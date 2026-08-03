/**
 * Types for scripts/check-readme.mjs — the README checker is plain ESM so it
 * can run from `npm run readme:check` without a build step, but
 * tests/readme.test.ts imports it, and this is the contract it imports.
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
