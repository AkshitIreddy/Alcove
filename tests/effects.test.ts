// @vitest-environment node
/**
 * tests/effects.test.ts — the delight-effects system:
 *   1. every script-vocab container name has a real registered editor node
 *      (names match vocab verbatim for the new nodes),
 *   2. BlockEffects global attributes serialize through the real schema
 *      (nodeFromJSON → check → toJSON round-trip),
 *   3. margin-doodle planning is deterministic per pageId and bounded,
 *   4. confetti particle math stays within its documented bounds,
 *   5. script bridge round-trips for sticky-note and columns fixtures,
 *      including the callout fallback when hasNode() denies a node.
 */
import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';

import { parse, print } from '../src/script';
import type { ScriptDoc } from '../src/script';
import { CONTAINER_NAMES } from '../src/script/vocab';
import { mulberry32 } from '../src/art/noise';
import {
  scriptDocToTiptap,
  CONTAINER_NODE_NAMES,
  type TiptapNode,
} from '../src/editor/script/toTiptap';
import { tiptapToScriptDoc } from '../src/editor/script/fromTiptap';
import {
  BLOCK_EFFECT_TYPES,
  SQUIGGLE_DATA_URI,
} from '../src/editor/effects/blockEffects';
import {
  DOODLE_KINDS,
  MAX_DOODLES_PER_PAGE,
  doodleSvg,
  planDoodles,
} from '../src/editor/effects/doodles';
import {
  CONFETTI_COUNT,
  CONFETTI_DURATION_MS,
  CONFETTI_FLUTTER_PX,
  CONFETTI_PALETTE,
  createConfettiParticles,
  particleAt,
} from '../src/editor/effects/confetti';
import { seededTilt } from '../src/editor/nodes/containers';
import { stripSpans } from './script/fixtures';

/**
 * Minimal DOM shim (same as tests/editor.test.ts): compiled Solid node-view
 * components register delegated event roots at import time. Imported after
 * the shim.
 */
const globals = globalThis as Record<string, unknown>;
if (typeof globals.window === 'undefined') {
  globals.window = globals;
  globals.document = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

const { createEditorExtensions } = await import('../src/editor/extensions');
const schema = getSchema(createEditorExtensions());

/** Compare two script docs modulo spans and diagnostics. */
function essence(doc: ScriptDoc): unknown {
  return stripSpans({ frontmatter: doc.frontmatter, blocks: doc.blocks });
}

function content(json: { content?: unknown[] }): TiptapNode[] {
  return (json.content ?? []) as TiptapNode[];
}

/* ------------------------- vocab ↔ node registry --------------------------- */

describe('container vocabulary is fully wired', () => {
  it('every vocab container name resolves to a registered node', () => {
    for (const name of CONTAINER_NAMES) {
      const nodeName = CONTAINER_NODE_NAMES[name];
      expect(nodeName, `mapping for "${name}"`).toBeDefined();
      expect(
        schema.nodes[nodeName],
        `schema node "${nodeName}" for container "${name}"`,
      ).toBeDefined();
    }
  });

  it('new container nodes use the vocab canonical name verbatim', () => {
    const verbatim = [
      'sticky-note',
      'polaroid',
      'washi-box',
      'card',
      'quote-card',
      'spoiler',
      'banner',
      'columns',
      'col',
      'callout',
    ] as const;
    for (const name of verbatim) {
      expect(schema.nodes[name]?.name, name).toBe(name);
      expect(
        CONTAINER_NODE_NAMES[name as keyof typeof CONTAINER_NODE_NAMES],
      ).toBe(name);
    }
  });

  it('every BlockEffects target type exists in the schema', () => {
    for (const type of BLOCK_EFFECT_TYPES) {
      expect(schema.nodes[type], type).toBeDefined();
    }
  });
});

/* -------------------------- global effect attrs ---------------------------- */

describe('BlockEffects global attributes', () => {
  it('serialize through nodeFromJSON → check → toJSON unchanged', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { rotate: -2, tape: 'corner', shadow: 'soft' },
          content: [{ type: 'text', text: 'taped and tilted' }],
        },
        {
          type: 'heading',
          attrs: { level: 2, underline: 'squiggle', frame: 'stitch' },
          content: [{ type: 'text', text: 'squiggled heading' }],
        },
        {
          type: 'blockquote',
          attrs: { washi: 'top', paper: 'torn' },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'washi quote' }],
            },
          ],
        },
        {
          type: 'sticky-note',
          attrs: { color: 'moss', rotate: 1.5 },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'a mossy note' }],
            },
          ],
        },
      ],
    };
    const node = schema.nodeFromJSON(json);
    expect(() => node.check()).not.toThrow();
    const round = node.toJSON() as {
      content: Array<{ attrs: Record<string, unknown> }>;
    };
    expect(round.content[0].attrs.rotate).toBe(-2);
    expect(round.content[0].attrs.tape).toBe('corner');
    expect(round.content[0].attrs.shadow).toBe('soft');
    expect(round.content[1].attrs.underline).toBe('squiggle');
    expect(round.content[1].attrs.frame).toBe('stitch');
    expect(round.content[2].attrs.washi).toBe('top');
    expect(round.content[2].attrs.paper).toBe('torn');
    expect(round.content[3].attrs.color).toBe('moss');
    expect(round.content[3].attrs.rotate).toBe(1.5);
  });

  it('defaults to null (attrs absent in stored docs stay unset)', () => {
    const node = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'plain' }] },
      ],
    });
    const attrs = node.child(0).attrs;
    expect(attrs.rotate).toBeNull();
    expect(attrs.tape).toBeNull();
    expect(attrs.underline).toBeNull();
  });

  it('bakes the squiggle underline as a stable SVG data URI at module load', () => {
    expect(SQUIGGLE_DATA_URI.startsWith('data:image/svg+xml,')).toBe(true);
    expect(SQUIGGLE_DATA_URI).toContain('%3Csvg');
    expect(SQUIGGLE_DATA_URI).toContain('%3Cpath');
    // No runtime SVG filters, ever.
    expect(SQUIGGLE_DATA_URI).not.toContain('filter');
    expect(SQUIGGLE_DATA_URI).not.toContain('feTurbulence');
  });

  it('seededTilt is deterministic and bounded', () => {
    expect(seededTilt('abc', 2.2)).toBe(seededTilt('abc', 2.2));
    for (const seed of ['a', 'b', 'note|lemon|1', 'note|sky|3']) {
      const tilt = seededTilt(seed, 2.2);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(2.2);
    }
  });
});

/* ------------------------------ margin doodles ----------------------------- */

describe('margin doodles', () => {
  it('planning is deterministic per pageId', () => {
    expect(planDoodles('page-1')).toEqual(planDoodles('page-1'));
    expect(planDoodles('another-page')).toEqual(planDoodles('another-page'));
  });

  it('different pages get different plans', () => {
    expect(JSON.stringify(planDoodles('page-1'))).not.toBe(
      JSON.stringify(planDoodles('page-2')),
    );
  });

  it('stays within bounds: 2..4 doodles, distinct kinds, sane geometry', () => {
    for (const pageId of ['p1', 'p2', 'p3', 'a-long-page-id', 'xyz']) {
      const plans = planDoodles(pageId);
      expect(plans.length).toBeGreaterThanOrEqual(2);
      expect(plans.length).toBeLessThanOrEqual(MAX_DOODLES_PER_PAGE);
      expect(new Set(plans.map((p) => p.kind)).size).toBe(plans.length);
      for (const plan of plans) {
        expect(DOODLE_KINDS).toContain(plan.kind);
        expect(['left', 'right']).toContain(plan.side);
        expect(plan.topPct).toBeGreaterThanOrEqual(8);
        expect(plan.topPct).toBeLessThanOrEqual(85);
        expect(Math.abs(plan.rotate)).toBeLessThanOrEqual(14);
        expect(plan.size).toBeGreaterThanOrEqual(22);
        expect(plan.size).toBeLessThanOrEqual(34);
        expect(plan.svg.startsWith('<svg')).toBe(true);
        expect(plan.svg).toContain('stroke="currentColor"');
        expect(plan.svg).not.toContain('<filter');
      }
    }
  });

  it('doodle SVGs are cached and deterministic per (kind, seed)', () => {
    for (const kind of DOODLE_KINDS) {
      const first = doodleSvg(kind, 42);
      expect(doodleSvg(kind, 42)).toBe(first);
      expect(doodleSvg(kind, 43)).not.toBe(first);
    }
  });
});

/* ----------------------------- confetti physics ---------------------------- */

describe('confetti particle math', () => {
  const rng = mulberry32(0xC0FFEE);
  const particles = createConfettiParticles(CONFETTI_COUNT, rng);

  it('creates the requested count with bounded kinematics', () => {
    expect(particles).toHaveLength(40);
    for (const p of particles) {
      expect(Math.abs(p.vx)).toBeLessThanOrEqual(0.3);
      expect(p.vy).toBeLessThan(0); // upward burst
      expect(p.vy).toBeGreaterThanOrEqual(-0.46);
      expect(p.size).toBeGreaterThanOrEqual(5);
      expect(p.size).toBeLessThanOrEqual(11);
      expect(p.aspect).toBeGreaterThanOrEqual(0.55);
      expect(p.aspect).toBeLessThanOrEqual(0.8);
      expect(Number.isInteger(p.colorIndex)).toBe(true);
      expect(p.colorIndex).toBeGreaterThanOrEqual(0);
      expect(p.colorIndex).toBeLessThan(CONFETTI_PALETTE.length);
      expect(Math.abs(p.spin)).toBeLessThanOrEqual(0.008);
      expect(p.flutter).toBeGreaterThanOrEqual(4);
      expect(p.flutter).toBeLessThanOrEqual(CONFETTI_FLUTTER_PX);
    }
  });

  it('starts at the origin, fully opaque', () => {
    for (const p of particles) {
      const start = particleAt(p, 0);
      expect(Math.abs(start.x)).toBe(0); // -0 for negative vx is still origin
      expect(Math.abs(start.y)).toBe(0);
      expect(start.opacity).toBe(1);
    }
  });

  it('gravity wins by the end of the burst and the fade completes', () => {
    for (const p of particles) {
      const end = particleAt(p, CONFETTI_DURATION_MS);
      expect(end.y).toBeGreaterThan(0); // fell past the origin despite the pop
      expect(end.opacity).toBe(0);
      // Flutter never drifts a scrap beyond its amplitude off the ballistic x.
      expect(Math.abs(end.x - p.vx * CONFETTI_DURATION_MS)).toBeLessThanOrEqual(
        p.flutter + 1e-9,
      );
      expect(end.scaleY).toBeGreaterThanOrEqual(0.35);
      expect(end.scaleY).toBeLessThanOrEqual(1);
      expect(Number.isFinite(end.rotation)).toBe(true);
    }
  });

  it('clamps time beyond the burst duration', () => {
    const p = particles[0];
    expect(particleAt(p, 5000)).toEqual(particleAt(p, CONFETTI_DURATION_MS));
  });
});

/* --------------------------- bridge round-trips ---------------------------- */

const STICKY_FIXTURE = [
  '::: sticky-note {color=lemon, rotate=-2}',
  'Exam on **Friday!**',
  ':::',
].join('\n');

const COLUMNS_FIXTURE = [
  '::: columns {gap=lg}',
  '::: col',
  'left',
  ':::',
  '::: col {width=2}',
  'right',
  ':::',
  ':::',
].join('\n');

describe('script bridge round-trips real container nodes', () => {
  it('sticky-note becomes a real node and round-trips exactly', () => {
    const doc = parse(STICKY_FIXTURE);
    const json = scriptDocToTiptap(doc);
    const block = content(json)[0];
    expect(block.type).toBe('sticky-note');
    expect(block.attrs?.color).toBe('lemon');
    expect(block.attrs?.rotate).toBe(-2);
    expect(() =>
      schema.nodeFromJSON(json as unknown as Record<string, unknown>).check(),
    ).not.toThrow();

    const restored = tiptapToScriptDoc(json);
    expect(essence(restored)).toEqual(essence(doc));
    expect(print(restored)).toBe(print(doc));
  });

  it('columns become a real columns node with weighted cols and round-trip', () => {
    const doc = parse(COLUMNS_FIXTURE);
    const json = scriptDocToTiptap(doc);
    const block = content(json)[0];
    expect(block.type).toBe('columns');
    expect(block.attrs?.gap).toBe('lg');
    expect(block.content?.map((n) => n.type)).toEqual(['col', 'col']);
    expect(block.content?.[1]?.attrs?.width).toBe(2);
    expect(() =>
      schema.nodeFromJSON(json as unknown as Record<string, unknown>).check(),
    ).not.toThrow();

    const restored = tiptapToScriptDoc(json);
    expect(essence(restored)).toEqual(essence(doc));
    expect(print(restored)).toBe(print(doc));
  });

  it('keeps the callout fallback when hasNode() denies the node', () => {
    const doc = parse(STICKY_FIXTURE);
    const json = scriptDocToTiptap(doc, {
      hasNode: (name) => name !== 'sticky-note',
    });
    const block = content(json)[0];
    expect(block.type).toBe('callout');
    expect(block.attrs?.containerName).toBe('sticky-note');
    // …and the marker attrs still round-trip the original container.
    const restored = tiptapToScriptDoc(json);
    expect(essence(restored)).toEqual(essence(doc));
  });
});
