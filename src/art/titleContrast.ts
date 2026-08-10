/** Shared, renderer-level title legibility for spine and cover plates. */

import { normaliseHex } from './customColour';
import { FLAT } from './flat';

/**
 * Titles are identity text, not optional ornament. Four is the strongest
 * universal floor Alcove's canonical cream/ink pair can guarantee across its
 * mid-tone flat plate fills without inventing a second near-black outline.
 */
export const TITLE_TEXT_MIN_CONTRAST = 4;

export interface TitleColourResolution {
  /** The actual flat fill immediately behind the glyphs. */
  ground: string;
  /** The final glyph colour after the legibility guard. */
  ink: string;
  /** The role/authored colour before the guard, useful for diagnostics. */
  preferred: string;
}

/** WCAG relative contrast for two CSS hex colours. Invalid input is ink. */
export function colourContrast(a: string, b: string): number {
  const luminance = (input: string): number => {
    const hex = normaliseHex(input) ?? FLAT.ink;
    const channel = (offset: number): number => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return channel(1) * 0.2126 + channel(3) * 0.7152 + channel(5) * 0.0722;
  };
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Keep the reader/authored tooling colour when it remains legible on the
 * plate. Otherwise choose the better of Alcove's two semantic text inks.
 *
 * This belongs after plate resolution: an ivory label, a sunk purple panel
 * and bare vellum can all begin with the same book palette and require three
 * different answers once their actual flat ground is known.
 */
export function titleInkAgainst(preferred: string, ground: string): string {
  if (colourContrast(preferred, ground) >= TITLE_TEXT_MIN_CONTRAST) return preferred;
  const candidates = [FLAT.ink, FLAT.cream] as const;
  return candidates.reduce((best, candidate) =>
    colourContrast(candidate, ground) > colourContrast(best, ground) ? candidate : best,
  );
}

function mixHex(a: string, b: string, t: number): string {
  const ah = normaliseHex(a) ?? FLAT.ink;
  const bh = normaliseHex(b) ?? FLAT.cream;
  const channel = (offset: number): string => {
    const av = Number.parseInt(ah.slice(offset, offset + 2), 16);
    const bv = Number.parseInt(bh.slice(offset, offset + 2), 16);
    return Math.round(av + (bv - av) * t).toString(16).padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * Resolve the pair, optionally shifting a physical plate's flat fill just far
 * enough to make one of the existing semantic inks legible. This never invents
 * a new black/white or light model: it mixes the plate toward Alcove's own ink
 * or cream face in measured 5% flat steps.
 */
export function resolveTitleColours(
  preferred: string,
  ground: string,
  mayShiftPlate = false,
): TitleColourResolution {
  const direct = titleInkAgainst(preferred, ground);
  if (colourContrast(direct, ground) >= TITLE_TEXT_MIN_CONTRAST || !mayShiftPlate) {
    return { ground, preferred, ink: direct };
  }

  const inks = [preferred, FLAT.ink, FLAT.cream] as const;
  const targets = [FLAT.ink, FLAT.cream] as const;
  for (let step = 1; step <= 16; step += 1) {
    const t = step * 0.05;
    let best: TitleColourResolution | null = null;
    let bestRatio = 0;
    for (const target of targets) {
      const shifted = mixHex(ground, target, t);
      for (const ink of inks) {
        const ratio = colourContrast(ink, shifted);
        if (ratio < TITLE_TEXT_MIN_CONTRAST || ratio <= bestRatio) continue;
        best = { ground: shifted, preferred, ink };
        bestRatio = ratio;
      }
    }
    if (best !== null) return best;
  }

  return { ground, preferred, ink: direct };
}
