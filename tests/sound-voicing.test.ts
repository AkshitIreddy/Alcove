/**
 * tests/sound-voicing.test.ts — THE LEVEL A CUE STARTS AT.
 *
 * The reader, on the installed build:
 *
 *   "i have just discovered a major ting, a lot of time i said bad but
 *    actually there is a sound bug that turns that sound effects into
 *    jitterry sand paper, for example when i click on studio its a nice tap
 *    when i click again to close it becomes jittery sand paper (happens like
 *    maybe 2 times every 3 times)"
 *
 * `shots-now/sound-grit.mjs` records the app's real Web Audio output through
 * an AudioWorklet spliced into howler's master bus and measures every play.
 * It found the defect: across five phases and 137 recorded plays, EVERY play
 * started at gain 1.000 and was corrected to 0.28–0.56 afterwards.
 *
 * Why that is audible only sometimes — the reader's "2 times every 3" — is
 * the shape of the race. Howler's `play()` writes the Howl's GROUP volume
 * into the new voice's gain node one statement before `bufferSource.start()`,
 * and the engine's `howl.volume(v, id)` lands after. Two `setValueAtTime`
 * events at the same AudioContext time replace one another and nothing is
 * heard; one render quantum apart and the cue opens 2–4× too loud and then
 * steps discontinuously in the middle of its own attack.
 *
 * THIS FILE IS THE GATE. The stub below is not a convenience double: it
 * mirrors the two pieces of howler that caused the bug — `Sound.reset()`
 * copying the group volume and rate onto a fresh voice, and the group setters
 * walking every live id — so a regression that puts the level back after the
 * play is a failing test rather than a listening argument.
 *
 * A listening claim is worth nothing here. The reader has been telling us the
 * sound is bad for weeks and this was measurable the whole time.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  type HowlLike,
  type HowlOptions,
  play,
  resetEngineForTests,
  setHowlerLoader,
  setPlayRngForTests,
  setSoundscape,
  setVolumes,
  startAmbient,
} from '../src/sound/engine';

/* ─────────────────────────── a truthful Howl stub ───────────────────────── */

/** What one voice was doing when it began, and what it ended up at. */
interface VoiceRecord {
  readonly id: number;
  readonly src: string;
  /** The gain the voice's node was given by `play()` itself. */
  readonly startVolume: number;
  /** The playback rate `play()` gave it. */
  readonly startRate: number;
  /** Where it was by the time the play call returned. */
  volume: number;
  rate: number;
}

/**
 * A Howl that behaves like howler where it matters.
 *
 * - a new voice inherits the GROUP volume and rate (`Sound.reset()`), and that
 *   is the value its gain node is set to before the buffer starts;
 * - `volume(v)` / `rate(r)` with no id move the group AND every live voice;
 * - `volume(v, id)` / `rate(r, id)` move one voice only.
 */
class VoiceHowl implements HowlLike {
  static instances: VoiceHowl[] = [];
  static voices: VoiceRecord[] = [];

  readonly options: HowlOptions;
  groupVolume = 1;
  groupRate = 1;
  private nextId = 0;
  private readonly liveIds = new Set<number>();
  readonly fades: { from: number; to: number; duration: number; id: number | undefined }[] = [];
  private readonly onceHandlers: { event: string; fn: () => void; id: number | undefined }[] = [];

  constructor(options: HowlOptions) {
    this.options = options;
    VoiceHowl.instances.push(this);
  }

  get src(): string {
    return this.options.src[0] as string;
  }

  private recordOf(id: number): VoiceRecord | undefined {
    for (let i = VoiceHowl.voices.length - 1; i >= 0; i--) {
      const v = VoiceHowl.voices[i] as VoiceRecord;
      if (v.id === id && v.src === this.src) return v;
    }
    return undefined;
  }

  play(): number {
    const id = ++this.nextId;
    this.liveIds.add(id);
    VoiceHowl.voices.push({
      id,
      src: this.src,
      startVolume: this.groupVolume,
      startRate: this.groupRate,
      volume: this.groupVolume,
      rate: this.groupRate,
    });
    return id;
  }

  /** Let every sounding voice finish, the way a 140 ms click does. */
  endAll(): void {
    this.liveIds.clear();
  }

  stop(id?: number): void {
    if (id === undefined) this.liveIds.clear();
    else this.liveIds.delete(id);
  }

  playing(id?: number): boolean {
    return id === undefined ? this.liveIds.size > 0 : this.liveIds.has(id);
  }

  volume(vol: number, id?: number): void {
    if (id === undefined) {
      this.groupVolume = vol;
      for (const live of this.liveIds) {
        const rec = this.recordOf(live);
        if (rec) rec.volume = vol;
      }
      return;
    }
    const rec = this.recordOf(id);
    if (rec) rec.volume = vol;
  }

  rate(rate: number, id?: number): void {
    if (id === undefined) {
      this.groupRate = rate;
      for (const live of this.liveIds) {
        const rec = this.recordOf(live);
        if (rec) rec.rate = rate;
      }
      return;
    }
    const rec = this.recordOf(id);
    if (rec) rec.rate = rate;
  }

  fade(from: number, to: number, duration: number, id?: number): void {
    this.fades.push({ from, to, duration, id });
    this.volume(to, id);
  }

  once(event: string, fn: () => void, id?: number): void {
    this.onceHandlers.push({ event, fn, id });
  }

  unload(): void {
    this.liveIds.clear();
  }

  emit(event: string): void {
    const pending = this.onceHandlers.filter((h) => h.event === event);
    for (const h of pending) h.fn();
  }
}

const howlerStub = { autoSuspend: true as boolean };

const installStub = (): void => {
  resetEngineForTests();
  VoiceHowl.instances = [];
  VoiceHowl.voices = [];
  howlerStub.autoSuspend = true;
  setHowlerLoader(async () => ({
    Howl: VoiceHowl as unknown as new (o: HowlOptions) => HowlLike,
    Howler: howlerStub,
  }));
};

const stubFor = (src: string): VoiceHowl | undefined =>
  VoiceHowl.instances.find((h) => h.src === src);

/** Finish every sounding voice — the gap between two real button presses. */
const letEverythingFinish = (): void => {
  for (const h of VoiceHowl.instances) h.endAll();
};

/* ────────────────────────────────── gates ───────────────────────────────── */

describe('a cue starts at the level and rate it was asked for', () => {
  beforeEach(installStub);

  it('plays click-soft 30 times without one correction after the sound began', async () => {
    setVolumes({ master: 0.8, ui: 0.7 });
    for (let i = 0; i < 30; i++) {
      await play('click-soft');
      letEverythingFinish();
    }

    expect(VoiceHowl.voices).toHaveLength(30);
    const wrong = VoiceHowl.voices.filter(
      (v) => Math.abs(v.startVolume - v.volume) > 1e-12 || Math.abs(v.startRate - v.rate) > 1e-12,
    );
    // Named rather than counted: a failure should say which play and by how
    // much, not "expected 4 to be 0".
    expect(
      wrong.map((v) => `${v.src}#${v.id} began at ${v.startVolume}/${v.startRate}, ended at ${v.volume}/${v.rate}`),
    ).toEqual([]);
  });

  it('never begins a cue at unity when the mix asks for less — the measured defect', async () => {
    setVolumes({ master: 0.8, ui: 0.7 });
    setPlayRngForTests(() => 0.5); // jitter exactly 1, so the maths is exact
    await play('click-soft');
    const voice = VoiceHowl.voices[0] as VoiceRecord;
    // 0.7 ui x 0.8 master, the `calm` trim being 1.
    expect(voice.startVolume).toBeCloseTo(0.56, 10);
    expect(voice.startVolume).not.toBe(1);
  });

  it('holds for every family, at every volume the sliders can reach', async () => {
    for (const master of [0.15, 0.5, 1]) {
      for (const family of ['click-soft', 'pop-soft', 'page-flip', 'book-pull', 'check-done'] as const) {
        installStub();
        setVolumes({ master, ui: 0.7, pages: 0.8, shelf: 0.7 });
        for (let i = 0; i < 8; i++) {
          await play(family);
          letEverythingFinish();
        }
        for (const v of VoiceHowl.voices) {
          expect(v.startVolume, `${family} @ master ${master}`).toBeCloseTo(v.volume, 12);
          expect(v.startRate, `${family} @ master ${master}`).toBeCloseTo(v.rate, 12);
        }
      }
    }
  });

  it('does not bequeath one play\'s jittered pitch to the next press', async () => {
    setPlayRngForTests(() => 0.95); // pitch pushed to the top of the band
    await play('pop-soft');
    letEverythingFinish();
    const first = VoiceHowl.voices[0] as VoiceRecord;
    expect(first.startRate).not.toBe(1);

    // A caller that wants the plain cue must get the plain cue.
    await play('pop-soft', { noJitter: true });
    const second = VoiceHowl.voices[1] as VoiceRecord;
    expect(second.startRate).toBe(1);
    expect(second.rate).toBe(1);
  });

  it('leaves a voice that is still ringing alone rather than yanking it', async () => {
    setVolumes({ master: 1, ui: 1 });
    // A spread-out RNG so consecutive plays really do ask for different levels
    // — with jitter pinned to 1 the restore would be indistinguishable from
    // doing nothing, and the test would pass without testing anything.
    let n = 1;
    setPlayRngForTests(() => {
      n = (n * 16807 + 12345) % 2147483647;
      return (n % 1009) / 1009;
    });

    // The same FILE, ten times, with nothing allowed to finish in between:
    // howler's group setters walk every live id, so each press would drag
    // every still-ringing copy to its own level if they were not put back.
    const settled: number[] = [];
    for (let i = 0; i < 10; i++) {
      await play('click-soft-2');
      const fresh = VoiceHowl.voices[i] as VoiceRecord;
      // The new voice began at its own level even mid-overlap.
      expect(fresh.startVolume).toBeCloseTo(fresh.volume, 12);
      expect(fresh.startRate).toBeCloseTo(fresh.rate, 12);
      // And nothing already sounding moved.
      for (let k = 0; k < i; k++) {
        expect((VoiceHowl.voices[k] as VoiceRecord).volume, `voice ${k} after press ${i}`).toBe(
          settled[k] as number,
        );
      }
      settled.push(fresh.volume);
    }
    expect(new Set(settled.map((v) => v.toFixed(6))).size).toBeGreaterThan(3);
  });

  it('starts the ambient bed silent instead of at the group level', async () => {
    setSoundscape('fireplace');
    await startAmbient();
    const bed = stubFor('/sounds/ambient-fireplace.wav');
    expect(bed).toBeDefined();
    const voice = VoiceHowl.voices.find((v) => v.src === '/sounds/ambient-fireplace.wav');
    expect(voice).toBeDefined();
    // The bed used to begin at the Howl's group volume and be set to 0 after,
    // which put a burst of full-level fireplace in front of every fade-in.
    expect(voice?.startVolume).toBe(0);
    expect(bed?.fades[0]).toMatchObject({ from: 0, duration: 600 });
  });

  it('turns howler\'s power saver off so a play never has to wake the graph', async () => {
    expect(howlerStub.autoSuspend).toBe(true);
    await play('click-soft');
    // The resume path defers the sound into a `once("resume")` callback with
    // `_playLock` set, which queues volume() and rate() behind it and drains
    // them from a setTimeout(0) — a whole task at the wrong level. Thirty
    // seconds of quiet before a click is the ordinary rhythm of a notes app.
    expect(howlerStub.autoSuspend).toBe(false);
  });
});
