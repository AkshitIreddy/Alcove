// @vitest-environment node
/**
 * tests/sound-sets.test.ts — the named sound sets: the table, the resolver,
 * what the engine actually plays through them, and the persisted choice.
 *
 * Three things this file exists to catch, all of which this codebase has
 * produced before in the visual vocabularies:
 *
 *   UNREACHABLE   a vocabulary that exists, validates and renders but that no
 *                 panel can get to. Here that means: every set must resolve a
 *                 playable voice for every role, and `SOUND_SET_SHORTLIST` /
 *                 `soundSetsInGroup` between them must reach all of them.
 *   INDISTINCT    a table whose entries are the same thing with new names.
 *                 Every set's full resolved voicing is fingerprinted and the
 *                 fingerprints have to be unique.
 *   KEY COLLISION the resolver and the variant picker both memoize on a
 *                 composite key. Ids, family names and character names all
 *                 contain hyphens, so a key glued together without separators
 *                 serves the wrong voice forever and nothing ever fails.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CHARACTER_PROFILES,
  SOUND_FAMILIES,
  VARIANT_WEIGHTS,
  getEngineState,
  init,
  keystroke,
  msSinceVoicedPlay,
  muteAll,
  play,
  poolFor,
  resetEngineForTests,
  setHowlerLoader,
  setPlayRngForTests,
  setReducedSound,
  setSoundCharacter,
  setSoundSet,
  setTypingSounds,
  setVolumes,
  type FamilyName,
  type HowlLike,
  type HowlOptions,
  type SoundName,
} from '../src/sound/engine';
import {
  DEFAULT_SOUND_SET_ID,
  SOUND_SETS,
  SOUND_SET_GROUPS,
  SOUND_SET_GROUP_IDS,
  SOUND_SET_IDS,
  SOUND_SET_SHORTLIST,
  isSoundSetId,
  resolveSoundSetId,
  resolveVoice,
  soundSetJitterScale,
  soundSetPool,
  soundSetSpec,
  soundSetsInGroup,
  type SoundSetId,
} from '../src/sound/soundSets';
import { PREVIEW_MS } from '../src/sound/preview';
import {
  loadSoundSet,
  resetSoundSetPrefsForTests,
  saveSoundSet,
  snapshotSoundSetId,
} from '../src/sound/soundSetPrefs';

const FAMILIES = Object.keys(SOUND_FAMILIES) as readonly FamilyName[];

/** Roles that fire at interaction rate — nothing may stack a second cue on them. */
const HOT_ROLES: readonly FamilyName[] = ['click-soft', 'tick-hover', 'typing-tick'];

/* ─────────────────────────────── the table ──────────────────────────────── */

describe('the sound-set table', () => {
  it('ships enough sets, in enough characters, with no duplicate ids', () => {
    // The reader asked for real choice wherever the app offers a list; three
    // presets is the thing they complained about.
    expect(SOUND_SET_IDS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SOUND_SET_IDS).size).toBe(SOUND_SET_IDS.length);
    expect(SOUND_SET_GROUP_IDS.length).toBeGreaterThanOrEqual(5);
    for (const group of SOUND_SET_GROUP_IDS) {
      expect(soundSetsInGroup(group).length, group).toBeGreaterThanOrEqual(2);
    }
  });

  it('every set names a real group, and the groups partition the sets', () => {
    const byGroup = SOUND_SET_GROUP_IDS.flatMap((g) => soundSetsInGroup(g));
    expect([...byGroup].sort()).toEqual([...SOUND_SET_IDS].sort());
    for (const id of SOUND_SET_IDS) {
      expect(SOUND_SET_GROUPS[SOUND_SETS[id].group], id).toBeDefined();
    }
  });

  it('every set and group is describable', () => {
    for (const id of SOUND_SET_IDS) {
      const spec = SOUND_SETS[id];
      expect(spec.name.length, id).toBeGreaterThan(2);
      expect(spec.blurb.length, id).toBeGreaterThan(12);
      expect(spec.id).toBe(id);
    }
    for (const group of SOUND_SET_GROUP_IDS) {
      expect(SOUND_SET_GROUPS[group].name.length, group).toBeGreaterThan(2);
      expect(SOUND_SET_GROUPS[group].blurb.length, group).toBeGreaterThan(12);
    }
  });

  it('every cue a set or group names is a real family', () => {
    const tables = [
      ...SOUND_SET_GROUP_IDS.map((g) => [g, SOUND_SET_GROUPS[g].voices] as const),
      ...SOUND_SET_IDS.map((id) => [id, SOUND_SETS[id].voices] as const),
    ];
    for (const [owner, table] of tables) {
      for (const [role, spec] of Object.entries(table ?? {})) {
        expect(FAMILIES, `${owner}.${role}`).toContain(role as FamilyName);
        if (spec === null || spec === undefined) continue;
        if (spec.cue !== undefined) expect(FAMILIES, `${owner}.${role}`).toContain(spec.cue);
        if (spec.layer !== undefined) {
          expect(FAMILIES, `${owner}.${role} layer`).toContain(spec.layer.cue);
        }
      }
    }
  });

  it('the shortlist is one set per character, in group order', () => {
    expect(SOUND_SET_SHORTLIST.length).toBe(SOUND_SET_GROUP_IDS.length);
    SOUND_SET_SHORTLIST.forEach((id, i) => {
      expect(SOUND_SETS[id].group).toBe(SOUND_SET_GROUP_IDS[i]);
    });
    // The default must be reachable without expanding the picker.
    expect(SOUND_SET_SHORTLIST).toContain(DEFAULT_SOUND_SET_ID);
  });

  it('the default set is the identity voicing — the cues exactly as mastered', () => {
    expect(isSoundSetId(DEFAULT_SOUND_SET_ID)).toBe(true);
    for (const family of FAMILIES) {
      expect(resolveVoice(DEFAULT_SOUND_SET_ID, family), family).toEqual({
        cue: family,
        rate: 1,
        gain: 1,
        layer: null,
      });
    }
    expect(soundSetPool(DEFAULT_SOUND_SET_ID)).toBe('all');
    expect(soundSetJitterScale(DEFAULT_SOUND_SET_ID)).toBe(1);
  });

  it('no set is another set with a new name', () => {
    // Fingerprint the WHOLE resolved voicing, which is what a listener hears —
    // two entries differing only in an unresolved spec field would collide here
    // and should.
    const fingerprints = new Map<string, SoundSetId>();
    for (const id of SOUND_SET_IDS) {
      const parts = FAMILIES.map((f) => {
        const v = resolveVoice(id, f);
        if (v === null) return `${f}=off`;
        const layer = v.layer === null
          ? ''
          : `+${v.layer.cue}@${v.layer.rate.toFixed(3)}x${v.layer.gain.toFixed(3)}@${v.layer.delayMs}`;
        return `${f}=${v.cue}@${v.rate.toFixed(3)}x${v.gain.toFixed(3)}${layer}`;
      });
      parts.push(`pool=${soundSetPool(id)}`, `jitter=${soundSetJitterScale(id).toFixed(3)}`);
      const print = parts.join(';');
      expect(fingerprints.get(print), `${id} is identical to ${fingerprints.get(print)}`)
        .toBeUndefined();
      fingerprints.set(print, id);
    }
    expect(fingerprints.size).toBe(SOUND_SET_IDS.length);
  });

  it('every set departs from the house voicing in something audible', () => {
    for (const id of SOUND_SET_IDS) {
      if (id === DEFAULT_SOUND_SET_ID) continue;
      const departs = FAMILIES.some((f) => {
        const v = resolveVoice(id, f);
        return v === null || v.cue !== f || v.rate !== 1 || v.gain !== 1 || v.layer !== null;
      });
      const meta = soundSetPool(id) !== 'all' || soundSetJitterScale(id) !== 1;
      expect(departs || meta, `${id} sounds exactly like the house set`).toBe(true);
    }
  });

  it('no set silences everything, and every set keeps the page and the book', () => {
    for (const id of SOUND_SET_IDS) {
      const heard = FAMILIES.filter((f) => resolveVoice(id, f) !== null);
      expect(heard.length, id).toBeGreaterThanOrEqual(6);
      // Whatever a reader picks, turning a page and pulling a book still speak:
      // those two are the app's signature and are not decorations.
      expect(resolveVoice(id, 'page-flip'), id).not.toBeNull();
      expect(resolveVoice(id, 'book-pull'), id).not.toBeNull();
    }
  });

  it('at most one set makes the whole interface silent', () => {
    // `almost-nothing` is allowed to — it says so in its name and its blurb.
    // A second one would mean the table had drifted towards muteness rather
    // than towards character, which is not what a picker is for.
    const mutes = SOUND_SET_IDS.filter(
      (id) => resolveVoice(id, 'click-soft') === null && resolveVoice(id, 'pop-soft') === null,
    );
    expect(mutes).toEqual(['almost-nothing']);
    expect(SOUND_SETS['almost-nothing'].blurb).toMatch(/nothing/i);
  });

  it('nothing layers a second cue onto a role that fires at interaction rate', () => {
    for (const id of SOUND_SET_IDS) {
      for (const role of HOT_ROLES) {
        expect(resolveVoice(id, role)?.layer ?? null, `${id}.${role}`).toBeNull();
      }
    }
  });

  it('every resolved rate and gain stays inside the safe window', () => {
    for (const id of SOUND_SET_IDS) {
      for (const family of FAMILIES) {
        const v = resolveVoice(id, family);
        if (v === null) continue;
        for (const [what, rate, gain] of [
          ['voice', v.rate, v.gain] as const,
          ...(v.layer ? [['layer', v.layer.rate, v.layer.gain] as const] : []),
        ]) {
          const where = `${id}.${family} ${what}`;
          // Howler accepts 0.5–4; past a quarter either way a page turn stops
          // sounding like paper, so the table is held to a narrower window.
          expect(rate, where).toBeGreaterThanOrEqual(0.5);
          expect(rate, where).toBeLessThanOrEqual(2);
          expect(gain, where).toBeGreaterThan(0);
          expect(gain, where).toBeLessThanOrEqual(4);
        }
      }
    }
  });
});

/* ────────────────────── the loudness hierarchy survives ─────────────────── */

/**
 * `gen-sounds.mjs` masters the whole set to one loudness hierarchy — a hover
 * tick 8 dB under a button press, a press 5 dB under a panel opening — and a
 * sound set is precisely the thing that can undo it, because it re-points a
 * role at a recording that was mastered for a different job.
 *
 * So the hierarchy is re-measured here from the SHIPPED WAVs, per set.
 */
const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');

/** Peak of a mastered cue, in dBFS. Read once per family (all takes share it). */
function peakDb(name: SoundName): number {
  const raw = readFileSync(join(SOUNDS_DIR, `${name}.wav`));
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const view = new DataView(buf);
  const tag = (off: number): string => String.fromCharCode(...new Uint8Array(buf, off, 4));
  let peak = 0;
  let off = 12;
  while (off + 8 <= raw.byteLength) {
    const size = view.getUint32(off + 4, true);
    if (tag(off) === 'data') {
      for (let i = off + 8; i + 1 < off + 8 + size; i += 2) {
        const v = Math.abs(view.getInt16(i, true)) / 32768;
        if (v > peak) peak = v;
      }
      break;
    }
    off += 8 + size + (size % 2);
  }
  return 20 * Math.log10(Math.max(peak, 1e-9));
}

const familyPeak = new Map<FamilyName, number>();
const peakOfFamily = (family: FamilyName): number => {
  let db = familyPeak.get(family);
  if (db === undefined) {
    db = peakDb((SOUND_FAMILIES[family] as readonly SoundName[])[0] as SoundName);
    familyPeak.set(family, db);
  }
  return db;
};

/** What a role peaks at in a given set, in dBFS, before the reader's sliders. */
function roleDb(id: SoundSetId, role: FamilyName): number | null {
  const voice = resolveVoice(id, role);
  if (voice === null) return null;
  return peakOfFamily(voice.cue) + 20 * Math.log10(voice.gain);
}

describe('every set keeps the mastered loudness hierarchy', () => {
  it('no set gain exceeds unity, so the sliders never clamp one role and not another', () => {
    // Howler volume tops out at 1, so a gain above unity can only spend the
    // headroom the reader's own sliders happen to leave — which means the
    // balance BETWEEN two roles would change as they move the master fader.
    // Keeping every resolved gain at or under 1 makes the hierarchy below hold
    // at every slider position rather than only at the shipped defaults.
    for (const id of SOUND_SET_IDS) {
      for (const family of FAMILIES) {
        const v = resolveVoice(id, family);
        if (v === null) continue;
        expect(v.gain, `${id}.${family}`).toBeLessThanOrEqual(1);
        if (v.layer) expect(v.layer.gain, `${id}.${family} layer`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a hover stays under a press, and a press under a panel opening', () => {
    for (const id of SOUND_SET_IDS) {
      const hover = roleDb(id, 'tick-hover');
      const click = roleDb(id, 'click-soft');
      const pop = roleDb(id, 'pop-soft');
      if (click !== null && hover !== null) {
        expect(click - hover, `${id}: press ${click.toFixed(1)} vs hover ${hover.toFixed(1)} dBFS`)
          .toBeGreaterThanOrEqual(3);
      }
      if (pop !== null && click !== null) {
        expect(pop - click, `${id}: panel ${pop.toFixed(1)} vs press ${click.toFixed(1)} dBFS`)
          .toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('nothing a reader does often is mastered into inaudibility', () => {
    // The shipped hover tick is the quietest thing in the app at −27 dBFS;
    // a set may go quieter than that but not by more than a few dB, or the
    // cue is simply gone under any real room noise.
    for (const id of SOUND_SET_IDS) {
      for (const role of ['click-soft', 'pop-soft', 'page-flip', 'book-pull'] as const) {
        const db = roleDb(id, role);
        if (db === null) continue;
        expect(db, `${id}.${role} at ${db.toFixed(1)} dBFS`).toBeGreaterThanOrEqual(-32);
      }
      const hover = roleDb(id, 'tick-hover');
      if (hover !== null) expect(hover, `${id}.tick-hover`).toBeGreaterThanOrEqual(-34);
    }
  });

  it('a layer never overtakes the cue it sits under', () => {
    for (const id of SOUND_SET_IDS) {
      for (const family of FAMILIES) {
        const v = resolveVoice(id, family);
        if (v === null || v.layer === null) continue;
        const main = peakOfFamily(v.cue) + 20 * Math.log10(v.gain);
        const under = peakOfFamily(v.layer.cue) + 20 * Math.log10(v.layer.gain);
        expect(main - under, `${id}.${family} layer at ${under.toFixed(1)} vs ${main.toFixed(1)}`)
          .toBeGreaterThanOrEqual(3);
      }
    }
  });
});

/* ───────────────────────────── the resolver ─────────────────────────────── */

describe('resolveVoice', () => {
  it('is total: junk gives the house set rather than a throw', () => {
    for (const junk of [undefined, null, 42, {}, 'no-such-set', '']) {
      expect(resolveSoundSetId(junk)).toBe(DEFAULT_SOUND_SET_ID);
      expect(isSoundSetId(junk)).toBe(false);
      expect(() => resolveVoice(junk as unknown as SoundSetId, 'pop-soft')).not.toThrow();
      expect(resolveVoice(junk as unknown as SoundSetId, 'pop-soft')?.cue).toBe('pop-soft');
    }
    expect(soundSetSpec('nope' as unknown as SoundSetId).id).toBe(DEFAULT_SOUND_SET_ID);
  });

  it('memoizes on the set AND the role, not on either alone', () => {
    // Collapsing on the role would make every set sound like the first one
    // asked for; collapsing on the set would make every role sound the same.
    expect(resolveVoice('house', 'click-soft')?.cue).toBe('click-soft');
    expect(resolveVoice('loose-leaf', 'click-soft')?.cue).toBe('typing-tick');
    expect(resolveVoice('loose-leaf', 'pop-soft')?.cue).toBe('page-flip');
    expect(resolveVoice('house', 'click-soft')?.cue).toBe('click-soft'); // still, after the others
  });

  it('a set overrides its group, including overriding it back to silence', () => {
    // `margin-note` silences the camera whoosh its own group leaves alone.
    expect(resolveVoice('margin-note', 'shelf-whoosh')).toBeNull();
    expect(resolveVoice('loose-leaf', 'shelf-whoosh')).not.toBeNull();
    // `almost-nothing` silences the two most common cues in the app.
    expect(resolveVoice('almost-nothing', 'click-soft')).toBeNull();
    expect(resolveVoice('almost-nothing', 'pop-soft')).toBeNull();
  });

  it('flat set/group multipliers compound with a role’s own numbers', () => {
    // `oak-stacks` is library (group rate 0.94) × set rate 0.94 × role 0.92.
    const drop = resolveVoice('oak-stacks', 'drop-thump');
    expect(drop?.rate).toBeCloseTo(0.94 * 0.94 * 0.92, 6);
    // and the layer under a book pull rides the same multipliers.
    const pull = resolveVoice('oak-stacks', 'book-pull');
    expect(pull?.layer?.rate).toBeCloseTo(0.94 * 0.94 * 0.88, 6);
    expect(pull?.layer?.gain).toBeCloseTo(0.45, 6);
    // A flat gain reaches every role, including ones with no entry of their own.
    expect(resolveVoice('house-soft', 'crumple-delete')?.gain).toBeCloseTo(0.75, 6);
  });

  it('a group pool and jitter scale reach every one of its sets', () => {
    for (const id of soundSetsInGroup('studio')) {
      expect(soundSetPool(id), id).toBe('plain');
    }
    expect(soundSetJitterScale('drafting-table')).toBe(0.5); // from the group
    expect(soundSetJitterScale('blueprint')).toBe(0.2); // the set overrides it
  });
});

/* ──────────────────────── the engine, through a stub ────────────────────── */

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

const nameOf = (src: string): SoundName =>
  src.replace('/sounds/', '').replace('.wav', '') as SoundName;

const playedNames = (): SoundName[] => StubHowl.playLog.map(nameOf);

const familyOf = (name: SoundName): FamilyName | undefined =>
  FAMILIES.find((f) => (SOUND_FAMILIES[f] as readonly SoundName[]).includes(name));

const installStub = (): void => {
  resetEngineForTests();
  StubHowl.instances = [];
  StubHowl.playLog = [];
  setHowlerLoader(async () => ({ Howl: StubHowl as unknown as new (o: HowlOptions) => HowlLike }));
};

const flush = (ms = 0): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('the engine plays roles through the chosen set', () => {
  beforeEach(() => {
    installStub();
    setPlayRngForTests(() => 0.5); // jitter() === 1, so the maths stays exact
  });

  it('reports the active set, and refuses an unknown one without going quiet', () => {
    expect(getEngineState().set).toBe(DEFAULT_SOUND_SET_ID);
    setSoundSet('reading-room');
    expect(getEngineState().set).toBe('reading-room');
    setSoundSet('not-a-set');
    expect(getEngineState().set).toBe(DEFAULT_SOUND_SET_ID);
  });

  it('substitutes the cue for a ROLE and leaves a named FILE alone', async () => {
    setSoundSet('loose-leaf');
    await play('click-soft'); // the role
    expect(familyOf(playedNames()[0] as SoundName)).toBe('typing-tick');
    StubHowl.playLog = [];
    await play('click-soft-2'); // the file
    expect(playedNames()).toEqual(['click-soft-2']);
  });

  it('applies the set’s gain and rate to the play', async () => {
    setVolumes({ master: 1, ui: 1, shelf: 1, pages: 1 });
    setSoundSet('house-soft'); // a flat 0.75 across every role
    const id = await play('pop-soft', { noJitter: true });
    const stub = StubHowl.instances.find((h) => h.src === StubHowl.playLog[0]) as StubHowl;
    expect(stub.volumes.get(id as number)).toBeCloseTo(0.75, 10);

    installStub();
    setPlayRngForTests(() => 0.5);
    setSoundSet('house-bright'); // a flat 1.08 rate
    const id2 = await play('pop-soft', { noJitter: true });
    const stub2 = StubHowl.instances.find((h) => h.src === StubHowl.playLog[0]) as StubHowl;
    expect(stub2.rates.get(id2 as number)).toBeCloseTo(1.08, 10);
  });

  it('the house set touches neither: no rate call, volume straight through', async () => {
    setVolumes({ master: 1, ui: 1 });
    const id = await play('pop-soft', { noJitter: true });
    const stub = StubHowl.instances.find((h) => h.src === StubHowl.playLog[0]) as StubHowl;
    expect(stub.volumes.get(id as number)).toBeCloseTo(1, 10);
    expect(stub.rates.size).toBe(0);
  });

  it('plays a layer under the roles that have one, after its delay', async () => {
    setSoundSet('reading-room'); // library: a thump 130 ms under a book pull
    await play('book-pull');
    expect(playedNames().map(familyOf)).toEqual(['book-pull']);
    await flush(200);
    expect(playedNames().map(familyOf)).toEqual(['book-pull', 'drop-thump']);
  });

  it('a silenced role plays nothing and does not even load its file', async () => {
    setSoundSet('almost-nothing');
    expect(await play('click-soft')).toBeUndefined();
    expect(await play('pop-soft')).toBeUndefined();
    expect(StubHowl.instances).toHaveLength(0);
    // The roles it keeps still sound.
    expect(await play('page-flip')).toBeDefined();
  });

  it('reduced sound drops the layer, and silences the hover role whatever voices it', async () => {
    setSoundSet('drafting-table'); // studio voices hover with the crisp blip
    setReducedSound(true);
    expect(await play('tick-hover')).toBeUndefined();
    expect(await play('typing-tick')).toBeUndefined();
    expect(StubHowl.playLog).toHaveLength(0);

    setSoundSet('reading-room');
    await play('book-pull');
    await flush(200);
    expect(playedNames().map(familyOf)).toEqual(['book-pull']); // no thump under it
  });

  it('the minimal character silences a role even when the set re-voices it', async () => {
    setSoundSet('drafting-table');
    setSoundCharacter('minimal');
    expect(await play('tick-hover')).toBeUndefined();
    expect(await play('shelf-whoosh')).toBeUndefined();
    expect(StubHowl.playLog).toHaveLength(0);
  });

  it('a set pool narrows which takes rotate', async () => {
    setSoundSet('drafting-table'); // pool: plain
    for (const family of FAMILIES) {
      for (const name of poolFor(family)) expect(VARIANT_WEIGHTS[name], name).toBe('plain');
    }
    setSoundSet('house');
    expect(poolFor('page-flip')).toEqual(SOUND_FAMILIES['page-flip']);
  });

  it('the jitter scale widens and narrows the per-play wobble', async () => {
    setVolumes({ master: 1, ui: 1 });
    setPlayRngForTests(() => 1); // jitter() === 1 + half
    const rateFor = async (set: string): Promise<number> => {
      installStub();
      setPlayRngForTests(() => 1);
      setSoundSet(set);
      const id = await play('pop-soft');
      const stub = StubHowl.instances.find((h) => h.src === StubHowl.playLog[0]) as StubHowl;
      return stub.rates.get(id as number) as number;
    };
    const { pitchJitter } = CHARACTER_PROFILES.calm;
    expect(await rateFor('house')).toBeCloseTo(1 + pitchJitter, 6);
    expect(await rateFor('house-wide')).toBeCloseTo(1 + pitchJitter * 1.9, 6);
    expect(await rateFor('blueprint')).toBeGreaterThan(1); // tight, but still moving
  });

  it('rotation stays independent per set: switching back does not repeat', async () => {
    let n = 1;
    setPlayRngForTests(() => {
      n = (n * 16807 + 12345) % 2147483647;
      return (n % 1009) / 1009;
    });
    await init();
    StubHowl.playLog = [];
    setSoundSet('house');
    for (let i = 0; i < 40; i++) {
      setSoundSet(i % 2 === 0 ? 'house' : 'house-bright');
      await play('page-flip');
    }
    // Both sets voice the page role with page-flip, and each keeps its own
    // rotation — so a variant may repeat across the switch, but never inside
    // one set's own run.
    const evens = playedNames().filter((_, i) => i % 2 === 0);
    const odds = playedNames().filter((_, i) => i % 2 === 1);
    for (const run of [evens, odds]) {
      for (let i = 1; i < run.length; i++) expect(run[i]).not.toBe(run[i - 1]);
    }
  });

  it('the click role never counts as a control voicing itself, whatever plays it', async () => {
    await init();
    setSoundSet('drafting-table'); // buttons are voiced by pop-soft here
    const before = msSinceVoicedPlay(1_000_000);
    await play('click-soft');
    expect(msSinceVoicedPlay(1_000_000)).toBe(before);

    setSoundSet('quiet-hours'); // ...and panels are voiced by click-soft here
    await play('pop-soft');
    expect(msSinceVoicedPlay(Date.now())).toBeLessThan(1000);
  });

  it('a set that silences the keystroke role stops the tick being counted', async () => {
    setTypingSounds(true);
    setSoundSet('almost-nothing');
    keystroke(0);
    keystroke(1000);
    await flush();
    expect(StubHowl.playLog).toHaveLength(0);
    expect(getEngineState().typingTicksPlayed).toBe(0);
    setSoundSet('house');
    keystroke(2000);
    await flush();
    expect(getEngineState().typingTicksPlayed).toBe(1);
  });

  it('mute still wins over every set', async () => {
    setSoundSet('carillon');
    muteAll(true);
    for (const family of FAMILIES) expect(await play(family)).toBeUndefined();
    await flush(200);
    expect(StubHowl.playLog).toHaveLength(0);
  });

  it('every set voices every role with a file that exists', async () => {
    await init();
    const loaded = new Set(StubHowl.instances.map((h) => nameOf(h.src)));
    for (const id of SOUND_SET_IDS) {
      setSoundSet(id);
      for (const family of FAMILIES) {
        const voice = resolveVoice(id, family);
        if (voice === null) continue;
        expect(loaded.has((SOUND_FAMILIES[voice.cue] as readonly SoundName[])[0] as SoundName))
          .toBe(true);
        StubHowl.playLog = [];
        const played = await play(family);
        expect(played, `${id}.${family}`).toBeDefined();
        expect(familyOf(playedNames()[0] as SoundName), `${id}.${family}`).toBe(voice.cue);
      }
    }
    await flush(300); // let any layer timers land before the next spec
  });
});

/* ────────────────────────── the persisted choice ────────────────────────── */

describe('the stored sound set', () => {
  beforeEach(() => {
    installStub();
    resetSoundSetPrefsForTests();
  });

  it('opens on the house set when nothing is stored', async () => {
    expect(await loadSoundSet()).toBe(DEFAULT_SOUND_SET_ID);
    expect(snapshotSoundSetId()).toBe(DEFAULT_SOUND_SET_ID);
    expect(getEngineState().set).toBe(DEFAULT_SOUND_SET_ID);
  });

  it('saving applies to the engine and survives a reload', async () => {
    await saveSoundSet('map-room');
    expect(snapshotSoundSetId()).toBe('map-room');
    expect(getEngineState().set).toBe('map-room');

    // A fresh session reads the same row back.
    resetSoundSetPrefsForTests();
    expect(getEngineState().set).toBe(DEFAULT_SOUND_SET_ID);
    expect(await loadSoundSet()).toBe('map-room');
    expect(getEngineState().set).toBe('map-room');
  });

  it('a set id that no longer exists resolves to the house set', async () => {
    await saveSoundSet('withdrawn-set');
    expect(snapshotSoundSetId()).toBe(DEFAULT_SOUND_SET_ID);
    expect(getEngineState().set).toBe(DEFAULT_SOUND_SET_ID);
  });
});

/* ─────────────────────────────── the audition ───────────────────────────── */

describe('the sound-set audition', () => {
  it('is short, and made of roles rather than files', () => {
    // A picker for the ear that makes you choose blind is not a picker.
    expect(PREVIEW_MS).toBeGreaterThan(500);
    expect(PREVIEW_MS).toBeLessThanOrEqual(1500);
  });
});
