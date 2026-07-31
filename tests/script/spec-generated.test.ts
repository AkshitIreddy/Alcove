/**
 * The gate on the AI-facing spec.
 *
 * `src-tauri/resources/notebook-script-spec.md` is what a person hands to a
 * chatbot so it can write Notebook Script. If the parser learns a container,
 * effect, sticker or diagram and the spec does not, the chatbot writes script
 * the app cannot read — and nothing else in the suite would notice.
 *
 * So: regenerate the spec here, in memory, from the same two inputs the CLI
 * uses (src/script/vocab.ts + scripts/spec-template.md) and fail if the
 * checked-in files differ, naming what is stale. Running `npm run spec` is
 * then the whole job — this test is the proof it ran.
 *
 * The second half checks the other end of the pipe: that the vocabulary the
 * spec is generated FROM is the vocabulary the parser actually implements.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  SPEC_MD_PATH,
  SPEC_TS_PATH,
  TEMPLATE_PATH,
  buildSpec,
  firstDifferences,
  missingFromSpec,
  renderSpecModule,
} from '../../scripts/gen-spec.mjs';
import * as vocab from '../../src/script/vocab';
import { parse } from '../../src/script';
import { resolveContainerName, resolveDiagramLang } from '../../src/script/normalize';
import { DIAGRAM_SHAPES, DIAGRAM_WASHES } from '../../src/diagrams/types';

const template = readFileSync(TEMPLATE_PATH, 'utf8');
const expectedMd = buildSpec(vocab, template);
const expectedTs = renderSpecModule(expectedMd);

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** Fail with the same words the CLI uses, so the fix is never a guess. */
function assertFresh(path: string, want: string): void {
  const have = read(path);
  if (have === want) return;
  throw new Error(
    [
      `${path} is out of date with src/script/vocab.ts.`,
      ...firstDifferences(want, have),
      '',
      'Run: npm run spec',
    ].join('\n'),
  );
}

describe('generated spec', () => {
  it('ships the spec the vocabulary describes', () => {
    assertFresh(SPEC_MD_PATH, expectedMd);
  });

  it('ships the same spec inlined for the frontend', () => {
    assertFresh(SPEC_TS_PATH, expectedTs);
  });

  it('names every name the parser knows', () => {
    const missing = missingFromSpec(vocab, expectedMd);
    if (missing.length > 0) {
      throw new Error(
        [
          'The spec never mentions:',
          ...missing.map((m) => `  - ${m}`),
          '',
          'Every name in src/script/vocab.ts must reach a generated region in',
          'scripts/gen-spec.mjs, or a chatbot will never write it.',
        ].join('\n'),
      );
    }
  });

  it('keeps the narrative the generator does not own', () => {
    // Cheap smoke test on the hand-written half: the sections a reader (and
    // BookView's "copy spec" button) expects to be there.
    expect(expectedMd).toContain('# Notebook Script');
    expect(expectedMd).toContain('## 11. Final checklist');
    expect(expectedMd).not.toContain('<!-- gen:');
    expect(expectedMd).not.toContain('<!-- template:');
    expect(expectedMd.length).toBeGreaterThan(10_000);
  });
});

/* ------------------------------------------------------------------------ */

describe('vocabulary documents what the parser implements', () => {
  it('has prose for every name, and no prose for names that are gone', () => {
    // The Record<> types make the missing direction a compile error; this
    // catches the reverse — a doc entry left behind after a name was removed.
    expect(Object.keys(vocab.CONTAINER_DOCS).sort()).toEqual(
      [...vocab.CONTAINER_NAMES].sort(),
    );
    expect(Object.keys(vocab.STICKER_DOCS).sort()).toEqual(
      [...vocab.STICKER_NAMES].sort(),
    );
    expect(Object.keys(vocab.ATTR_DOCS).sort()).toEqual(
      [...vocab.KNOWN_ATTR_KEYS].sort(),
    );
    expect(Object.keys(vocab.DIAGRAM_DOCS).sort()).toEqual(
      [...vocab.DIAGRAM_LANGS].sort(),
    );
    expect(Object.keys(vocab.LEAF_DIRECTIVE_DOCS).sort()).toEqual(
      Object.keys(vocab.LEAF_DIRECTIVE_NAMES).sort(),
    );
  });

  it('resolves every documented container name to itself', () => {
    for (const name of vocab.CONTAINER_NAMES) {
      expect(resolveContainerName(name).name, name).toBe(name);
    }
  });

  it('resolves every alias the spec promises', () => {
    for (const [alias, target] of Object.entries(vocab.CONTAINER_ALIASES)) {
      const resolved = resolveContainerName(alias);
      expect(resolved.name, alias).toBe(target.name);
      expect(resolved.impliedAttrs, alias).toEqual(target.attrs);
    }
  });

  it('resolves every documented diagram fence and alias', () => {
    for (const lang of vocab.DIAGRAM_LANGS) {
      expect(resolveDiagramLang(lang).lang, lang).toBe(lang);
    }
    for (const [alias, target] of Object.entries(vocab.DIAGRAM_LANG_ALIASES)) {
      expect(resolveDiagramLang(alias).lang, alias).toBe(target);
    }
  });

  it('accepts every enum value the spec prints, without a warning', () => {
    for (const [key, domain] of Object.entries(vocab.SPEC_ATTR_DOMAINS)) {
      for (const value of domain) {
        const doc = parse(`Cells divide. {${key}=${value}}`);
        expect(doc.diagnostics.map((d) => d.message), `${key}=${value}`).toEqual([]);
      }
    }
    for (const [key, domain] of Object.entries(vocab.FRONTMATTER_ENUM_DOMAINS)) {
      for (const value of domain) {
        const doc = parse(`---\n${key}: ${value}\n---\n\nCells divide.\n`);
        expect(doc.diagnostics.map((d) => d.message), `${key}: ${value}`).toEqual([]);
        expect(doc.frontmatter[key], `${key}: ${value}`).toBe(value);
      }
    }
  });

  it('understands every spelling of every leaf directive', () => {
    for (const spelling of vocab.LEAF_DIRECTIVE_NAMES.let) {
      const doc = parse(`::${spelling} course = Cell Biology\n\n{{course}}\n`);
      expect(doc.vars?.course, spelling).toBe('Cell Biology');
      expect(doc.diagnostics, spelling).toEqual([]);
    }
    for (const spelling of vocab.LEAF_DIRECTIVE_NAMES.style) {
      const doc = parse(`::${spelling} hero {color=amber}\n\n# Cell {use=hero}\n`);
      expect(doc.styles?.hero, spelling).toEqual({ color: 'amber' });
      expect(doc.blocks[0]?.attrs.color, spelling).toBe('amber');
    }
    for (const spelling of vocab.LEAF_DIRECTIVE_NAMES.fetch) {
      const doc = parse(`::${spelling}{query="a fluffy kitten"}\n`);
      expect(doc.blocks[0]?.kind, spelling).toBe('fetchDirective');
    }
  });

  it('mirrors the diagram renderer it documents', () => {
    // `shape` is documented from vocab but implemented over in src/diagrams;
    // the spec would advertise a shape the renderer cannot draw otherwise.
    expect([...vocab.DIAGRAM_SHAPE_VALUES]).toEqual([...DIAGRAM_SHAPES]);
    // Every script colour must survive into a diagram node's wash.
    for (const color of vocab.WASH_COLORS) {
      expect(DIAGRAM_WASHES as readonly string[], color).toContain(color);
    }
  });
});
