/**
 * src/data/shelfOfMine.ts — the reader's own hand on every list in the studio.
 *
 * The report, in their words:
 *
 *   "we should also give the user to delete stuff in the customisation in all
 *    possible areas with option to restore it again by right clicking its menu
 *    which then opens up the list of deleted ones with checkbox style options
 *    to restore what they want, along with option for user to favorite stuff
 *    which then puts it in first in its category or sub cateofry depending
 *    favorite level the user sets for it"
 *
 *   "single star to pin it to top of a subcateogyr while double star for it to
 *    be at top within the category as a whole, this notation for pretty much
 *    anything"
 *
 * "this notation for pretty much anything" is the whole design brief. It is not
 * a feature of the room presets that other lists might copy later; it is ONE
 * mechanism keyed by (axis, entry id), and every long list in the studio — the
 * rooms, the carpentries, the papers, the bindings, the sound sets — reaches
 * for it by naming its axis and doing nothing else. `DesignStrip` and
 * `DesignPicker` apply it for their caller, so a panel opts in with one prop
 * rather than with a copy of this logic.
 *
 * ## Three things it stores, and one it does not
 *
 * HIDDEN. The reader took an entry off a list. Nothing is destroyed and
 * nothing ever will be: the id is written down, the list stops offering it, the
 * dice stop rolling it, and the restore drawer hands it back whenever they ask.
 * This is the reader deleting, which is a different act from the curation the
 * vocabularies do to themselves — a tier demotion keeps an odd entry pickable
 * and out of the roll, and that is not this.
 *
 * STARS. 0, 1 or 2 against an entry. One star puts it first inside its own
 * family; two lift it clear of the families to the top of the whole axis. That
 * is the reader's notation, taken literally.
 *
 * SAVED ROOMS. A room the reader composed and kept. It is theirs, so it is
 * starrable like any house preset and removable like one — and because
 * "removed" here means hidden, removing one is as undoable as removing
 * anything else. That is the one place the curation rule ("you dont have to be
 * too cruel") and the reader's own delete key meet: neither of them destroys.
 *
 * What it does NOT store is ORDER. Order is derived — stars first, then the
 * vocabulary's own authored sequence — because a stored order goes stale the
 * moment a vocabulary grows an entry, and these grow constantly. `orderByStars`
 * is pure and total and is the only thing that decides.
 *
 * ## Not a cache key
 *
 * Every other axis added to this app had to be spelled into a bake key (see
 * CLAUDE.md). This one must not be: hiding an entry or starring it changes
 * which options are OFFERED and in what order, and changes no drawn pixel of
 * any option. Nothing here belongs next to `flatSchemeTag()`.
 *
 * ## Total, like everything else that comes back off disk
 *
 * The blob is read out of SQLite unvalidated. Junk in an axis name or an entry
 * id is dropped; junk INSIDE a saved room is repaired per field rather than
 * dropping the room, because a saved room is the reader's own work and losing
 * it to a renamed timber pattern would be the cruelty the rule forbids.
 */

import { createSignal } from 'solid-js';
import {
  DEFAULT_SHELF_DESIGN,
  isBuildId,
  isPatternId,
  type BuildId,
  type PatternId,
} from '../art/shelfDesign';
import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from '../art/themes';
import type { WallpaperSpec } from '../art/wallpaperDesign';
import { getDb } from './db';
import { mergeWallpaperSpec } from './designPrefs';

/* ========================================================================== *
 *                                  the axes                                  *
 * ========================================================================== */

/**
 * Every list a reader can curate, named once.
 *
 * A closed union rather than a bare string, because the whole mechanism is
 * keyed by (axis, entry id) and a typo — 'wallpapers' for 'wallpaper' — would
 * split one reader's curation in two, silently, forever. Adding a list is a
 * word here; passing a string that is not one of these is a type error at the
 * call site, which is where it can still be fixed.
 *
 * They are named for what the READER is choosing, not for the module that
 * implements it: 'covering' rather than 'materialLook'.
 */
export const CURATION_AXES = [
  // the room
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
  // the book
  'binding',
  'spine-shape',
  'covering',
  'marks',
  'spine-cloth',
  'tooling',
  'binding-material',
  'ornament',
  'title-plate',
  'lettering',
  'wear',
  'edge',
  'format',
  'charm',
  'charm-colour',
  'cover-frame',
  'cover-medallion',
  // the rest of the app
  'sound-set',
  'stationery',
  'sticker',
  'page-style',
  'icon-colour',
] as const;

export type CurationAxis = (typeof CURATION_AXES)[number];

const AXIS_SET: ReadonlySet<string> = new Set(CURATION_AXES);

export function isCurationAxis(value: unknown): value is CurationAxis {
  return typeof value === 'string' && AXIS_SET.has(value);
}

/**
 * The reader's notation: none, one star, two.
 *
 * Deliberately not a boolean "favourite". One star means "first in its family"
 * and two mean "first of everything", and a reader who wants both levels wants
 * to be able to tell them apart at a glance — which is what makes the second
 * star worth having at all.
 */
export type Stars = 0 | 1 | 2;

/** What a star does, in the words the menu says out loud. */
export function starMeaning(stars: Stars, family?: string): string {
  if (stars === 2) return 'first of them all';
  if (stars === 1) {
    return family !== undefined && family.length > 0
      ? `first in ${family.toLowerCase()}`
      : 'first in its family';
  }
  return 'no star';
}

/* ========================================================================== *
 *                              a room of your own                            *
 * ========================================================================== */

/** Reader-owned preset ids all start here, so they can never shadow a house one. */
export const SAVED_ROOM_PREFIX = 'mine.';

/** The section a saved room is filed under in the preset sheet. */
export const SAVED_ROOM_GROUP = 'Yours';

export function isSavedRoomId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(SAVED_ROOM_PREFIX);
}

/**
 * The four values a room is: its colours, how the case is built, what is worked
 * into its timber, and the paper behind it.
 *
 * Structurally the same as `RoomLook` in views/rail/designOptions.ts, and
 * deliberately re-declared here rather than imported: the data layer does not
 * get to depend on a view. The two assign to each other in both directions,
 * which is the only compatibility either side needs.
 */
export interface SavedRoomLook {
  theme: ThemeId;
  build: BuildId;
  pattern: PatternId;
  wallpaper: WallpaperSpec;
  /** The named paper, when the wall is wearing one. '' once an axis is nudged. */
  paper?: string;
}

export interface SavedRoom extends SavedRoomLook {
  id: string;
  name: string;
  blurb: string;
  group: string;
  paper: string;
  /** Epoch ms. The reader's own rooms lead newest-first inside their section. */
  saved: number;
}

/** The one line a saved room's card carries. */
const SAVED_ROOM_BLURB = 'a room of your own, kept.';

const MAX_ROOM_NAME = 48;

/** How many rooms the reader may keep. Generous; a cap only stops a runaway. */
export const MAX_SAVED_ROOMS = 60;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug.length === 0 ? 'room' : slug;
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_ROOM_NAME);
}

/* ========================================================================== *
 *                                  the book                                  *
 * ========================================================================== */

export interface ShelfOfMine {
  /** axis → entry id → 1 | 2. A 0 is never stored; it is the absence. */
  stars: Record<string, Record<string, 1 | 2>>;
  /** axis → the entry ids the reader took off the list, oldest first. */
  hidden: Record<string, string[]>;
  /** The reader's own rooms, newest last. */
  rooms: SavedRoom[];
}

const SETTINGS_KEY = 'shelfOfMine';

function emptyBook(): ShelfOfMine {
  return { stars: {}, hidden: {}, rooms: [] };
}

/*
 * A plain object and one revision signal, not a `createStore`.
 *
 * designPrefs.ts uses a store because a card has to repaint when ITS OWN
 * bookcase is redressed and not when a sibling is — that granularity is worth
 * the proxy. Here it is not: a star or a removal changes one list's membership
 * and order, the lists are tens of entries, and they are already rebuilt whole
 * on every pick. Coarse is the correct answer, and it is the one that cannot
 * develop a tracking bug in a nested record that did not exist yet.
 */
let book: ShelfOfMine = emptyBook();
const [revision, setRevision] = createSignal(0);

let loadPromise: Promise<void> | null = null;

function bump(): void {
  setRevision((r) => r + 1);
}

/** Read this to subscribe; the value itself means nothing. */
function track(): void {
  void revision();
}

/* ------------------------------- validation ------------------------------ */

function parseSavedRoom(raw: unknown, index: number): SavedRoom | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const name = cleanName(s.name);
  if (name === '') return null;
  const id = isSavedRoomId(s.id) ? s.id : `${SAVED_ROOM_PREFIX}${slugify(name)}-${index}`;
  // Repaired per field rather than dropped. A room the reader composed and
  // named is their work; a build id that was renamed under it is a reason to
  // hand back a room with the house carpentry, not a reason to lose the room.
  return {
    id,
    name,
    blurb: typeof s.blurb === 'string' && s.blurb.trim() !== '' ? s.blurb.trim() : SAVED_ROOM_BLURB,
    group: SAVED_ROOM_GROUP,
    theme: isThemeId(s.theme) ? s.theme : DEFAULT_THEME_ID,
    build: isBuildId(s.build) ? s.build : DEFAULT_SHELF_DESIGN.build,
    pattern: isPatternId(s.pattern) ? s.pattern : DEFAULT_SHELF_DESIGN.pattern,
    wallpaper: mergeWallpaperSpec(s.wallpaper),
    paper: typeof s.paper === 'string' ? s.paper : '',
    saved: typeof s.saved === 'number' && Number.isFinite(s.saved) ? s.saved : 0,
  };
}

/** Total: any stored blob at all resolves to a usable book. */
export function parseShelfOfMine(raw: unknown): ShelfOfMine {
  const out = emptyBook();
  const source = typeof raw === 'string' ? safeJson(raw) : raw;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return out;
  const s = source as Record<string, unknown>;

  if (s.stars !== null && typeof s.stars === 'object' && !Array.isArray(s.stars)) {
    for (const [axis, entries] of Object.entries(s.stars as Record<string, unknown>)) {
      // An axis this build does not know is dropped rather than kept: keeping
      // it would grow the blob forever with words nothing reads.
      if (!isCurationAxis(axis)) continue;
      if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) continue;
      const kept: Record<string, 1 | 2> = {};
      for (const [id, value] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof id !== 'string' || id === '') continue;
        if (value === 1 || value === 2) kept[id] = value;
        // Anything else — true, 'yes', 3 — is not a star this app can draw.
      }
      if (Object.keys(kept).length > 0) out.stars[axis] = kept;
    }
  }

  if (s.hidden !== null && typeof s.hidden === 'object' && !Array.isArray(s.hidden)) {
    for (const [axis, ids] of Object.entries(s.hidden as Record<string, unknown>)) {
      if (!isCurationAxis(axis) || !Array.isArray(ids)) continue;
      const kept = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
      if (kept.length > 0) out.hidden[axis] = kept;
    }
  }

  if (Array.isArray(s.rooms)) {
    const seen = new Set<string>();
    s.rooms.forEach((raw, index) => {
      const room = parseSavedRoom(raw, index);
      // A duplicate id would make one row unreachable by every helper here,
      // which reads to the reader as a room that cannot be deleted.
      if (room !== null && !seen.has(room.id)) {
        seen.add(room.id);
        out.rooms.push(room);
      }
    });
    out.rooms = out.rooms.slice(0, MAX_SAVED_ROOMS);
  }

  return out;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* -------------------------------- loading -------------------------------- */

async function persist(): Promise<void> {
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      SETTINGS_KEY,
      JSON.stringify(book),
    ]);
  } catch {
    // Best effort, the same bargain designPrefs strikes: the session still
    // shows the reader's choice, and a list that forgets a star beats a crash
    // inside a panel.
  }
}

/** Read the book once. Idempotent; safe from every panel's onMount. */
export function loadShelfOfMine(): Promise<void> {
  loadPromise ??= (async () => {
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [SETTINGS_KEY],
      );
      book = parseShelfOfMine(rows[0]?.value);
    } catch {
      // No row, no table, no database: nothing hidden and nothing starred is a
      // perfectly good answer, and it is the answer a new reader gets anyway.
    }
    bump();
  })();
  return loadPromise;
}

/** Test seam: forget the load so a fresh database is read again. */
export function resetShelfOfMineForTests(): void {
  loadPromise = null;
  book = emptyBook();
  bump();
}

/** Test seam: start from a known book without going through SQLite. */
export function seedShelfOfMineForTests(raw: unknown): void {
  loadPromise = Promise.resolve();
  book = parseShelfOfMine(raw);
  bump();
}

/* ========================================================================== *
 *                                   reads                                    *
 * ========================================================================== */

/** How many stars the reader put on this entry. Reactive inside Solid. */
export function starsOf(axis: CurationAxis, id: string): Stars {
  track();
  return book.stars[axis]?.[id] ?? 0;
}

/** Did the reader take this entry off the list? Reactive inside Solid. */
export function isHidden(axis: CurationAxis, id: string): boolean {
  track();
  return book.hidden[axis]?.includes(id) ?? false;
}

/** Everything the reader removed from one axis, oldest first. */
export function hiddenIds(axis: CurationAxis): readonly string[] {
  track();
  return book.hidden[axis] ?? [];
}

/** How many entries are waiting in one axis's restore drawer. */
export function hiddenCount(axis: CurationAxis): number {
  return hiddenIds(axis).length;
}

/** The reader's own rooms, newest first — which is the order they want them. */
export function savedRooms(): readonly SavedRoom[] {
  track();
  return [...book.rooms].sort((a, b) => b.saved - a.saved);
}

export function getSavedRoom(id: string): SavedRoom | null {
  track();
  return book.rooms.find((room) => room.id === id) ?? null;
}

/* ========================================================================== *
 *                                  ordering                                  *
 * ========================================================================== */

/**
 * The reader's notation, applied: stars first, then whatever order the
 * vocabulary already publishes.
 *
 * Pure, total, and the ONLY thing that decides order. Two rules, straight out
 * of the report:
 *
 *  - two stars lift an entry clear of its family to the head of the whole axis
 *    ("at the top within the category as a whole");
 *  - one star lifts it to the head of its own family, and the families keep
 *    the order the vocabulary put them in ("top of a subcategory").
 *
 * Everything else keeps its authored index, so the curation the vocabularies
 * do to themselves — a signature binding before a niche one, a characterful
 * preset before a plain one — survives underneath the reader's.
 *
 * Identity when nothing is starred. That matters more than it looks: these
 * lists are rebuilt on every pick and every keystroke, and a sort that returns
 * a new array each time makes every downstream memo re-run for nothing.
 */
export function orderByStars<T>(
  items: readonly T[],
  starsOf: (item: T) => Stars,
  groupOf?: (item: T) => string,
): readonly T[] {
  if (items.length < 2) return items;
  if (!items.some((item) => starsOf(item) !== 0)) return items;

  // Family order is taken from the list as it ARRIVES, so lifting an entry out
  // of a family cannot reorder the families themselves.
  const familyAt = new Map<string, number>();
  const rows = items.map((item, index) => {
    const family = groupOf?.(item) ?? '';
    if (!familyAt.has(family)) familyAt.set(family, familyAt.size);
    return { item, index, family, stars: starsOf(item) };
  });

  rows.sort((a, b) => {
    // ★★ — out of the families altogether, in their own authored order.
    const aTop = a.stars === 2 ? 0 : 1;
    const bTop = b.stars === 2 ? 0 : 1;
    if (aTop !== bTop) return aTop - bTop;
    if (aTop === 0) return a.index - b.index;
    // then the families, in the order the vocabulary introduced them…
    const fa = familyAt.get(a.family) ?? 0;
    const fb = familyAt.get(b.family) ?? 0;
    if (fa !== fb) return fa - fb;
    // …with ★ at the head of each.
    const aStar = a.stars === 1 ? 0 : 1;
    const bStar = b.stars === 1 ? 0 : 1;
    if (aStar !== bStar) return aStar - bStar;
    return a.index - b.index;
  });

  return rows.map((row) => row.item);
}

/**
 * Anything a reader picks from a list: it has an id, and it may say which
 * family it belongs to.
 *
 * Structural on purpose. `PickerOption` satisfies it, and so does any future
 * row shape, without the data layer ever importing a view's type.
 */
export interface CuratedEntry {
  readonly id: string;
  readonly group?: string;
}

/**
 * One axis's list, as the reader has arranged it: their removals taken out,
 * their stars applied.
 *
 * `activeId` is an escape hatch with one job. A reader can remove the entry
 * they are currently wearing — there is no good reason to forbid it — and if
 * that entry then vanished from the strip, every tile would come back unpressed
 * and the panel would read as though it had forgotten their choice. So the
 * entry in use is shown even while it is removed, and it goes the moment they
 * pick something else. The restore drawer still lists it, because it IS removed.
 */
export function curateList<T extends CuratedEntry>(
  axis: CurationAxis,
  items: readonly T[],
  activeId?: string,
): readonly T[] {
  track();
  const hidden = book.hidden[axis];
  const visible =
    hidden === undefined || hidden.length === 0
      ? items
      : items.filter((item) => !hidden.includes(item.id) || item.id === activeId);
  return orderByStars(
    visible,
    (item) => book.stars[axis]?.[item.id] ?? 0,
    (item) => item.group ?? '',
  );
}

/**
 * What the dice may land on: everything the reader has not taken off the list.
 *
 * Stars are deliberately NOT weighted in here. A star says "show me this
 * first", and a reader who asked to be surprised did not ask to be surprised by
 * the six things they already told the app they like.
 *
 * If the reader removed the entire vocabulary, the roll falls back to all of
 * it rather than doing nothing. A "surprise me" that silently no-ops is a
 * broken button, and the pool being empty is the one case where honouring the
 * removals exactly is worse than ignoring them.
 */
export function rollPool<T>(
  axis: CurationAxis,
  items: readonly T[],
  idOf: (item: T) => string,
): readonly T[] {
  track();
  const hidden = book.hidden[axis];
  if (hidden === undefined || hidden.length === 0) return items;
  const pool = items.filter((item) => !hidden.includes(idOf(item)));
  return pool.length === 0 ? items : pool;
}

/* ========================================================================== *
 *                                   writes                                   *
 * ========================================================================== */

/**
 * Put stars on an entry, or take them off.
 *
 * Optimistic, like every other write in this directory: the list reorders on
 * the frame the reader clicked and the row goes to SQLite behind it.
 */
export async function setStars(axis: CurationAxis, id: string, stars: Stars): Promise<void> {
  await loadShelfOfMine();
  if (id === '') return;
  const entries = { ...(book.stars[axis] ?? {}) };
  if (stars === 0) delete entries[id];
  else entries[id] = stars;
  const next = { ...book.stars };
  if (Object.keys(entries).length === 0) delete next[axis];
  else next[axis] = entries;
  book = { ...book, stars: next };
  bump();
  await persist();
}

/** none → one → two → none. What a click on the star mark does. */
export async function cycleStars(axis: CurationAxis, id: string): Promise<Stars> {
  const next = ((starsOf(axis, id) + 1) % 3) as Stars;
  await setStars(axis, id, next);
  return next;
}

/**
 * Take an entry off a list.
 *
 * The star, if there is one, stays. Restoring has to put the entry back where
 * the reader had it, not back at the bottom of the pile they promoted it out
 * of — otherwise removing something by accident quietly costs them the
 * arrangement as well.
 */
export async function hideEntry(axis: CurationAxis, id: string): Promise<void> {
  await loadShelfOfMine();
  if (id === '') return;
  const current = book.hidden[axis] ?? [];
  if (current.includes(id)) return;
  book = { ...book, hidden: { ...book.hidden, [axis]: [...current, id] } };
  bump();
  await persist();
}

/** Put entries back on a list. The checkbox drawer's one action. */
export async function restoreEntries(
  axis: CurationAxis,
  ids: readonly string[],
): Promise<void> {
  await loadShelfOfMine();
  const current = book.hidden[axis];
  if (current === undefined || ids.length === 0) return;
  const dropping = new Set(ids);
  const kept = current.filter((id) => !dropping.has(id));
  if (kept.length === current.length) return;
  const next = { ...book.hidden };
  if (kept.length === 0) delete next[axis];
  else next[axis] = kept;
  book = { ...book, hidden: next };
  bump();
  await persist();
}

/** Put everything back on one list. */
export function restoreAll(axis: CurationAxis): Promise<void> {
  return restoreEntries(axis, [...hiddenIds(axis)]);
}

/* ---------------------------- saving a room ------------------------------ */

/**
 * Keep the room as it stands, under a name.
 *
 * The reader's words: "give the user the option to save their current room as
 * preset and also star it simuntaosuly to make sure it stays up top" — so the
 * stars are an argument here rather than a second trip through `setStars`. A
 * reader who asked for it to stay up top wants it up top on the frame it
 * appears, not after they find it and star it.
 *
 * The name is made unique by suffix rather than by refusal. Two rooms called
 * "study" is a thing a person does, and an error dialog over it is not.
 */
export async function saveRoomAsPreset(
  name: string,
  look: SavedRoomLook,
  stars: Stars = 0,
): Promise<SavedRoom | null> {
  await loadShelfOfMine();
  const clean = cleanName(name);
  if (clean === '') return null;
  if (book.rooms.length >= MAX_SAVED_ROOMS) return null;

  const taken = new Set(book.rooms.map((room) => room.id));
  const base = `${SAVED_ROOM_PREFIX}${slugify(clean)}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;

  const room: SavedRoom = {
    id,
    name: clean,
    blurb: SAVED_ROOM_BLURB,
    group: SAVED_ROOM_GROUP,
    theme: isThemeId(look.theme) ? look.theme : DEFAULT_THEME_ID,
    build: isBuildId(look.build) ? look.build : DEFAULT_SHELF_DESIGN.build,
    pattern: isPatternId(look.pattern) ? look.pattern : DEFAULT_SHELF_DESIGN.pattern,
    wallpaper: mergeWallpaperSpec(look.wallpaper),
    paper: typeof look.paper === 'string' ? look.paper : '',
    saved: Date.now(),
  };
  book = { ...book, rooms: [...book.rooms, room] };
  bump();
  await persist();
  if (stars !== 0) await setStars('room-preset', id, stars);
  return room;
}

/**
 * Rename one of the reader's own rooms. The id does not move — a renamed room
 * keeps its stars, and keeps being the room the case is currently wearing.
 */
export async function renameSavedRoom(id: string, name: string): Promise<boolean> {
  await loadShelfOfMine();
  const clean = cleanName(name);
  if (clean === '') return false;
  const index = book.rooms.findIndex((room) => room.id === id);
  if (index < 0) return false;
  const rooms = [...book.rooms];
  rooms[index] = { ...rooms[index]!, name: clean };
  book = { ...book, rooms };
  bump();
  await persist();
  return true;
}

/**
 * Throw a saved room away for good.
 *
 * Note what the studio calls instead: removing a saved room from the list is
 * `hideEntry('room-preset', id)`, exactly like removing a house preset, so it
 * lands in the same restore drawer and comes back with the same checkbox. This
 * is the floor under that — the one call that actually forgets — and it exists
 * so a reader who wants a room gone has a way, not because the delete key
 * should reach it.
 */
export async function forgetSavedRoom(id: string): Promise<boolean> {
  await loadShelfOfMine();
  const rooms = book.rooms.filter((room) => room.id !== id);
  if (rooms.length === book.rooms.length) return false;
  book = { ...book, rooms };
  bump();
  await persist();
  await setStars('room-preset', id, 0);
  await restoreEntries('room-preset', [id]);
  return true;
}

