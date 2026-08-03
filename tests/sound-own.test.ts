// @vitest-environment node
/**
 * tests/sound-own.test.ts — the two levers TODO.md said a sound set could not
 * have: the reader's own files, and a real filter.
 *
 * Both were written down as impossible, and only one of them was. This file
 * is where the difference is pinned, because the failure mode for each is
 * silent:
 *
 *   THE FILTER    is a BiquadFilterNode chain spliced into howler's own graph
 *                 between `Howler.masterGain` and `ctx.destination`. What can
 *                 go wrong is the SPLICE, not the maths: a chain built and
 *                 never connected, a master gain left disconnected after a
 *                 throw (the whole app silent), or a re-wire that runs on
 *                 every play. A stub graph is enough to catch all three, and
 *                 deliberately is NOT enough to prove the filter filters —
 *                 `scripts/probe-sound-bus.mjs` measures that in a real
 *                 AudioContext, which is the only place it can be measured.
 *   THE OWN SETS  are a base set plus overrides. The failure is a file that is
 *                 stored, listed, previewed and never actually played, because
 *                 the decision is made three layers below the panel — inside
 *                 `playRole`, after the base's substitution table has already
 *                 chosen a different family.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  FAMILY_NAMES,
  SOUND_FAMILIES,
  getBaseSoundSet,
  getBusFilter,
  getEngineState,
  play,
  resetEngineForTests,
  setHowlerLoader,
  setPlayRngForTests,
  setReducedSound,
  setSoundCharacter,
  setSoundSet,
  setVolumes,
  type FamilyName,
  type HowlLike,
  type HowlOptions,
  type SoundName,
} from '../src/sound/engine';
import {
  BUS_FILTER_MAX_BOOST_DB,
  NO_BUS_FILTER,
  applyBusFilter,
  busFilterNodes,
  busFilterStatus,
  describeBusFilter,
  resetBusFilterForTests,
  resolveStage,
  type BusFilter,
  type HowlerAudioGlobal,
} from '../src/sound/filter';
import {
  SOUND_SETS,
  SOUND_SET_GROUPS,
  SOUND_SET_IDS,
  soundSetFilter,
  soundSetSpec,
} from '../src/sound/soundSets';
import {
  MAX_USER_SOUND_SETS,
  USER_SET_PREFIX,
  baseSetIdOf,
  clearUserSoundSets,
  freeUserSoundSetId,
  isUserSoundSetId,
  registerUserSoundSet,
  sanitizeSetName,
  snapshotUserSoundSets,
  unregisterUserSoundSet,
  userCueCount,
  userCueFor,
  userSoundSet,
  type UserSoundSet,
  type UserSoundSetId,
} from '../src/sound/userSoundSets';
import {
  AUDIO_EXTENSIONS,
  MAX_CUE_BYTES,
  ROLE_LABELS,
  roleFromFileName,
  roleVocabulary,
} from '../src/sound/userSoundSetStore';

/* ═══════════════════════════ a stub Web Audio graph ══════════════════════ */

/**
 * Enough of an AudioNode to answer the only question that matters: what is
 * connected to what. Nothing here processes a sample, and nothing here is
 * asked to — see the header.
 */
class StubNode {
  outputs: StubNode[] = [];
  connect(to: StubNode): StubNode {
    this.outputs.push(to);
    return to;
  }
  disconnect(to?: StubNode): void {
    this.outputs = to === undefined ? [] : this.outputs.filter((o) => o !== to);
  }
}

class StubBiquad extends StubNode {
  type = 'lowpass';
  frequency = { value: 350 };
  Q = { value: 1 };
  gain = { value: 0 };
}

class StubCtx {
  destination = new StubNode();
  created: StubBiquad[] = [];
  throwOnCreate = false;
  createBiquadFilter(): StubBiquad {
    if (this.throwOnCreate) throw new Error('no biquads today');
    const node = new StubBiquad();
    this.created.push(node);
    return node;
  }
}

interface Graph {
  ctx: StubCtx;
  master: StubNode;
  howler: HowlerAudioGlobal;
}

const graph = (usingWebAudio = true): Graph => {
  const ctx = new StubCtx();
  const master = new StubNode();
  return {
    ctx,
    master,
    howler: {
      usingWebAudio,
      ctx: ctx as unknown as AudioContext,
      masterGain: master as unknown as GainNode,
    },
  };
};

/** Follow the outputs from `from` and report whether `to` is downstream. */
const reaches = (from: StubNode, to: StubNode): boolean => {
  const seen = new Set<StubNode>();
  const walk = (node: StubNode): boolean => {
    if (node === to) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    return node.outputs.some(walk);
  };
  return from.outputs.some(walk);
};

/** The single path from `from` to the end, as a list. */
const chainFrom = (from: StubNode): StubNode[] => {
  const out: StubNode[] = [];
  let node = from;
  while (node.outputs.length === 1) {
    node = node.outputs[0] as StubNode;
    out.push(node);
    if (out.length > 12) break;
  }
  return out;
};

const LOWPASS: BusFilter = [{ type: 'lowpass', frequency: 1500, q: 0.8 }];
const TWO_STAGE: BusFilter = [
  { type: 'lowpass', frequency: 4400, q: 0.707 },
  { type: 'lowshelf', frequency: 180, gain: 3 },
];

/* ═════════════════════════════ the filter module ═════════════════════════ */

describe('the master-bus filter', () => {
  beforeEach(() => {
    resetBusFilterForTests();
  });

  it('splices real biquads between the master gain and the destination', () => {
    const g = graph();
    // howler's own wiring, which we are about to cut into.
    g.master.connect(g.ctx.destination);

    const status = applyBusFilter(g.howler, TWO_STAGE);
    expect(status.installed).toBe(true);
    expect(status.supported).toBe(true);
    expect(status.reason).toBeNull();

    const chain = chainFrom(g.master);
    expect(chain).toHaveLength(3); // two biquads, then the destination
    expect(chain[0]).toBeInstanceOf(StubBiquad);
    expect(chain[1]).toBeInstanceOf(StubBiquad);
    expect(chain[2]).toBe(g.ctx.destination);
    // The direct hop howler made is gone: exactly one path, through the chain.
    expect(g.master.outputs).toHaveLength(1);
  });

  it('sets every biquad parameter from the stage, in order', () => {
    const g = graph();
    applyBusFilter(g.howler, TWO_STAGE);
    const [first, second] = g.ctx.created;
    expect(first.type).toBe('lowpass');
    expect(first.frequency.value).toBe(4400);
    expect(first.Q.value).toBeCloseTo(0.707, 6);
    expect(second.type).toBe('lowshelf');
    expect(second.frequency.value).toBe(180);
    expect(second.gain.value).toBe(3);
    // The default Q is Butterworth, not zero — a q of 0 is a different filter.
    expect(second.Q.value).toBeCloseTo(0.7071, 4);
  });

  it('is a no-op when nothing moved, so it can live on the play path', () => {
    const g = graph();
    applyBusFilter(g.howler, LOWPASS);
    expect(g.ctx.created).toHaveLength(1);
    for (let i = 0; i < 20; i += 1) applyBusFilter(g.howler, LOWPASS);
    expect(g.ctx.created).toHaveLength(1);
    expect(busFilterNodes()).toHaveLength(1);
  });

  it('re-wires when the chain changes, and drops the old nodes', () => {
    const g = graph();
    applyBusFilter(g.howler, LOWPASS);
    const old = busFilterNodes()[0] as unknown as StubNode;
    applyBusFilter(g.howler, TWO_STAGE);
    expect(g.ctx.created).toHaveLength(3);
    expect(old.outputs).toHaveLength(0); // disconnected, not left hanging
    expect(reaches(g.master, g.ctx.destination)).toBe(true);
    expect(chainFrom(g.master)).toHaveLength(3);
  });

  it('notices howler replacing its context and re-installs into the new one', () => {
    const a = graph();
    applyBusFilter(a.howler, LOWPASS);
    expect(reaches(a.master, a.ctx.destination)).toBe(true);

    // `Howler.unload()` closes the context and builds a fresh master gain.
    const b = graph();
    applyBusFilter(b.howler, LOWPASS);
    expect(b.ctx.created).toHaveLength(1);
    expect(reaches(b.master, b.ctx.destination)).toBe(true);
  });

  it('an empty chain restores howler\'s own wiring and reports not-installed', () => {
    const g = graph();
    applyBusFilter(g.howler, LOWPASS);
    const status = applyBusFilter(g.howler, NO_BUS_FILTER);
    expect(status.installed).toBe(false);
    expect(status.supported).toBe(true);
    expect(status.reason).toBeNull();
    expect(g.master.outputs).toEqual([g.ctx.destination]);
    expect(busFilterNodes()).toHaveLength(0);
  });

  it('says so, precisely, when Web Audio is not there', () => {
    expect(applyBusFilter(undefined, LOWPASS).reason).toBe('howler not loaded');

    const html5 = graph(false);
    const status = applyBusFilter(html5.howler, LOWPASS);
    expect(status.installed).toBe(false);
    expect(status.supported).toBe(false);
    expect(status.reason).toMatch(/HTML5/);
    expect(html5.ctx.created).toHaveLength(0);

    // The ordinary pre-first-sound state is not a failure.
    const lazy = applyBusFilter({ usingWebAudio: true, ctx: null, masterGain: null }, LOWPASS);
    expect(lazy.reason).toBe('web audio not started');
  });

  it('never leaves the bus disconnected when wiring throws', () => {
    const g = graph();
    g.master.connect(g.ctx.destination);
    g.ctx.throwOnCreate = true;

    const status = applyBusFilter(g.howler, LOWPASS);
    expect(status.installed).toBe(false);
    expect(status.supported).toBe(true);
    expect(status.reason).toMatch(/could not wire/);
    // The whole point: silence is not an acceptable failure mode.
    expect(g.master.outputs).toEqual([g.ctx.destination]);
  });

  it('clamps every field, and the tag names all of them', () => {
    const wild = resolveStage({ type: 'peaking', frequency: 1e9, q: 500, gain: 60 });
    expect(wild.frequency).toBe(20_000);
    expect(wild.q).toBe(12);
    expect(wild.gain).toBe(BUS_FILTER_MAX_BOOST_DB);
    expect(resolveStage({ type: 'lowpass', frequency: Number.NaN }).frequency).toBe(1000);

    // The tag doubles as the re-wire identity, so a field it forgets is a
    // change that never re-wires. Every one has to move the string.
    const base: BusFilter = [{ type: 'peaking', frequency: 900, q: 1.1, gain: 3 }];
    const tag = describeBusFilter(base);
    expect(tag).toBe('peaking@900Hz/Q1.10+3dB');
    expect(describeBusFilter([{ ...base[0], gain: -3 }])).not.toBe(tag);
    expect(describeBusFilter([{ ...base[0], q: 2 }])).not.toBe(tag);
    expect(describeBusFilter([{ ...base[0], frequency: 901 }])).not.toBe(tag);
    expect(describeBusFilter([{ ...base[0], type: 'notch' }])).not.toBe(tag);
    expect(describeBusFilter(NO_BUS_FILTER)).toBe('');
  });

  it('reports its status without being asked to re-wire', () => {
    const g = graph();
    applyBusFilter(g.howler, LOWPASS);
    expect(busFilterStatus().tag).toBe('lowpass@1500Hz/Q0.80');
    expect(busFilterStatus().stages).toHaveLength(1);
  });
});

/* ════════════════════════ the table's declared filters ═══════════════════ */

const VALID_TYPES = new Set([
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'peaking',
  'notch',
  'allpass',
]);

describe('the sets that declare a filter', () => {
  it('declares only filters the Web Audio API will accept, unclamped', () => {
    let declared = 0;
    for (const id of SOUND_SET_IDS) {
      const chains: Array<[string, BusFilter | undefined]> = [
        [id, soundSetSpec(id).filter],
        [`group ${soundSetSpec(id).group}`, SOUND_SET_GROUPS[soundSetSpec(id).group].filter],
      ];
      for (const [where, chain] of chains) {
        if (chain === undefined) continue;
        declared += 1;
        for (const stage of chain) {
          expect(VALID_TYPES.has(stage.type), `${where}: ${stage.type}`).toBe(true);
          expect(stage.frequency, where).toBeGreaterThanOrEqual(20);
          expect(stage.frequency, where).toBeLessThanOrEqual(20_000);
          // A declared value the clamp would silently change is a table that
          // lies about what it does.
          expect(resolveStage(stage), where).toEqual({
            type: stage.type,
            frequency: stage.frequency,
            q: stage.q ?? 0.7071,
            gain: stage.gain ?? 0,
          });
          if (stage.gain !== undefined) {
            expect(stage.gain, where).toBeLessThanOrEqual(BUS_FILTER_MAX_BOOST_DB);
          }
        }
      }
    }
    expect(declared).toBeGreaterThanOrEqual(5);
  });

  it('a set\'s own chain REPLACES its group\'s rather than compounding with it', () => {
    const overriders = SOUND_SET_IDS.filter(
      (id) =>
        soundSetSpec(id).filter !== undefined &&
        SOUND_SET_GROUPS[soundSetSpec(id).group].filter !== undefined,
    );
    // `glass-desk` over the studio group is the case the header describes.
    expect(overriders.length).toBeGreaterThan(0);
    for (const id of overriders) {
      const own = soundSetSpec(id).filter as BusFilter;
      expect(soundSetFilter(id), id).toEqual(own);
      expect(soundSetFilter(id).length, id).toBe(own.length);
    }
  });

  it('inherits the group\'s chain, and answers nothing for the rest', () => {
    for (const id of SOUND_SET_IDS) {
      const spec = soundSetSpec(id);
      const group = SOUND_SET_GROUPS[spec.group].filter;
      const expected = spec.filter ?? group ?? NO_BUS_FILTER;
      expect(soundSetFilter(id), id).toEqual(expected);
    }
    expect(soundSetFilter('house')).toEqual(NO_BUS_FILTER);
    // Total for junk, like every other reader of a stored set id.
    expect(soundSetFilter('not-a-set' as never)).toEqual(
      soundSetFilter(SOUND_SETS.house.id),
    );
  });

  it('leaves most of the table alone — a filter is a judgement, not a default', () => {
    const withFilter = SOUND_SET_IDS.filter((id) => soundSetFilter(id).length > 0);
    expect(withFilter.length).toBeGreaterThanOrEqual(5);
    expect(withFilter.length).toBeLessThan(SOUND_SET_IDS.length / 2);
  });
});

/* ═════════════════════════════ the own-set registry ══════════════════════ */

const cue = (name: string): { src: string; relPath: string; fileName: string } => ({
  src: `/dev/${name}`,
  relPath: `dev/${name}`,
  fileName: name,
});

const own = (
  id: string,
  base: UserSoundSet['base'],
  cues: Partial<Record<FamilyName, string>>,
): UserSoundSet => ({
  id: id as UserSoundSetId,
  name: id.replace(USER_SET_PREFIX, ''),
  base,
  cues: Object.fromEntries(
    Object.entries(cues).map(([role, file]) => [role, cue(file as string)]),
  ) as UserSoundSet['cues'],
});

describe('the reader\'s own sets: the registry', () => {
  beforeEach(() => {
    clearUserSoundSets();
  });

  it('registers, replaces in place, and forgets', () => {
    registerUserSoundSet(own('user:a', 'house', {}));
    registerUserSoundSet(own('user:b', 'house', {}));
    registerUserSoundSet(own('user:a', 'far-room', { 'click-soft': 'tap.wav' }));
    // Replacement keeps its position: a re-import must not move the set the
    // reader is looking at to the end of the row.
    expect(snapshotUserSoundSets().map((s) => s.id)).toEqual(['user:a', 'user:b']);
    expect(userSoundSet('user:a')?.base).toBe('far-room');
    expect(userCueCount(userSoundSet('user:a') as UserSoundSet)).toBe(1);

    expect(unregisterUserSoundSet('user:a' as UserSoundSetId)).toBe(true);
    expect(unregisterUserSoundSet('user:a' as UserSoundSetId)).toBe(false);
    expect(snapshotUserSoundSets()).toHaveLength(1);
  });

  it('answers null for anything that is not a registered own id', () => {
    expect(isUserSoundSetId('house')).toBe(false);
    expect(isUserSoundSetId('user:x')).toBe(true);
    expect(userSoundSet('house')).toBeNull();
    expect(userSoundSet(null)).toBeNull();
    expect(userSoundSet('user:missing')).toBeNull();
    expect(userCueFor('user:missing', 'click-soft')).toBeNull();
  });

  it('resolves a SHIPPED id to itself — the bug that silently played the house set', () => {
    // `baseSetIdOf` reads the registry, which knows nothing about shipped ids.
    // Returning the fallback for them made every one of the shipped sets play
    // the house voicing while the picker still reported the chosen name.
    for (const id of SOUND_SET_IDS) expect(baseSetIdOf(id, 'house'), id).toBe(id);
    registerUserSoundSet(own('user:kit', 'cloister', {}));
    expect(baseSetIdOf('user:kit', 'house')).toBe('cloister');
    expect(baseSetIdOf('user:gone', 'house')).toBe('house');
    expect(baseSetIdOf(undefined, 'oak-stacks')).toBe('oak-stacks');
  });

  it('mints ids that do not collide, including with ids not yet registered', () => {
    expect(sanitizeSetName('  My Typewriter Kit.wav ')).toBe('my-typewriter-kit');
    expect(sanitizeSetName('***')).toBe('');
    expect(sanitizeSetName('x'.repeat(80))).toHaveLength(32);

    expect(freeUserSoundSetId('Typewriter')).toBe('user:typewriter');
    registerUserSoundSet(own('user:typewriter', 'house', {}));
    expect(freeUserSoundSetId('Typewriter')).toBe('user:typewriter-2');
    // The store restores a whole file at once, so ids it is about to write
    // must count as taken before any of them is registered.
    expect(freeUserSoundSetId('Typewriter', new Set(['user:typewriter-2']))).toBe(
      'user:typewriter-3',
    );
    expect(freeUserSoundSetId('!!!')).toBe('user:my-set');
  });

  it('caps the collection', () => {
    expect(MAX_USER_SOUND_SETS).toBeGreaterThan(1);
    expect(MAX_USER_SOUND_SETS).toBeLessThanOrEqual(20);
  });
});

/* ══════════════════════ importing: which file is which role ══════════════ */

describe('the import matcher', () => {
  it('labels every role in words a reader could have chosen themselves', () => {
    for (const role of FAMILY_NAMES) {
      expect(ROLE_LABELS[role], role).toBeTruthy();
      expect(ROLE_LABELS[role], role).not.toBe(role);
    }
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...FAMILY_NAMES].sort());
  });

  it('takes an exact family name, and a shipped take name, outright', () => {
    for (const role of FAMILY_NAMES) {
      expect(roleFromFileName(`${role}.wav`), role).toBe(role);
      expect(roleFromFileName(`${role.toUpperCase()}.WAV`), role).toBe(role);
      for (const take of SOUND_FAMILIES[role] as readonly string[]) {
        // A reader who exported the app's own set, edited it and brought it
        // back has file names in exactly this shape.
        expect(roleFromFileName(`${take}.wav`), take).toBe(role);
      }
    }
  });

  it('prefers the longest alias, so a shorter one cannot capture a specific name', () => {
    expect(roleFromFileName('my-book-return-take-3.wav')).toBe('book-return');
    expect(roleFromFileName('bookout.ogg')).toBe('book-pull');
    expect(roleFromFileName('big soft THUMP.flac')).toBe('drop-thump');
    expect(roleFromFileName('celebrate!!.mp3')).toBe('confetti');
  });

  it('reports an unrecognisable name rather than guessing a free role', () => {
    // Assigning leftovers to whichever roles happened to be free would make
    // the same folder import differently depending on what was in the set.
    expect(roleFromFileName('untitled-47.wav')).toBeNull();
    expect(roleFromFileName('recording.wav')).toBeNull();
    expect(roleFromFileName('')).toBeNull();
    expect(roleFromFileName('.wav')).toBeNull();
  });

  it('gives every alias to exactly one role, so no word can be ambiguous', () => {
    const owner = new Map<string, FamilyName>();
    for (const role of FAMILY_NAMES) {
      for (const word of roleVocabulary(role)) {
        expect(owner.get(word), `"${word}" is claimed twice`).toBeUndefined();
        owner.set(word, role);
      }
    }
    // The one the header calls out: bare "tick" sits in three role names.
    expect(owner.has('tick')).toBe(false);
  });

  it('accepts the formats a browser will actually decode, and a sane ceiling', () => {
    expect(AUDIO_EXTENSIONS).toContain('wav');
    expect(AUDIO_EXTENSIONS).toContain('mp3');
    expect(AUDIO_EXTENSIONS).toContain('ogg');
    expect(AUDIO_EXTENSIONS).not.toContain('png');
    expect(MAX_CUE_BYTES).toBeGreaterThan(256 * 1024);
    expect(MAX_CUE_BYTES).toBeLessThanOrEqual(32 * 1024 * 1024);
  });
});

/* ═════════════════════ the own set on the engine's play path ═════════════ */

class StubHowl implements HowlLike {
  static instances: StubHowl[] = [];
  static playLog: string[] = [];

  readonly options: HowlOptions;
  nextId = 0;
  live = new Set<number>();
  volumes = new Map<number, number>();
  rates = new Map<number, number>();

  constructor(options: HowlOptions) {
    this.options = options;
    StubHowl.instances.push(this);
  }
  get src(): string {
    return this.options.src[0] as string;
  }
  play(): number {
    const id = ++this.nextId;
    this.live.add(id);
    StubHowl.playLog.push(this.src);
    return id;
  }
  stop(id?: number): void {
    if (id === undefined) this.live.clear();
    else this.live.delete(id);
  }
  playing(id?: number): boolean {
    return id === undefined ? this.live.size > 0 : this.live.has(id);
  }
  volume(vol: number, id?: number): void {
    this.volumes.set(id ?? -1, vol);
  }
  rate(rate: number, id?: number): void {
    this.rates.set(id ?? -1, rate);
  }
  fade(): void {}
  once(): void {}
  unload(): void {
    this.live.clear();
  }
}

const familyOf = (src: string): FamilyName | undefined => {
  const name = src.replace('/sounds/', '').replace('.wav', '') as SoundName;
  return FAMILY_NAMES.find((f) => (SOUND_FAMILIES[f] as readonly SoundName[]).includes(name));
};

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('the engine plays the reader\'s own files', () => {
  let g: Graph;

  beforeEach(() => {
    resetEngineForTests();
    clearUserSoundSets();
    StubHowl.instances = [];
    StubHowl.playLog = [];
    g = graph();
    setHowlerLoader(async () => ({
      Howl: StubHowl as unknown as new (o: HowlOptions) => HowlLike,
      Howler: g.howler,
    }));
    setPlayRngForTests(() => 0.5);
    setVolumes({ master: 1, ui: 1, shelf: 1, pages: 1 });
  });

  it('plays the reader\'s file for a filled role and the base\'s cue for the rest', async () => {
    registerUserSoundSet(own('user:kit', 'house', { 'click-soft': 'tap.wav' }));
    setSoundSet('user:kit');
    expect(getEngineState().set).toBe('user:kit');
    expect(getBaseSoundSet()).toBe('house');
    expect(getEngineState().ownCues).toBe(1);

    await play('click-soft');
    expect(StubHowl.playLog).toEqual(['/dev/tap.wav']);

    StubHowl.playLog = [];
    await play('page-flip');
    expect(StubHowl.playLog[0]).toMatch(/^\/sounds\/page-flip/);
  });

  it('beats the base set\'s substitution — a click stays a click', async () => {
    // `loose-leaf` voices the button role with a typing tick. A reader who
    // imported a click and heard a page turn would have no way to explain it.
    setSoundSet('loose-leaf');
    await play('click-soft');
    expect(familyOf(StubHowl.playLog[0] as string)).toBe('typing-tick');

    StubHowl.playLog = [];
    registerUserSoundSet(own('user:kit', 'loose-leaf', { 'click-soft': 'tap.wav' }));
    setSoundSet('user:kit');
    await play('click-soft');
    expect(StubHowl.playLog).toEqual(['/dev/tap.wav']);
  });

  it('is heard even where the base set silences the role', async () => {
    setSoundSet('almost-nothing');
    expect(await play('click-soft')).toBeUndefined();

    registerUserSoundSet(own('user:kit', 'almost-nothing', { 'click-soft': 'tap.wav' }));
    setSoundSet('user:kit');
    expect(await play('click-soft')).toBeDefined();
    expect(StubHowl.playLog).toEqual(['/dev/tap.wav']);
  });

  it('still obeys the reader\'s own three preferences, which are newer answers', async () => {
    registerUserSoundSet(
      own('user:kit', 'house', { 'tick-hover': 'tick.wav', 'shelf-whoosh': 'whoosh.wav' }),
    );
    setSoundSet('user:kit');
    setReducedSound(true);
    expect(await play('tick-hover')).toBeUndefined();
    setReducedSound(false);
    setSoundCharacter('minimal');
    expect(await play('shelf-whoosh')).toBeUndefined();
    expect(StubHowl.playLog).toHaveLength(0);
  });

  it('replaces the cue under a LAYER too, so one thump lands in both places', async () => {
    // `reading-room` puts a `drop-thump` 140 ms under a book pull. A reader
    // who recorded one thump should not have to notice there were two.
    registerUserSoundSet(own('user:kit', 'reading-room', { 'drop-thump': 'thud.wav' }));
    setSoundSet('user:kit');
    await play('book-pull');
    await flush(220);
    expect(StubHowl.playLog).toHaveLength(2);
    expect(StubHowl.playLog[0]).toMatch(/^\/sounds\/book-pull/);
    expect(StubHowl.playLog[1]).toBe('/dev/thud.wav');
  });

  it('rides the base\'s gain, rate and the role\'s own volume slider', async () => {
    registerUserSoundSet(own('user:kit', 'house-soft', { 'pop-soft': 'blip.wav' }));
    setSoundSet('user:kit');
    const id = (await play('pop-soft', { noJitter: true })) as number;
    const stub = StubHowl.instances.find((h) => h.src === '/dev/blip.wav') as StubHowl;
    expect(stub.volumes.get(id)).toBeCloseTo(0.75, 10); // house-soft's flat 0.75

    // The role's category comes from the role, not from the file: a page turn
    // the reader recorded must still move with the pages slider.
    setVolumes({ pages: 0.5 });
    registerUserSoundSet(own('user:kit2', 'house', { 'page-flip': 'turn.wav' }));
    setSoundSet('user:kit2');
    const id2 = (await play('page-flip', { noJitter: true })) as number;
    const stub2 = StubHowl.instances.find((h) => h.src === '/dev/turn.wav') as StubHowl;
    expect(stub2.volumes.get(id2)).toBeCloseTo(0.5, 10);
  });

  it('tells howler the codec, because an asset URL is not a file path', async () => {
    registerUserSoundSet(own('user:kit', 'house', { 'click-soft': 'tap.ogg' }));
    setSoundSet('user:kit');
    await play('click-soft');
    const stub = StubHowl.instances.find((h) => h.src === '/dev/tap.ogg') as StubHowl;
    expect(stub.options.format).toEqual(['ogg']);
    expect(stub.options.loop).toBe(false);
  });

  it('caches the reader\'s cue under a key that cannot collide with a SoundName', async () => {
    registerUserSoundSet(own('user:kit', 'house', { 'click-soft': 'tap.wav' }));
    setSoundSet('user:kit');
    await play('click-soft');
    await play('click-soft');
    await play('click-soft');
    expect(StubHowl.playLog).toHaveLength(3);
    // One Howl, three plays: the key is stable.
    expect(StubHowl.instances.filter((h) => h.src === '/dev/tap.wav')).toHaveLength(1);
  });

  it('falls back to the house set when the chosen own set is not registered', () => {
    setSoundSet('user:never-existed');
    expect(getEngineState().set).toBe('house');
    expect(getBaseSoundSet()).toBe('house');
    expect(getEngineState().ownCues).toBe(0);
  });

  it('installs the base\'s bus filter under an own set, and reports it honestly', async () => {
    registerUserSoundSet(own('user:kit', 'far-room', { 'click-soft': 'tap.wav' }));
    setSoundSet('user:kit');
    // Nothing is wired until howler has loaded and built a context.
    expect(getBusFilter().installed).toBe(false);
    await play('click-soft');
    const state = getEngineState();
    expect(state.filter.wanted).toBe(describeBusFilter(soundSetFilter('far-room')));
    expect(state.filter.installed).toBe(true);
    expect(state.filter.tag).toBe(state.filter.wanted);
    expect(state.filter.reason).toBeNull();
    expect(reaches(g.master, g.ctx.destination)).toBe(true);
  });

  it('follows a re-base under a stable id — the case a change-guard would miss', async () => {
    registerUserSoundSet(own('user:kit', 'house', { 'click-soft': 'tap.wav' }));
    setSoundSet('user:kit');
    await play('click-soft');
    expect(getBusFilter().installed).toBe(false); // house declares none

    registerUserSoundSet(own('user:kit', 'far-room', { 'click-soft': 'tap.wav' }));
    setSoundSet('user:kit'); // same id, different base
    expect(getEngineState().filter.tag).toBe(describeBusFilter(soundSetFilter('far-room')));
    expect(getBaseSoundSet()).toBe('far-room');
  });

  it('a howler with no namespace costs the filter and nothing else', async () => {
    resetEngineForTests();
    StubHowl.playLog = [];
    setHowlerLoader(async () => ({
      Howl: StubHowl as unknown as new (o: HowlOptions) => HowlLike,
    }));
    setSoundSet('far-room');
    expect(await play('click-soft')).toBeDefined();
    expect(StubHowl.playLog).toHaveLength(1);
    expect(getEngineState().filter.installed).toBe(false);
    expect(getEngineState().filter.reason).toBe('howler not loaded');
  });
});
