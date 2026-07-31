/**
 * src/sound/credits.ts — the shape of public/sounds/CREDITS.json, and the
 * reshaping the credits panel needs.
 *
 * Split from the view so it can be unit-tested against the REAL manifest in a
 * node environment: the CC BY obligation is a shipping blocker, and a test
 * that has to boot a DOM to check it is a test that gets skipped.
 *
 * `scripts/gen-sounds.mjs` rewrites the manifest from the same table that
 * drives the audio on every build, so nothing here may hard-code a credit —
 * everything is read.
 */

/** One recording behind one cue, as `gen-sounds.mjs` writes it. */
export interface SoundCredit {
  title: string;
  author: string;
  licence: string;
  licenceUrl: string;
  sourcePage: string;
  sourceFile: string;
  /** Where the recordist originally published it, when that is not the host. */
  originallyFrom?: string;
  attributionRequired?: boolean;
  attributionText?: string;
}

export interface CreditsManifest {
  note?: string;
  generated?: string;
  /** Credits that MUST be displayed. Empty when everything is CC0/PD. */
  attributionsRequired?: string[];
  /** cue name -> the recordings it was built from (layered beds have several). */
  sounds?: Record<string, SoundCredit[]>;
}

/** One recording, with every cue it became. */
export interface CreditGroup {
  credit: SoundCredit;
  cues: string[];
}

/**
 * Regroup the per-cue manifest by recording, keyed on the source page (the
 * one field that identifies a submission rather than a use of it).
 *
 * Tolerant by design: a manifest from a future build with extra fields, or an
 * old one with a bare object where an array now goes, still renders rather
 * than throwing inside a resource.
 */
export function groupCredits(manifest: CreditsManifest | undefined): CreditGroup[] {
  const groups = new Map<string, CreditGroup>();
  for (const [cue, entry] of Object.entries(manifest?.sounds ?? {})) {
    const credits = Array.isArray(entry) ? entry : [entry as SoundCredit];
    for (const credit of credits) {
      if (!credit || typeof credit.title !== 'string') continue;
      const key = credit.sourcePage || credit.title;
      const existing = groups.get(key);
      if (existing) existing.cues.push(cue);
      else groups.set(key, { credit, cues: [cue] });
    }
  }
  // Obligations first, then alphabetically — a reader checking compliance
  // should not have to scroll for the one entry that carries a requirement.
  return [...groups.values()].sort((a, b) => {
    const oblig =
      Number(b.credit.attributionRequired ?? false) - Number(a.credit.attributionRequired ?? false);
    return oblig !== 0 ? oblig : a.credit.title.localeCompare(b.credit.title);
  });
}

/** Collapse a long cue list: "page-flip ×6" reads better than six names. */
export function summariseCues(cues: readonly string[]): string {
  const families = new Map<string, number>();
  for (const cue of cues) {
    const family = cue.replace(/-\d+$/, '');
    families.set(family, (families.get(family) ?? 0) + 1);
  }
  return [...families.entries()]
    .map(([family, count]) => (count > 1 ? `${family} ×${count}` : family))
    .join(', ');
}

/**
 * The badge form of a licence. "Public domain (PD-author, via pdsounds.org)"
 * is the accurate string and belongs in CREDITS.json, but as an uppercase chip
 * it is wider than the row it labels and buries the two words that matter.
 * The parenthetical moves to the row's `title`.
 */
export function shortLicence(licence: string): string {
  const cut = licence.indexOf('(');
  return (cut > 0 ? licence.slice(0, cut) : licence).trim();
}
