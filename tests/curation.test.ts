// @vitest-environment node
/**
 * tests/curation.test.ts — the reader's own hand on a list.
 *
 * `src/data/shelfOfMine.ts` is one mechanism keyed by (axis, entry id), and
 * three things about it are worth a gate rather than a read-through:
 *
 *  1. NOTHING IS DESTROYED. A removal takes an entry out of every list and out
 *     of the dice, and the drawer gives it back. The report asked for exactly
 *     that pairing — "delete stuff … with option to restore it again" — and the
 *     half that is easy to lose is the second one, because a broken restore
 *     looks identical to a working one until somebody needs it.
 *
 *  2. THE NOTATION MEANS WHAT THEY SAID. One star is the head of a family, two
 *     is the head of the whole list, and everything under the stars keeps the
 *     order the vocabulary authored. That is three rules interacting, and the
 *     interaction is where an ordering goes quietly wrong.
 *
 *  3. IT IS TOTAL. The book comes back out of SQLite unvalidated, and a room
 *     the reader composed is their own work — junk in an axis of it is repaired
 *     rather than treated as grounds for losing the room.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SHELF_DESIGN } from '../src/art/shelfDesign';
import { DEFAULT_THEME_ID } from '../src/art/themes';
import {
  CURATION_AXES,
  SAVED_ROOM_GROUP,
  SAVED_ROOM_PREFIX,
  curateList,
  cycleStars,
  forgetSavedRoom,
  getSavedRoom,
  hiddenCount,
  hiddenIds,
  hideEntry,
  isCurationAxis,
  isHidden,
  isSavedRoomId,
  loadShelfOfMine,
  orderByStars,
  parseShelfOfMine,
  renameSavedRoom,
  resetShelfOfMineForTests,
  restoreAll,
  restoreEntries,
  rollPool,
  saveRoomAsPreset,
  savedRooms,
  seedShelfOfMineForTests,
  setStars,
  starMeaning,
  starsOf,
  type Stars,
} from '../src/data/shelfOfMine';

/* --------------------------------- fixture -------------------------------- */

interface Row {
  id: string;
  group?: string;
}

/** Three families, in the order a vocabulary would publish them. */
const ROWS: readonly Row[] = [
  { id: 'a1', group: 'Alpha' },
  { id: 'a2', group: 'Alpha' },
  { id: 'a3', group: 'Alpha' },
  { id: 'b1', group: 'Beta' },
  { id: 'b2', group: 'Beta' },
  { id: 'c1', group: 'Gamma' },
];

const ids = (rows: readonly Row[]): string[] => rows.map((row) => row.id);

/** Starts every test from an empty book without going near SQLite. */
beforeEach(() => {
  seedShelfOfMineForTests(null);
});

/* ========================================================================== *
 *                          the notation, on its own                          *
 * ========================================================================== */

describe('orderByStars', () => {
  const stars = (map: Record<string, Stars>) => (row: Row): Stars => map[row.id] ?? 0;
  const family = (row: Row): string => row.group ?? '';

  it('is the identity when nothing is starred — the same array, not a copy', () => {
    // Not pedantry: these lists are rebuilt on every pick and every keystroke,
    // and a sort that returns a fresh array each time makes every downstream
    // memo re-run for nothing.
    expect(orderByStars(ROWS, () => 0, family)).toBe(ROWS);
  });

  it('lifts a two-star entry clear of its family to the head of everything', () => {
    const out = orderByStars(ROWS, stars({ b2: 2 }), family);
    expect(ids(out)).toEqual(['b2', 'a1', 'a2', 'a3', 'b1', 'c1']);
  });

  it('lifts a one-star entry to the head of its OWN family and no further', () => {
    const out = orderByStars(ROWS, stars({ b2: 1 }), family);
    // Beta stays the second family; b2 leads it. Alpha is untouched.
    expect(ids(out)).toEqual(['a1', 'a2', 'a3', 'b2', 'b1', 'c1']);
  });

  it('reads both levels at once, and the families keep their published order', () => {
    const out = orderByStars(ROWS, stars({ a3: 1, c1: 2 }), family);
    expect(ids(out)).toEqual(['c1', 'a3', 'a1', 'a2', 'b1', 'b2']);
  });

  it('keeps the authored order among entries that tie', () => {
    const out = orderByStars(ROWS, stars({ b1: 2, a2: 2, a1: 1, a3: 1 }), family);
    // Two stars first, in the order the vocabulary published them; then Alpha
    // with its one-star pair at the head, also in published order.
    expect(ids(out)).toEqual(['a2', 'b1', 'a1', 'a3', 'b2', 'c1']);
  });

  it('degrades sanely on a list with no families: two stars still beat one', () => {
    const flat: readonly Row[] = [{ id: 'x' }, { id: 'y' }, { id: 'z' }, { id: 'w' }];
    const out = orderByStars(flat, stars({ y: 1, z: 2, w: 1 }));
    expect(ids(out)).toEqual(['z', 'y', 'w', 'x']);
  });

  it('never drops or duplicates an entry, whatever the stars', () => {
    const out = orderByStars(ROWS, stars({ a1: 2, b1: 1, c1: 2, a3: 1 }), family);
    expect(ids(out).sort()).toEqual(ids(ROWS).sort());
    expect(new Set(ids(out)).size).toBe(ROWS.length);
  });

  it('says what a star means in words', () => {
    expect(starMeaning(2)).toBe('first of them all');
    expect(starMeaning(1, 'Rustic')).toBe('first in rustic');
    expect(starMeaning(1)).toBe('first in its family');
    expect(starMeaning(0)).toBe('no star');
  });
});

/* ========================================================================== *
 *                        removals: out, and back again                       *
 * ========================================================================== */

describe('removing an entry', () => {
  it('takes it out of the list the reader browses', async () => {
    await hideEntry('build', 'a2');
    expect(isHidden('build', 'a2')).toBe(true);
    expect(ids([...curateList('build', ROWS)])).toEqual(['a1', 'a3', 'b1', 'b2', 'c1']);
  });

  it('takes it out of the roll pool', async () => {
    await hideEntry('build', 'b1');
    expect(ids([...rollPool('build', ROWS, (row) => row.id)])).toEqual([
      'a1',
      'a2',
      'a3',
      'b2',
      'c1',
    ]);
  });

  it('and it is STILL restorable — the drawer holds it either way', async () => {
    await hideEntry('build', 'b1');
    expect(hiddenIds('build')).toEqual(['b1']);
    expect(hiddenCount('build')).toBe(1);

    await restoreEntries('build', ['b1']);
    expect(isHidden('build', 'b1')).toBe(false);
    expect(ids([...curateList('build', ROWS)])).toEqual(ids(ROWS));
    expect(ids([...rollPool('build', ROWS, (row) => row.id)])).toEqual(ids(ROWS));
    expect(hiddenIds('build')).toEqual([]);
  });

  it('restores only what was ticked', async () => {
    await hideEntry('build', 'a1');
    await hideEntry('build', 'b1');
    await hideEntry('build', 'c1');
    await restoreEntries('build', ['a1', 'c1']);
    expect(hiddenIds('build')).toEqual(['b1']);
  });

  it('gives everything back at once', async () => {
    await hideEntry('build', 'a1');
    await hideEntry('build', 'b1');
    await restoreAll('build');
    expect(hiddenIds('build')).toEqual([]);
  });

  it('keeps the star, so restoring puts it back where the reader had it', async () => {
    await setStars('build', 'c1', 2);
    await hideEntry('build', 'c1');
    expect(starsOf('build', 'c1')).toBe(2);
    await restoreEntries('build', ['c1']);
    expect(ids([...curateList('build', ROWS)])[0]).toBe('c1');
  });

  it('is keyed by axis: removing from one list leaves the others alone', async () => {
    await hideEntry('build', 'a1');
    expect(isHidden('build', 'a1')).toBe(true);
    expect(isHidden('pattern', 'a1')).toBe(false);
    expect(ids([...curateList('pattern', ROWS)])).toEqual(ids(ROWS));
  });

  it('is idempotent — removing twice does not double the drawer', async () => {
    await hideEntry('build', 'a1');
    await hideEntry('build', 'a1');
    expect(hiddenIds('build')).toEqual(['a1']);
  });

  it('still shows the entry the reader is WEARING, so nothing reads as forgotten', async () => {
    // They may remove what they have on; the strip must not come back with no
    // tile pressed, which reads as "it forgot my choice" rather than "it is
    // removed". It goes the moment they choose something else — and the drawer
    // lists it throughout, because it IS removed.
    await hideEntry('build', 'a2');
    expect(ids([...curateList('build', ROWS, 'a2')])).toEqual(ids(ROWS));
    expect(hiddenIds('build')).toEqual(['a2']);
    expect(ids([...curateList('build', ROWS, 'a1')])).not.toContain('a2');
  });

  it('falls back to the whole vocabulary when the reader removed all of it', async () => {
    // A "surprise me" that silently does nothing is a broken button; this is
    // the one case where honouring every removal is worse than ignoring them.
    for (const row of ROWS) await hideEntry('build', row.id);
    expect(ids([...rollPool('build', ROWS, (row) => row.id)])).toEqual(ids(ROWS));
    // The browsable list still honours them — that half is a choice, not a trap.
    expect(curateList('build', ROWS)).toEqual([]);
  });
});

/* ========================================================================== *
 *                       stars, through the real store                        *
 * ========================================================================== */

describe('starring an entry', () => {
  it('orders the curated list across families', async () => {
    await setStars('wallpaper', 'c1', 2);
    await setStars('wallpaper', 'b2', 1);
    expect(ids([...curateList('wallpaper', ROWS)])).toEqual([
      'c1',
      'a1',
      'a2',
      'a3',
      'b2',
      'b1',
    ]);
  });

  it('cycles none → one → two → none', async () => {
    expect(await cycleStars('wallpaper', 'a1')).toBe(1);
    expect(await cycleStars('wallpaper', 'a1')).toBe(2);
    expect(await cycleStars('wallpaper', 'a1')).toBe(0);
    expect(starsOf('wallpaper', 'a1')).toBe(0);
  });

  it('does not weight the dice', async () => {
    // A star says "show me this first". A reader who asked to be surprised did
    // not ask to be surprised by the things they already told the app they like.
    await setStars('wallpaper', 'c1', 2);
    expect(ids([...rollPool('wallpaper', ROWS, (row) => row.id)])).toEqual(ids(ROWS));
  });

  it('is keyed by axis, like everything else here', async () => {
    await setStars('build', 'a1', 2);
    expect(starsOf('build', 'a1')).toBe(2);
    expect(starsOf('pattern', 'a1')).toBe(0);
  });
});

/* ========================================================================== *
 *                             a room of your own                             *
 * ========================================================================== */

const LOOK = {
  theme: DEFAULT_THEME_ID,
  build: DEFAULT_SHELF_DESIGN.build,
  pattern: DEFAULT_SHELF_DESIGN.pattern,
  wallpaper: { pattern: 'trellis', scale: 'medium', depth: 'flat', ink: 'ink' },
} as const;

describe('saving the current room as a preset', () => {
  it('keeps it, names it, and stars it in the same action', async () => {
    // The reader's words: "save their current room as preset and also star it
    // simuntaosuly to make sure it stays up top".
    const room = await saveRoomAsPreset('The Study', LOOK, 2);
    expect(room).not.toBeNull();
    expect(isSavedRoomId(room!.id)).toBe(true);
    expect(room!.name).toBe('The Study');
    expect(room!.group).toBe(SAVED_ROOM_GROUP);
    expect(starsOf('room-preset', room!.id)).toBe(2);
    expect(savedRooms().map((r) => r.id)).toEqual([room!.id]);
  });

  it('leads the list once it is starred, exactly like a house preset', async () => {
    const room = await saveRoomAsPreset('The Study', LOOK, 2);
    const withMine: readonly Row[] = [...ROWS, { id: room!.id, group: SAVED_ROOM_GROUP }];
    expect(ids([...curateList('room-preset', withMine)])[0]).toBe(room!.id);
  });

  it('makes two rooms of the same name distinct rather than refusing one', async () => {
    const first = await saveRoomAsPreset('study', LOOK);
    const second = await saveRoomAsPreset('study', LOOK);
    expect(first!.id).toBe(`${SAVED_ROOM_PREFIX}study`);
    expect(second!.id).toBe(`${SAVED_ROOM_PREFIX}study-2`);
    expect(savedRooms()).toHaveLength(2);
  });

  it('refuses a nameless room rather than filing an untitled one', async () => {
    expect(await saveRoomAsPreset('   ', LOOK)).toBeNull();
    expect(savedRooms()).toEqual([]);
  });

  it('is removable like anything else — and therefore restorable', async () => {
    // The reader deleting one of their own rooms goes through the SAME removal
    // as a house preset, so it lands in the same drawer with the same checkbox.
    const room = await saveRoomAsPreset('The Study', LOOK);
    const all: readonly Row[] = [{ id: room!.id, group: SAVED_ROOM_GROUP }, ...ROWS];
    await hideEntry('room-preset', room!.id);
    expect(ids([...curateList('room-preset', all)])).not.toContain(room!.id);
    expect(hiddenIds('room-preset')).toEqual([room!.id]);
    // Still theirs: the drawer can still name it even with no card behind it.
    expect(getSavedRoom(room!.id)?.name).toBe('The Study');
    await restoreEntries('room-preset', [room!.id]);
    expect(ids([...curateList('room-preset', all)])).toContain(room!.id);
  });

  it('renames without moving the id, so the stars survive the rename', async () => {
    const room = await saveRoomAsPreset('study', LOOK, 1);
    expect(await renameSavedRoom(room!.id, 'The Long Study')).toBe(true);
    expect(getSavedRoom(room!.id)?.name).toBe('The Long Study');
    expect(starsOf('room-preset', room!.id)).toBe(1);
  });

  it('forgetting one for good takes its star and its removal with it', async () => {
    const room = await saveRoomAsPreset('study', LOOK, 2);
    await hideEntry('room-preset', room!.id);
    expect(await forgetSavedRoom(room!.id)).toBe(true);
    expect(getSavedRoom(room!.id)).toBeNull();
    expect(starsOf('room-preset', room!.id)).toBe(0);
    // No orphan sitting in the drawer offering to restore a room that is gone.
    expect(hiddenIds('room-preset')).toEqual([]);
  });
});

/* ========================================================================== *
 *                       total, off an unvalidated disk                       *
 * ========================================================================== */

describe('parseShelfOfMine', () => {
  const JUNK: readonly unknown[] = [
    null,
    undefined,
    0,
    -1,
    NaN,
    '',
    'nonsense',
    '{',
    [],
    [1, 2, 3],
    {},
    { stars: 7 },
    { stars: { build: 'yes' } },
    { hidden: 'all of them' },
    { hidden: { build: 'a1' } },
    { rooms: {} },
    { rooms: [null, 3, 'room'] },
  ];

  it('is total: every junk value gives a usable book', () => {
    for (const raw of JUNK) {
      const book = parseShelfOfMine(raw);
      expect(book.stars).toBeTypeOf('object');
      expect(book.hidden).toBeTypeOf('object');
      expect(Array.isArray(book.rooms)).toBe(true);
    }
  });

  it('drops an axis this build does not know rather than growing forever', () => {
    const book = parseShelfOfMine({
      stars: { build: { a1: 2 }, 'no-such-axis': { x: 1 } },
      hidden: { pattern: ['p1'], 'also-not-an-axis': ['x'] },
    });
    expect(Object.keys(book.stars)).toEqual(['build']);
    expect(Object.keys(book.hidden)).toEqual(['pattern']);
  });

  it('keeps only a star this app can draw', () => {
    const book = parseShelfOfMine({
      stars: { build: { a1: 1, a2: 2, a3: 3, a4: true, a5: 0, a6: 'yes' } },
    });
    expect(book.stars.build).toEqual({ a1: 1, a2: 2 });
  });

  it('de-duplicates a removal list', () => {
    const book = parseShelfOfMine({ hidden: { build: ['a1', 'a1', 'a2', 7, ''] } });
    expect(book.hidden.build).toEqual(['a1', 'a2']);
  });

  it('REPAIRS a saved room rather than losing the reader’s own work', () => {
    // A build id renamed under a room the reader composed and named is a reason
    // to hand back their room with the house carpentry, not a reason to lose it.
    const book = parseShelfOfMine({
      rooms: [
        {
          id: `${SAVED_ROOM_PREFIX}mine`,
          name: 'Mine',
          theme: 'no-such-theme',
          build: 'no-such-build',
          pattern: 42,
          wallpaper: null,
        },
      ],
    });
    expect(book.rooms).toHaveLength(1);
    expect(book.rooms[0]!.name).toBe('Mine');
    expect(book.rooms[0]!.theme).toBe(DEFAULT_THEME_ID);
    expect(book.rooms[0]!.build).toBe(DEFAULT_SHELF_DESIGN.build);
    expect(book.rooms[0]!.pattern).toBe(DEFAULT_SHELF_DESIGN.pattern);
    expect(book.rooms[0]!.wallpaper.pattern).toBeTypeOf('string');
  });

  it('drops a room with no name at all — there is nothing to give back', () => {
    const book = parseShelfOfMine({ rooms: [{ id: `${SAVED_ROOM_PREFIX}x`, name: '  ' }] });
    expect(book.rooms).toEqual([]);
  });

  it('never lets two saved rooms share an id', () => {
    const book = parseShelfOfMine({
      rooms: [
        { id: `${SAVED_ROOM_PREFIX}a`, name: 'One' },
        { id: `${SAVED_ROOM_PREFIX}a`, name: 'Two' },
      ],
    });
    expect(book.rooms).toHaveLength(1);
    expect(book.rooms[0]!.name).toBe('One');
  });
});

describe('the axis vocabulary', () => {
  it('recognises its own words and nothing else', () => {
    for (const axis of CURATION_AXES) expect(isCurationAxis(axis)).toBe(true);
    expect(isCurationAxis('wallpapers')).toBe(false);
    expect(isCurationAxis(7)).toBe(false);
    expect(isCurationAxis(undefined)).toBe(false);
  });

  it('covers every axis the two studios actually offer', () => {
    // A word missing here is a list that silently cannot be curated, which is
    // indistinguishable from one nobody has wired yet.
    for (const axis of ['room-preset', 'colour', 'build', 'pattern', 'wallpaper', 'binding']) {
      expect(CURATION_AXES).toContain(axis);
    }
  });
});

/* ========================================================================== *
 *                    it survives the reader closing the app                  *
 * ========================================================================== */

describe('persistence', () => {
  it('reads back the removals, the stars and the rooms after a reload', async () => {
    await hideEntry('wallpaper', 'gone-one');
    await setStars('wallpaper', 'kept-one', 2);
    const room = await saveRoomAsPreset('Kept Room', LOOK, 1);

    // Forget everything the module knows and read the row again, exactly as a
    // cold start does.
    resetShelfOfMineForTests();
    expect(isHidden('wallpaper', 'gone-one')).toBe(false);
    await loadShelfOfMine();

    expect(isHidden('wallpaper', 'gone-one')).toBe(true);
    expect(starsOf('wallpaper', 'kept-one')).toBe(2);
    expect(savedRooms().map((r) => r.name)).toContain('Kept Room');
    expect(starsOf('room-preset', room!.id)).toBe(1);
  });
});

/* ========================================================================== *
 *                    one mechanism, and both lists use it                    *
 * ========================================================================== */

describe('the strip and the sheet share one implementation', () => {
  const read = (name: string): string =>
    readFileSync(join(import.meta.dirname, '..', 'src', 'views', 'rail', name), 'utf8');

  it('routes both through createCuration rather than each filtering its own', () => {
    // The whole point of the mechanism is that a list opts in with one prop.
    // A caller that grew its own `.filter(isHidden)` would drift from this one
    // the first time either changed, and the drift is invisible until a reader
    // finds a removed entry still on offer in the sheet they reached from a
    // strip that had removed it.
    for (const file of ['DesignStrip.tsx', 'DesignPicker.tsx']) {
      const source = read(file);
      expect(source, `${file} does not use the shared controller`).toContain('createCuration');
      expect(source, `${file} re-implements the removal filter`).not.toMatch(
        /\.filter\([^)]*isHidden/,
      );
    }
  });

  it('offers the axis as a prop on both, spelled the same way', () => {
    for (const file of ['DesignStrip.tsx', 'DesignPicker.tsx']) {
      expect(read(file)).toMatch(/axis\?: CurationAxis/);
    }
  });

  /*
   * The two halves this mechanism cannot wire from inside its own files, left
   * named rather than left silent.
   *
   * This repo's recurring failure — `tests/roll-gates.test.ts` was written for
   * it — is a vocabulary that is authored, exported, validated and reachable
   * from nowhere. `rollPool` is in exactly that position until the studio's
   * "surprise me" reads it, and a saved room is until `roomPresetOptions()`
   * carries it. Both live in files this agent does not own (LibraryStudio.tsx,
   * designOptions.ts). Turn each of these into a real assertion at the moment
   * it is wired; a todo that has been sitting here for a while is a feature
   * nobody can reach.
   */
  it.todo('the dice roll through rollPool once LibraryStudio names its axes');
  it.todo('roomPresetOptions() carries savedRooms() so a kept room is pickable');
});
