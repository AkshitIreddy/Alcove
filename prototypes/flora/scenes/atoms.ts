/**
 * prototypes/flora/scenes/atoms.ts — the generated cut-out registry.
 *
 * Every file in `assets/atoms/` is imported (esbuild inlines each as a data
 * URI, see shoot.mjs) and decoded once at boot, so the harness can compare
 * generated leaves against painted ones without a server or a fetch.
 */

import berrySprig11 from '../../../assets/atoms/berry-sprig-v1-1.webp';
import daisy11 from '../../../assets/atoms/daisy-flower-v1-1.webp';
import daisy12 from '../../../assets/atoms/daisy-flower-v1-2.webp';
import daisy31 from '../../../assets/atoms/daisy-flower-v3-1.webp';
import fern21 from '../../../assets/atoms/fern-leaflet-v2-1.webp';
import fern22 from '../../../assets/atoms/fern-leaflet-v2-2.webp';
import fern31 from '../../../assets/atoms/fern-leaflet-v3-1.webp';
import fern32 from '../../../assets/atoms/fern-leaflet-v3-2.webp';
import fern33 from '../../../assets/atoms/fern-leaflet-v3-3.webp';
import grass11 from '../../../assets/atoms/grass-blade-v1-1.webp';
import grass12 from '../../../assets/atoms/grass-blade-v1-2.webp';
import rose11 from '../../../assets/atoms/rose-leaf-v1-1.webp';
import rose12 from '../../../assets/atoms/rose-leaf-v1-2.webp';
import rose13 from '../../../assets/atoms/rose-leaf-v1-3.webp';
import rose14 from '../../../assets/atoms/rose-leaf-v1-4.webp';
import rose15 from '../../../assets/atoms/rose-leaf-v1-5.webp';

import { registerFloraAtoms, type FloraAtomImage } from '../../../src/art/flora';

const SOURCES: Record<string, string> = {
  'berry-sprig-v1-1': berrySprig11,
  'daisy-flower-v1-1': daisy11,
  'daisy-flower-v1-2': daisy12,
  'daisy-flower-v3-1': daisy31,
  'fern-leaflet-v2-1': fern21,
  'fern-leaflet-v2-2': fern22,
  'fern-leaflet-v3-1': fern31,
  'fern-leaflet-v3-2': fern32,
  'fern-leaflet-v3-3': fern33,
  'grass-blade-v1-1': grass11,
  'grass-blade-v1-2': grass12,
  'rose-leaf-v1-1': rose11,
  'rose-leaf-v1-2': rose12,
  'rose-leaf-v1-3': rose13,
  'rose-leaf-v1-4': rose14,
  'rose-leaf-v1-5': rose15,
};

export async function loadAtoms(): Promise<void> {
  const out: Record<string, FloraAtomImage> = {};
  await Promise.all(
    Object.entries(SOURCES).map(async ([name, src]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      out[name] = { image: img, width: img.naturalWidth, height: img.naturalHeight };
    }),
  );
  registerFloraAtoms(out);
}
