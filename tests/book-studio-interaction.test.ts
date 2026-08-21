import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOK_SURPRISE_LOCK_IDS } from '../src/art/bookSurprise';
import { ACTIVE_TITLE_PLATES, resolveBookStyle } from '../src/art/bookStyle';
import {
  bookPreviewGeometry,
  coverCompositionTargetRects,
  previewRectStyle,
  type BookPreviewGeometryInput,
} from '../src/views/rail/bookStudioPreview';

const ROOT = resolve(import.meta.dirname, '..');

function input(patch: Partial<BookPreviewGeometryInput> = {}): BookPreviewGeometryInput {
  return {
    canvasWidth: 214,
    canvasHeight: 292,
    stageScale: 0.9,
    baseline: 282,
    height: 280,
    thickness: 38,
    coverAspect: 0.68,
    raisedBands: 3,
    headTail: true,
    ornament: 5,
    coverTitlePlate: 'label',
    coverFrame: 24,
    coverMedallion: 5,
    ...patch,
  };
}

function centerY(rectangle: { top: number; height: number }): number {
  return rectangle.top + rectangle.height / 2;
}

/** The same centred/clamped expansion expressed by rail.css, then scaled. */
function displayedHitRect(
  rectangle: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
): { left: number; top: number; width: number; height: number } {
  const min = 24 / scale;
  const width = Math.max(rectangle.width, min);
  const height = Math.max(rectangle.height, min);
  const left = Math.min(
    canvasWidth - width,
    Math.max(0, rectangle.left - (width - rectangle.width) / 2),
  );
  const top = Math.min(
    canvasHeight - height,
    Math.max(0, rectangle.top - (height - rectangle.height) / 2),
  );
  return { left: left * scale, top: top * scale, width: width * scale, height: height * scale };
}

function overlaps(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean {
  return a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top;
}

describe('Book Studio interaction contract', () => {
  it('keeps previous-generation history as a compact preview-corner action', () => {
    const source = readFileSync(resolve(ROOT, 'src/views/rail/BookStudio.tsx'), 'utf8');
    const css = readFileSync(resolve(ROOT, 'src/styles/rail.css'), 'utf8');

    expect(source).toContain('class="nb-book-preview-previous"');
    expect(source).toContain('aria-label="Restore previous generated book look"');
    expect(source).not.toContain('class="nb-book-surprise-previous"');
    expect(source).not.toContain('<strong>previous look</strong>');
    expect(css).toMatch(/\.nb-book-preview-previous\s*\{[\s\S]*?width:\s*27px;[\s\S]*?height:\s*27px;/);
  });

  it('keeps each custom-colour home as one picker without a duplicate swatch shelf', () => {
    const picker = readFileSync(resolve(ROOT, 'src/views/rail/OwnColour.tsx'), 'utf8');
    const library = readFileSync(resolve(ROOT, 'src/views/rail/LibraryStudio.tsx'), 'utf8');
    const css = readFileSync(resolve(ROOT, 'src/styles/studio.css'), 'utf8');

    expect(library.match(/<OwnColour/g)).toHaveLength(2);
    expect(picker).toContain('class="nb-own-colour-well"');
    expect(picker).toContain('class="nb-own-colour-hex font-ui"');
    expect(picker).not.toContain('nb-swatch-grid-own');
    expect(picker).not.toContain('colours you have used');
    expect(css).not.toContain('.nb-swatch-grid-own');
  });

  it('offers no spine-title control while retaining the cover title control', () => {
    const source = readFileSync(resolve(ROOT, 'src/views/rail/BookStudio.tsx'), 'utf8');
    expect(source).not.toContain('data-book-control="title-size"');
    expect(source).not.toContain('data-book-control="title-space"');
    expect(source).not.toContain('Spine title size');
    expect(source).toContain('aria-label="Cover title treatment"');
  });

  it('keeps only the selected preview face in the accessibility tree', () => {
    const source = readFileSync(resolve(ROOT, 'src/views/rail/BookStudio.tsx'), 'utf8');
    const canvases = [...source.matchAll(/<canvas[\s\S]*?\/>/g)]
      .map((match) => match[0])
      .filter((markup) => markup.includes('nb-studio-face'));
    expect(canvases).toHaveLength(2);
    expect(canvases[0]).toContain('role="img"');
    expect(canvases[0]).toContain("aria-hidden={face() !== 'spine'}");
    expect(canvases[1]).toContain('role="img"');
    expect(canvases[1]).toContain("aria-hidden={face() !== 'cover'}");
    // A canvas is not natively tabbable; no positive tab index may smuggle the
    // visually hidden reverse face back into keyboard navigation.
    expect(canvases.join('\n')).not.toMatch(/tabIndex=\{?[1-9]/);
  });

  it('keeps the interaction layer on the exact preview book rectangle', () => {
    const layout = bookPreviewGeometry(input());
    expect(layout.spine).toEqual({
      left: 89.9,
      top: 30,
      width: 34.2,
      height: 252,
    });
    expect(layout.cover.top).toBe(layout.spine.top);
    expect(layout.cover.height).toBe(layout.spine.height);
    expect(layout.cover.width).toBeCloseTo(171.36, 5);
    expect(layout.cover.left).toBeCloseTo(21.32, 5);
  });

  it('projects renderer-owned normalized spine targets instead of inventing UI boxes', () => {
    const layout = bookPreviewGeometry(input({
      spineTargets: {
        raisedBands: [
          { left: -0.04, top: 0.12, width: 1.08, height: 0.025 },
          { left: -0.04, top: 0.62, width: 1.08, height: 0.025 },
        ],
        ornament: { left: 0.25, top: 0.72, width: 0.5, height: 0.1 },
        endbands: [
          { left: 0, top: 0.02, width: 1, height: 0.03 },
          { left: 0, top: 0.95, width: 1, height: 0.03 },
        ],
      },
    }));
    const cords = layout.hotspots.filter((row) => row.target === 'bands');
    const endbands = layout.hotspots.filter((row) => row.target === 'endbands');
    const ornament = layout.hotspots.find((row) => row.id === 'spine-ornament');
    expect(layout.hotspots.find((row) => row.id === 'spine-title')).toBeUndefined();
    expect(cords).toHaveLength(2);
    expect(cords[0]?.rect.top).toBeLessThan(75);
    expect(cords[1]?.rect.top).toBeGreaterThan(165);
    expect(endbands.map((row) => row.id)).toEqual([
      'spine-endband-head-1',
      'spine-endband-tail-2',
    ]);
    expect(ornament?.rect.top).toBeGreaterThan(195);
    expect(layout.hotspots.filter((row) => row.target === 'cover-frame')).toHaveLength(4);
    const bottomFrame = layout.hotspots.find((row) => row.id === 'cover-frame-bottom');
    const pageEdge = layout.hotspots.find((row) => row.id === 'cover-edge');
    expect(pageEdge?.layer).toBe('body');
    expect((pageEdge?.rect.top ?? 0) + (pageEdge?.rect.height ?? 0)).toBeLessThan(
      bottomFrame?.rect.top ?? 0,
    );
  });

  it('projects active cover title and unified emblem targets from the renderer composition family', () => {
    const direct = bookPreviewGeometry(input({
      coverTitlePlate: 'direct-gilt-title',
      coverFrame: 24,
      coverMedallion: 5,
    }));
    const ticket = bookPreviewGeometry(input({
      coverTitlePlate: 'laid-paper-ticket',
      coverFrame: 24,
      coverMedallion: 5,
    }));

    const directTitle = direct.hotspots.find((row) => row.id === 'cover-title');
    const ticketTitle = ticket.hotspots.find((row) => row.id === 'cover-title');
    const ticketEmblem = ticket.hotspots.find((row) => row.id === 'cover-emblem');
    const exactTicket = coverCompositionTargetRects(ticket.cover, {
      coverTitlePlate: 'laid-paper-ticket',
      coverFrame: 24,
      coverMedallion: 5,
    });

    // A paper ticket narrows and the transparent controls must travel with
    // its exact authored locus rather than an assumed generic lower plate.
    expect(ticketTitle?.rect.width).toBeLessThan(directTitle?.rect.width ?? 0);
    expect(centerY(ticketTitle!.rect)).not.toBe(centerY(directTitle!.rect));
    expect(ticketTitle?.rect.left).toBeCloseTo(exactTicket.title.left, 5);
    expect(ticketTitle?.rect.top).toBeCloseTo(exactTicket.title.top, 5);
    expect(centerY(ticketEmblem!.rect)).toBeCloseTo(centerY(exactTicket.medallion), 5);
    // The visible emblem is smaller than the accessibility rectangle, but
    // expansion is concentric rather than drifting down and right.
    expect(ticketEmblem?.rect.width).toBe(34);
    expect(ticketEmblem?.rect.height).toBe(34);
    expect(
      (ticketEmblem?.rect.left ?? 0) + (ticketEmblem?.rect.width ?? 0) / 2,
    ).toBeCloseTo(exactTicket.medallion.left + exactTicket.medallion.width / 2, 5);
  });

  it('tracks Library Buckram\'s effective label instead of its latent none sentinel', () => {
    let resolved: ReturnType<typeof resolveBookStyle> | undefined;
    for (let seed = 0; seed < 4_096 && resolved === undefined; seed += 1) {
      const candidate = resolveBookStyle(seed, undefined, undefined, {
        binding: 'library-buckram',
      });
      if (candidate.style.titlePlate === 'none') resolved = candidate;
    }

    expect(resolved).toBeDefined();
    expect(resolved!.style.titlePlate).toBe('none');
    expect(resolved!.cover.titlePlate).toBe('laid-paper-ticket');

    const rendered = bookPreviewGeometry(input({
      coverTitlePlate: resolved!.cover.titlePlate,
    })).hotspots.find((row) => row.id === 'cover-title');
    const label = bookPreviewGeometry(input({
      coverTitlePlate: 'laid-paper-ticket',
    })).hotspots.find((row) => row.id === 'cover-title');
    const latentNone = bookPreviewGeometry(input({
      coverTitlePlate: resolved!.style.titlePlate,
    })).hotspots.find((row) => row.id === 'cover-title');

    expect(rendered?.rect).toEqual(label?.rect);
    expect(rendered?.rect).not.toEqual(latentNone?.rect);

    // This is the component seam: both the canvas painter and its transparent
    // interaction overlay now read the same resolved cover model.
    const source = readFileSync(resolve(ROOT, 'src/views/rail/BookStudio.tsx'), 'utf8');
    expect(source).toContain('coverTitlePlate: resolved().cover.titlePlate');
  });

  it('never creates a spine-title hotspot, even for legacy target data', () => {
    const layout = bookPreviewGeometry(input({
      spineTargets: {
        title: null,
        raisedBands: [],
        ornament: null,
        endbands: [],
      },
    }));
    expect(layout.hotspots.find((row) => row.id === 'spine-title')).toBeUndefined();
  });

  it('hands CSS source geometry so responsive hit expansion stays centred', () => {
    expect(previewRectStyle({ left: 11, top: 22, width: 7, height: 9 })).toEqual({
      '--nb-hotspot-left': '11px',
      '--nb-hotspot-top': '22px',
      '--nb-hotspot-width': '7px',
      '--nb-hotspot-height': '9px',
    });
    const css = readFileSync(resolve(ROOT, 'src/styles/rail.css'), 'utf8');
    expect(css).toContain('--nb-preview-hit-min: 52.174px');
    expect(css).toContain('width: var(--nb-hotspot-hit-width)');
    expect(css).toContain('height: var(--nb-hotspot-hit-height)');
    expect(css).toContain('calc(var(--nb-hotspot-left) - (var(--nb-hotspot-hit-width) - var(--nb-hotspot-width)) / 2)');
  });

  it('keeps every narrow target at least 24px and title clear of the emblem', () => {
    const scale = 0.46;
    for (const coverTitlePlate of ACTIVE_TITLE_PLATES) {
      const layout = bookPreviewGeometry(input({ coverTitlePlate }));
      const displayed = new Map(layout.hotspots.map((hotspot) => [
        hotspot.id,
        displayedHitRect(hotspot.rect, input().canvasWidth, input().canvasHeight, scale),
      ]));
      for (const target of displayed.values()) {
        expect(target.width).toBeGreaterThanOrEqual(23.999);
        expect(target.height).toBeGreaterThanOrEqual(23.999);
      }
      expect(overlaps(displayed.get('cover-title')!, displayed.get('cover-emblem')!)).toBe(false);
    }
  });

  it('leaves an add target wherever optional rendered furniture is absent', () => {
    const layout = bookPreviewGeometry(input({
      raisedBands: 0,
      headTail: false,
      ornament: -1,
      spineTargets: {
        title: null,
        raisedBands: [],
        ornament: null,
        endbands: [],
      },
    }));
    const absent = new Set(
      layout.hotspots.filter((row) => row.absent === true).map((row) => row.id),
    );
    expect(absent).toEqual(new Set([
      'spine-cords',
      'spine-endbands',
      'spine-ornament',
      'cover-emblem',
    ]));
  });

  it('renders exactly one affordance for every generator lock id', () => {
    const source = readFileSync(resolve(ROOT, 'src/views/rail/BookStudio.tsx'), 'utf8');
    const ids = [...source.matchAll(/<Lock\s+id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids)).toEqual(new Set(BOOK_SURPRISE_LOCK_IDS));
    expect(ids).toHaveLength(BOOK_SURPRISE_LOCK_IDS.length);
  });

  it('gives every preview hotspot a real focus destination in the Studio', () => {
    const source = readFileSync(resolve(ROOT, 'src/views/rail/BookStudio.tsx'), 'utf8');
    const targets = new Set([
      ...[...source.matchAll(/data-book-control="([^"]+)"/g)].map((match) => match[1]),
      ...[...source.matchAll(/\btarget="([^"]+)"/g)].map((match) => match[1]),
    ]);
    const previewTargets = new Set(bookPreviewGeometry(input()).hotspots.map((row) => row.target));
    expect([...previewTargets].filter((target) => !targets.has(target))).toEqual([]);
  });
});
