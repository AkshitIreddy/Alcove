/**
 * src/features/settings/codeAppearancePrefs.ts — where the code look lives.
 *
 * `appearancePrefs.ts` said this in as many words when it was written:
 *
 *   > It is deliberately tiny — if a second appearance choice ever needs
 *   > storing it belongs in here beside the paper rather than in a third
 *   > place.
 *
 * This is a second file rather than a fifth field in that one, and the reason
 * is not tidiness — it is the READER. The paper stock changes the whole app;
 * these five change one kind of block. They are written from a different row
 * of the settings sheet, they are read by the editor rather than by
 * `apply.ts`'s root-attribute pass alone, and a code block's look has to be
 * pushable at ProseMirror (line numbers are decorations, and decorations only
 * change when something tells a plugin to recompute). That last part is why
 * this store has a subscribe with no argument as well as a Solid signal:
 * `nodes/codeBlock.tsx` is inside a ProseMirror plugin, where there is no
 * reactive owner to run an effect in.
 *
 * Every read is total. A value comes back out of SQLite unvalidated, and a
 * bad one has to give the house look rather than an exception inside a
 * repaint.
 */

import { createSignal } from 'solid-js';
import { getDb } from '../../data/db';
import {
  CODE_SIZE_MAX,
  CODE_SIZE_MIN,
  DEFAULT_CODE_FACE,
  DEFAULT_CODE_FRAME,
  DEFAULT_CODE_SIZE,
  DEFAULT_CODE_THEME_ID,
  resolveCodeFace,
  resolveCodeFrame,
  resolveCodeTheme,
  type CodeFace,
  type CodeFrame,
} from './codeAppearance';

const SETTINGS_KEY = 'codeAppearance';

export interface CodeLook {
  /** A `CodeThemeSpec` id. */
  readonly theme: string;
  /** How the block is drawn. */
  readonly frame: CodeFrame;
  /** The monospaced face. */
  readonly face: CodeFace;
  /** Code type size, px. */
  readonly size: number;
  /** Line numbers down the left. */
  readonly numbers: boolean;
}

export const DEFAULT_CODE_LOOK: CodeLook = {
  theme: DEFAULT_CODE_THEME_ID,
  frame: DEFAULT_CODE_FRAME,
  face: DEFAULT_CODE_FACE,
  size: DEFAULT_CODE_SIZE,
  numbers: true,
};

const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/**
 * Total. Every field is resolved on its own, so one bad value cannot take the
 * other four with it — a reader who somehow stored `size: "big"` keeps the
 * theme they chose.
 */
export function normalizeCodeLook(raw: unknown): CodeLook {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_CODE_LOOK;
  }
  const book = raw as Record<string, unknown>;
  const size = typeof book.size === 'number' && Number.isFinite(book.size)
    ? clamp(Math.round(book.size), CODE_SIZE_MIN, CODE_SIZE_MAX)
    : DEFAULT_CODE_LOOK.size;
  return {
    // `resolveCodeTheme` falls back to the plain pencil rather than to the
    // house default, so a corrupt row is visibly a fault and not a choice.
    theme:
      typeof book.theme === 'string'
        ? resolveCodeTheme(book.theme).id
        : DEFAULT_CODE_LOOK.theme,
    frame: resolveCodeFrame(
      typeof book.frame === 'string' ? book.frame : DEFAULT_CODE_LOOK.frame,
    ),
    face: resolveCodeFace(
      typeof book.face === 'string' ? book.face : DEFAULT_CODE_LOOK.face,
    ).id,
    size,
    numbers:
      typeof book.numbers === 'boolean'
        ? book.numbers
        : DEFAULT_CODE_LOOK.numbers,
  };
}

const [book, setBook] = createSignal<CodeLook>(DEFAULT_CODE_LOOK);
const listeners = new Set<(look: CodeLook) => void>();

/**
 * The chosen look.
 *
 * One function for both callers, exactly as `paperStock()` is: inside a Solid
 * computation it tracks (the panel's chips restyle themselves), and outside
 * one it is a plain read (the ProseMirror plugin calls it from `apply`).
 */
export const codeLook = (): CodeLook => book();

/**
 * Fire when the look changes. Returns an unsubscribe.
 *
 * The arrow points from the store outward, the same way `subscribePaperStock`
 * does and for the same reason: `apply.ts` and the editor both have to end at
 * the same place, and if either of them owned the notification the two
 * modules would import each other.
 */
export function subscribeCodeLook(listener: (look: CodeLook) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: CodeLook): void {
  setBook(next);
  for (const listener of listeners) listener(next);
}

let loadPromise: Promise<CodeLook> | null = null;

/** Load once; later calls reuse the same promise. */
export function loadCodeLook(): Promise<CodeLook> {
  loadPromise ??= (async () => {
    try {
      const db = await getDb();
      const rows = await db.select<Array<{ value: string }>>(
        'SELECT value FROM settings WHERE key = $1 LIMIT 1',
        [SETTINGS_KEY],
      );
      const next = normalizeCodeLook(
        rows.length > 0 ? JSON.parse(rows[0].value) : null,
      );
      publish(next);
      return next;
    } catch {
      // No database yet, or a blob that will not parse. The house look is a
      // perfectly good answer and an exception here would take the whole
      // first paint with it.
      return DEFAULT_CODE_LOOK;
    }
  })();
  return loadPromise;
}

/** Change one or more axes. Unknown values resolve; the rest are kept. */
export async function saveCodeLook(patch: Partial<CodeLook>): Promise<void> {
  const next = normalizeCodeLook({ ...book(), ...patch });
  publish(next);
  try {
    const db = await getDb();
    await db.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      [SETTINGS_KEY, JSON.stringify(next)],
    );
  } catch {
    // Applied but not persisted: the reader sees their choice now and loses
    // it on restart, which is far better than a picker that does nothing.
  }
}
