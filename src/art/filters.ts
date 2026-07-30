/**
 * art/filters.ts — the three SVG filter recipes from the art-pipeline design
 * doc, as template functions of the bake scale S.
 *
 * Core rule (CLAUDE.md / art-pipeline.md): these filters are consumed
 * EXCLUSIVELY by art/bake.ts. They must never be attached to live DOM.
 *
 * Resolution scaling rule from the doc: parameter values in the recipes are
 * authored for a 1x bake. When baking a bucket at scale S, multiply every
 * baseFrequency by 1/S and every displacement scale by S so wobble amplitude
 * is resolution-independent. Other pixel-space lengths in the chains
 * (feMorphology radius, feGaussianBlur stdDeviation, feDiffuseLighting
 * surfaceScale) are scaled by S for the same reason — they are lengths in
 * device pixels, so leaving them fixed would thin the rim/relief at 2x.
 */

/** Format a number for XML output without exponent notation or noise. */
function fmt(n: number): string {
  return Number(n.toFixed(6)).toString();
}

/**
 * Pencil line filter (#pencil) — wobble + graphite grain eating into the
 * stroke. Recipe values at 1x: baseFrequency 0.035/0.06 (wobble) and 0.9
 * (grain), displacement scale 2.5.
 */
export function pencilFilter(s = 1): string {
  return (
    `<filter id="pencil" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(0.035 / s)} ${fmt(0.06 / s)}" numOctaves="4" seed="7" result="wobble"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="wobble" scale="${fmt(2.5 * s)}" xChannelSelector="R" yChannelSelector="G" result="disp"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(0.9 / s)}" numOctaves="2" seed="11" result="grain"/>` +
    `<feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.4 -0.15" result="grainA"/>` +
    `<feComposite in="disp" in2="grainA" operator="in"/>` +
    `</filter>`
  );
}

/**
 * Watercolor wash filter (#watercolor) — wobbly blob edge + classic
 * edge-darkening rim + pigment pooling. Recipe values at 1x: blob
 * baseFrequency 0.012/0.015, displacement scale 18, erode radius 4,
 * rim blur 1.4, pool baseFrequency 0.05.
 *
 * Granulation is deliberately NOT part of this chain — it is applied at
 * composite time from the shared 256² noise tile (see art/spines.ts).
 */
export function watercolorFilter(s = 1): string {
  return (
    `<filter id="watercolor" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(0.012 / s)} ${fmt(0.015 / s)}" numOctaves="3" seed="4" result="big"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="big" scale="${fmt(18 * s)}" result="blob"/>` +
    `<feMorphology in="blob" operator="erode" radius="${fmt(4 * s)}" result="inner"/>` +
    `<feComposite in="blob" in2="inner" operator="out" result="rim"/>` +
    `<feColorMatrix in="rim" type="matrix" values="0.62 0 0 0 0  0 0.62 0 0 0  0 0 0.62 0 0  0 0 0 0.85 0" result="rimDark"/>` +
    `<feGaussianBlur in="rimDark" stdDeviation="${fmt(1.4 * s)}" result="rimSoft"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(0.05 / s)}" numOctaves="2" seed="21" result="pool"/>` +
    `<feColorMatrix in="pool" type="matrix" values="0 0 0 0 0.85  0 0 0 0 0.85  0 0 0 0 0.85  0 0 0 0 1" result="poolTone"/>` +
    `<feBlend in="blob" in2="poolTone" mode="multiply" result="pooled"/>` +
    `<feComposite in="pooled" in2="blob" operator="in" result="body"/>` +
    `<feMerge><feMergeNode in="body"/><feMergeNode in="rimSoft"/></feMerge>` +
    `</filter>`
  );
}

/**
 * Paper tile filter (#paper) — Codrops-style lit fibre. Recipe values at 1x:
 * baseFrequency 0.04, 5 octaves, surfaceScale 1.6, distant light 45°/60°.
 * Baked once per DPR onto a flood rect; tinted afterwards with source-atop
 * (cream #f7f1e3 / aged #efe4cc) — see art/paper.ts.
 */
export function paperFilter(s = 1): string {
  return (
    `<filter id="paper">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${fmt(0.04 / s)}" numOctaves="5" result="n"/>` +
    `<feDiffuseLighting in="n" lighting-color="#f7f1e3" surfaceScale="${fmt(1.6 * s)}">` +
    `<feDistantLight azimuth="45" elevation="60"/>` +
    `</feDiffuseLighting>` +
    `</filter>`
  );
}

/**
 * Wrap art + defs into a self-contained SVG document string suitable for
 * blob-URL loading in art/bake.ts. Bake inputs must be self-contained — no
 * external references (fonts, images) other than inline data URIs.
 */
export function svgDoc(w: number, h: number, inner: string, defs = ''): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}" height="${fmt(h)}" viewBox="0 0 ${fmt(w)} ${fmt(h)}">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    inner +
    `</svg>`
  );
}
