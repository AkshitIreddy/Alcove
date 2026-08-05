// @vitest-environment node
/**
 * tests/art-themes.test.ts — the library colour schemes (src/art/themes.ts).
 *
 * A theme used to be a whole art package: wood grain and ring gamma, joinery,
 * cornice carving, rail inlay, plate material, wallpaper × colourway, a wall
 * finish, a light rig, flora, props, motes. The suite that guarded it asserted
 * over all of that — fourteen complete packages, distinct carpentry vocabulary,
 * 144 wallpaper combinations — and every one of those assertions was true of
 * data that drew nothing, because the flat restyle bakes one case out of a
 * fixed set of shapes.
 *
 * What is worth guarding now is much smaller, and actually load-bearing:
 *   - a theme is a name, a blurb and a colour scheme, and nothing else
 *   - the default room is exactly the palette `art/flat.ts` hard-codes
 *   - every scheme keeps the one brown ink legible, and keeps its own layers
 *     ordered (wall lightest → timber → turned face → recess)
 *   - schemes are genuinely different from each other, not one room retinted
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_ID,
  FEATURED_THEME_IDS,
  THEMES,
  THEME_FAMILIES,
  THEME_IDS,
  THEME_TAGS,
  allThemes,
  getTheme,
  isThemeId,
  themesInFamily,
  type ColourScheme,
  type LibraryTheme,
} from '../src/art/themes';
import { INK_FLOOR, caseFaces, clothPair, lum as paletteLum, toOklch } from '../src/art/palette';
import {
  CLOTHS,
  FLAT,
  HOUSE_CLOTHS,
  flatSchemeTag,
  setFlatScheme,
  type FlatCtx,
} from '../src/art/flat';
import {
  drawCrown,
  drawPlank,
  drawPost,
  drawRecess,
  drawSpine,
  flatSpineFor,
} from '../src/art/flatShelf';

const themes = allThemes();

/** `#rgb` / `#rrggbb` → channels. */
function parseHex(hex: string): { r: number; g: number; b: number } {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Perceived brightness, 0–255. */
function lum(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Every hex in a scheme, flattened. */
function colours(scheme: ColourScheme): readonly string[] {
  return [scheme.timber, scheme.timberDark, scheme.recess, scheme.wall, ...scheme.cloths.flat()];
}

/* ================================ identity =============================== */

describe('theme registry', () => {
  it('ships a real library, and offers every room in it', () => {
    // Four was the old ceiling and the wrong one: three of the four were warm
    // wood, so "change the room" changed the lighting. The floor here is the
    // brief ("at least 50"), not the exact count — adding a room should not
    // have to come and edit a number.
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(THEME_IDS).size, 'a duplicated id').toBe(THEME_IDS.length);
    // No "shipped subset": ten rooms that existed only as data were exactly
    // the promise the colour-only pass came to stop making.
    expect(themes.map((t) => t.id)).toEqual([...THEME_IDS]);
  });

  it('keys every theme by its own id', () => {
    for (const id of THEME_IDS) expect(THEMES[id].id).toBe(id);
  });

  it('opens a brand-new library in a room with a decision in it', () => {
    // Still deliberately NOT the icon's oak — that is the house FALLBACK, the
    // beige-on-beige case every stock bookshelf illustration is — but the
    // opening room is now a timber rather than a painted one, because the
    // reader asked for "a dark brown shelf" and no amount of paint is that.
    //
    // The id is pinned rather than described because "has a decision in it" is
    // not a property a test can read off a hex — it was decided by
    // photographing six browns on the opening carpentry
    // (`shots-now/hero/board-case2.png`). Moving it is a deliberate act and
    // should have to come and say so here.
    expect(DEFAULT_THEME_ID).toBe('walnut');
    expect(THEMES[DEFAULT_THEME_ID].name).toBe('English Walnut');
    // A timber, and a DARK one: the tags are what the derived house-room card
    // is filed by, and a light timber here would file the refectory case under
    // the wrong family (see DEFAULT_SHELF_DESIGN).
    expect(THEMES[DEFAULT_THEME_ID].family).toBe('timber');
    expect(THEMES[DEFAULT_THEME_ID].tags).toContain('dark');
    // Nothing is lost: all three former defaults are rooms like any other.
    expect(THEMES.athenaeum.name).toBe('Old Athenaeum');
    expect(THEMES.verdigris.name).toBe('Verdigris Library');
    expect(THEMES.lapis.name).toBe('Lapis Cabinet');
  });

  it('offers a spread as the featured few, default and house oak included', () => {
    for (const id of FEATURED_THEME_IDS) expect(isThemeId(id)).toBe(true);
    expect(FEATURED_THEME_IDS).toContain(DEFAULT_THEME_ID);
    expect(FEATURED_THEME_IDS).toContain('athenaeum');
    // A strip that showed eight timbers would advertise the wrong library.
    const families = new Set(FEATURED_THEME_IDS.map((id) => THEMES[id].family));
    expect(families.size).toBeGreaterThanOrEqual(4);
  });

  it('falls back to the default room for junk and for retired ids', () => {
    expect(getTheme(null).id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(undefined).id).toBe(DEFAULT_THEME_ID);
    expect(getTheme('not-a-room').id).toBe(DEFAULT_THEME_ID);
    // A library saved in one of the ten retired rooms still opens.
    expect(getTheme('sakura').id).toBe(DEFAULT_THEME_ID);
    // …and one saved in any of the four rooms that ever shipped opens THERE.
    for (const id of ['athenaeum', 'blossom', 'reef', 'apothecary']) {
      expect(getTheme(id).id, `${id} no longer loads`).toBe(id);
    }
  });

  it('narrows persisted values', () => {
    expect(isThemeId('reef')).toBe(true);
    expect(isThemeId('REEF')).toBe(false);
    expect(isThemeId('sakura')).toBe(false);
    expect(isThemeId(7)).toBe(false);
  });
});

describe('the picker can group and steer', () => {
  it('puts every room on exactly one shelf, and none of them empty', () => {
    for (const family of THEME_FAMILIES) {
      expect(themesInFamily(family).length, `${family} is empty`).toBeGreaterThan(0);
    }
    const counted = THEME_FAMILIES.reduce((n, f) => n + themesInFamily(f).length, 0);
    expect(counted).toBe(themes.length);
  });

  it('tags every room out of one closed vocabulary', () => {
    for (const theme of themes) {
      expect(theme.tags.length, `${theme.id} is untagged`).toBeGreaterThanOrEqual(2);
      for (const tag of theme.tags) {
        expect(THEME_TAGS, `${theme.id} invents the tag "${tag}"`).toContain(tag);
      }
    }
  });

  it('never ships a mood word only one or two rooms answer to', () => {
    // The words are offered as a way to STEER the dice (`withMood` in
    // views/rail/designOptions.ts). A tag two rooms carry is not a mood, it is
    // a preset with extra steps.
    for (const tag of THEME_TAGS) {
      const carried = themes.filter((t) => (t.tags as readonly string[]).includes(tag));
      expect(carried.length, `"${tag}" is carried by ${carried.length} rooms`).toBeGreaterThanOrEqual(4);
    }
  });
});

/* =============================== the shape =============================== */

describe('a theme is a colour scheme and nothing else', () => {
  it.each(themes.map((t) => [t.id, t] as const))('%s carries a name, blurb and scheme', (_id, theme) => {
    expect(theme.name.length).toBeGreaterThan(2);
    expect(theme.blurb.length).toBeGreaterThan(10);
    for (const hex of colours(theme.scheme)) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('carries no field the flat case cannot honour', () => {
    // The named survivors are the room's identity plus the one bridge into the
    // spine pipeline. Anything else that reappears here is a knob describing
    // art that is not drawn — which is the whole failure mode this pass fixed.
    for (const theme of themes) {
      // `family` and `tags` are the only two additions since, and both are
      // CONSUMED rather than decorative: the family groups the picker, the
      // tags narrow the dice. Neither is drawn, and nothing else may join
      // them — a field describing art nobody renders is the failure mode.
      expect(Object.keys(theme).sort()).toEqual([
        'blurb',
        'family',
        'id',
        'name',
        'scheme',
        'spineDefaults',
        'tags',
      ]);
      expect(Object.keys(theme.scheme).sort()).toEqual([
        'cloths',
        'recess',
        'timber',
        'timberDark',
        'wall',
      ]);
    }
  });

  it('gives every room the same six cloth slots', () => {
    // A book picks its cloth by `seed % cloths.length`; a room with a different
    // count would silently re-roll the binding of every book on the shelf.
    for (const theme of themes) {
      expect(theme.scheme.cloths).toHaveLength(6);
      for (const pair of theme.scheme.cloths) expect(pair).toHaveLength(2);
    }
  });

  it('offers new books the room’s own cloths, dressed the same everywhere', () => {
    const dressing = (t: LibraryTheme): string =>
      JSON.stringify([t.spineDefaults.materials, t.spineDefaults.gilt, t.spineDefaults.bands, t.spineDefaults.wear]);
    for (const theme of themes) {
      expect(theme.spineDefaults.pigments).toEqual(theme.scheme.cloths.map(([face]) => face));
      // Material, gilt, banding and wear are dressing, not colour: one option
      // for each, shared by every room.
      expect(dressing(theme)).toBe(dressing(themes[0] as LibraryTheme));
    }
  });
});

/* ============================ the flat contract =========================== */

describe('the default room is the flat palette', () => {
  it('spells out exactly what art/flat.ts hard-codes', () => {
    // `art/flat.ts` starts every draw in its own colours; the default theme has
    // to BE those colours, or picking the room you are already in would repaint
    // the shelf. Edit one and this fails until the other follows.
    const s = THEMES.athenaeum.scheme;
    expect(s.timber).toBe(FLAT.timber);
    expect(s.timberDark).toBe(FLAT.timberDark);
    expect(s.recess).toBe(FLAT.recess);
    expect(s.wall).toBe(FLAT.wall);
    // Against HOUSE_CLOTHS, not CLOTHS. A room carries exactly six cloths; the
    // house palette grew to fifty so a pigment name can mean what it says. The
    // six the icon established are still the first six of both, and those are
    // what "the default room IS the flat palette" is claiming.
    expect(s.cloths.map(([a, b]) => [a, b])).toEqual(
      HOUSE_CLOTHS.map(([a, b]) => [a, b]),
    );
    expect(CLOTHS.slice(0, HOUSE_CLOTHS.length)).toEqual(HOUSE_CLOTHS);
  });
});

describe('every scheme is drawable in the one ink', () => {
  it('keeps the wall lightest, then the timber, its turned face, then the recess', () => {
    for (const theme of themes) {
      const s = theme.scheme;
      expect(lum(s.wall), `${theme.id} wall`).toBeGreaterThan(lum(s.timber));
      expect(lum(s.timber), `${theme.id} timber`).toBeGreaterThan(lum(s.timberDark));
      expect(lum(s.timberDark), `${theme.id} recess`).toBeGreaterThan(lum(s.recess));
    }
  });

  it('never goes so dark that the one ink outline stops reading', () => {
    // FLAT.ink is the same brown on every shape in every room. That is most of
    // why the app reads as one drawing, and it is also a floor under how dark a
    // scheme may go — an outline that has sunk into its own fill is not a style
    // choice, it is a shape that has stopped having an edge. Hence no midnight
    // room, however much a Moonlit Observatory wanted to be one.
    const floor = lum(FLAT.ink) + 15;
    for (const theme of themes) {
      for (const hex of colours(theme.scheme)) {
        expect(lum(hex), `${theme.id} ${hex} is darker than the ink can survive`).toBeGreaterThan(
          floor,
        );
      }
    }
  });

  it('turns every cloth face away into a genuinely darker edge', () => {
    for (const theme of themes) {
      for (const [face, dark] of theme.scheme.cloths) {
        expect(lum(face) - lum(dark), `${theme.id} ${face}`).toBeGreaterThan(10);
      }
    }
  });
});

/* ============================== the joinery ============================== */

/** Shortest way round the hue circle, in degrees. */
function hueGap(a: string, b: string): number {
  const d = Math.abs(toOklch(a).h - toOklch(b).h) % 360;
  return d > 180 ? 360 - d : d;
}

describe('a board folds instead of ending', () => {
  // The reported bug, in one word: "the area that connects different parts
  // looks unnatural". Where a shelf's top surface meets its front edge, or an
  // upright's face meets its turned side, the flat style has nothing but a
  // colour step to say "same board, turning". Hand-mixed steps wander in hue
  // and the seam reads as two objects butted together.

  it('keeps every face of a room on the same hue', () => {
    for (const theme of themes) {
      const s = theme.scheme;
      // The icon itself turns 7.9 degrees between its timber and its recess,
      // and that is the most any room may wander. Past this the case stops
      // being one piece of furniture.
      expect(hueGap(s.timber, s.timberDark), `${theme.id} face`).toBeLessThanOrEqual(12);
      expect(hueGap(s.timber, s.recess), `${theme.id} recess`).toBeLessThanOrEqual(12);
    }
  });

  it('keeps the inside of the case clearly darker than its front', () => {
    // Not merely "darker" — the layering test above already has that, and it
    // passed while four rooms had a recess sitting one step off their timber.
    for (const theme of themes) {
      const s = theme.scheme;
      expect(lum(s.timber) - lum(s.recess), `${theme.id} has no depth`).toBeGreaterThan(28);
      expect(lum(s.timber) - lum(s.timberDark), `${theme.id} has no fold`).toBeGreaterThan(14);
    }
  });

  it('keeps every recess bright enough for the one ink to read on it', () => {
    // `INK_FLOOR` is much higher than the bare legibility floor asserted
    // further up, and it is where it is because a specimen board showed the
    // difference: at the old floor a dark bookcase was a brown smear with its
    // carpentry only implied.
    for (const theme of themes) {
      expect(paletteLum(theme.scheme.recess), `${theme.id} recess`).toBeGreaterThanOrEqual(
        INK_FLOOR - 2,
      );
    }
  });

  it('derives the same faces every time it is asked', () => {
    // These hexes reach the bake cache key (`libraryKey.ts`), which validates
    // nothing about a hit. A derivation that wobbled would serve one room's
    // baked case art in another for the rest of the session.
    for (const timber of ['#c08a52', '#3f8a7d', '#2f7f8c', '#e6cf8a', '#6a615c']) {
      expect(caseFaces(timber)).toEqual(caseFaces(timber));
    }
    expect(clothPair('#c96f4a')).toEqual(clothPair('#c96f4a'));
  });

  it('lifts a room authored darker than the ink can carry, rather than clipping it', () => {
    // Ask for near-black and you get the darkest the app can draw with an
    // outline still on it — WITH a fold, not three colours on the floor.
    const faces = caseFaces('#100c08');
    expect(paletteLum(faces.recess)).toBeGreaterThanOrEqual(INK_FLOOR - 2);
    expect(lum(faces.timber) - lum(faces.recess)).toBeGreaterThan(28);
    expect(hueGap(faces.timber, faces.recess)).toBeLessThanOrEqual(12);
  });
});

/* ============================== distinctness ============================= */

describe('no two rooms are the same room retinted', () => {
  it('shares no case colour between rooms', () => {
    const cases = themes.map((t) => [t.scheme.timber, t.scheme.recess, t.scheme.wall].join('|'));
    expect(new Set(cases).size).toBe(themes.length);
  });

  it('moves the case a visible distance between any two rooms', () => {
    const dist = (a: string, b: string): number => {
      const p = parseHex(a);
      const q = parseHex(b);
      return Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b);
    };
    for (let i = 0; i < themes.length; i++) {
      for (let j = i + 1; j < themes.length; j++) {
        const a = themes[i] as LibraryTheme;
        const b = themes[j] as LibraryTheme;
        const moved =
          dist(a.scheme.timber, b.scheme.timber) +
          dist(a.scheme.recess, b.scheme.recess) +
          dist(a.scheme.wall, b.scheme.wall);
        expect(moved, `${a.id} vs ${b.id} barely move`).toBeGreaterThan(60);
      }
    }
  });

  it('never ships a drab cloth palette', () => {
    /** Chroma proxy: how far apart the RGB channels are, 0 = grey. */
    const chroma = (hex: string): number => {
      const { r, g, b } = parseHex(hex);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    for (const theme of themes) {
      const faces = theme.scheme.cloths.map(([face]) => face);
      const mean = faces.reduce((sum, f) => sum + chroma(f), 0) / faces.length;
      expect(mean, `${theme.id} cloths are washed out`).toBeGreaterThan(40);
      expect(Math.max(...faces.map(chroma)), `${theme.id} has no hero colour`).toBeGreaterThan(70);
    }
  });

  it('gives every room six distinct cloths', () => {
    for (const theme of themes) {
      const faces = theme.scheme.cloths.map(([face]) => face);
      expect(new Set(faces).size, `${theme.id} repeats a cloth`).toBe(faces.length);
    }
  });
});

/* ======================= the scheme reaches the pixels ==================== */

/**
 * A recording 2D context.
 *
 * Every drawing call is a no-op; the only thing kept is the sequence of
 * `fillStyle` values the code assigned. That is enough to prove which palette a
 * draw actually read, which is the whole question here, and it runs in plain
 * Node — the suite has no canvas.
 */
function recorder(): { ctx: FlatCtx; fills: string[] } {
  const fills: string[] = [];
  let fill = '';
  const noop = (): void => undefined;
  const ctx = {
    get fillStyle(): string {
      return fill;
    },
    set fillStyle(v: string) {
      fill = v;
      fills.push(v);
    },
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'round',
    globalAlpha: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    clip: noop,
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    fillText: noop,
  } as unknown as FlatCtx;
  return { ctx, fills };
}

describe('picking a room actually repaints it', () => {
  // The point of the whole colour-scheme design. Every one of these was a
  // hard-coded `FLAT.*` read before, which is why four "different" rooms all
  // baked a byte-identical case and the picker only appeared to work.
  const cases: readonly { name: string; draw: () => void; of: (s: ColourScheme) => string }[] = [
    { name: 'plank', draw: () => drawPlank(recording.ctx, 0, 0, 200, 20), of: (s) => s.timber },
    { name: 'post', draw: () => drawPost(recording.ctx, 0, 0, 20, 200), of: (s) => s.timber },
    { name: 'recess', draw: () => drawRecess(recording.ctx, 0, 0, 200, 200), of: (s) => s.recess },
    { name: 'crown', draw: () => drawCrown(recording.ctx, 0, 0, 300, 24), of: (s) => s.timber },
  ];

  let recording = recorder();

  afterEach(() => setFlatScheme(null));

  for (const { name, draw, of } of cases) {
    it(`draws the ${name} in the room's own colours`, () => {
      for (const theme of themes) {
        recording = recorder();
        setFlatScheme(theme.scheme);
        draw();
        expect(recording.fills, `${theme.id} ${name}`).toContain(of(theme.scheme));
      }
    });
  }

  it('does NOT repaint a book when the room changes', () => {
    // The counterpart to the cases above, and the reason `spine` is not one of
    // them. A room owns the case and the wall; a book owns itself. Books that
    // all recoloured together were books you had to re-learn every time you
    // redecorated, which defeats the point of recognising a spine.
    const seen = new Set<string>();
    for (const theme of themes) {
      recording = recorder();
      setFlatScheme(theme.scheme);
      drawSpine(recording.ctx, 0, 0, 30, 200, flatSpineFor(0));
      seen.add(recording.fills.join('|'));
    }
    expect(seen.size, 'the same book drew differently in different rooms').toBe(1);
  });

  it('restores the house palette when the scheme is cleared', () => {
    setFlatScheme(THEMES.reef.scheme);
    setFlatScheme(null);
    recording = recorder();
    drawRecess(recording.ctx, 0, 0, 100, 100);
    expect(recording.fills).toContain(FLAT.recess);
  });
});

/* ============================== the cache tag ============================= */

/**
 * One single-colour edit to a room, and the name of the thing it edits.
 *
 * `field` is the key it belongs to and exists only so the table can be proved
 * COMPLETE — a seventh colour added to a scheme has to arrive here, and fails
 * below until it does. `what` is what a failure says out loud, because "the tag
 * did not move" is useless and "cloths[3] turned edge left the cache tag" is the
 * whole diagnosis.
 *
 * Typed in `ColourScheme` rather than `FlatScheme` because that is what a theme
 * hands over; the two are structurally identical on purpose (see the header of
 * `FlatScheme`), which is what lets a room be set without either module
 * importing the other.
 */
interface Nudge {
  readonly field: keyof ColourScheme;
  readonly what: string;
  readonly apply: (scheme: ColourScheme) => ColourScheme;
}

/**
 * The same hex, moved somewhere it cannot coincidentally already be.
 *
 * Every digit changes: `0` becomes `1`, and anything that is not `0` becomes
 * `0`. Borrowing a second authored room's colours would read better and would
 * also quietly make this test depend on no two of the sixty rooms sharing a
 * wall — a property nothing guarantees, and one whose failure would look like a
 * cache bug rather than like a coincidence. The tag is a function of strings;
 * it does not care that `#101011` is not a colour anybody would paint a shelf.
 */
function elsewhere(hex: string): string {
  return `#${hex.slice(1).replace(/./g, (c) => (c === '0' ? '1' : '0'))}`;
}

/** Every field of a scheme, one at a time — both halves of all six cloths. */
const NUDGES: readonly Nudge[] = [
  { field: 'timber', what: 'timber', apply: (s) => ({ ...s, timber: elsewhere(s.timber) }) },
  {
    field: 'timberDark',
    what: 'timberDark (the board turning away)',
    apply: (s) => ({ ...s, timberDark: elsewhere(s.timberDark) }),
  },
  { field: 'recess', what: 'recess', apply: (s) => ({ ...s, recess: elsewhere(s.recess) }) },
  { field: 'wall', what: 'wall', apply: (s) => ({ ...s, wall: elsewhere(s.wall) }) },
  // Both halves, not just the face. `tagOf` spreads `cloths.flat()`, so a
  // rewrite to `cloths.map(([face]) => face)` would drop six hexes and still
  // look like it carried the cloths — and every turned spine band in the room
  // would come back off the cache in the previous room's colour.
  ...([0, 1, 2, 3, 4, 5] as const).flatMap((slot) =>
    ([0, 1] as const).map(
      (half): Nudge => ({
        field: 'cloths',
        what: `cloths[${slot}] ${half === 0 ? 'face' : 'turned edge'}`,
        apply: (s) => ({
          ...s,
          cloths: s.cloths.map((pair, i) =>
            i === slot
              ? ((half === 0
                  ? [elsewhere(pair[0]), pair[1]]
                  : [pair[0], elsewhere(pair[1])]) as readonly [string, string])
              : pair,
          ),
        }),
      }),
    ),
  ),
];

describe('the room’s cache tag carries every colour in it', () => {
  /**
   * `flatSchemeTag()` is what every memo holding drawn pixels keys on — the
   * case parts through `art/bake.ts`, the wallpaper tile, the cover data-url.
   * A cache validates nothing about a hit, so a colour missing from the tag is
   * not one wrong picture: it is one room's art served in another for the rest
   * of the session, to everybody who already has the right art filed under that
   * key, with nothing logged and nothing to notice.
   *
   * **What stood here could not fail.** It was a sweep — tag all sixty rooms,
   * expect sixty distinct tags — and every one of the sixty differs in its CASE
   * colours, so a `tagOf` reading nothing but timber/timberDark/recess/wall is
   * still injective over them. That is not hypothetical. Delete
   * `...scheme.cloths.flat()` from `tagOf` in `src/art/flat.ts` and the ENTIRE
   * suite stays green, all of it, while a room and the same room with its six
   * cloths rotated by one both tag `49800n`. Those two rooms are not a
   * technicality apart: a book picks its cloth by `seed % cloths.length`, so
   * rotating the list re-dresses every book on the shelf.
   *
   * So the guard here is differential instead — hold a room still, move exactly
   * ONE colour, require the tag to move, and name the colour when it does not.
   * That is the only shape that notices an axis leaving a key, and it is the
   * shape `design-cache-keys.test.ts` and `art-wallpaper.test.ts` already use
   * for the wallpaper's six axes; both of those went red when an axis was
   * dropped, which is the whole reason to copy them rather than invent a second
   * approach.
   */

  afterEach(() => setFlatScheme(null));

  const tagFor = (scheme: ColourScheme): string => {
    setFlatScheme(scheme);
    return flatSchemeTag();
  };

  it('has a nudge for every field a scheme has', () => {
    // The table above is only as good as its coverage, and a table of colours
    // is exactly the kind of thing a seventh colour gets added next to rather
    // than into. Fail here — one line, naming the field — instead of leaving a
    // new axis outside the key and outside the test that guards the key.
    expect(new Set(NUDGES.map((n) => n.field))).toEqual(
      new Set(Object.keys(themes[0]!.scheme) as (keyof ColourScheme)[]),
    );
  });

  it('moves when any ONE colour of a room moves, in every room', () => {
    for (const theme of themes) {
      const base = theme.scheme;
      const before = tagFor(base);
      for (const nudge of NUDGES) {
        expect(
          tagFor(nudge.apply(base)),
          `${theme.id}: ${nudge.what} is not in the cache tag — a room differing only there ` +
            `will be served this room's baked art`,
        ).not.toBe(before);
      }
    }
  });

  it('moves when the same six cloths are merely REORDERED', () => {
    // The collision actually observed under the mutation, and the reason the
    // test above is not enough on its own. Both cases below hold the multiset
    // of hexes exactly and change only the arrangement — and both arrangements
    // paint a visibly different shelf, since the slot a book lands in decides
    // its cloth and the pair's order decides which half is the turned band.
    //
    // Watched, not assumed: put `.sort()` in front of `tagOf`'s `.join('')` and
    // every single-colour nudge above still passes, because sorting a changed
    // multiset still gives a changed string. Only this test goes red.
    for (const theme of themes) {
      const base = theme.scheme;
      const before = tagFor(base);

      const rotated: ColourScheme = { ...base, cloths: [...base.cloths.slice(1), base.cloths[0]!] };
      expect(tagFor(rotated), `${theme.id}: the cloth ORDER is not in the tag`).not.toBe(before);

      const turned: ColourScheme = {
        ...base,
        cloths: base.cloths.map(([face, dark]) => [dark, face] as const),
      };
      expect(
        tagFor(turned),
        `${theme.id}: which half of a cloth pair is the face is not in the tag`,
      ).not.toBe(before);
    }
  });

  it('gives the same room the same tag, however it was arrived at', () => {
    // The live half of the old sweep, kept: the tag has to be a function of the
    // colours and of nothing else — not of what was set before it, not of how
    // many times it has been asked. A tag that drifted would be the opposite
    // failure to the one above, rebaking every part of a case nobody repainted.
    const first = new Map(themes.map((t) => [t.id, tagFor(t.scheme)] as const));
    for (const theme of themes) {
      setFlatScheme(THEMES.reef.scheme); // a detour through another room
      expect(tagFor(theme.scheme), theme.id).toBe(first.get(theme.id));
      // Structurally equal, separately constructed: the tag is derived from the
      // hexes, never from object identity or from a theme id.
      expect(tagFor(structuredClone(theme.scheme) as ColourScheme)).toBe(first.get(theme.id));
    }
    // …and the house palette is reached the same way every time.
    setFlatScheme(THEMES.lapis.scheme);
    setFlatScheme(null);
    const house = flatSchemeTag();
    setFlatScheme(THEMES.reef.scheme);
    setFlatScheme(null);
    expect(flatSchemeTag()).toBe(house);
  });

  it('still separates the sixty authored rooms', () => {
    // The old claim, kept because it is true and cheap and a 32-bit tag really
    // can collide — `design-cache-keys.test.ts` has a navy and a teal bookcase
    // that did exactly that. It is NOT the guard, though, and should not be
    // read as one: this is the assertion that stayed green while the cloths
    // were missing from the key.
    const tags = themes.map((t) => tagFor(t.scheme));
    expect(new Set(tags).size).toBe(themes.length);
  });
});

/*
 * Suites that went with the data they guarded: fourteen complete art packages,
 * unique carpentry signatures, eighteen wallpaper patterns × eighteen
 * colourways (144 walls), six wall treatments orthogonal to the room, the
 * per-theme plate font floor, `scaleFloraDensity`. Every one of them asserted
 * over fields that no renderer read after the flat restyle.
 */
