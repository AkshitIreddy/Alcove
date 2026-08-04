/**
 * Margin doodles — tiny deterministic pencil sketches (star, spiral, leaf,
 * arrow, underline flourish) scattered in the page's side margins.
 *
 * Everything derives from fnv1a(pageId) → mulberry32, so the same page
 * always gets the same doodles at the same spots. The linework is baked
 * through art/wobble (pre-distorted path data, no runtime SVG filters) and
 * cached per (kind, seed).
 *
 * Visibility: PageEditor mounts these only when settings.showMarginDoodles;
 * the `nb-margin-doodle` class is additionally hidden by the settings root
 * classes (nb-minimalist / nb-no-doodles) as a CSS backstop.
 */
import { wobblePath } from '../../art/wobble';
import { fnv1a, mulberry32 } from '../../art/noise';

export const DOODLE_KINDS = [
  'star',
  'spiral',
  'leaf',
  'arrow',
  'flourish',
] as const;

export type DoodleKind = (typeof DOODLE_KINDS)[number];

export const MAX_DOODLES_PER_PAGE = 4;

export interface DoodlePlan {
  kind: DoodleKind;
  side: 'left' | 'right';
  /** Vertical position as a percentage of the page height (8..85). */
  topPct: number;
  /** Tilt in degrees (-14..14). */
  rotate: number;
  /** Square box size in px (22..34). */
  size: number;
  /** Complete inline SVG markup (stroke: currentColor). */
  svg: string;
}

// ---------------------------------------------------------------------------
// Pencil linework (clean source paths, wobbled per seed)
// ---------------------------------------------------------------------------

function starPath(): string {
  const cx = 16;
  const cy = 16;
  const outer = 12;
  const inner = 5;
  let d = '';
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? outer : inner;
    const x = Math.round((cx + Math.cos(angle) * radius) * 100) / 100;
    const y = Math.round((cy + Math.sin(angle) * radius) * 100) / 100;
    d += `${i === 0 ? 'M' : ' L'} ${x} ${y}`;
  }
  return `${d} Z`;
}

function spiralPath(): string {
  let d = '';
  const turns = 2.75;
  const steps = 40;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const radius = 1.5 + t * 11.5;
    const x = Math.round((16 + Math.cos(angle) * radius) * 100) / 100;
    const y = Math.round((16 + Math.sin(angle) * radius) * 100) / 100;
    d += `${i === 0 ? 'M' : ' L'} ${x} ${y}`;
  }
  return d;
}

/** Source paths per kind; multiple entries render as separate strokes. */
const DOODLE_PATHS: Record<DoodleKind, readonly string[]> = {
  star: [starPath()],
  spiral: [spiralPath()],
  leaf: [
    'M 16 29 C 7 22 7 11 16 3 C 25 11 25 22 16 29 Z',
    'M 16 26 L 16 7',
  ],
  arrow: ['M 4 26 C 12 22 20 14 26 6', 'M 19.5 6.5 L 26 6 L 25.5 12.5'],
  flourish: [
    'M 2 18 C 7 12 11 24 16 18 C 19 14.5 21 15 22 18 C 23 21 20 22.5 19 19 C 18 15 24 12 30 16',
  ],
};

const svgCache = new Map<string, string>();

/** Wobbled pencil SVG for a doodle kind, deterministic per (kind, seed). */
export function doodleSvg(kind: DoodleKind, seed: number): string {
  const key = `${kind}:${seed >>> 0}`;
  const cached = svgCache.get(key);
  if (cached !== undefined) return cached;

  const paths = DOODLE_PATHS[kind]
    .map((d, index) =>
      wobblePath(d, {
        seed: (seed + index * 0x9e3779b9) >>> 0,
        amplitude: 0.9,
        frequency: 0.06,
        samplesEveryPx: 3,
      }),
    )
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
  const svg = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
  svgCache.set(key, svg);
  return svg;
}

// ---------------------------------------------------------------------------
// Planning (pure) + mounting (DOM)
// ---------------------------------------------------------------------------

/**
 * Plan the doodles for a page: 2..4 sketches, distinct kinds, alternating
 * margins, varied heights. Pure and deterministic per pageId.
 */
export function planDoodles(pageId: string): DoodlePlan[] {
  const seed = fnv1a(pageId);
  const rng = mulberry32(seed);

  const count = 2 + Math.floor(rng() * (MAX_DOODLES_PER_PAGE - 1)); // 2..4
  const kinds = [...DOODLE_KINDS];
  for (let i = kinds.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = kinds[i];
    kinds[i] = kinds[j];
    kinds[j] = tmp;
  }

  const plans: DoodlePlan[] = [];
  let side: 'left' | 'right' = rng() < 0.5 ? 'left' : 'right';
  const band = 72 / count;
  for (let i = 0; i < count; i += 1) {
    const topPct = 8 + i * band + rng() * band * 0.6;
    plans.push({
      kind: kinds[i],
      side,
      topPct: Math.round(topPct * 10) / 10,
      rotate: Math.round((rng() * 28 - 14) * 10) / 10,
      size: Math.round(22 + rng() * 12),
      svg: doodleSvg(kinds[i], (seed + Math.imul(i + 1, 0x85ebca6b)) >>> 0),
    });
    side = side === 'left' ? 'right' : 'left';
  }
  return plans;
}

/**
 * Mount the page's doodles into `container` (expected: the .nb-page root,
 * which is position:relative with side margins). Returns a cleanup that
 * removes them again.
 */
export function mountMarginDoodles(
  container: HTMLElement,
  pageId: string,
): () => void {
  const elements = planDoodles(pageId).map((plan) => {
    const el = document.createElement('div');
    el.className = 'nb-margin-doodle';
    el.setAttribute('aria-hidden', 'true');
    el.dataset.doodle = plan.kind;
    el.style.top = `${plan.topPct}%`;
    el.style[plan.side === 'left' ? 'left' : 'right'] = '4px';
    el.style.width = `${plan.size}px`;
    el.style.height = `${plan.size}px`;
    el.style.transform = `rotate(${plan.rotate}deg)`;
    el.innerHTML = plan.svg;
    container.appendChild(el);
    return el;
  });
  return () => {
    for (const el of elements) el.remove();
  };
}
