# Art bible — the single source of truth

Every visual decision in this app answers to this document. It is derived from the user's own analysis of the reference image (`reference/bookshelf-reference.png`), which is the clearest statement of the target we have.

---

## The thesis

> *"This image succeeds because it is not simply depicting a bookshelf — it creates an atmosphere… an old library that has been peacefully reclaimed by nature. Nothing feels accidental, yet nothing feels artificially perfect either."*

We are not rendering a bookcase. We are creating **one cohesive feeling**, and every element must serve it: *knowledge preserved over time while nature slowly reclaims the space.* Books are history. Aged wood is decades of use. Vines are time passing. Flowers are life and renewal. Warm sunlight makes it hopeful rather than abandoned.

A feature that does not reinforce that feeling is decoration, and decoration is what makes the current build read as cheap.

---

## 1. Composition — a journey, not a focal point

- **Horizontal shelf lines** give structure and stability; **vertical vine movement** stops it feeling rigid.
- The eye should travel a circuit: across the books → up the vines → down through the flowers → back.
- **No single overwhelming focal point.** Guide the viewer through the whole scene.

## 2. Visual hierarchy — brightness leads

Order of attention: **brightest sunlit region → the illuminated books → the vines → flower clusters → the dark surrounds.** Build the scene so that order is inevitable.

## 3. Lighting — the largest contributor

- Warm, soft, **directional from the upper right**.
- **Selective, never even**: it picks out important areas and lets the rest fall into soft shadow.
- **Shadows are never pure black** — they hold warm tone and reflected bounce. This is the difference between "physically believable" and "digitally rendered".
- Backlit foliage glows (light passing *through* leaves); bloom haloes hot spots.
- Deep occlusion exists so the glow has something to sing against — but it is *warm* dark, not dead black.

## 4. Materials — history you can read

- Wood: visible grain, **softened edges**, slight wear — the impression of decades of use.
- **Books must never repeat.** Every volume differs in height, thickness, colour, texture, binding, embossing and degree of ageing. Some leather, some cloth, some faded, some polished, some heavily worn.
- These variations are what convince the brain each object *has its own history*.

## 5. Controlled randomness — no visible repetition

> *"Leaves vary in size and orientation. Books are never evenly spaced. Flowers appear in natural clusters rather than in decorative patterns. Nothing feels duplicated or stamped."*

This is the defining trait of high-quality environment art, and it is where our current build fails hardest: identical vine sprigs at mechanical spacing, uniform book widths, evenly distributed foliage. **Every repeated element must vary in scale, rotation, tone and condition, and be placed by natural clustering rather than even distribution.**

## 6. Vegetation — believable growth

Vines must **originate from plausible places**, climb *around* shelves, wrap gently around books, and continue beyond the frame. Growth that decorates empty space reads as stickers. Growth with a source, a path and an exit reads as life.

## 7. Colour harmony — restraint is what makes colour sing

> *"The palette is intentionally restrained. Warm browns dominate… Flowers introduce small accents… these colors occupy only a tiny percentage of the image. Because bright colors are used sparingly, every flower becomes visually meaningful instead of contributing to clutter."*

**This resolves the tension in the brief.** The user asked for "very very colorful", and also praised this restrained palette. Both are true, and the reconciliation is:

> **Vividness comes from CONTRAST and SELECTIVE saturation, not global saturation.**

The flowers in the reference are intensely vivid *because* they sit in a field of warm browns and greens. Saturating everything would destroy the very effect that makes them beautiful. So: dominant warm neutrals, rich greens for contrast, and small deliberate accents of pink/white/blue/red that carry all the chroma. Never a uniformly bright scene — that is what made our pastel wallpaper look cheap.

## 8. Detail and rest

Nearly every object carries intricate texture, yet the image never feels noisy: **high-detail areas are balanced by darker, quieter regions where the eye rests.** Do not texture everything equally.

## 9. Depth through overlapping layers

Foreground **flowers** → midground **vines** → subject **books** → structural **shelves** → dark **recesses**. Real overlap between layers is what produces the sense of physical space.

## 10. Restraint

Enough books to suggest abundance without crowding. Enough plants to say nature without hiding the library. Enough flowers for colour without domination. When in doubt, less.

---

## How this translates to our pipeline

| Bible principle | Where it is implemented |
|---|---|
| Lighting is the atmosphere | **superseded.** The deferred pass (`src/art/lighting.ts` + `src/render/`) is deleted. The flat language has no lights: depth is a darker flat face beside a lighter one, plus `flat.contactShadow()` where an object meets a surface |
| Materials with history | **superseded.** Photoreal generation is gone; a material now shows in the silhouette and dressing (cords, round back, gilt), never in a simulated surface |
| Books never repeat | procedural composition: per-book size, lean, wear, binding, foil, fade |
| Controlled randomness | seeded jitter on every repeated element; clustered placement, never even spacing |
| Believable growth | flora anchored to plausible origins, paths that wrap and exit frame |
| Restrained palette | theme value structure first, chroma concentrated in small accents |
| Detail and rest | LOD and deliberate quiet zones; do not texture every surface equally |
| Overlapping depth | render order with foliage genuinely in front of books, not only behind |

**Acceptance test for any visual change:** put the render beside the reference. Does it tell the same story with the same restraint? If it merely has similar objects in it, it has failed.
