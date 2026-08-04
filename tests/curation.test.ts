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
import { ROOM_PRESETS, getRoomPreset, roomPresetOptions } from '../src/views/rail/designOptions';
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
  type CurationAxis,
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

/** One of the rail's own files, read as text. Several gates below are source. */
const read = (name: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'src', 'views', 'rail', name), 'utf8');

/**
 * Comments out.
 *
 * Every source gate here is about what the code DOES, and a prose paragraph
 * naming `rollPool` while the call beside it rolls the raw table is exactly the
 * shape of the bug being watched for.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

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
   * The two halves this mechanism could not wire from inside its own files.
   *
   * This repo's recurring failure — `tests/roll-gates.test.ts` was written for
   * it — is a vocabulary that is authored, exported, validated and reachable
   * from nowhere. `rollPool` was in exactly that position until the studio's
   * "surprise me" read it, and a saved room was until `roomPresetOptions()`
   * carried it. Both lived in files the agent that wrote this mechanism did not
   * own (LibraryStudio.tsx, designOptions.ts), and both were left here as
   * `it.todo` rather than as silence. They are wired now, so they are gates.
   */
  it('the dice roll through rollPool: no pool reaches withMood ungated', () => {
    // The exact failure this catches: `surprise()` narrowing the FULL
    // vocabulary by mood and handing back one of the six papers the reader
    // explicitly took off the list. A dice that ignores the removals is not a
    // dice, it is a panel that did not listen — and it looks identical to a
    // working one until the removed entry comes back up.
    const studio = strip(read('LibraryStudio.tsx'));
    const at = studio.indexOf('const surprise');
    expect(at, 'LibraryStudio has no surprise()').toBeGreaterThan(0);
    const surprise = studio.slice(at, at + 1800);

    const POOLS: readonly (readonly [CurationAxis, string])[] = [
      ['colour', 'THEME_IDS'],
      ['build', 'ROLLABLE_BUILDS'],
      ['pattern', 'ROLLABLE_PATTERNS'],
      ['wallpaper', 'WALLPAPER_ROLL'],
    ];
    for (const [axis, pool] of POOLS) {
      expect(surprise, `${pool} is rolled without the reader's removals`).toMatch(
        new RegExp(`rollPool\\('${axis}',\\s*${pool}`),
      );
    }
    // The gate has to be on the OUTSIDE of every pool, not merely present
    // somewhere in the function: `withMood(POOL, …)` beside an unused
    // `rollPool` import would satisfy a looser check and roll the whole table.
    expect(surprise, 'a pool reaches withMood without passing rollPool').not.toMatch(
      new RegExp(`withMood\\(\\s*(?:${POOLS.map(([, pool]) => pool).join('|')})`),
    );
  });

  it('roomPresetOptions() carries savedRooms() so a kept room is pickable', async () => {
    const house = roomPresetOptions();
    expect(house).toHaveLength(ROOM_PRESETS.length);

    const room = await saveRoomAsPreset('The Study', LOOK, 2);
    const withMine = roomPresetOptions();
    expect(withMine).toHaveLength(ROOM_PRESETS.length + 1);

    const card = withMine.find((option) => option.id === room!.id);
    expect(card, 'a kept room is not on the list it was kept from').toBeDefined();
    expect(card!.name).toBe('The Study');
    expect(card!.group).toBe(SAVED_ROOM_GROUP);

    // The half that is easy to miss, and fatal on its own: a card that is
    // offered, drawn and pressed, and then answers null to the lookup the
    // studio applies it through — so the press silently does nothing.
    expect(getRoomPreset(room!.id)?.build).toBe(LOOK.build);
    expect(getRoomPreset(room!.id)?.theme).toBe(LOOK.theme);

    // Its own art key, or the card cache serves it somebody else's picture.
    expect(new Set(withMine.map((option) => option.artKey)).size).toBe(withMine.length);

    // And the notation reaches it: two stars put the reader's own room at the
    // head of the whole sheet, which is what they saved it starred for.
    expect(curateList('room-preset', withMine)[0]?.id).toBe(room!.id);

    // Removable like any house preset, and restorable from the same drawer.
    await hideEntry('room-preset', room!.id);
    expect(curateList('room-preset', withMine).map((o) => o.id)).not.toContain(room!.id);
    await restoreEntries('room-preset', [room!.id]);
    expect(curateList('room-preset', withMine).map((o) => o.id)).toContain(room!.id);
  });
});

/* ========================================================================== *
 *              every studio list says which list it is, out loud             *
 * ========================================================================== */

/**
 * The gate for the failure this whole wave exists for.
 *
 * `DesignStrip` and `DesignPicker` apply the reader's curation for their
 * caller — but ONLY when the caller names its axis, because that is what lets a
 * list opt in with one prop. The consequence is that forgetting the prop is
 * completely silent: the strip renders, the tiles work, the right-click does
 * what right-click used to do, and the entire mechanism underneath it is
 * unreachable from that list forever. Nothing else in the tree can tell the
 * difference between a list that opted out and a list nobody wired.
 *
 * So it is checked in the source, where the prop either is or is not written.
 */
describe('every studio list names its axis', () => {
  /** Every `<Tag …/>` element in a file, as its own text. */
  const elementsOf = (source: string, tag: string): readonly string[] => {
    const out: string[] = [];
    for (let at = source.indexOf(`<${tag}`); at >= 0; at = source.indexOf(`<${tag}`, at + 1)) {
      const end = source.indexOf('/>', at);
      out.push(source.slice(at, end < 0 ? source.length : end));
    }
    return out;
  };

  const STUDIOS = ['LibraryStudio.tsx', 'BookStudio.tsx'] as const;

  it('mounts at least one of each, or this whole file passes vacuously', () => {
    for (const file of STUDIOS) {
      const source = strip(read(file));
      expect(elementsOf(source, 'DesignStrip').length, file).toBeGreaterThan(0);
      expect(elementsOf(source, 'DesignPicker').length, file).toBeGreaterThan(0);
    }
  });

  it('gives every strip and every sheet an axis prop', () => {
    for (const file of STUDIOS) {
      const source = strip(read(file));
      for (const tag of ['DesignStrip', 'DesignPicker']) {
        elementsOf(source, tag).forEach((element, index) => {
          const label = /label="([^"]*)"|title=\{?([^\n]*)/.exec(element)?.[1] ?? `#${index}`;
          expect(element, `${file}: <${tag} ${label}> names no axis`).toMatch(/\baxis=/);
        });
      }
    }
  });

  it('spells every axis with a word the store knows', () => {
    // A typo — 'wallpapers' for 'wallpaper' — would split one reader's
    // curation in two, silently, forever.
    //
    // Only the literal props are read. An `axis` that arrives as an expression
    // is already a `CurationAxis` or TypeScript refused it; a bare string in
    // the markup is the one form that could get past a cast, and it is also
    // the form a hurried edit reaches for.
    let checked = 0;
    for (const file of STUDIOS) {
      for (const word of strip(read(file)).matchAll(/axis=(?:"([a-z-]+)"|\{'([a-z-]+)'\})/g)) {
        const axis = word[1] ?? word[2] ?? '';
        expect(isCurationAxis(axis), `${file}: '${axis}' is not a curation axis`).toBe(true);
        checked += 1;
      }
    }
    expect(checked, 'no literal axis props at all — the regex has gone stale').toBeGreaterThan(8);
  });

  /**
   * The lists each studio is expected to offer, by name.
   *
   * A word missing from the source is a list that silently cannot be curated,
   * which — per the note in `CURATION_AXES` — is indistinguishable from one
   * nobody has wired yet. That is precisely the state this wave found the
   * mechanism in, so it is worth naming the axes rather than merely counting
   * the props above.
   */
  const OFFERED: Record<(typeof STUDIOS)[number], readonly CurationAxis[]> = {
    'LibraryStudio.tsx': [
      'room-preset',
      'colour',
      'shelf-colour',
      'wall-colour',
      'build',
      'pattern',
      'named-case',
      'wallpaper',
      'wallpaper-scale',
      'wallpaper-relief',
      'wallpaper-ink',
    ],
    'BookStudio.tsx': [
      'binding',
      'spine-shape',
      'covering',
      'marks',
      'spine-cloth',
      'charm-colour',
      // The nine chip rows. They were DECLARED in `CURATION_AXES` and bound to
      // nothing for a whole wave — the store would happily have recorded a
      // removal against 'ornament' that no picker ever consulted — which is
      // precisely the failure the file above describes and the reason this
      // list is spelled out rather than counted.
      'binding-material',
      'ornament',
      'title-plate',
      'lettering',
      'edge',
      'format',
      'charm',
      'cover-frame',
      'cover-medallion',
    ],
  };

  it('reaches every list the two studios actually offer', () => {
    // The word itself, quoted, rather than `axis="…"` on an element: a studio
    // whose sheet serves eight axes passes them through one lookup table
    // (`SHEET_AXIS`, `OWN_AXIS_CURATION`) so the strip and the sheet cannot
    // spell one list two ways, and the word is written in the table instead.
    // What stops that from weakening the check is the two gates above — every
    // element must carry the prop, and every axis literal must be a real one.
    for (const [file, axes] of Object.entries(OFFERED)) {
      const source = strip(read(file));
      for (const axis of axes) {
        expect(source, `${file} never names '${axis}'`).toMatch(new RegExp(`['"]${axis}['"]`));
      }
    }
  });

  it('files the reader’s own packs on a real axis rather than a lookalike', () => {
    // The conflict this wave had to resolve: YourDesigns took its own `axis`
    // prop over 'wallpaper' | 'carpentry'. The first collides with a
    // CurationAxis by luck; the second is not one at all. A pack that could not
    // be starred would be the one thing in the studio that is actually the
    // reader's own and also the one thing they cannot arrange.
    const yours = strip(
      readFileSync(
        join(import.meta.dirname, '..', 'src', 'features', 'packs', 'YourDesigns.tsx'),
        'utf8',
      ),
    );
    expect(yours, 'YourDesigns does not use the shared controller').toContain('createCuration');
    expect(yours, 'YourDesigns re-implements the removal filter').not.toMatch(
      /\.filter\([^)]*isHidden/,
    );
    for (const word of yours.matchAll(/^\s*(?:wallpaper|carpentry):\s*'([a-z-]+)',/gm)) {
      expect(isCurationAxis(word[1]), `'${word[1]}' is not a curation axis`).toBe(true);
    }
    // And the mapping is a total record, so a third category cannot be added
    // without somebody deciding which list a reader curates it in.
    expect(yours).toMatch(/Record<PackAxis,\s*CurationAxis>/);
    // The prop is `pack`, so that in this tree `axis` means exactly one thing.
    expect(yours, 'the pack category is called `axis` again').not.toMatch(
      /readonly axis:|props\.axis/,
    );
  });
});

/* ========================================================================== *
 *              a word in the vocabulary is a promise some list keeps         *
 * ========================================================================== */

/**
 * The gate for the defect this repo has now shipped nine times: something
 * authored, ticked as done, and reachable by nobody.
 *
 * `CURATION_AXES` is a closed union, which is exactly what makes a stray word
 * in it invisible. TypeScript checks that every `axis` prop names one of these;
 * NOTHING checked the other direction, so sixteen of the thirty-three were
 * declared, validated, persisted and consulted by no picker at all — and no
 * test could tell that apart from a list that had opted out. Three of the
 * sixteen ('tooling', 'wear', 'icon-colour') had no picker to wire at all and
 * were dropped from the vocabulary; the rest are bound below.
 *
 * The check is deliberately a text search rather than a type: the failure is
 * that a word exists and nothing consumes it, and only the source can say.
 */
describe('every axis in the vocabulary has a picker that names it', () => {
  /** Any file in src/, by path segments. */
  const src = (...parts: readonly string[]): string =>
    readFileSync(join(import.meta.dirname, '..', 'src', ...parts), 'utf8');

  /**
   * Where each list actually lives — named, not searched for, because "some
   * file somewhere mentions the string" is the assertion that would have
   * passed all through the wave this exists to end.
   */
  const HOME: Readonly<Record<CurationAxis, readonly string[]>> = {
    'room-preset': ['views/rail/LibraryStudio.tsx'],
    colour: ['views/rail/LibraryStudio.tsx'],
    'shelf-colour': ['views/rail/LibraryStudio.tsx'],
    'wall-colour': ['views/rail/LibraryStudio.tsx'],
    build: ['views/rail/LibraryStudio.tsx'],
    pattern: ['views/rail/LibraryStudio.tsx'],
    'named-case': ['views/rail/LibraryStudio.tsx'],
    wallpaper: ['views/rail/LibraryStudio.tsx'],
    'wallpaper-scale': ['views/rail/LibraryStudio.tsx'],
    'wallpaper-relief': ['views/rail/LibraryStudio.tsx'],
    'wallpaper-ink': ['views/rail/LibraryStudio.tsx'],
    binding: ['views/rail/BookStudio.tsx'],
    'spine-shape': ['views/rail/BookStudio.tsx'],
    covering: ['views/rail/BookStudio.tsx'],
    marks: ['views/rail/BookStudio.tsx'],
    'spine-cloth': ['views/rail/BookStudio.tsx'],
    'binding-material': ['views/rail/BookStudio.tsx'],
    ornament: ['views/rail/BookStudio.tsx'],
    'title-plate': ['views/rail/BookStudio.tsx'],
    lettering: ['views/rail/BookStudio.tsx'],
    edge: ['views/rail/BookStudio.tsx'],
    format: ['views/rail/BookStudio.tsx'],
    charm: ['views/rail/BookStudio.tsx'],
    'charm-colour': ['views/rail/BookStudio.tsx'],
    'cover-frame': ['views/rail/BookStudio.tsx'],
    'cover-medallion': ['views/rail/BookStudio.tsx'],
    'sound-set': ['features/settings/SettingsPanel.tsx'],
    stationery: ['views/rail/CataloguePanel.tsx'],
    sticker: ['views/rail/CataloguePanel.tsx'],
    'page-style': ['views/rail/PageStylePanel.tsx'],
  };

  it('names a home for every axis, and no axis this build does not know', () => {
    // Both directions. A word added to `CURATION_AXES` with no entry here is
    // the exact state the sixteen were in; an entry here for a word that has
    // been retired is a table nobody pruned.
    expect(Object.keys(HOME).sort()).toEqual([...CURATION_AXES].sort());
  });

  it('finds the word written in the picker that owns the list', () => {
    for (const [axis, files] of Object.entries(HOME) as [CurationAxis, readonly string[]][]) {
      const found = files.some((file) =>
        new RegExp(`['"]${axis}['"]`).test(strip(src(...file.split('/')))),
      );
      expect(found, `no picker names '${axis}' — the store would record a removal nothing reads`).toBe(true);
    }
  });

  it('leaves the three axes with no picker out of the vocabulary', () => {
    // Named, so that re-adding one is a deliberate act with a list behind it.
    // 'tooling' is a two-position switch, 'wear' is a continuous slider, and
    // 'icon-colour' had no control anywhere in the app.
    for (const gone of ['tooling', 'wear', 'icon-colour']) {
      expect(isCurationAxis(gone), `'${gone}' is back without a picker`).toBe(false);
    }
  });

  it('routes every one of them through the shared controller', () => {
    // Not through a hand-rolled copy of it. The panels below are the ones this
    // wave wired; each has to reach `createCuration` (directly or through
    // `CuratedChips`, which is itself one call to it) and must not have grown
    // its own removal filter beside it.
    const PANELS = [
      'views/rail/BookStudio.tsx',
      'views/rail/CataloguePanel.tsx',
      'views/rail/PageStylePanel.tsx',
      'features/settings/SettingsPanel.tsx',
    ];
    for (const panel of PANELS) {
      const source = strip(src(...panel.split('/')));
      expect(source, `${panel} does not use the shared controller`).toMatch(
        /createCuration|CuratedChips/,
      );
      expect(source, `${panel} re-implements the removal filter`).not.toMatch(
        /\.filter\([^)]*isHidden/,
      );
    }
  });

  it('makes the book studio’s dice honour a removal, not just its rows', () => {
    // The half of a removal that is invisible from the DOM, and the one a
    // reader minds more: they take a stamp off the list, press randomise, and
    // the app puts it straight back on the book. Every draw in that panel goes
    // through `respectingCuration`, which is `rollPool` and nothing else.
    const studio = strip(src('views', 'rail', 'BookStudio.tsx'));
    expect(studio, 'the studio never consults the roll pool').toContain('rollPool');
    for (const draw of studio.matchAll(/randomBookStyleOverrides\(/g)) {
      const before = studio.slice(Math.max(0, draw.index - 60), draw.index);
      expect(
        before.includes('respectingCuration('),
        'a draw that skips the reader’s removals',
      ).toBe(true);
    }
    // …and `surprise me`, which does not draw overrides at all: it resolves a
    // fresh style off a seed, so it needs the same pass on the way out.
    expect(studio).toMatch(/respectingCuration\(\s*bookStyleToOverrides\(/);
  });
});
