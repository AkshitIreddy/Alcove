/**
 * Snapshot geometry is a transaction boundary, not a second layout pass.
 *
 * A mounted page and the inert DOM handed to html-to-image are two different
 * formatting contexts.  Measuring the inert clone after it has been moved
 * offscreen only records the reflow we are trying to prevent.  The mounted
 * capture path therefore measures the live source first and applies that
 * manifest to the clone.  The offscreen path has no live presentation and
 * deliberately measures its fully-settled staged editor instead.
 */

export interface FrozenSnapshotBlock {
  /** Visual border-box origin relative to the owning prose box. */
  readonly top: number;
  readonly left: number;
  /** Used, pre-transform border-box size in CSS pixels. */
  readonly width: number;
  readonly height: number;
}

export interface FrozenSnapshotNodeView {
  readonly elementIndex: number;
  readonly width: number;
  readonly height: number;
  readonly children: readonly FrozenSnapshotBlock[];
}

export interface FrozenSnapshotList {
  readonly listIndex: number;
  readonly rows: readonly FrozenSnapshotListRow[];
}

export interface FrozenSnapshotListRow {
  /** The live LI's actual border box. Ruled paragraphs can make this taller
   * than the distance at which the following LI begins. */
  readonly height: number;
  /** Distance from this row's top to the next row (or the list bottom). */
  readonly advance: number;
  /** Native markers are a pseudo-element html-to-image does not clone. */
  readonly marker: FrozenSnapshotMarkerStyle | null;
}

export interface FrozenSnapshotMarkerStyle {
  readonly color: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontStyle: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
}

export interface FrozenSnapshotInlineBox {
  /** Index in `.nb-prose.querySelectorAll('*')`; cloneNode preserves it. */
  readonly elementIndex: number;
  readonly width: number;
  readonly height: number;
  /** Keep a source single-line atom single-line in the foreignObject clone. */
  readonly singleLine: boolean;
  /** Non-wrapping equivalent of the source white-space behaviour. */
  readonly unwrappedWhiteSpace: 'nowrap' | 'pre';
}

const SNAPSHOT_MARKER_CLASS = 'nb-snapshot-native-marker';
const SNAPSHOT_MARKER_RULES = 'data-nb-snapshot-marker-rules';

function finitePixel(value: number): string {
  return `${Math.abs(value) < 0.0005 ? 0 : value.toFixed(3)}px`;
}

function computedBorderBox(element: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(element);
  const dimension = (axis: 'width' | 'height'): number => {
    const used = Number.parseFloat(style[axis]);
    if (!Number.isFinite(used) || used <= 0) {
      return axis === 'width' ? element.offsetWidth : element.offsetHeight;
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

function sheetScale(sheet: HTMLElement): { x: number; y: number } {
  const rect = sheet.getBoundingClientRect();
  const style = getComputedStyle(sheet);
  const width = Number.parseFloat(style.width);
  const height = Number.parseFloat(style.height);
  return {
    x: Number.isFinite(width) && width > 0 ? rect.width / width : 1,
    y: Number.isFinite(height) && height > 0 ? rect.height / height : 1,
  };
}

function proseElements(sheet: HTMLElement): HTMLElement[] {
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  return prose === null
    ? []
    : Array.from(prose.querySelectorAll<HTMLElement>('*'));
}

function relativeVisualBox(
  element: HTMLElement,
  owner: HTMLElement,
  scale: { x: number; y: number },
): FrozenSnapshotBlock {
  const rect = element.getBoundingClientRect();
  const ownerRect = owner.getBoundingClientRect();
  const size = computedBorderBox(element);
  return {
    top: (rect.top - ownerRect.top) / Math.max(scale.y, 1e-6),
    left: (rect.left - ownerRect.left) / Math.max(scale.x, 1e-6),
    width: size.width,
    height: size.height,
  };
}

function validBox(box: FrozenSnapshotBlock): boolean {
  return (
    Number.isFinite(box.top) &&
    Number.isFinite(box.left) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width >= 0 &&
    box.height >= 0
  );
}

function measuredMarkerStyle(row: HTMLElement): FrozenSnapshotMarkerStyle | null {
  const rowStyle = getComputedStyle(row);
  if (rowStyle.display !== 'list-item' || rowStyle.listStyleType === 'none') {
    return null;
  }
  const marker = getComputedStyle(row, '::marker');
  return {
    color: marker.color,
    fontFamily: marker.fontFamily,
    fontSize: marker.fontSize,
    fontStyle: marker.fontStyle,
    fontWeight: marker.fontWeight,
    lineHeight: marker.lineHeight,
    letterSpacing: marker.letterSpacing,
  };
}

/** Measure the top-level editor flow from its authoritative presentation. */
export function measureSnapshotBlockGeometry(
  sheet: HTMLElement,
): readonly FrozenSnapshotBlock[] {
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  if (prose === null) return [];
  const scale = sheetScale(sheet);
  return Array.from(prose.children)
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map((child) => relativeVisualBox(child, prose, scale));
}

/** Measure immediate visual children owned by Solid node views at any depth. */
export function measureSnapshotNodeViewGeometry(
  sheet: HTMLElement,
): readonly FrozenSnapshotNodeView[] {
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  if (prose === null) return [];
  const scale = sheetScale(sheet);
  const elements = proseElements(sheet);
  const measured: FrozenSnapshotNodeView[] = [];
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const owner = elements[elementIndex]!;
    if (!owner.classList.contains('nb-node-view')) continue;
    const children = Array.from(owner.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    if (children.length === 0) continue;
    const ownerSize = computedBorderBox(owner);
    measured.push({
      elementIndex,
      width: ownerSize.width,
      height: ownerSize.height,
      children: children.map((child) => relativeVisualBox(child, owner, scale)),
    });
  }
  return measured;
}

/**
 * Measure both list-row border boxes and their advances.
 *
 * Ruled paragraphs deliberately use negative trailing lead: an ordered-list
 * row is 39.5px tall in the Welcome page while the next row begins 32px down.
 * html-to-image serialises the computed height but loses that collapsed
 * negative spacing. Keeping only either number necessarily changes the marker
 * box or the ruled rhythm; the snapshot contract must carry both.
 */
export function measureSnapshotListRows(
  sheet: HTMLElement,
): readonly FrozenSnapshotList[] {
  const measured: FrozenSnapshotList[] = [];
  const lists = Array.from(sheet.querySelectorAll<HTMLElement>('ul, ol'));
  for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
    const list = lists[listIndex]!;
    const rows = Array.from(list.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.tagName === 'LI',
    );
    if (rows.length === 0) continue;
    const listRect = list.getBoundingClientRect();
    const style = getComputedStyle(list);
    const cssHeight = Number.parseFloat(style.height);
    const scaleY =
      Number.isFinite(cssHeight) && cssHeight > 0 ? listRect.height / cssHeight : 1;
    const rowGeometry = rows.map((row, index): FrozenSnapshotListRow => {
      const top = row.getBoundingClientRect().top;
      const nextTop = rows[index + 1]?.getBoundingClientRect().top ?? listRect.bottom;
      return {
        height: computedBorderBox(row).height,
        advance: (nextTop - top) / Math.max(scaleY, 1e-6),
        marker: measuredMarkerStyle(row),
      };
    });
    measured.push({ listIndex, rows: rowGeometry });
  }
  return measured;
}

function installSnapshotMarkerRules(sheet: HTMLElement): void {
  if (sheet.querySelector(`style[${SNAPSHOT_MARKER_RULES}]`) !== null) return;
  const style = sheet.ownerDocument.createElement('style');
  style.setAttribute(SNAPSHOT_MARKER_RULES, '');
  style.textContent = `
.${SNAPSHOT_MARKER_CLASS}::marker {
  color: var(--nb-snapshot-marker-color) !important;
  font-family: var(--nb-snapshot-marker-family) !important;
  font-size: var(--nb-snapshot-marker-size) !important;
  font-style: var(--nb-snapshot-marker-style) !important;
  font-weight: var(--nb-snapshot-marker-weight) !important;
  line-height: var(--nb-snapshot-marker-line-height) !important;
  letter-spacing: var(--nb-snapshot-marker-letter-spacing) !important;
}`;
  sheet.append(style);
}

function freezeSnapshotMarker(row: HTMLElement, marker: FrozenSnapshotMarkerStyle): void {
  row.classList.add(SNAPSHOT_MARKER_CLASS);
  row.style.setProperty('--nb-snapshot-marker-color', marker.color);
  row.style.setProperty('--nb-snapshot-marker-family', marker.fontFamily);
  row.style.setProperty('--nb-snapshot-marker-size', marker.fontSize);
  row.style.setProperty('--nb-snapshot-marker-style', marker.fontStyle);
  row.style.setProperty('--nb-snapshot-marker-weight', marker.fontWeight);
  row.style.setProperty('--nb-snapshot-marker-line-height', marker.lineHeight);
  row.style.setProperty('--nb-snapshot-marker-letter-spacing', marker.letterSpacing);
}

function sourceTextLineCount(element: HTMLElement): number {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0.01 && rect.height > 0.01,
  );
  range.detach();

  // Range fragments on one visual line need not share a top: superscript,
  // inline icons and mixed font sizes all shift their fragment vertically.
  // A genuine wrapped line occupies a disjoint vertical band, so merge any
  // fragments whose vertical intervals overlap instead of comparing tops.
  const lineBands: Array<{ top: number; bottom: number }> = [];
  for (const rect of rects) {
    const band = lineBands.find(
      (candidate) =>
        Math.min(candidate.bottom, rect.bottom) - Math.max(candidate.top, rect.top) > 0.5,
    );
    if (band === undefined) {
      lineBands.push({ top: rect.top, bottom: rect.bottom });
    } else {
      band.top = Math.min(band.top, rect.top);
      band.bottom = Math.max(band.bottom, rect.bottom);
    }
  }
  return lineBands.length;
}

function unwrappedWhiteSpace(style: CSSStyleDeclaration): 'nowrap' | 'pre' {
  // Inline code inherits ProseMirror's `break-spaces`; `pre` removes wrapping
  // without changing its preservation of authored spaces. Ordinary inline
  // atoms keep normal whitespace collapsing through `nowrap`.
  return style.whiteSpace === 'pre' ||
    style.whiteSpace === 'pre-wrap' ||
    style.whiteSpace === 'break-spaces'
    ? 'pre'
    : 'nowrap';
}

/**
 * Measure atomic inline boxes from the source page.
 *
 * Inline code/key caps are the smallest reliable reproduction of the defect:
 * once a clone gives the pill a narrower content box its border and label can
 * wrap as separate-looking pieces.  Any authored inline-block/flex/grid is an
 * atom for the same reason, so the contract follows computed display rather
 * than a brittle list of classes.
 */
export function measureSnapshotInlineBoxes(
  sheet: HTMLElement,
): readonly FrozenSnapshotInlineBox[] {
  const measured: FrozenSnapshotInlineBox[] = [];
  const elements = proseElements(sheet);
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const style = getComputedStyle(element);
    const display = style.display;
    if (display !== 'inline-block' && display !== 'inline-flex' && display !== 'inline-grid') {
      continue;
    }
    const size = computedBorderBox(element);
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) continue;
    measured.push({
      elementIndex,
      width: size.width,
      height: size.height,
      singleLine: sourceTextLineCount(element) <= 1,
      unwrappedWhiteSpace: unwrappedWhiteSpace(style),
    });
  }
  return measured;
}

function correctVisualOrigins(
  owner: HTMLElement,
  children: readonly HTMLElement[],
  boxes: readonly FrozenSnapshotBlock[],
  scale: { x: number; y: number },
): void {
  // Rotated effect blocks report a visual bounding-box origin which is not
  // their CSS top/left.  Correct the inert clone after placement instead of
  // mutating the live source to suppress transforms (which would itself trip
  // the page MutationObserver and invalidate the capture transaction).
  for (let pass = 0; pass < 3; pass += 1) {
    const ownerRect = owner.getBoundingClientRect();
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      const box = boxes[index];
      if (box === undefined || child.style.position !== 'absolute') continue;
      const rect = child.getBoundingClientRect();
      const top = Number.parseFloat(child.style.top);
      const left = Number.parseFloat(child.style.left);
      if (Number.isFinite(top) && Number.isFinite(rect.top)) {
        child.style.setProperty(
          'top',
          finitePixel(top + (ownerRect.top + box.top * scale.y - rect.top) / Math.max(scale.y, 1e-6)),
          'important',
        );
      }
      if (Number.isFinite(left) && Number.isFinite(rect.left)) {
        child.style.setProperty(
          'left',
          finitePixel(left + (ownerRect.left + box.left * scale.x - rect.left) / Math.max(scale.x, 1e-6)),
          'important',
        );
      }
    }
  }
}

/** Apply source list box geometry and advances to the inert clone. */
export function freezeSnapshotListRows(
  sheet: HTMLElement,
  measured: readonly FrozenSnapshotList[] = measureSnapshotListRows(sheet),
): number {
  const lists = Array.from(sheet.querySelectorAll<HTMLElement>('ul, ol'));
  if (measured.some((list) => list.rows.some((row) => row.marker !== null))) {
    installSnapshotMarkerRules(sheet);
  }
  let frozen = 0;
  for (const listBox of measured) {
    const list = lists[listBox.listIndex];
    if (list === undefined) continue;
    const rows = Array.from(list.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.tagName === 'LI',
    );
    for (let index = 0; index < rows.length; index += 1) {
      const box = listBox.rows[index];
      if (
        box === undefined ||
        !Number.isFinite(box.height) ||
        !Number.isFinite(box.advance) ||
        box.height < 0 ||
        box.advance <= 0
      ) {
        continue;
      }
      const row = rows[index]!;
      row.style.setProperty('height', finitePixel(box.height), 'important');
      // Once height is explicit, the ruled paragraph's collapsed negative
      // tail no longer positions the following LI. Re-express the exact live
      // advance on the row itself while retaining its full marker box.
      row.style.setProperty(
        'margin-bottom',
        finitePixel(box.advance - box.height),
        'important',
      );
      row.style.setProperty('box-sizing', 'border-box', 'important');
      if (box.marker !== null) freezeSnapshotMarker(row, box.marker);
      frozen += 1;
    }
  }
  return frozen;
}

/** Apply source node-view child geometry to the inert clone. */
export function freezeSnapshotNodeViewGeometry(
  sheet: HTMLElement,
  measured: readonly FrozenSnapshotNodeView[] = measureSnapshotNodeViewGeometry(sheet),
): number {
  const prose = sheet.querySelector<HTMLElement>('.nb-prose');
  if (prose === null) return 0;
  const elements = proseElements(sheet);
  const scale = sheetScale(sheet);
  let frozen = 0;
  for (const ownerBox of measured) {
    const owner = elements[ownerBox.elementIndex];
    if (owner === undefined || !owner.classList.contains('nb-node-view')) continue;
    const children = Array.from(owner.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    owner.style.setProperty('position', 'relative', 'important');
    if (Number.isFinite(ownerBox.width) && ownerBox.width >= 0) {
      owner.style.setProperty('width', finitePixel(ownerBox.width), 'important');
    }
    if (Number.isFinite(ownerBox.height) && ownerBox.height >= 0) {
      owner.style.setProperty('height', finitePixel(ownerBox.height), 'important');
    }
    owner.style.setProperty('box-sizing', 'border-box', 'important');
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      const box = ownerBox.children[index];
      if (box === undefined || !validBox(box)) continue;
      child.style.setProperty('position', 'absolute', 'important');
      child.style.setProperty('inset', 'auto', 'important');
      child.style.setProperty('top', finitePixel(box.top), 'important');
      child.style.setProperty('left', finitePixel(box.left), 'important');
      child.style.setProperty('width', finitePixel(box.width), 'important');
      child.style.setProperty('height', finitePixel(box.height), 'important');
      child.style.setProperty('box-sizing', 'border-box', 'important');
      child.style.setProperty('margin', '0', 'important');
      frozen += 1;
    }
    correctVisualOrigins(owner, children, ownerBox.children, scale);
  }
  return frozen;
}

/** Apply exact atomic inline dimensions to the inert clone. */
export function freezeSnapshotInlineBoxes(
  sheet: HTMLElement,
  measured: readonly FrozenSnapshotInlineBox[] = measureSnapshotInlineBoxes(sheet),
): number {
  const elements = proseElements(sheet);
  let frozen = 0;
  for (const box of measured) {
    const element = elements[box.elementIndex];
    if (
      element === undefined ||
      !Number.isFinite(box.width) ||
      !Number.isFinite(box.height) ||
      box.width < 0 ||
      box.height < 0
    ) {
      continue;
    }
    element.style.setProperty('width', finitePixel(box.width), 'important');
    element.style.setProperty('height', finitePixel(box.height), 'important');
    element.style.setProperty('min-width', '0', 'important');
    element.style.setProperty('max-width', 'none', 'important');
    element.style.setProperty('box-sizing', 'border-box', 'important');
    element.style.setProperty('flex', 'none', 'important');
    if (box.singleLine) {
      // The used width can be only a fraction wider than the cloned text run
      // (Welcome's `Esc` has effectively zero spare room). The foreignObject
      // must not turn a source single-line atom into two lines just because
      // its font metrics round differently.
      element.style.setProperty('white-space', box.unwrappedWhiteSpace, 'important');
      element.style.setProperty('overflow-wrap', 'normal', 'important');
      element.style.setProperty('word-break', 'normal', 'important');
    }
    frozen += 1;
  }
  return frozen;
}

/** Freeze one inert sheet's top-level editor flow from a measured source. */
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
  prose.style.setProperty('position', 'relative', 'important');
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const box = boxes[index];
    if (box === undefined || !validBox(box)) continue;
    child.style.setProperty('position', 'absolute', 'important');
    child.style.setProperty('inset', 'auto', 'important');
    child.style.setProperty('top', finitePixel(box.top), 'important');
    child.style.setProperty('left', finitePixel(box.left), 'important');
    child.style.setProperty('width', finitePixel(box.width), 'important');
    child.style.setProperty('height', finitePixel(box.height), 'important');
    child.style.setProperty('box-sizing', 'border-box', 'important');
    child.style.setProperty('margin', '0', 'important');
  }
  correctVisualOrigins(prose, children, boxes, sheetScale(sheet));
  return boxes;
}
