/**
 * src/features/packs/store.ts — where a reader's packs live, and how one
 * reaches the shelf.
 *
 * The same split `sound/userSoundSets.ts` + `sound/userSoundSetStore.ts`
 * already makes, for the same reason: the registry is a Solid signal so panels
 * re-render, and this is the one module in `features/packs/` that touches
 * SQLite and the drawing stores.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A PACK IS RE-VALIDATED ON THE WAY OUT OF THE DATABASE
 * ─────────────────────────────────────────────────────────────────────────
 * An import is all-or-nothing: one bad entry refuses the file, because the
 * reader is standing there and can fix it. A READ is the opposite situation —
 * nobody is watching, the file was fine when it went in, and a vocabulary can
 * move underneath it. So the read path is TOTAL in the way `resolveShelfDesign`
 * is: every entry goes back through `validatePackItem`, the ones that no longer
 * name anything the app draws are dropped and COUNTED, and the panel says so.
 * Dropping quietly would leave a tile that paints the fallback paper while
 * claiming to be the reader's; throwing would take the studio down with it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NOTHING HERE IS A NEW AXIS OF BAKED PIXELS — AND THAT IS DELIBERATE
 * ─────────────────────────────────────────────────────────────────────────
 * CLAUDE.md's standing trap: any axis that varies baked pixels must appear in
 * the relevant cache key, and a key missing an axis serves the wrong art to
 * everybody who already has the right art under it. A reader's wallpaper is a
 * `WallpaperSpec` built out of the SHIPPED axes, so `wallpaperTileKey` already
 * covers it to the last field; a reader's bookcase is a `{build, pattern}`
 * pair, so `shelfDesignTag()` already covers that. That is not luck — it is
 * why packs carry recipes rather than pictures. If a pack ever carries bytes
 * that get drawn, this comment stops being true and a cache key has to grow.
 */

import { createSignal } from 'solid-js';
import { nanoid } from 'nanoid';
import {
  FALLBACK_SHELF_DESIGN,
  isBuildId,
  isPatternId,
  type ShelfDesign,
} from '../../art/shelfDesign';
import type { WallpaperSpec } from '../../art/wallpaperDesign';
import { getDb } from '../../data/db';
import {
  mergeWallpaperSpec,
  saveRoomDesign,
  saveWallpaper,
} from '../../data/designPrefs';
import { addUserSticker } from '../templates/userStickers';
import { PACK_CATEGORIES, packCategory } from './categories';
import type { PackCategory, PackCategoryId } from './schema';
import { validatePackItem, type PackItem, type ValidatedPack } from './validate';

const SETTINGS_KEY = 'userPacks';

/**
 * A ceiling, because these are the reader's own files and nothing else in the
 * app would notice them growing. Twenty-four packs is well past what anyone
 * will make and still a list a panel can draw without capping twice.
 */
export const MAX_PACKS = 24;

/** One pack, as it sits in the app after an import. */
export interface InstalledPack {
  readonly id: string;
  readonly category: PackCategoryId;
  readonly name: string;
  /** '' when the file named nobody. */
  readonly author: string;
  readonly items: readonly PackItem[];
  readonly addedAt: number;
  /**
   * Entries that were in the file and no longer name anything this app draws.
   * Surfaced in the panel rather than swallowed — see the header.
   */
  readonly dropped: number;
}

/** One entry, with the pack it came from, for a flat "yours" strip. */
export interface PackEntry {
  readonly packId: string;
  readonly packName: string;
  readonly index: number;
  readonly item: PackItem;
}

/* ============================== the registry ============================== */

const [registry, setRegistry] = createSignal<readonly InstalledPack[]>([]);

/** Reactive read — tracks inside a Solid computation. */
export function userPacks(): readonly InstalledPack[] {
  return registry();
}

/** Detached read, for QA bridges and non-Solid callers. */
export function snapshotUserPacks(): readonly InstalledPack[] {
  return registry();
}

/** Every pack in one category, newest last (the order they were added). */
export function packsIn(category: PackCategoryId): readonly InstalledPack[] {
  return registry().filter((pack) => pack.category === category);
}

/**
 * Every entry in one category, flattened, so a strip can show "yours"
 * alongside the shipped vocabulary without knowing about packs at all.
 */
export function entriesIn(category: PackCategoryId): readonly PackEntry[] {
  const out: PackEntry[] = [];
  for (const pack of packsIn(category)) {
    pack.items.forEach((item, index) => {
      out.push({ packId: pack.id, packName: pack.name, index, item });
    });
  }
  return out;
}

/* ============================== persistence =============================== */

interface StoredPack {
  id: string;
  category: string;
  name: string;
  author: string;
  addedAt: number;
  items: unknown[];
}

let loadPromise: Promise<readonly InstalledPack[]> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * One stored pack back into a live one. Total — anything unreadable answers
 * null and the pack is simply not there, which is the answer a corrupt row
 * gets everywhere else in this app.
 */
function hydrate(raw: unknown): InstalledPack | null {
  if (!isRecord(raw)) return null;
  const category = packCategory(raw.category);
  if (category === null) return null;
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : `pack_${nanoid(8)}`;
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : category.title;
  const author = typeof raw.author === 'string' ? raw.author : '';
  const addedAt = typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) ? raw.addedAt : 0;

  const items: PackItem[] = [];
  let dropped = 0;
  const list = Array.isArray(raw.items) ? raw.items : [];
  for (const entry of list.slice(0, category.maxItems)) {
    const checked = validatePackItem(category, entry, 'item');
    if (checked.item === null) dropped += 1;
    else items.push(checked.item);
  }
  if (items.length === 0 && dropped === 0) return null;
  return { id, category: category.id, name, author, items, addedAt, dropped };
}

function toStored(pack: InstalledPack): StoredPack {
  return {
    id: pack.id,
    category: pack.category,
    name: pack.name,
    author: pack.author,
    addedAt: pack.addedAt,
    items: [...pack.items],
  };
}

async function persist(): Promise<void> {
  const payload = JSON.stringify({ packs: snapshotUserPacks().map(toStored) });
  try {
    const db = await getDb();
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
      SETTINGS_KEY,
      payload,
    ]);
  } catch {
    // Best effort, like every other keyed preference in this app: the session
    // still shows the pack, and a studio that forgets beats a studio that
    // refuses to open.
  }
}

/** Read every stored pack and register it. Idempotent. */
export function loadUserPacks(): Promise<readonly InstalledPack[]> {
  loadPromise ??= (async () => {
    let stored: unknown = null;
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [SETTINGS_KEY],
      );
      const raw = rows[0]?.value;
      stored = typeof raw === 'string' ? JSON.parse(raw) : null;
    } catch {
      // No row, no table, bad JSON: the reader simply has no packs.
    }
    const list = isRecord(stored) && Array.isArray(stored.packs) ? stored.packs : [];
    const hydrated: InstalledPack[] = [];
    for (const entry of list.slice(0, MAX_PACKS)) {
      const pack = hydrate(entry);
      if (pack !== null) hydrated.push(pack);
    }
    setRegistry(hydrated);
    return hydrated;
  })();
  return loadPromise;
}

/* ================================ writing ================================= */

/** What installing a pack actually did, so the dialog can be specific. */
export interface InstallReport {
  readonly pack: InstalledPack | null;
  /** Entries that landed. */
  readonly installed: number;
  /** Plain-English trouble that did not stop the install (a sticker that
   *  could not be written to disk, say). */
  readonly warnings: readonly string[];
  /** A refusal, when the install could not happen at all. */
  readonly refusal: string | null;
}

/**
 * Put a validated pack into the app.
 *
 * Stickers are the one category whose install has a SIDE of its own: the
 * drawings go through `features/templates/userStickers.ts` into the asset
 * store, which is where the catalogue and Notebook Script already read them
 * from. Everything else is a recipe, and a recipe only has to be remembered.
 */
export async function installPack(validated: ValidatedPack): Promise<InstallReport> {
  await loadUserPacks();
  if (snapshotUserPacks().length >= MAX_PACKS) {
    return {
      pack: null,
      installed: 0,
      warnings: [],
      refusal: `that would be ${MAX_PACKS + 1} packs — forget one first.`,
    };
  }

  const warnings: string[] = [];
  let items = validated.items;

  if (validated.category === 'sticker') {
    const landed: PackItem[] = [];
    for (const item of validated.items) {
      const svg = item.svg ?? '';
      const name = item.name ?? 'sticker';
      try {
        const record = await addUserSticker(new TextEncoder().encode(svg), 'svg', name);
        // Keep the name the registry actually gave it — it de-duplicates, so
        // a second "acorn" becomes "acorn-2" and the pack should say so.
        landed.push({ ...item, name: record.name });
      } catch {
        warnings.push(`“${name}” could not be saved to disk, so it is not in your catalogue.`);
      }
    }
    if (landed.length === 0) {
      return {
        pack: null,
        installed: 0,
        warnings,
        refusal: 'none of the drawings could be saved. Nothing was imported.',
      };
    }
    items = landed;
  }

  const pack: InstalledPack = {
    id: `pack_${nanoid(8)}`,
    category: validated.category,
    name: validated.name,
    author: validated.author,
    items,
    addedAt: Date.now(),
    dropped: 0,
  };
  setRegistry((prev) => [...prev, pack]);
  await persist();
  return { pack, installed: items.length, warnings, refusal: null };
}

/** Drop one pack. Returns whether anything was there. */
export async function forgetPack(id: string): Promise<boolean> {
  await loadUserPacks();
  let hit = false;
  setRegistry((prev) => {
    const next = prev.filter((pack) => pack.id !== id);
    hit = next.length !== prev.length;
    return hit ? next : prev;
  });
  if (hit) await persist();
  return hit;
}

/* ================================ applying ================================ */

/** A reader's wallpaper entry as the spec the wall is baked from. */
export function wallpaperSpecOf(item: PackItem): WallpaperSpec {
  return mergeWallpaperSpec(item);
}

/**
 * A reader's bookcase entry as the carpentry the case is built from.
 *
 * The fallback never fires in practice — `hydrate` drops an entry whose build
 * no longer exists, so nothing in the registry can name one — and it is here
 * because the alternative is a cast, and a cast is a promise the compiler
 * cannot check while a vocabulary is still being edited by somebody else.
 */
export function shelfDesignOfItem(item: PackItem): ShelfDesign {
  return {
    build: isBuildId(item.build) ? item.build : FALLBACK_SHELF_DESIGN.build,
    pattern: isPatternId(item.pattern) ? item.pattern : FALLBACK_SHELF_DESIGN.pattern,
  };
}

/**
 * Hang one of the reader's papers.
 *
 * Through `saveWallpaper`, which is the same call the studio's own tiles make,
 * so the wall repaints on the frame it was pressed and the choice survives a
 * restart. Nothing about this path knows the paper came from a file.
 */
export async function applyWallpaperEntry(item: PackItem): Promise<void> {
  await saveWallpaper(wallpaperSpecOf(item));
}

/** Build one of the reader's cases. Colour is untouched — the two are orthogonal. */
export async function applyCarpentryEntry(item: PackItem): Promise<void> {
  const build = item.build;
  const pattern = item.pattern;
  if (!isBuildId(build) || !isPatternId(pattern)) return;
  await saveRoomDesign({ build, pattern });
}

/**
 * Apply one entry, whichever category it is from.
 *
 * Stickers and sounds are absent on purpose: they are not a CHOICE the room
 * holds, they are things that arrive and stay. A sticker is inserted at the
 * caret from the catalogue; a sound set is picked in settings.
 */
export async function applyEntry(category: PackCategoryId, item: PackItem): Promise<boolean> {
  switch (category) {
    case 'wallpaper':
      await applyWallpaperEntry(item);
      return true;
    case 'carpentry':
      await applyCarpentryEntry(item);
      return true;
    default:
      return false;
  }
}

/** What forgetting a pack in this category does NOT undo, said plainly. */
export function forgetCaveat(category: PackCategory): string | null {
  return category.id === 'sticker'
    ? 'the drawings themselves stay in your catalogue — this only forgets the record of where they came from'
    : null;
}

/* ================================== tests ================================= */

/** Test seam: forget the load so a fresh database is read again. */
export function resetUserPacksForTests(): void {
  loadPromise = null;
  setRegistry([]);
}

/* ================================ QA bridge =============================== */

declare global {
  interface Window {
    __nbPacks?: {
      list: () => readonly InstalledPack[];
      load: () => Promise<readonly InstalledPack[]>;
      categories: () => readonly string[];
      /** Install from text, because a probe cannot answer a file dialog. */
      install: (categoryId: string, text: string) => Promise<InstallReport | string>;
      apply: (packId: string, index: number) => Promise<boolean>;
      forget: (packId: string) => Promise<boolean>;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__nbPacks = {
    list: snapshotUserPacks,
    load: loadUserPacks,
    categories: () => PACK_CATEGORIES.map((c) => c.id),
    install: async (categoryId, text) => {
      const category = packCategory(categoryId);
      if (category === null) return `no category "${categoryId}"`;
      const { validatePackText } = await import('./validate');
      const checked = validatePackText(text, category, packCategory);
      if (!checked.ok) return checked.problems.map((p) => `${p.where}: ${p.message}`).join('\n');
      return installPack(checked.pack);
    },
    apply: async (packId, index) => {
      const pack = snapshotUserPacks().find((p) => p.id === packId);
      const item = pack?.items[index];
      if (pack === undefined || item === undefined) return false;
      return applyEntry(pack.category, item);
    },
    forget: forgetPack,
  };
}
