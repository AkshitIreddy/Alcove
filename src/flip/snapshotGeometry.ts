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

interface FrozenSnapshotNestedBlock extends FrozenSnapshotBlock {
  readonly element: HTMLElement;
  readonly parent: HTMLElement;
  readonly viewportTop: number;
  readonly viewportLeft: number;
}

const NESTED_LAYOUT_DISPLAYS = new Set([
  'block',
  'flex',
  'grid',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'list-item',
  'table',
  'table-caption',
  'table-cell',
  'table-row',
  'table-row-group',
]);

function snapshotScale(sheet: HTMLElement): { x: number; y: number } {
  const rect = sheet.getBoundingClientRect();
  const style = getComputedStyle(sheet);
  const width = Number.parseFloat(style.width);
  const height = Number.parseFloat(style.height);
  return {
    x: Number.isFinite(width) && width > 0 ? rect.width / width : 1,
    y: Number.isFinite(height) && height > 0 ? rect.height / height : 1,
  };
}

function frozenBorderBox(
  element: HTMLElement,
  rect: DOMRect,
  scale: { x: number; y: number },
): { width: number; height: number } {
  const style = getComputedStyle(element);
  // getBoundingClientRect includes every ancestral hand-drawn tilt. Feeding
  // that rotated bounding box back into CSS width/height applies the tilt
  // twice and is the classic "card contents jump but ordinary prose does not"
  // failure. Computed width/height are the used, untransformed CSS box.
  const borderBox = (axis: 'width' | 'height'): number => {
    const declared = Number.parseFloat(style[axis]);
    if (!Number.isFinite(declared) || declared <= 0) {
      const offset = axis === 'width' ? element.offsetWidth : element.offsetHeight;
      return offset || (axis === 'width'
        ? rect.width / Math.max(scale.x, 1e-6)
        : rect.height / Math.max(scale.y, 1e-6));
    }
    if (style.boxSizing === 'border-box') return declared;
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
    return declared + (Number.isFinite(extras) ? extras : 0);
  };
  return { width: borderBox('width'), height: borderBox('height') };
}

/**
 * Capture the second layout level inside feature node views.
 *
 * The outer callout/spoiler/columns box can be perfectly stationary while its
 * NodeViewContent is laid out again a few pixels higher by html-to-image's
 * foreignObject clone. Record every block-like direct child against its real
 * parent. Inline spans are deliberately left alone: their paragraph owns the
 * line box, and turning every mark into an absolutely positioned fragment
 * would destroy wrapping and selection-shaped decorations.
 */
export function measureSnapshotNestedGeometry(
  sheet: HTMLElement,
): readonly FrozenSnapshotNestedBlock[] {
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  if (prose === null) return [];
  const scale = snapshotScale(sheet);
  const measured: FrozenSnapshotNestedBlock[] = [];
  const roots = Array.from(
    prose.querySelectorAll<HTMLElement>('[data-nb-block-flow="feature"]'),
  );
  const visited = new Set<HTMLElement>();

  const visit = (parent: HTMLElement): void => {
    if (visited.has(parent)) return;
    visited.add(parent);
    if (parent.matches('svg, canvas, video, audio, iframe')) return;
    const parentRect = parent.getBoundingClientRect();
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.visibility === 'collapse') continue;
      if (style.position === 'absolute' || style.position === 'fixed') {
        // An authored overlay already owns its geometry. Re-positioning it as
        // flow is how tint buttons and diagram handles ended up in the text.
        continue;
      }
      const isListRow = child.tagName === 'LI' || parent.matches('ul, ol');
      if (!isListRow && NESTED_LAYOUT_DISPLAYS.has(style.display)) {
        const rect = child.getBoundingClientRect();
        const borderBox = frozenBorderBox(child, rect, scale);
        measured.push({
          element: child,
          parent,
          viewportTop: rect.top,
          viewportLeft: rect.left,
          top: (rect.top - parentRect.top) / Math.max(scale.y, 1e-6),
          left: (rect.left - parentRect.left) / Math.max(scale.x, 1e-6),
          width: borderBox.width,
          height: borderBox.height,
        });
      }
      visit(child);
    }
  };

  for (const root of roots) visit(root);
  return measured;
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
    const borderBox = frozenBorderBox(child, rect, { x: scaleX, y: scaleY });
    return {
      top: (rect.top - proseRect.top) / Math.max(scaleY, 1e-6),
      left: (rect.left - proseRect.left) / Math.max(scaleX, 1e-6),
      width: borderBox.width,
      height: borderBox.height,
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
 * Commit nested feature geometry after every measurement has been taken.
 * Parents are encountered before children, so each containing block is fixed
 * before its descendants are placed. The top-level transaction then fixes the
 * feature root itself without changing any of these relative coordinates.
 */
export function freezeSnapshotNestedGeometry(
  sheet: HTMLElement,
  measured: readonly FrozenSnapshotNestedBlock[] = measureSnapshotNestedGeometry(sheet),
): number {
  const scale = snapshotScale(sheet);
  let frozen = 0;
  for (const box of measured) {
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
    const parentPosition = getComputedStyle(box.parent).position;
    if (parentPosition === 'static') {
      box.parent.style.setProperty('position', 'relative', 'important');
    }
    const child = box.element;
    child.style.setProperty('position', 'absolute', 'important');
    child.style.setProperty('inset', 'auto', 'important');
    child.style.setProperty('top', finitePixel(box.top), 'important');
    child.style.setProperty('left', finitePixel(box.left), 'important');
    child.style.setProperty('width', finitePixel(box.width), 'important');
    child.style.setProperty('height', finitePixel(box.height), 'important');
    child.style.setProperty('min-width', '0', 'important');
    child.style.setProperty('min-height', '0', 'important');
    child.style.setProperty('max-width', 'none', 'important');
    child.style.setProperty('max-height', 'none', 'important');
    child.style.setProperty('box-sizing', 'border-box', 'important');
    child.style.setProperty('margin', '0', 'important');
    child.style.setProperty('flex', 'none', 'important');
    frozen += 1;
  }

  // Transforms are retained because the wobble is part of the page. Correct
  // their post-transform border boxes after placement so a rotated spoiler
  // chip or card lands on exactly the pixels measured before the transaction.
  // A rotated ancestor couples X and Y, so changing left can move top by a
  // fraction of a pixel. Three bounded correction passes converge well below
  // a physical pixel without adding a layout loop to the live editor (this is
  // the inert, offscreen transaction only).
  for (let pass = 0; pass < 3; pass += 1) {
    for (const box of measured) {
      const child = box.element;
      if (child.style.position !== 'absolute') continue;
      const rect = child.getBoundingClientRect();
      const top = Number.parseFloat(child.style.top);
      const left = Number.parseFloat(child.style.left);
      if (Number.isFinite(top) && Number.isFinite(rect.top)) {
        child.style.setProperty(
          'top',
          finitePixel(top + (box.viewportTop - rect.top) / Math.max(scale.y, 1e-6)),
          'important',
        );
      }
      if (Number.isFinite(left) && Number.isFinite(rect.left)) {
        child.style.setProperty(
          'left',
          finitePixel(left + (box.viewportLeft - rect.left) / Math.max(scale.x, 1e-6)),
          'important',
        );
      }
    }
  }
  return frozen;
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
  const scale = snapshotScale(sheet);

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
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const box = boxes[index];
    if (box === undefined || child.style.position !== 'absolute') continue;
    const proseRect = prose.getBoundingClientRect();
    const rect = child.getBoundingClientRect();
    const top = Number.parseFloat(child.style.top);
    const left = Number.parseFloat(child.style.left);
    if (Number.isFinite(top) && Number.isFinite(rect.top)) {
      child.style.setProperty(
        'top',
        finitePixel(top + (proseRect.top + box.top * scale.y - rect.top) / Math.max(scale.y, 1e-6)),
        'important',
      );
    }
    if (Number.isFinite(left) && Number.isFinite(rect.left)) {
      child.style.setProperty(
        'left',
        finitePixel(left + (proseRect.left + box.left * scale.x - rect.left) / Math.max(scale.x, 1e-6)),
        'important',
      );
    }
  }
  return boxes;
}
