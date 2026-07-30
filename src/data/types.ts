/**
 * Model types for the Notebook data layer.
 *
 * Naming convention: `*Row` interfaces mirror the SQLite schema exactly
 * (snake_case columns, integer booleans, JSON stored as TEXT); the plain
 * model interfaces (`Book`, `Page`, ...) are what the rest of the app
 * consumes (camelCase, parsed JSON, real booleans).
 */

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

export interface Book {
  id: string;
  title: string;
  /** Floor index on the endless bookshelf (0 = top, grows downward). */
  floor: number;
  /** Slot position within the floor (gaps are allowed and expected). */
  slot: number;
  /** Deterministic seed for the procedural spine art (32-bit unsigned). */
  spineSeed: number;
  /** Free-form cover metadata (palette, sticker, wear marks...), or null. */
  coverMeta: Record<string, unknown> | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

export interface CreateBookInput {
  title: string;
  floor: number;
  slot: number;
  /** Omit for a random seed; pass explicitly for deterministic spines. */
  spineSeed?: number;
  coverMeta?: Record<string, unknown> | null;
}

export interface UpdateBookPatch {
  title?: string;
  spineSeed?: number;
  coverMeta?: Record<string, unknown> | null;
}

/** Raw `books` table row. */
export interface BookRow {
  id: string;
  title: string;
  floor: number;
  slot: number;
  spine_seed: number;
  cover_meta: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * The TipTap document JSON (`editor.getJSON()`), persisted verbatim.
 * The block editor owns the deep shape; the data layer only guarantees
 * the top-level envelope.
 */
export interface PageDoc {
  type: 'doc';
  attrs?: Record<string, unknown>;
  content?: unknown[];
}

export interface Page {
  id: string;
  bookId: string;
  /** Position of the page within its book (0-based, ascending). */
  ord: number;
  /** Parsed document JSON — the single source of truth for page content. */
  doc: PageDoc;
  /**
   * Verbatim Notebook Script source this page was inserted from, or null.
   * Kept byte-identical so "Export Script" can diff against what an AI wrote.
   */
  scriptSource: string | null;
  /**
   * True once the doc has been edited after a script insert — exports must
   * then fall back to the canonical printer instead of `scriptSource`.
   */
  sourceDirty: boolean;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

export interface CreatePageInput {
  bookId: string;
  /** Omit to append after the book's current last page. */
  ord?: number;
  /** Omit for an empty document. */
  doc?: PageDoc;
  scriptSource?: string | null;
}

/** Raw `pages` table row. */
export interface PageRow {
  id: string;
  book_id: string;
  ord: number;
  doc_json: string;
  script_source: string | null;
  source_dirty: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetKind = 'image' | 'audio' | 'other';

/** A file cached under the app-data assets directory (fetched images etc.). */
export interface AssetRef {
  id: string;
  /** Path relative to the app-data assets root. */
  relPath: string;
  kind: AssetKind;
  /** Free-form metadata (source URL, license, dimensions...), or null. */
  meta: Record<string, unknown> | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/** Raw `assets` table row. */
export interface AssetRow {
  id: string;
  rel_path: string;
  kind: string;
  meta: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type ThemeName = 'parchment' | 'pastel' | 'botanical' | 'night';
export type PageStyle = 'ruled' | 'grid' | 'blank' | 'dotted';
export type AnimationLevel = 'full' | 'reduced' | 'off';
export type BookPalette =
  | 'amber'
  | 'terracotta'
  | 'moss'
  | 'lemon'
  | 'sky'
  | 'blush'
  | 'plum'
  | 'peach'
  | 'sage'
  | 'lavender'
  | 'sand'
  | 'slate';

/**
 * All user-facing options. Persisted as a single JSON blob in the
 * `settings` table under the key `'app'`; unknown/invalid stored values
 * fall back to `DEFAULT_SETTINGS` on load.
 */
export interface Settings {
  // Appearance
  theme: ThemeName;
  handwritingEnabled: boolean;
  /** Font family name for handwriting text (bundled @fontsource families). */
  handwritingFont: string;
  /** Editor body font size in px. */
  bodyFontSize: number;
  pageStyleDefault: PageStyle;
  /** Ink token or CSS color for body text (e.g. 'sepia', 'graphite'). */
  inkColor: string;
  animationLevel: AnimationLevel;
  minimalistMode: boolean;
  showMarginDoodles: boolean;
  confettiOnComplete: boolean;
  defaultBookPalette: BookPalette;

  // Sound (all volumes 0..1)
  soundMaster: number;
  soundUi: number;
  soundPages: number;
  /** Bookshelf-world sounds (book pulls, whooshes, thumps). */
  soundShelf: number;
  soundAmbient: number;
  muteAll: boolean;
  /** Keep the ambient library loop running in the background. */
  ambientLoop: boolean;
  /** Skip the most incidental sounds (hover ticks, pencil scratch). */
  reducedSound: boolean;

  // Behavior
  autostart: boolean;
  /** Multiplier applied to wheel/pinch zoom deltas. */
  zoomSensitivity: number;
  /** Fling momentum decay factor (0 = none, ~0.95 = very floaty). */
  dragMomentum: number;
  autosaveIntervalMs: number;
  backupEnabled: boolean;
  backupIntervalDays: number;
  spellcheck: boolean;

  // Input
  /** Action id -> shortcut (e.g. 'command-palette' -> 'mod+k'). */
  keybindings: Record<string, string>;

  /** Never collected; the type forbids turning it on. */
  readonly telemetry: false;
}
