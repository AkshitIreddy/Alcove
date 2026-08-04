/**
 * art/bake.ts — memoized rasters for art that is drawn once and reused.
 *
 * Two things live here: a promise-valued memory cache keyed by
 * `params × dpr`, and a cooperative pump that keeps a storm of cache misses
 * from landing in one task.
 *
 * ## Why there is no disk cache any more
 *
 * There used to be one: every baked canvas was PNG-encoded and written to
 * `appCacheDir()/art/{hash}.png`, so a warm start could read bytes instead of
 * repainting. That was the right trade for the painting stack it was built
 * for — seconds of brush work per room. It is the wrong trade for flat art.
 *
 * Measured (Chromium, d3d11 raster, the four flat case parts textures.ts bakes
 * at boot — plank 1200×40, recess 1200×280, post 34×320, crown 1228×64):
 *
 *   dpr 1        draw 23.2ms   PNG encode 38.0ms   PNG decode 12.1ms    30KB
 *   dpr 2        draw 34.4ms   PNG encode 62.4ms   PNG decode 32.0ms    78KB
 *
 * A cold boot with the cache paid draw + encode (61ms / 97ms) where redrawing
 * costs 23ms / 34ms — the cache made the first run of every room 2.6× more
 * expensive, and the encode was awaited on the critical path (the blob had to
 * be produced before `transferToImageBitmap` detached the canvas). A warm boot
 * saved 11ms of CPU at dpr 1 and nothing at all at dpr 2, and spent a `mkdir`
 * plus one `readFile` per part over the Tauri IPC bridge to do it — and every
 * miss paid that IPC round trip *before* the producer was even allowed to
 * start, because the disk read was awaited first.
 *
 * So: memory only. The parts are a few dozen path fills; redrawing them is
 * cheaper than talking about them. This also takes `@tauri-apps/plugin-fs`
 * off the eager startup module graph — it was the only static import of that
 * plugin in the app, everything else loads it on demand.
 */

/* ----------------------------- memory cache ------------------------------ */

/**
 * Promise-valued so concurrent requests for the same key share one bake.
 * The resolved ImageBitmaps are shared — callers must never close() them.
 *
 * Keyed by the full `params|dpr` string rather than a hash of it: the map is
 * in-process and a few dozen entries deep, so there is nothing to gain from
 * shortening the key and a (small) correctness risk in a 32-bit collision
 * serving one room's plank to another.
 */
const memoryCache = new Map<string, Promise<ImageBitmap>>();

function memoryKey(params: string, dpr: number): string {
  return `${params}|${dpr}`;
}

/* ------------------------------ profiling -------------------------------- */

/** One timed unit of bake work (a producer run, or a spine paint). */
export interface BakeSample {
  /** Truncated params (first 96 chars) — enough to identify the art piece. */
  what: string;
  ms: number;
  /**
   * `'bake'` — the producer ran on this thread; `'spine'` — a spine, wherever
   * it was painted. (`'disk'` is retained for compatibility with anything
   * reading the ring buffer; nothing emits it since the disk cache went.)
   */
  kind: 'disk' | 'bake' | 'spine';
  at: number;
}

/**
 * Ring buffer of recent bake timings. Always on (numbers only, capped) so the
 * diagnostics log and the perf HUD can read it; exposed on globalThis for QA
 * probes when any ?fx= / ?bakeprof= flag is present.
 */
const PROFILE_CAP = 600;
const bakeSamples: BakeSample[] = [];

export function recordBakeSample(sample: BakeSample): void {
  bakeSamples.push(sample);
  if (bakeSamples.length > PROFILE_CAP) bakeSamples.splice(0, bakeSamples.length - PROFILE_CAP);
}

if (typeof location !== 'undefined' && /[?&](fx|bakeprof)=/.test(location.search)) {
  (globalThis as Record<string, unknown>)['__bakeProfile'] = bakeSamples;
}

/* --------------------------- cooperative pump ----------------------------- */

/**
 * Art producers are heavy SYNCHRONOUS canvas work. Nothing stopped a dozen of
 * them resuming inside one microtask drain, which is how a cold cache used to
 * pin the main thread for a minute-plus with a white, unresponsive window.
 *
 * Every cache miss waits its turn here, and the pump still releases exactly
 * ONE producer per turn, so:
 *   - a producer can never chain onto the previous one inside a single task;
 *   - the browser gets a paint + input opportunity between every two bakes;
 *   - the worst-case block is one producer, not the whole storm.
 *
 * ## What a "turn" costs
 *
 * The turn used to be a `requestIdleCallback` unconditionally. Measured on an
 * idle main thread that is worth **16–17ms per turn** — a whole frame of
 * latency handed to every producer, whatever it costs. The four flat case
 * parts draw in 23.2ms of real work (dpr 1) and took **63.9ms** median from
 * first request to all four settled; roughly 40ms of that was the pump.
 *
 * So the scheduler is now chosen by what the last producer actually cost.
 * Cheap producers — the flat parts, a wallpaper tile — yield through a plain
 * macrotask, which still ends the current task (the whole point: paint and
 * input get their chance) but costs microseconds instead of a frame. A
 * producer that overran a frame's worth of budget puts the pump back on
 * `requestIdleCallback`, where the browser decides when there is room, with
 * the timeout guaranteeing progress on a thread that never goes idle (the
 * shelf renders continuously while art lands).
 *
 * Re-entrancy is unchanged and still safe: a producer that awaits another
 * bakeCached queues behind the pump and suspends — it holds no lock, and the
 * pump never waits on a producer, so there is no deadlock.
 */
const PUMP_IDLE_TIMEOUT_MS = 90;

/**
 * A producer at or under this is not worth a frame of scheduling latency: it
 * fits inside a frame next to the shelf's own render with room to spare.
 */
const CHEAP_PRODUCER_MS = 8;

/** Cost of the most recent producer; picks the next turn's scheduler. */
let lastProducerMs = 0;

const pumpQueue: Array<() => void> = [];
let pumpScheduled = false;

/** MessageChannel macrotask — the cheapest way to end a task and continue. */
let fastPort: MessagePort | null = null;
const fastPending: Array<() => void> = [];

/**
 * End this task and continue on the next one, without waiting for idle.
 * Returns false when the environment offers no such primitive, in which case
 * the caller falls back to requestIdleCallback/setTimeout.
 *
 * `scheduler.postTask` is preferred: the browser knows it is a task competing
 * with rendering and schedules it accordingly. A MessageChannel round trip is
 * the same shape without the priority hint.
 */
function fastTurn(cb: () => void): boolean {
  const scheduler = (globalThis as { scheduler?: { postTask?: unknown } }).scheduler;
  if (typeof scheduler?.postTask === 'function') {
    (scheduler.postTask as (fn: () => void, opts: { priority: string }) => Promise<void>)(cb, {
      priority: 'user-visible',
    }).catch(() => {
      // No signal is passed, so this cannot abort in practice — but a pump
      // whose turn never arrives stalls every queued producer forever, so
      // run it rather than risk that.
      cb();
    });
    return true;
  }
  if (typeof MessageChannel === 'undefined') return false;
  if (fastPort === null) {
    const channel = new MessageChannel();
    fastPort = channel.port2;
    channel.port1.onmessage = (): void => {
      fastPending.shift()?.();
    };
    fastPort.start?.();
  }
  fastPending.push(cb);
  fastPort.postMessage(0);
  return true;
}

function scheduleTurn(cb: () => void): void {
  if (lastProducerMs <= CHEAP_PRODUCER_MS && fastTurn(cb)) return;
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => cb(), { timeout: PUMP_IDLE_TIMEOUT_MS });
    return;
  }
  setTimeout(cb, 0);
}

function pump(): void {
  if (pumpScheduled || pumpQueue.length === 0) return;
  pumpScheduled = true;
  scheduleTurn(() => {
    pumpScheduled = false;
    // Release exactly one waiter. Its continuation (the producer) runs in this
    // task's microtask drain; the next waiter gets a fresh turn.
    pumpQueue.shift()?.();
    pump();
  });
}

/**
 * Resolve on the next pump turn, one caller per turn. Exported so other
 * bake-time producers (spine atlas slices) can share the same fairness queue.
 */
export function awaitBakeTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    pumpQueue.push(resolve);
    pump();
  });
}

/** A producer bakes the raster for a cache miss and hands back its canvas. */
export type CanvasProducer = () => Promise<OffscreenCanvas>;

/**
 * The cached bake path every baker goes through:
 *  1. in-memory Map hit → shared ImageBitmap
 *  2. miss → wait a pump turn → produce() → transferToImageBitmap
 *
 * There is no off-thread route here, and no disk. Routing a bake to the art
 * worker only ever paid for the painting stack's brush work; the flat parts
 * are a few dozen path fills, less work than posting a message about them.
 * Spines still paint off-thread, but they go straight to `artOffload.spine()`
 * from `SpineFactory` with the recipe in hand rather than encoded in a key.
 */
export function bakeCached(
  params: string,
  dpr: number,
  produce: CanvasProducer,
): Promise<ImageBitmap> {
  const key = memoryKey(params, dpr);
  const hit = memoryCache.get(key);
  if (hit) return hit;

  const pending = (async () => {
    // Wait for a turn so this producer's synchronous cost lands in a task of
    // its own rather than chaining onto whatever bake just finished.
    await awaitBakeTurn();
    const t0 = performance.now();
    const canvas = await produce();
    // Canvas 2D records commands lazily — `produce()` alone times the
    // recording, not the raster. `transferToImageBitmap` is what forces the
    // flush, so the cost the pump feeds back has to span both or it will
    // read every producer as free.
    const bitmap = canvas.transferToImageBitmap();
    const ms = performance.now() - t0;
    lastProducerMs = ms;
    recordBakeSample({ what: params.slice(0, 96), ms, kind: 'bake', at: t0 });
    return bitmap;
  })();

  // Do not poison the cache with rejected bakes.
  const wrapped = pending.catch((err: unknown) => {
    memoryCache.delete(key);
    throw err;
  });
  memoryCache.set(key, wrapped);
  return wrapped;
}
