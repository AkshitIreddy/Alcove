/**
 * Types for scripts/check-readme.mjs — the README checker is plain ESM so it
 * can run from `npm run readme:check` without a build step. This declaration
 * keeps its reusable exports explicit for TypeScript-aware callers.
 */

/** Absolute path to the repo root. */
export const ROOT: string;

/** Fact keys the CLI knows of but cannot compute without loading TypeScript. */
export const DEFERRED_FACTS: readonly string[];

/** Repo-relative paths of README.md and every fragment under docs/readme/. */
export function readmeDocs(): string[];

/** Recompute every fact derivable from files alone. */
export function computeFacts(): Record<string, number>;

/** Compare `<!--f:key-->value<!--/f-->` markers against `facts`. */
export function checkFacts(
  facts: Record<string, number>,
  docs?: string[],
): { checked: number; deferred: number; problems: string[] };

/** Resolve every relative link, always against the repo root. */
export function checkLinks(docs?: string[]): { checked: number; problems: string[] };

/* ------------------------------ the screenshots -------------------------- */

/** Repo-relative path of the capture manifest. */
export const SHOTS_MANIFEST: string;

/** Repo-relative path of the directory the README's pictures live in. */
export const SHOTS_DIR: string;

/** Floor under "a screenshot rather than a blank frame", in bytes. */
export const MIN_SHOT_BYTES: number;

/** Files whose content is inside a picture, keyed by the picture's file name. */
export const SHOT_SOURCES: Readonly<Record<string, readonly string[]>>;

/** TypeScript-derived identity keys recorded by the screenshot manifest. */
export const DEPICTED_KEYS: readonly string[];

/** Short sha256 of a repo-relative file. */
export function digestOf(rel: string): string;

/** Every path declared in {@link SHOT_SOURCES}, digested. */
export function sourceDigests(): Record<string, string>;

/** Product name (tauri.conf.json) and version (package.json). */
export function appIdentity(): { product: string; version: string };

/** Bare file names of every PNG in {@link SHOTS_DIR}, sorted. */
export function shotFiles(): string[];

/** Size, digest and pixel dimensions of one shot, read off the file. */
export function measureShot(
  file: string,
): { bytes: number; sha256: string; width: number; height: number };

/** One entry of the manifest's `shots` array. */
export interface ShotRecord {
  file: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  /** ISO timestamp of the run that took THIS picture. */
  at: string;
  /** Short sha of the tree it photographed, `+dirty` when uncommitted. */
  commit: string;
}

/** What `shots-now/readme-shots.mjs` writes after a capture run. */
export interface ShotsManifest {
  capturedBy: string;
  /** The last run, whatever it captured. Per-shot provenance is on each entry. */
  lastRunAt: string;
  app: { product: string; version: string };
  commit: { sha: string; short: string; dirty: boolean };
  viewport: { width: number; height: number; scale: number };
  depicts: Record<string, string>;
  sources: Record<string, string>;
  shots: ShotRecord[];
}

/** The manifest as written, or null when missing or unreadable. */
export function readShotsManifest(): ShotsManifest | null;

/** Compare the manifest against the tree; `depicted` supplies the TS-only values. */
export function checkShots(depicted?: Record<string, string>): {
  checked: number;
  deferred: number;
  problems: string[];
};
