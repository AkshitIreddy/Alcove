/**
 * Universal block-effect attributes — the script language's decorative attrs
 * (rotate, tape, washi, shadow, frame, paper, underline) promoted to REAL
 * TipTap attributes on every top-level block type via a global-attribute
 * extension.
 *
 * Rendering is pure CSS (src/styles/effects.css) driven by data-attributes:
 *   rotate     → data-rotate + a `--nb-rotate` inline custom property
 *   tape       → data-tape ('top' | 'corner' | 'both') — gradient strips
 *   washi      → data-washi ('top') — patterned washi strip
 *   shadow     → data-shadow ('soft')
 *   frame      → data-frame ('scallop' | 'stitch')
 *   paper      → data-paper ('torn' | 'lined')
 *   underline  → data-underline ('squiggle' | 'marker'); squiggle additionally
 *                carries the wobble-generated SVG mask as `--nb-squiggle`
 *
 * The squiggle SVG is generated ONCE at module load through art/wobble
 * (deterministic seed ⇒ stable string) and embedded as a data URI used as a
 * CSS mask, so its color stays token-driven. No runtime SVG filters.
 */
import { Extension } from '@tiptap/core';
import {
  BLOCK_PAPER_VALUES,
  FRAME_VALUES,
  SHADOW_VALUES,
  TAPE_VALUES,
  UNDERLINE_VALUES,
  WASHI_VALUES,
} from '../../script/vocab';
import { wobbleLine } from '../../art/wobble';

// ---------------------------------------------------------------------------
// Squiggle underline (baked once, cached string)
// ---------------------------------------------------------------------------

function buildSquiggleDataUri(): string {
  // A tileable 28×9 wavy stroke. Black on transparent: it is consumed as an
  // alpha CSS mask, so the visible color comes from tokens in effects.css.
  const d = wobbleLine(0, 4.5, 28, 4.5, {
    seed: 47,
    amplitude: 2.6,
    frequency: 0.18,
    samplesEveryPx: 3,
  });
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='9' viewBox='0 0 28 9'>" +
    `<path d='${d}' fill='none' stroke='#000' stroke-width='1.8' stroke-linecap='round'/>` +
    '</svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Generated at module load via wobble; deterministic, cached forever. */
export const SQUIGGLE_DATA_URI: string = buildSquiggleDataUri();

// ---------------------------------------------------------------------------
// Attribute plumbing
// ---------------------------------------------------------------------------

/** Script `rotate` is specified as -3..3 degrees; clamp for rendering. */
export function clampRotate(value: number): number {
  return Math.max(-3, Math.min(3, value));
}

interface EffectAttributeSpec {
  default: null;
  parseHTML: (element: HTMLElement) => string | null;
  renderHTML: (attributes: Record<string, unknown>) => Record<string, unknown>;
}

function enumEffect(key: string, values: readonly string[]): EffectAttributeSpec {
  return {
    default: null,
    parseHTML: (element) => {
      const raw = element.getAttribute(`data-${key}`);
      return raw !== null && values.includes(raw) ? raw : null;
    },
    renderHTML: (attributes) => {
      const value = attributes[key];
      if (typeof value !== 'string' || !values.includes(value)) return {};
      return { [`data-${key}`]: value };
    },
  };
}

/**
 * Every block type the effects apply to. Names must match extension names —
 * unknown entries are ignored by TipTap, so listing is safe across configs.
 */
export const BLOCK_EFFECT_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'horizontalRule',
  'table',
  'image',
  'imageRow',
  'details',
  'callout',
  'diagram',
  'sticky-note',
  'polaroid',
  'washi-box',
  'card',
  'quote-card',
  'banner',
  'spoiler',
  'columns',
] as const;

export const BlockEffects = Extension.create({
  name: 'blockEffects',

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_EFFECT_TYPES],
        attributes: {
          rotate: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.getAttribute('data-rotate');
              if (raw === null) return null;
              const parsed = Number(raw);
              return Number.isFinite(parsed) && parsed !== 0
                ? clampRotate(parsed)
                : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.rotate;
              if (
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value === 0
              ) {
                return {};
              }
              return {
                'data-rotate': String(value),
                style: `--nb-rotate: ${clampRotate(value)}deg`,
              };
            },
          },
          tape: enumEffect('tape', TAPE_VALUES),
          washi: enumEffect('washi', WASHI_VALUES),
          shadow: enumEffect('shadow', SHADOW_VALUES),
          frame: enumEffect('frame', FRAME_VALUES),
          paper: enumEffect('paper', BLOCK_PAPER_VALUES),
          underline: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.getAttribute('data-underline');
              return raw !== null &&
                (UNDERLINE_VALUES as readonly string[]).includes(raw)
                ? raw
                : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.underline;
              if (
                typeof value !== 'string' ||
                !(UNDERLINE_VALUES as readonly string[]).includes(value)
              ) {
                return {};
              }
              const out: Record<string, string> = { 'data-underline': value };
              if (value === 'squiggle') {
                out.style = `--nb-squiggle: url("${SQUIGGLE_DATA_URI}")`;
              }
              return out;
            },
          },
        },
      },
    ];
  },
});
