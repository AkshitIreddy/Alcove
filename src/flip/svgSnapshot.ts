/**
 * src/flip/svgSnapshot.ts — make inline SVG survive an html-to-image capture.
 *
 * THE BUG THIS EXISTS FOR: html-to-image clones every HTML element by copying
 * its *computed* style onto the clone, which is why the rest of a page
 * rasterizes faithfully. It does not do that inside an `<svg>`: cloneNode()
 * deep-clones the whole SVG subtree in one go and returns early, so the
 * children arrive with their attributes but with none of the styling that
 * lived in a stylesheet. Our diagrams are styled entirely by class
 * (`.nb-dg-fill { fill: var(--paper-cream) }`, `.nb-dg-stroke { fill: none }`
 * in styles/diagrams.css), and an SVG shape with no fill declared does not
 * fall back to transparent — the initial value of `fill` is BLACK. A page
 * holding a tree or timeline therefore snapshotted as a mass of black blobs
 * and the turning page went dark. Measured, not guessed: capturing a
 * class-styled `<rect>` returned rgba(0,0,0,255) where cream was drawn.
 *
 * The paper-cream composite in curl.ts cannot save this one — those texels
 * are opaque black, not transparent.
 *
 * THE FIX: just before a capture, copy the resolved paint/text properties of
 * every element inside every `<svg>` onto its own inline style, and undo it
 * afterwards. Inline styles are attributes, so they survive the deep clone.
 * Same shape as the `.snapshotting` class the capture already toggles: the
 * live DOM is touched for the duration of the capture and restored in a
 * finally block.
 */

/**
 * Presentation properties an SVG child can inherit from a stylesheet. Paint,
 * dash pattern, text metrics — everything that changes what a shape looks
 * like. Deliberately NOT `transform`: it survives as an attribute on the deep
 * clone, and re-declaring the computed matrix inline reintroduces it under a
 * different transform-box, which moves the shape.
 */
const SVG_PAINT_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'paint-order',
  'color',
  'display',
  'visibility',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'vector-effect',
  'shape-rendering',
  'mix-blend-mode',
] as const;

/** One element's original inline style, so the DOM can be put back exactly. */
interface InlineStyleBackup {
  element: SVGElement;
  /** null = the element had no style attribute at all before we touched it. */
  cssText: string | null;
}

/**
 * Inline the resolved paint properties of every element inside every `<svg>`
 * under `root`. Returns a restore function; call it in a finally block.
 *
 * Cheap enough to run per capture (a few hundred getComputedStyle reads on a
 * diagram-heavy page) and a no-op on pages with no SVG at all, which is the
 * common case.
 */
export function inlineSvgStyles(root: HTMLElement): () => void {
  const svgs = root.querySelectorAll('svg');
  if (svgs.length === 0) return () => {};

  const backups: InlineStyleBackup[] = [];
  for (const svg of svgs) {
    // The <svg> root itself gets its computed style copied by html-to-image;
    // only its descendants are stranded, so start below it.
    for (const node of svg.querySelectorAll('*')) {
      if (!(node instanceof SVGElement)) continue;
      const computed = getComputedStyle(node);
      backups.push({
        element: node,
        cssText: node.hasAttribute('style') ? node.getAttribute('style') : null,
      });
      for (const prop of SVG_PAINT_PROPS) {
        const value = computed.getPropertyValue(prop);
        // An empty read means the engine does not expose that property here;
        // writing '' would clear a value the element already had inline.
        if (value !== '') node.style.setProperty(prop, value);
      }
    }
  }

  return () => {
    for (const { element, cssText } of backups) {
      if (cssText === null) element.removeAttribute('style');
      else element.setAttribute('style', cssText);
    }
  };
}
