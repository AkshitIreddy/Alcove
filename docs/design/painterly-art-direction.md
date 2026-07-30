# Painterly art direction — the reference-image standard

The user supplied a reference photograph/painting of a sunlit bookshelf overgrown with flowering vines and said, plainly, that our shelf next to it "looks very cheap… like something a child could make, not some talented artist."

This document is the corrective. **The target is a high-end digital painting**, not a diagram of a bookshelf. Every theme is held to this standard.

---

## 1. What the reference actually contains (and we lack)

Read the image concretely. These are the specific properties to reproduce:

### Books
| Reference | Ours (before) |
|---|---|
| Thickness ranges from ~8px slivers to ~45px tomes, wildly varied | Near-uniform widths |
| Heights vary by 20–30%; tops form an irregular skyline | Near-uniform heights |
| Some lean, some are pushed back, some pulled proud of the shelf edge | All flush, all upright |
| Visible page-block edges (cream, sometimes gilt) beside every spine | Spine only |
| Rich materials: cracked leather, ribbed cloth, marbled boards, foil | Flat fill + a band |
| Gold foil titles that *catch* the light, half-legible, some worn away | Uniform legible text |
| Raised horizontal bands casting their own tiny shadows | Painted lines |
| Deep colour range: oxblood, navy, forest, tan, cream, plum | Limited palette |

### Vines and flowers
| Reference | Ours (before) |
|---|---|
| Woody stems 3–6px thick, tapering, with visible direction | Hairline stems |
| Leaves 25–60px — **large**, overlapping, forming masses | Tiny scattered leaves |
| Leaves at many depths: some lit, some in shade, some silhouetted | One flat tone |
| Flowers in **clusters** of 5–15 blooms, 20–40px each, prominent | Sparse, tiny, incidental |
| Growth sits **in front of** books, breaking the shelf line, and drapes over edges | Confined behind |
| Foliage occupies ~35% of the frame | ~3% |

### Light and shadow (the biggest single gap)
- One clear directional key light (upper right) with warm colour temperature.
- **God rays / volumetric shafts** crossing the frame.
- **Hot spots**: surfaces facing the light are blown out toward white-gold.
- **Deep occlusion**: the back of the case falls to near-black; shelf undersides are dark.
- **Contact shadows**: every book casts onto its neighbour and onto the plank.
- **Rim light** on leaf and spine edges facing the source.
- Colour temperature *shifts* across the frame — warm in light, cool in shadow.
- Atmospheric depth: distant/recessed things lose contrast and gain haze.

Ours had flat ambient light, no cast shadows, no rim light, no temperature shift.

### Overall painterly qualities
- High contrast with genuinely dark darks — we were mid-tone everywhere.
- Colour bleeding between adjacent objects.
- Soft-focus falloff at frame edges.
- Texture at every scale; nothing is a flat fill.

---

## 2. The lighting & shadow system (new, shared by all themes)

Artistic, not physically accurate — the goal is beauty.

```ts
interface LightRig {
  keyAngle: number;        // direction of the sun/lamp
  keyColour: string;       // warm gold, cool moon, neon cyan…
  keyIntensity: number;
  fillColour: string;      // bounce light in shadow (usually the complement)
  ambientOcclusion: number;// how dark recesses go
  rimStrength: number;     // edge light on objects facing the key
  shafts: ShaftSpec[];     // volumetric rays: angle, width, softness, opacity
  temperatureShift: number;// warm→cool across the light gradient
  vignette: number;
  bloom: number;           // glow bleed from hot spots
}
```

Render order per floor: ambient base → AO in every recess and joint → cast shadows (books onto neighbours and planks, flora onto wood) → key light pass with hot spots → rim pass → light shafts → bloom → vignette → colour grade.

**Contact shadow rule:** every object that touches another casts a short, dark, soft-edged shadow at the contact point. This one addition does more for perceived quality than any other.

## 3. Book generation rebuilt

Per shelf, generate a *composition*, not a row: choose a rhythm of thick/thin, tall/short, leaning/upright, proud/recessed; cluster similar bindings then break the pattern; leave occasional gaps and stacked-flat books. Each book gets: page-block edge, material texture (cracked leather / ribbed cloth / marbled paper / vellum), raised bands with their own shadows, foil title with specular catch and partial wear, head/tail bands, corner bumping, and a cast shadow onto its neighbour.

## 4. Flora rebuilt

Thick tapering woody stems; large overlapping leaves (25–60px) in masses rather than sprinkles; three depth tiers (silhouette / mid / lit) with a rim pass on the lit tier; flower clusters of 5–15 blooms with visible centres and layered petals; growth allowed **in front of** books and draping over shelf edges — while still never covering a spine's title. Foliage should be a major compositional element.

## 5. Living motion (per theme)

Everything gently alive, GPU-cheap, respecting `--motion-scale`:
- **Blossom Grove** — leaves sway on a wind field, petals drift and settle, a butterfly crosses occasionally, light shafts breathe.
- **Robot Workshop** — a robot head turns and blinks, LEDs pulse, a gear rotates, steam puffs.
- **Dino Dig** — palm fronds sway, a tiny pterodactyl silhouette crosses the sky, dust motes in the light shaft.
- **Coral Reef** — kelp undulates, bubbles rise, caustic light ripples over everything, a fish darts past.
- **Candy Shop** — sugar sparkles twinkle, a lollipop slowly spins, gumballs settle.
- **Star Voyager** — stars twinkle, a comet crosses, planets rotate slowly, an aurora shifts.
- **Cottage / Athenaeum / others** — curtain stir, candle flicker, dust in the shaft, a cat's tail flicking.

Implement as a shared `ambientMotion` layer: a wind field driving vertex/sprite offsets, plus scheduled "events" (butterfly, comet, fish) that fire on a slow random timer.

## 6. How to work

Follow the `ambitious-implementation` skill: **write the long version**. A convincing painterly shelf is thousands of lines of layered passes, not hundreds. Then follow `visual-verification`: render, screenshot, *look*, and compare side by side against the reference — iterate until the gap closes.

The bar for "done": place our render next to the reference image and the difference should be *style*, not *skill*.
