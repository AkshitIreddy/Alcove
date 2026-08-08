/**
 * Snapshot geometry is a transaction boundary, not a second layout pass.
 *
 * html-to-image copies computed styles into a foreignObject document. That
 * document has a different margin-collapsing context from the app and can
 * therefore move every block after a card, list or custom node even when the
 * source DOM measured perfectly. During a turn that reads as the stationary
 * page reacting to the other sheet being lifted.
 *
 * Snapshot roots are inert, offscreen copies owned by the raster pipeline.
 * Freeze each top-level prose block at the border box Chromium already chose
 * in the app document. Absolute positioning deliberately removes margin
 * collapse from the clone's state space while preserving the exact top, left,
 * width and height of ordinary prose and special blocks alike.
 */

export interface FrozenSnapshotBlock {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

function computedBorderBox(
  element: HTMLElement,
  rect: DOMRect,
  scaleX: number,
  scaleY: number,
): { width: number; height: number } {
  const style = getComputedStyle(element);
  const dimension = (axis: 'width' | 'height'): number => {
    const used = Number.parseFloat(style[axis]);
    if (!Number.isFinite(used) || used <= 0) {
      return axis === 'width'
        ? rect.width / Math.max(scaleX, 1e-6)
        : rect.height / Math.max(scaleY, 1e-6);
    }
    if (style.boxSizing === 'border-box') return used;
    const extras =
      axis === 'width'
        ? Number.parseFloat(style.paddingLeft) +
          Number.parseFloat(style.paddingRight) +
          Number.parseFloat(style.borderLeftWidth) +
          Number.parseFloat(style.borderRightWidth)
        : Number.parseFloat(style.paddingTop) +
          Number.parseFloat(style.paddingBottom) +
          Number.parseFloat(style.borderTopWidth) +
          Number.parseFloat(style.borderBottomWidth);
    return used + (Number.isFinite(extras) ? extras : 0);
  };
  return { width: dimension('width'), height: dimension('height') };
}

export function measureSnapshotBlockGeometry(
  sheet: HTMLElement,
): readonly FrozenSnapshotBlock[] {
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  if (prose === null) return [];
  const children = Array.from(prose.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  if (children.length === 0) return [];

  const proseRect = prose.getBoundingClientRect();
  const sheetRect = sheet.getBoundingClientRect();
  const sheetStyle = getComputedStyle(sheet);
  const sheetCssWidth = Number.parseFloat(sheetStyle.width);
  const sheetCssHeight = Number.parseFloat(sheetStyle.height);
  const scaleX =
    Number.isFinite(sheetCssWidth) && sheetCssWidth > 0
      ? sheetRect.width / sheetCssWidth
      : 1;
  const scaleY =
    Number.isFinite(sheetCssHeight) && sheetCssHeight > 0
      ? sheetRect.height / sheetCssHeight
      : 1;
  return children.map((child): FrozenSnapshotBlock => {
    const rect = child.getBoundingClientRect();
    // The visual rect includes every hand-drawn rotate()/skew(). It is the
    // correct target position but the wrong CSS width: writing that rotated
    // bounding width back onto the clone and retaining the transform applies
    // the wobble twice. Ordinary paragraphs have no transform, which is why
    // this failure singled out cards and diagrams.
    const size = computedBorderBox(child, rect, scaleX, scaleY);
    return {
      top: (rect.top - proseRect.top) / Math.max(scaleY, 1e-6),
      left: (rect.left - proseRect.left) / Math.max(scaleX, 1e-6),
      width: size.width,
      height: size.height,
    };
  });
}

/**
 * Freeze list-item advance before the containing top-level list is frozen.
 * html-to-image assigns each LI its computed border-box height, which otherwise
 * contains the ruled-text negative lead and lengthens every row in the clone.
 */
export function freezeSnapshotListRows(sheet: HTMLElement): number {
  let frozen = 0;
  for (const list of sheet.querySelectorAll<HTMLElement>('ul, ol')) {
    const rows = Array.from(list.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.tagName === 'LI',
    );
    if (rows.length === 0) continue;
    const listRect = list.getBoundingClientRect();
    const style = getComputedStyle(list);
    const cssHeight = Number.parseFloat(style.height);
    const scaleY =
      Number.isFinite(cssHeight) && cssHeight > 0
        ? listRect.height / cssHeight
        : 1;
    const listBottom = listRect.bottom;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const top = row.getBoundingClientRect().top;
      const nextTop = rows[index + 1]?.getBoundingClientRect().top ?? listBottom;
      const advance = (nextTop - top) / Math.max(scaleY, 1e-6);
      if (!Number.isFinite(advance) || advance <= 0) continue;
      row.style.setProperty('height', finitePixel(advance), 'important');
      row.style.setProperty('box-sizing', 'border-box', 'important');
      frozen += 1;
    }
  }
  return frozen;
}

function finitePixel(value: number): string {
  return `${Math.abs(value) < 0.0005 ? 0 : value.toFixed(3)}px`;
}

/**
 * Freeze one inert sheet's top-level editor flow. Returns the boxes that were
 * committed, which keeps this seam inspectable without exposing the DOM clone.
 */
export function freezeSnapshotBlockGeometry(
  sheet: HTMLElement,
  measured: readonly FrozenSnapshotBlock[] = measureSnapshotBlockGeometry(sheet),
): readonly FrozenSnapshotBlock[] {
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  if (prose === null) return [];
  const children = Array.from(prose.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  if (children.length === 0) return [];
  const boxes = measured.slice(0, children.length);
  const sheetRect = sheet.getBoundingClientRect();
  const sheetStyle = getComputedStyle(sheet);
  const cssWidth = Number.parseFloat(sheetStyle.width);
  const cssHeight = Number.parseFloat(sheetStyle.height);
  const scaleX = Number.isFinite(cssWidth) && cssWidth > 0 ? sheetRect.width / cssWidth : 1;
  const scaleY = Number.isFinite(cssHeight) && cssHeight > 0 ? sheetRect.height / cssHeight : 1;

  prose.style.setProperty('position', 'relative', 'important');
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const box = boxes[index];
    if (box === undefined) continue;
    if (
      !Number.isFinite(box.top) ||
      !Number.isFinite(box.left) ||
      !Number.isFinite(box.width) ||
      !Number.isFinite(box.height) ||
      box.width < 0 ||
      box.height < 0
    ) {
      continue;
    }
    child.style.setProperty('position', 'absolute', 'important');
    child.style.setProperty('inset', 'auto', 'important');
    child.style.setProperty('top', finitePixel(box.top), 'important');
    child.style.setProperty('left', finitePixel(box.left), 'important');
    child.style.setProperty('width', finitePixel(box.width), 'important');
    child.style.setProperty('height', finitePixel(box.height), 'important');
    child.style.setProperty('box-sizing', 'border-box', 'important');
    child.style.setProperty('margin', '0', 'important');
  }

  // Preserve the visual border-box origin as well as its untransformed size.
  // A rotated coordinate system couples x/y, so use a few bounded correction
  // passes in this inert stage rather than touching the live editor layout.
  for (let pass = 0; pass < 3; pass += 1) {
    const proseRect = prose.getBoundingClientRect();
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      const box = boxes[index];
      if (box === undefined || child.style.position !== 'absolute') continue;
      const rect = child.getBoundingClientRect();
      const top = Number.parseFloat(child.style.top);
      const left = Number.parseFloat(child.style.left);
      if (Number.isFinite(top)) {
        child.style.setProperty(
          'top',
          finitePixel(top + (proseRect.top + box.top * scaleY - rect.top) / Math.max(scaleY, 1e-6)),
          'important',
        );
      }
      if (Number.isFinite(left)) {
        child.style.setProperty(
          'left',
          finitePixel(left + (proseRect.left + box.left * scaleX - rect.left) / Math.max(scaleX, 1e-6)),
          'important',
        );
      }
    }
  }
  return boxes;
}
