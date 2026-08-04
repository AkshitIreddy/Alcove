/**
 * Types for scripts/gen-readme.mjs — the front-page composer is plain ESM so it
 * can run from `npm run readme:build` without a build step, but
 * tests/readme.test.ts imports it, and this is the contract it imports.
 */

/** One half of the README, as the front page reaches it. */
export interface ReadmePart {
  /** Short name, for messages. */
  id: string;
  /** What the navigation calls it. */
  title: string;
  /** Root-relative path, because the front page is the root. */
  href: string;
  /** One clause saying what is left in it after the lifts. */
  note: string;
}

/** A `##` section of a half, with the summary written beside it. */
export interface ReadmeSection {
  /** Heading text, verbatim. */
  text: string;
  /** The slug a browser lands on. */
  slug: string;
  /** The `<!--nav: …-->` summary. */
  nav: string;
  /** True when the front page already carries this section inline. */
  lifted: boolean;
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

/** A `<!--lift: name-->…<!--/lift-->` block of a half. */
export interface Lift {
  name: string;
  /** 1-based line of the opening marker. */
  from: number;
  /** 1-based line of the closing marker. */
  to: number;
  /** Everything between the markers, verbatim. */
  body: string;
}

/** One page, as it should be beside the one on disk. */
export interface ComposedPage {
  rel: string;
  have: string;
  want: string;
}

/** Absolute path to the repo root. */
export const ROOT: string;

/** Repo-relative path of the front page. */
export const README: string;

/** The halves, in reading order. */
export const PARTS: readonly ReadmePart[];

/** Every markdown page this script composes or navigates. */
export const PAGES: readonly string[];

/** Where releases are published. */
export const RELEASES: string;

/** The shipped version, cross-checked between package.json and tauri.conf.json. */
export function appVersion(): string;

/** The badge strip, composed so the version on it cannot lag package.json. */
export function renderBadges(version?: string): string;

/** The download table: one row per platform, unbuilt ones marked as such. */
export function renderDownloads(version?: string): string;

/** GitHub's heading-slug rules. */
export function slugify(heading: string): string;

/** Every heading outside fenced code, with duplicate slugs suffixed. */
export function headings(text: string): Heading[];

/** Headings on one page that slug the same way, so only the first is reachable. */
export function duplicateSlugs(text: string): string[];

/** Every lift block of one source, by name. Throws on nesting or no close. */
export function liftsOf(text: string): Map<string, Lift>;

/** One link, moved from a page in `fromDir` to the repo root. */
export function retarget(
  target: string,
  fromDir: string,
  href: string,
  slugs: ReadonlySet<string>,
): string;

/** One lift as the front page should carry it: markers gone, links retargeted. */
export function rewriteLift(lift: Lift, part: ReadmePart, slugs: ReadonlySet<string>): string;

/** The `##` sections of one half. Throws if a section has no summary. */
export function sectionsOf(part: ReadmePart, text?: string): ReadmeSection[];

/** The navigation table for one half, one row per section. */
export function renderNavTable(part: ReadmePart, sections: ReadmeSection[]): string;

/** What is left after the lifts, per half. */
export function renderDeeper(
  halves: readonly { part: ReadmePart; want: string }[],
): string;

/** The `##` sections of a built page, as one line a reader can scan. */
export function renderContents(text: string): string;

/** All three pages as they should be, beside the ones on disk. */
export function assemble(): { pages: ComposedPage[]; tables: Record<string, string> };

/** Resolve every `#fragment` against the real headings it points into. */
export function checkAnchors(pages?: readonly string[]): {
  checked: number;
  problems: string[];
};

/** First few differing lines, as want/have pairs. */
export function firstDifferences(want: string, have: string, limit?: number): string[];

/** Everything `--check` checks, as data. */
export function checkReadme(): { problems: string[]; anchors: number };
