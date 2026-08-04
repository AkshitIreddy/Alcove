/**
 * Types for scripts/gen-readme.mjs — the front-page composer is plain ESM so it
 * can run from `npm run readme:build` without a build step, but
 * tests/readme.test.ts imports it, and this is the contract it imports.
 */

/** One half of the README, as the front page reaches it. */
export interface ReadmePart {
  /** Short name, for messages. */
  id: string;
  /** The `<!-- gen:name -->` region its table is written into. */
  region: string;
  /** Root-relative path, because the front page is the root. */
  href: string;
}

/** A `##` section of a half, with the summary written beside it. */
export interface ReadmeSection {
  /** Heading text, verbatim. */
  text: string;
  /** The slug a browser lands on. */
  slug: string;
  /** The `<!--nav: …-->` summary. */
  nav: string;
}

/** One heading found in a markdown source. */
export interface Heading {
  depth: number;
  text: string;
  slug: string;
  line: number;
  /** The line directly below, where a `<!--nav: …-->` marker would sit. */
  next: string;
}

/** Absolute path to the repo root. */
export const ROOT: string;

/** Repo-relative path of the front page. */
export const README: string;

/** The halves, in reading order. */
export const PARTS: readonly ReadmePart[];

/** Every markdown page the front page's navigation spans. */
export const PAGES: readonly string[];

/** GitHub's heading-slug rules. */
export function slugify(heading: string): string;

/** Every heading outside fenced code, with duplicate slugs suffixed. */
export function headings(text: string): Heading[];

/** The `##` sections of one half. Throws if a section has no summary. */
export function sectionsOf(part: ReadmePart, text?: string): ReadmeSection[];

/** The navigation table for one half, one row per section. */
export function renderNavTable(part: ReadmePart, sections: ReadmeSection[]): string;

/** Rewrite every generated region of the front page. */
export function buildReadme(current: string, tables: Record<string, string>): string;

/** The front page as it should be, beside the one on disk. */
export function assemble(): { have: string; want: string; tables: Record<string, string> };

/** Resolve every `#fragment` against the real headings it points into. */
export function checkAnchors(pages?: readonly string[]): {
  checked: number;
  problems: string[];
};

/** First few differing lines, as want/have pairs. */
export function firstDifferences(want: string, have: string, limit?: number): string[];

/** Everything `--check` checks, as data. */
export function checkReadme(): { problems: string[]; want: string; anchors: number };
