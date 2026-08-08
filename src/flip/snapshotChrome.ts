/**
 * Browser-owned chrome cannot be cloned faithfully by html-to-image.
 *
 * Chromium paints scrollbars through `::-webkit-scrollbar*` pseudo-elements.
 * html-to-image copies computed styles from ordinary DOM nodes, but those
 * browser pseudo-elements never become nodes in its foreignObject. A table
 * therefore wears Alcove's paper-coloured pill at rest and a platform-default
 * bar for the duration of a page turn.
 *
 * Replace only overflowing table scrollbars with ordinary, absolutely
 * positioned DOM while a page is being photographed. The replacement is
 * built from resolved app tokens, preserves the current thumb position, and
 * is removed immediately after capture. Offscreen sheets are owned by the
 * snapshot pipeline; the mounted fallback receives the same reversible seam.
 */

const TABLE_SELECTOR = '.nb-prose .tableWrapper';
const FAUX_SCROLLBAR_ATTRIBUTE = 'data-nb-snapshot-scrollbar';
const SCROLLBAR_HEIGHT_PX = 12;
const SCROLLBAR_BORDER_PX = 3;
const MIN_THUMB_PX = 24;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolvedColor(
  root: HTMLElement,
  token: string,
  fallback: string,
): string {
  const probe = root.ownerDocument.createElement('span');
  probe.style.cssText =
    `position:absolute;visibility:hidden;pointer-events:none;color:var(${token});`;
  root.append(probe);
  try {
    const color = getComputedStyle(probe).color;
    return color === '' ? fallback : color;
  } finally {
    probe.remove();
  }
}

/**
 * Install clone-safe table scrollbar chrome and return an exact restoration.
 */
export function prepareSnapshotTableChrome(root: HTMLElement): () => void {
  const paper = resolvedColor(root, '--paper-cream', 'rgb(247, 241, 227)');
  const edge = resolvedColor(root, '--paper-edge', 'rgb(205, 185, 145)');
  const restores: Array<() => void> = [];

  for (const wrapper of root.querySelectorAll<HTMLElement>(TABLE_SELECTOR)) {
    if (wrapper.querySelector(`[${FAUX_SCROLLBAR_ATTRIBUTE}]`) !== null) continue;

    const viewport = finitePositive(wrapper.clientWidth, wrapper.getBoundingClientRect().width);
    const content = finitePositive(wrapper.scrollWidth, viewport);
    const previousCss = wrapper.style.cssText;
    const previousScrollLeft = wrapper.scrollLeft;
    const rect = wrapper.getBoundingClientRect();

    // Do this even when the source fits. The foreignObject clone can acquire
    // a one-pixel overflow from rounded computed widths/font metrics and then
    // invent a platform scrollbar that never existed in the live page.
    wrapper.style.setProperty('position', 'relative', 'important');
    wrapper.style.setProperty('overflow-x', 'hidden', 'important');
    wrapper.style.setProperty('scrollbar-width', 'none', 'important');
    wrapper.style.setProperty('box-sizing', 'border-box', 'important');
    wrapper.style.setProperty('height', `${rect.height.toFixed(3)}px`, 'important');

    if (content <= viewport + 0.5) {
      restores.push(() => {
        wrapper.style.cssText = previousCss;
        wrapper.scrollLeft = previousScrollLeft;
      });
      continue;
    }

    const trackWidth = Math.max(viewport, 1);
    const thumbWidth = Math.min(
      trackWidth,
      Math.max(MIN_THUMB_PX, trackWidth * (viewport / content)),
    );
    const travel = Math.max(trackWidth - thumbWidth, 0);
    const scrollRange = Math.max(content - viewport, 1);
    const thumbLeft = travel * Math.min(Math.max(previousScrollLeft / scrollRange, 0), 1);

    const track = root.ownerDocument.createElement('span');
    track.setAttribute(FAUX_SCROLLBAR_ATTRIBUTE, '');
    track.setAttribute('aria-hidden', 'true');
    track.style.cssText = [
      'position:absolute',
      'left:0',
      'right:0',
      'bottom:0',
      `height:${SCROLLBAR_HEIGHT_PX}px`,
      'display:block',
      'pointer-events:none',
      'z-index:4',
      'background:transparent',
      'box-sizing:border-box',
    ].join(';');

    const thumb = root.ownerDocument.createElement('span');
    thumb.style.cssText = [
      'position:absolute',
      `left:${thumbLeft.toFixed(3)}px`,
      'top:0',
      `width:${thumbWidth.toFixed(3)}px`,
      `height:${SCROLLBAR_HEIGHT_PX}px`,
      'display:block',
      `background:${edge}`,
      'border-style:solid',
      `border-width:${SCROLLBAR_BORDER_PX}px`,
      `border-color:${paper}`,
      'border-radius:999px',
      'box-sizing:border-box',
    ].join(';');
    track.append(thumb);
    wrapper.append(track);

    restores.push(() => {
      track.remove();
      wrapper.style.cssText = previousCss;
      wrapper.scrollLeft = previousScrollLeft;
    });
  }

  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) {
      restores[index]!();
    }
  };
}
