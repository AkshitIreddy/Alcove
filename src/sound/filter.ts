/**
 * src/sound/filter.ts — the one real filter Howler will carry.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT HOWLER ACTUALLY EXPOSES, AND WHAT IT DOES NOT
 * ─────────────────────────────────────────────────────────────────────────
 * `soundSets.ts` conditions the shipped cues with substitution, rate, gain,
 * layering, pool and jitter. Every one of those is a `Howl` method. A filter
 * is not — `Howl` has no tone control of any kind — so the note in TODO.md
 * said sets could not filter at all. That is half right, and the half it gets
 * wrong is worth having:
 *
 *   Howler DOES expose its Web Audio plumbing. `Howler.ctx` is the
 *   AudioContext and `Howler.masterGain` is the master GainNode — both are
 *   public, both are in `@types/howler`, and howler's own source calls the
 *   second one "useful for plugins or advanced usage". Every playing sound
 *   connects its node to `masterGain`, and `masterGain` connects to
 *   `ctx.destination`. That last hop is a seam we are allowed to cut:
 *
 *       masterGain ──▶ destination                (howler's own wiring)
 *       masterGain ──▶ biquad ──▶ [biquad] ──▶ destination   (ours)
 *
 * So the filter this module installs is a REAL BiquadFilterNode running in
 * the browser's own Web Audio graph. It is not an EQ curve baked into a file
 * and it is not a gain trim dressed up as a filter.
 *
 * ── The three limits, stated plainly ────────────────────────────────────
 *
 * 1. IT IS A MASTER BUS, SO IT IS PER-SET AND NOT PER-ROLE. Every sound
 *    reaches `masterGain` already mixed, so one filter colours everything a
 *    set plays — including the ambient bed. Filtering only the hover tick
 *    would mean rewiring the GainNode of one playing sound, which lives at
 *    `howl._sounds[i]._node`: private, undocumented, and re-created per play.
 *    A voicing lever built on that would break on a howler patch release and
 *    break silently. A set's filter is therefore a property of the ROOM the
 *    app is heard in, which is also the only thing any of them wanted to say.
 * 2. IT NEEDS THE WEB AUDIO BACKEND. With `Howler.usingWebAudio === false`
 *    (no AudioContext, or a Howl opted into HTML5 streaming) there is no
 *    master gain to cut into and no filter is installed. Nothing else about
 *    the set changes; `busFilterStatus()` says so rather than pretending.
 * 3. THE CONTEXT CAN BE REPLACED UNDER US. `Howler.unload()` closes the
 *    AudioContext and builds a fresh `masterGain` wired straight to the new
 *    destination, which throws our chain away. `applyBusFilter` is therefore
 *    written to be called repeatedly and cheaply: it remembers which context
 *    it wired and re-installs when that identity changes.
 *
 * Failure is never allowed to be silence. Every rewire runs inside a
 * try/catch whose recovery is `masterGain.connect(destination)` — the exact
 * wiring howler shipped — so the worst case is an unfiltered app, not a
 * disconnected one.
 */

/* ───────────────────────────── the spec shape ───────────────────────────── */

/**
 * One biquad stage. `gain` is in dB and only means anything for the shelving
 * and peaking types, exactly as in Web Audio — this is a thin description of
 * a BiquadFilterNode, not a new abstraction over it.
 */
export interface BusFilterStage {
  readonly type: BiquadFilterType;
  readonly frequency: number;
  readonly q?: number;
  /** dB. Shelving/peaking only; ignored by pass and notch types. */
  readonly gain?: number;
}

/** A whole chain, in signal order. Empty ⇒ howler's own wiring, untouched. */
export type BusFilter = readonly BusFilterStage[];

export const NO_BUS_FILTER: BusFilter = [];

/**
 * Bounds. The ceiling on `gain` is the one that matters: the bus sits after
 * the reader's master fader and before the destination, so a boost here can
 * only spend headroom the mix left, and +4 dB is about what a set mastered to
 * −18 dBFS peaks can carry without the clamp at the destination doing the
 * tone-shaping for us.
 */
const FREQ_MIN = 20;
const FREQ_MAX = 20_000;
const Q_MIN = 0.05;
const Q_MAX = 12;
export const BUS_FILTER_MAX_BOOST_DB = 4;
const GAIN_MIN_DB = -24;

const clamp = (v: number, lo: number, hi: number, fallback: number): number =>
  !Number.isFinite(v) ? fallback : v < lo ? lo : v > hi ? hi : v;

/** A stage with every field resolved and clamped — what actually gets wired. */
export interface ResolvedStage {
  readonly type: BiquadFilterType;
  readonly frequency: number;
  readonly q: number;
  readonly gain: number;
}

export function resolveStage(stage: BusFilterStage): ResolvedStage {
  return {
    type: stage.type,
    frequency: clamp(stage.frequency, FREQ_MIN, FREQ_MAX, 1000),
    q: clamp(stage.q ?? 0.7071, Q_MIN, Q_MAX, 0.7071),
    gain: clamp(stage.gain ?? 0, GAIN_MIN_DB, BUS_FILTER_MAX_BOOST_DB, 0),
  };
}

/**
 * A stable one-line description of a chain.
 *
 * Doubles as the identity used to decide whether a re-wire is needed, so it
 * has to mention every field a stage can carry — a tag that dropped `gain`
 * would leave a set's shelf at the previous set's depth and nothing would
 * ever report it.
 */
export function describeBusFilter(filter: BusFilter): string {
  return filter
    .map((raw) => {
      const s = resolveStage(raw);
      const gain = s.gain === 0 ? '' : `${s.gain > 0 ? '+' : ''}${s.gain}dB`;
      return `${s.type}@${Math.round(s.frequency)}Hz/Q${s.q.toFixed(2)}${gain}`;
    })
    .join(' + ');
}

/* ─────────────────────────── the howler surface ─────────────────────────── */

/**
 * The slice of the howler namespace this module touches. Both fields are
 * declared by `@types/howler`; `usingWebAudio` is howler's own answer to
 * "is there a graph at all".
 */
export interface HowlerAudioGlobal {
  readonly usingWebAudio?: boolean;
  readonly ctx?: AudioContext | null;
  readonly masterGain?: GainNode | null;
  /**
   * howler's power saver, and NOT readonly on purpose — the engine turns it
   * off. It suspends the AudioContext after 30 s with nothing playing, and
   * the resume path is where a play goes wrong: `Howl.play()` sees
   * `Howler.state !== 'running'`, sets `_playLock`, and defers the sound into
   * a `once('resume')` callback, which makes every following `volume()` and
   * `rate()` queue behind it and drain from a `setTimeout(0)`. The cue then
   * runs a whole task at the Howl's GROUP level instead of its own. Thirty
   * seconds of quiet before a click is the ordinary rhythm of a notes app,
   * so this fired constantly. See `engine.ts`'s `loadHowlerOnce`.
   */
  autoSuspend?: boolean;
}

export interface BusFilterStatus {
  /** True once a real BiquadFilterNode chain is running in howler's graph. */
  readonly installed: boolean;
  /** Whether Web Audio is available to install one at all. */
  readonly supported: boolean;
  /** Why nothing is installed, when nothing is. Null when all is well. */
  readonly reason: string | null;
  /** `describeBusFilter` of what is wired right now (''  ⇒ nothing). */
  readonly tag: string;
  readonly stages: readonly ResolvedStage[];
}

const IDLE: BusFilterStatus = {
  installed: false,
  supported: false,
  reason: 'web audio not started',
  tag: '',
  stages: [],
};

let status: BusFilterStatus = IDLE;

/** The context whose graph we last wired, so a replaced one is noticed. */
let wiredCtx: AudioContext | null = null;
let wiredGain: GainNode | null = null;
let wiredTag = '';
let nodes: BiquadFilterNode[] = [];

export function busFilterStatus(): BusFilterStatus {
  return status;
}

/** The live nodes, for QA taps only (a probe measures the real chain). */
export function busFilterNodes(): readonly BiquadFilterNode[] {
  return nodes;
}

function teardown(): void {
  for (const node of nodes) {
    try {
      node.disconnect();
    } catch {
      // A node whose context was closed under us is already gone.
    }
  }
  nodes = [];
}

/**
 * Wire (or re-wire) the master bus for `filter`.
 *
 * Idempotent and cheap on the hot path: when the context, the master gain and
 * the requested chain are all the same as last time it does nothing at all,
 * which is what lets the engine call it before every play rather than trying
 * to predict when howler built or replaced its graph.
 */
export function applyBusFilter(
  howler: HowlerAudioGlobal | undefined,
  filter: BusFilter,
): BusFilterStatus {
  const tag = describeBusFilter(filter);

  if (howler === undefined) {
    status = { ...IDLE, tag: '', reason: 'howler not loaded' };
    return status;
  }
  const ctx = howler.ctx ?? null;
  const master = howler.masterGain ?? null;
  if (howler.usingWebAudio === false) {
    teardown();
    wiredCtx = null;
    wiredGain = null;
    wiredTag = '';
    status = {
      installed: false,
      supported: false,
      reason: 'howler is in HTML5 audio mode — there is no master gain to filter',
      tag: '',
      stages: [],
    };
    return status;
  }
  if (ctx === null || master === null) {
    // Howler builds the context lazily; this is the ordinary state before the
    // first sound and is not a failure.
    status = { ...IDLE, tag: '', reason: 'web audio not started' };
    return status;
  }

  const unchanged = ctx === wiredCtx && master === wiredGain && tag === wiredTag;
  if (unchanged) return status;

  const stages = filter.map(resolveStage);
  try {
    teardown();
    // One disconnect() drops every output of the master gain, which is both
    // the direct hop to the destination howler made and any chain we made
    // before. Everything downstream is rebuilt below.
    master.disconnect();
    if (stages.length === 0) {
      master.connect(ctx.destination);
      wiredCtx = ctx;
      wiredGain = master;
      wiredTag = '';
      status = { installed: false, supported: true, reason: null, tag: '', stages: [] };
      return status;
    }
    let head: AudioNode = master;
    for (const stage of stages) {
      const node = ctx.createBiquadFilter();
      node.type = stage.type;
      node.frequency.value = stage.frequency;
      node.Q.value = stage.q;
      node.gain.value = stage.gain;
      head.connect(node);
      head = node;
      nodes.push(node);
    }
    head.connect(ctx.destination);
    wiredCtx = ctx;
    wiredGain = master;
    wiredTag = tag;
    status = { installed: true, supported: true, reason: null, tag, stages };
    return status;
  } catch (err) {
    // Never leave the bus dangling: put howler's own wiring back.
    teardown();
    try {
      master.disconnect();
      master.connect(ctx.destination);
    } catch {
      // Nothing further we can do; the context is gone.
    }
    wiredCtx = ctx;
    wiredGain = master;
    wiredTag = '';
    status = {
      installed: false,
      supported: true,
      reason: `could not wire the filter: ${String(err)}`,
      tag: '',
      stages: [],
    };
    return status;
  }
}

/** Forget everything, for tests. Does not touch a live graph. */
export function resetBusFilterForTests(): void {
  nodes = [];
  wiredCtx = null;
  wiredGain = null;
  wiredTag = '';
  status = IDLE;
}
