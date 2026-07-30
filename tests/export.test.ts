// @vitest-environment node
/**
 * Group D (import/export & templates) unit tests: the pure PDF assembler,
 * the markdown page-splitting logic, template integrity, and the
 * user-sticker surface (registry + script vocab).
 */
import { describe, expect, it } from 'vitest';
import {
  buildJpegPdf,
  DEFAULT_PDF_PIXELS_PER_INCH,
  type PdfImagePage,
} from '../src/editor/script/exporters/pdf';
import {
  blockLineCost,
  deriveBookTitle,
  inlineText,
  nextShelfSpot,
  splitBlocksIntoPages,
  titleFromFileName,
  PAGE_LINE_BUDGET,
} from '../src/features/templates/split';
import { NOTEBOOK_TEMPLATES } from '../src/features/templates/templates';
import { parse } from '../src/script';
import {
  ATTR_ENUM_DOMAINS,
  SCRIPT_STICKER_DOMAIN,
  isUserStickerName,
  registerScriptStickerName,
} from '../src/script/vocab';
import {
  isStickerId,
  isUserStickerId,
  listUserStickers,
  registerUserSticker,
  sanitizeStickerName,
  stickerSvg,
  userStickerSrc,
} from '../src/editor/nodes/stickers';
import { mapStickerName } from '../src/editor/script/toTiptap';

/**
 * Minimal DOM shim (same recipe as tests/editor.test.ts): compiled Solid
 * node-view components register delegated event roots at import time.
 * createFromScript pulls the full extension set, so it is imported after
 * the shim.
 */
const globals = globalThis as Record<string, unknown>;
if (typeof globals.window === 'undefined') {
  globals.window = globals;
  globals.document = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    // prosemirror-view sniffs `document.documentElement.style` at import.
    documentElement: { style: {} },
  };
}

const { scriptDocToPageSections } = await import(
  '../src/features/templates/createFromScript'
);

// ---------------------------------------------------------------------------
// PDF assembler
// ---------------------------------------------------------------------------

function fakeJpeg(length: number, fill = 0xab): Uint8Array {
  const bytes = new Uint8Array(Math.max(6, length));
  bytes.fill(fill);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

const latin1 = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join('');

function twoPages(): PdfImagePage[] {
  return [
    { jpeg: fakeJpeg(64), width: 1240, height: 1750 },
    { jpeg: fakeJpeg(48, 0xcd), width: 1240, height: 1750 },
  ];
}

describe('buildJpegPdf', () => {
  it('emits a well-formed header, page count and trailer', () => {
    const pdf = buildJpegPdf(twoPages());
    const text = latin1(pdf);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/Root 1 0 R');
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });

  it('startxref points at the xref table and offsets point at objects', () => {
    const pdf = buildJpegPdf(twoPages());
    const text = latin1(pdf);
    const startxref = Number(
      /startxref\n(\d+)\n/.exec(text)?.[1] ?? Number.NaN,
    );
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    // Lines: "xref", "0 9", the free entry, then 8 object entries.
    const entries = text
      .slice(startxref)
      .split('\n')
      .slice(3, 11)
      .map((line) => Number(line.slice(0, 10)));
    entries.forEach((offset, i) => {
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(
        `${i + 1} 0 obj`,
      );
    });
  });

  it('embeds the JPEG bytes verbatim', () => {
    const pages = twoPages();
    const pdf = buildJpegPdf(pages);
    const haystack = latin1(pdf);
    const needle = latin1(pages[1].jpeg);
    expect(haystack).toContain(needle);
  });

  it('maps 2x pixels onto paper points (192 px/inch)', () => {
    const text = latin1(buildJpegPdf(twoPages(), DEFAULT_PDF_PIXELS_PER_INCH));
    // 1240 / 192 * 72 = 465pt; 1750 / 192 * 72 = 656.25pt.
    expect(text).toContain('/MediaBox [0 0 465 656.25]');
  });

  it('throws on an empty page list', () => {
    expect(() => buildJpegPdf([])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Markdown splitting
// ---------------------------------------------------------------------------

const MD_THREE_SECTIONS = `# One

first section body

# Two

second section body

# Three

third section body
`;

describe('splitBlocksIntoPages', () => {
  it('starts a new page at every H1', () => {
    const doc = parse(MD_THREE_SECTIONS);
    const pages = splitBlocksIntoPages(doc.blocks);
    expect(pages).toHaveLength(3);
    for (const page of pages) {
      expect(page[0].kind).toBe('heading');
    }
  });

  it('keeps a leading H1 with its own section (no empty first page)', () => {
    const doc = parse('# Only\n\nbody\n');
    const pages = splitBlocksIntoPages(doc.blocks);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
  });

  it('capacity-splits headingless walls of text', () => {
    const wall = Array.from(
      { length: 40 },
      (_, i) => `Paragraph number ${i} with a little bit of body text.`,
    ).join('\n\n');
    const doc = parse(wall);
    const pages = splitBlocksIntoPages(doc.blocks);
    expect(pages.length).toBeGreaterThan(1);
    // No page exceeds the budget by more than one block's worth.
    for (const page of pages) {
      const lines = page.reduce((sum, block) => sum + blockLineCost(block), 0);
      expect(lines).toBeLessThanOrEqual(PAGE_LINE_BUDGET + 4);
    }
  });

  it('returns one (possibly empty) page for empty input', () => {
    expect(splitBlocksIntoPages([])).toEqual([[]]);
  });
});

describe('title derivation', () => {
  it('prefers frontmatter title, then first H1, then fallback', () => {
    const withFm = parse('---\ntitle: From Frontmatter\n---\n\n# H1 Title\n');
    expect(deriveBookTitle(withFm, 'file')).toBe('From Frontmatter');
    const withH1 = parse('# H1 Title\n\nbody');
    expect(deriveBookTitle(withH1, 'file')).toBe('H1 Title');
    const plain = parse('just text');
    expect(deriveBookTitle(plain, 'my-notes')).toBe('my-notes');
    expect(deriveBookTitle(plain, '   ')).toBe('Imported notes');
  });

  it('derives fallback titles from file names', () => {
    expect(titleFromFileName('C:\\notes\\study plan.md')).toBe('study plan');
    expect(titleFromFileName('/tmp/readme.markdown')).toBe('readme');
    expect(titleFromFileName('plain.txt')).toBe('plain');
  });
});

describe('nextShelfSpot', () => {
  it('fills gaps on the first floor before moving down', () => {
    const books = [
      { floor: 0, slot: 0 },
      { floor: 0, slot: 2 },
    ];
    expect(nextShelfSpot(books)).toEqual({ floor: 0, slot: 1 });
  });

  it('moves to the next floor when a floor is full', () => {
    const full = Array.from({ length: 19 }, (_, slot) => ({ floor: 0, slot }));
    expect(nextShelfSpot(full)).toEqual({ floor: 1, slot: 0 });
  });

  it('starts at 0/0 on an empty shelf', () => {
    expect(nextShelfSpot([])).toEqual({ floor: 0, slot: 0 });
  });
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

describe('templates', () => {
  it('all five templates parse warning-free', () => {
    expect(NOTEBOOK_TEMPLATES).toHaveLength(5);
    for (const template of NOTEBOOK_TEMPLATES) {
      const doc = parse(template.script);
      expect(doc.diagnostics, `${template.id} diagnostics`).toEqual([]);
      expect(doc.blocks.length, `${template.id} blocks`).toBeGreaterThan(2);
    }
  });

  it('every template maps to non-empty page sections with real content', () => {
    for (const template of NOTEBOOK_TEMPLATES) {
      const sections = scriptDocToPageSections(parse(template.script));
      expect(sections.length, template.id).toBeGreaterThan(0);
      const first = sections[0];
      expect(first.doc.type).toBe('doc');
      expect((first.doc.content ?? []).length).toBeGreaterThan(0);
      expect(first.source.length).toBeGreaterThan(0);
    }
  });

  it('cornell template keeps its columns container in the editor doc', () => {
    const cornell = NOTEBOOK_TEMPLATES.find((t) => t.id === 'cornell');
    expect(cornell).toBeDefined();
    const sections = scriptDocToPageSections(parse(cornell!.script));
    const json = JSON.stringify(sections.map((s) => s.doc));
    expect(json).toContain('"columns"');
    expect(json).toContain('"sticky-note"');
  });
});

// ---------------------------------------------------------------------------
// Custom stickers (registry + vocab + script mapping)
// ---------------------------------------------------------------------------

describe('user stickers', () => {
  it('sanitizes names into the sticker alphabet', () => {
    expect(sanitizeStickerName('My Bunny!.png')).toBe('my-bunny');
    expect(sanitizeStickerName('  Ærø  ')).toBe('r');
    expect(sanitizeStickerName('___')).toBe('');
  });

  it('registers, lists and resolves user stickers', () => {
    const id = registerUserSticker('Test Bunny.png', 'data:image/png;base64,AA');
    expect(id).toBe('user:test-bunny');
    expect(userStickerSrc(id)).toBe('data:image/png;base64,AA');
    expect(listUserStickers().some((s) => s.id === id)).toBe(true);
    expect(isUserStickerId(id)).toBe(true);
    expect(isStickerId(id)).toBe(true);
    expect(isStickerId('user:')).toBe(false);
  });

  it('renders registered user stickers as <img> and missing ones as placeholder', () => {
    registerUserSticker('rendered', 'https://example.test/a.png');
    const markup = stickerSvg('user:rendered');
    expect(markup).toContain('<img');
    expect(markup).toContain('https://example.test/a.png');
    const missing = stickerSvg('user:never-registered');
    expect(missing).toContain('<svg');
    expect(missing).toContain('stroke-dasharray');
  });

  it('escapes attribute-breaking characters in the src', () => {
    registerUserSticker('quoted', 'https://example.test/a.png?x="1"&y=<2>');
    const markup = stickerSvg('user:quoted');
    expect(markup).not.toContain('"1"');
    expect(markup).toContain('&quot;1&quot;');
    expect(markup).toContain('&amp;y=');
  });

  it('built-in stickers still render their wobbly SVG deterministically', () => {
    const a = stickerSvg('star');
    const b = stickerSvg('star');
    expect(a).toBe(b);
    expect(a).toContain('<svg');
  });

  it('joins the script vocab so {sticker=user:…} parses cleanly', () => {
    registerScriptStickerName('user:vocab-cat');
    expect(SCRIPT_STICKER_DOMAIN).toContain('user:vocab-cat');
    expect(ATTR_ENUM_DOMAINS.sticker).toContain('user:vocab-cat');
    expect(isUserStickerName('user:vocab-cat')).toBe(true);
    expect(isUserStickerName('user:')).toBe(false);

    const doc = parse('Hello there {sticker=user:vocab-cat}');
    expect(doc.diagnostics).toEqual([]);
    const block = doc.blocks[0];
    expect(block.attrs.sticker).toBe('user:vocab-cat');
  });

  it('mapStickerName passes user ids through and still maps built-ins', () => {
    expect(mapStickerName('user:anything')).toBe('user:anything');
    expect(mapStickerName('microscope')).toBe('sparkle');
    expect(mapStickerName('nonsense')).toBeNull();
    expect(mapStickerName('user:')).toBeNull();
  });
});
