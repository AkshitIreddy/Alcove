// @vitest-environment node
/**
 * tests/packs.test.ts — the reader's own packs, and the one property the
 * whole feature rests on.
 *
 * The reader asked for an upload popup carrying "a custom ai prompt they give
 * to an ai that will tell it the specifications of how to build and package
 * it". The failure mode is not a crash. It is a prompt that describes a format
 * the importer does not accept: the reader does the work, pastes the result,
 * and is told it is wrong by the app that told them what to write. Nothing
 * throws, nothing logs, and the feature is worse than absent.
 *
 * So the load-bearing test in this file is the ROUND TRIP — the example is
 * lifted back out of the GENERATED prompt text and run through the REAL
 * importer. Everything else here is ordinary coverage; that one is the reason
 * the file exists.
 *
 * Three more things are pinned, each because it is invisible when broken:
 *
 *   THE VOCABULARIES ARE READ, NOT COPIED. Every enum a pack can carry is
 *   compared against the module that owns it. A copied list goes stale on the
 *   first new motif and the reader's model is told about the old fifty.
 *
 *   ALL OR NOTHING. One bad entry refuses the file. A pack that half-imports
 *   leaves somebody diffing their own JSON against an app that will not say
 *   which line it disliked.
 *
 *   IT IS PLUGGED IN. Source-read, in the shape tests/roll-gates.test.ts
 *   already uses here: the panel is mounted, the strips are mounted, and the
 *   preview keys carry every axis they vary on. An importer nobody can reach
 *   is the exact class of bug this tree keeps finding, and writing a new one
 *   without a gate would be careless.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PACK_CATEGORIES,
  UNSUPPORTED_CATEGORIES,
  isPackCategoryId,
  packCategory,
} from '../src/features/packs/categories';
import {
  PACK_FORMAT,
  editDistance,
  nearestValue,
  type EnumField,
  type PackCategory,
} from '../src/features/packs/schema';
import {
  exampleJsonInPrompt,
  promptForCategory,
} from '../src/features/packs/prompt';
import {
  extractJson,
  parsePackText,
  validatePack,
  validatePackItem,
  validatePackText,
} from '../src/features/packs/validate';
import {
  WALLPAPER_DEPTHS,
  WALLPAPER_EDGES,
  WALLPAPER_INKS,
  WALLPAPER_PATTERNS,
  WALLPAPER_SCALES,
  WALLPAPER_TONES,
} from '../src/art/wallpaperDesign';
import { BUILD_IDS, PATTERN_IDS } from '../src/art/shelfDesign';
import { FAMILY_NAMES } from '../src/sound/engine';
import { roleFromFileName } from '../src/sound/userSoundSetStore';

const SRC = join(import.meta.dirname, '..', 'src');
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

/** Strip comments, so this file's own prose cannot satisfy a source match. */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const MANIFEST = PACK_CATEGORIES.filter((c) => c.intake === 'manifest');

/** A whole document around a category's own example items. */
function documentFor(category: PackCategory, items: unknown[] = [...category.example]): unknown {
  return {
    alcovePack: PACK_FORMAT,
    category: category.id,
    name: `Test ${category.plural}`,
    items,
  };
}

const check = (category: PackCategory, doc: unknown) =>
  validatePack(doc, category, packCategory);

/** Every problem, flattened, for a readable assertion. */
function problemText(result: ReturnType<typeof check>): string {
  return result.ok ? '' : result.problems.map((p) => `${p.where}: ${p.message}`).join(' | ');
}

/* ==========================================================================
   1. THE ROUND TRIP — the prompt promises what the importer accepts
   ========================================================================== */

describe('the generated prompt and the importer agree', () => {
  it.each(MANIFEST.map((c) => [c.id, c] as const))(
    '%s: the example embedded in the prompt imports cleanly',
    (_id, category) => {
      const json = exampleJsonInPrompt(promptForCategory(category));
      expect(json, 'the prompt must embed a ```json example').not.toBeNull();

      const parsed = parsePackText(json!);
      expect(parsed.ok, `the example is not valid JSON: ${problemText(parsed as never)}`).toBe(true);
      if (!parsed.ok) return;

      const result = check(category, parsed.pack.value);
      expect(result.ok, `the prompt's own example is refused: ${problemText(result)}`).toBe(true);
      if (result.ok) expect(result.pack.items.length).toBe(category.example.length);
    },
  );

  it.each(MANIFEST.map((c) => [c.id, c] as const))(
    '%s: the prompt names every field the importer reads',
    (_id, category) => {
      const prompt = promptForCategory(category);
      for (const field of category.fields) {
        expect(prompt, `field "${field.key}" is unmentioned`).toContain(`"${field.key}"`);
      }
    },
  );

  it.each(MANIFEST.map((c) => [c.id, c] as const))(
    '%s: the prompt lists every word an enum field accepts',
    (_id, category) => {
      const prompt = promptForCategory(category);
      const missing: string[] = [];
      for (const field of category.fields) {
        if (field.kind !== 'enum') continue;
        for (const value of field.values) {
          if (!new RegExp(`\\b${value}\\b`).test(prompt)) missing.push(`${field.key}=${value}`);
        }
      }
      expect(missing).toEqual([]);
    },
  );

  it.each(MANIFEST.map((c) => [c.id, c] as const))(
    '%s: every word the prompt lists is a word the importer takes',
    (_id, category) => {
      const refused: string[] = [];
      for (const field of category.fields) {
        if (field.kind !== 'enum') continue;
        for (const value of field.values) {
          const base = { ...(category.example[0] as Record<string, unknown>) };
          base[field.key] = value;
          const checked = validatePackItem(category, base, 'items[0]');
          if (checked.item === null) refused.push(`${field.key}=${value}`);
        }
      }
      expect(refused).toEqual([]);
    },
  );

  it('every category states its ceiling in the prompt', () => {
    for (const category of MANIFEST) {
      expect(promptForCategory(category)).toContain(String(category.maxItems));
    }
  });

  it('the sound prompt asks for exactly the file names the matcher understands', () => {
    const sound = packCategory('sound');
    expect(sound?.files).toBeDefined();
    const prompt = promptForCategory(sound!);
    for (const slot of sound!.files!.naming) {
      expect(prompt, `${slot.name} is missing from the prompt`).toContain(`${slot.name}.wav`);
      // The whole point: the name the prompt teaches is the name the importer
      // resolves. These two used to be different modules with no gate between.
      expect(roleFromFileName(`${slot.name}.wav`)).toBe(slot.name);
    }
    // And it must not ask for JSON, which would be a format the sound importer
    // has never accepted.
    expect(exampleJsonInPrompt(prompt)).toBeNull();
  });

  it('every alias the sound prompt offers resolves to the role it is listed under', () => {
    const sound = packCategory('sound')!;
    for (const slot of sound.files!.naming) {
      for (const alias of slot.alsoAccepts) {
        expect(roleFromFileName(`${alias}.wav`), `${alias} → ${slot.name}`).toBe(slot.name);
      }
    }
  });
});

/* ==========================================================================
   2. THE VOCABULARIES ARE READ, NOT COPIED
   ========================================================================== */

describe('a pack can name exactly what the app can draw', () => {
  const enumField = (categoryId: string, key: string): EnumField => {
    const field = packCategory(categoryId)?.fields.find((f) => f.key === key);
    expect(field?.kind).toBe('enum');
    return field as EnumField;
  };

  it('the wallpaper axes are the wallpaper module’s own', () => {
    expect(enumField('wallpaper', 'pattern').values).toEqual([...WALLPAPER_PATTERNS]);
    expect(enumField('wallpaper', 'scale').values).toEqual([...WALLPAPER_SCALES]);
    expect(enumField('wallpaper', 'depth').values).toEqual([...WALLPAPER_DEPTHS]);
    expect(enumField('wallpaper', 'ink').values).toEqual([...WALLPAPER_INKS]);
    expect(enumField('wallpaper', 'tone').values).toEqual([...WALLPAPER_TONES]);
    expect(enumField('wallpaper', 'edge').values).toEqual([...WALLPAPER_EDGES]);
  });

  it('the carpentry axes are the shelf module’s own', () => {
    expect(enumField('carpentry', 'build').values).toEqual([...BUILD_IDS]);
    expect(enumField('carpentry', 'pattern').values).toEqual([...PATTERN_IDS]);
  });

  it('the sound roles are the engine’s own families', () => {
    const sound = packCategory('sound')!;
    expect(sound.files!.naming.map((n) => n.name)).toEqual([...FAMILY_NAMES]);
  });

  it('every category is complete enough to put in front of somebody', () => {
    for (const category of PACK_CATEGORIES) {
      expect(isPackCategoryId(category.id)).toBe(true);
      expect(category.howTo.length, `${category.id} has no instructions`).toBeGreaterThan(1);
      expect(category.rules.length, `${category.id} states no rules`).toBeGreaterThan(1);
      expect(category.craft.length, `${category.id} offers no guidance`).toBeGreaterThan(1);
      expect(category.caveat.length, `${category.id} admits nothing`).toBeGreaterThan(20);
      // A manifest category must have fields AND an example; a files category
      // must have the file table instead. One or the other, never neither.
      if (category.intake === 'manifest') {
        expect(category.fields.length).toBeGreaterThan(0);
        expect(category.example.length).toBeGreaterThan(0);
        expect(category.files).toBeUndefined();
      } else {
        expect(category.files?.naming.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('says out loud what it cannot take, with a reason for each', () => {
    expect(UNSUPPORTED_CATEGORIES.length).toBeGreaterThan(2);
    for (const entry of UNSUPPORTED_CATEGORIES) {
      expect(entry.title.length).toBeGreaterThan(3);
      expect(entry.why.length, `${entry.title} has no reason`).toBeGreaterThan(30);
    }
    // The one a reader is most likely to try, since the category is called
    // "wallpapers" and every other app would take a picture.
    expect(UNSUPPORTED_CATEGORIES.some((e) => /image|picture/i.test(e.title))).toBe(true);
  });
});

/* ==========================================================================
   3. ALL OR NOTHING, AND A REFUSAL YOU CAN ACT ON
   ========================================================================== */

describe('refusals name the place and the fix', () => {
  const wallpaper = packCategory('wallpaper')!;
  const good = wallpaper.example[0] as Record<string, unknown>;

  it('one bad entry refuses the whole file', () => {
    const result = check(wallpaper, documentFor(wallpaper, [good, { ...good, ink: 'nonsense' }]));
    expect(result.ok).toBe(false);
    // Nothing partial comes back: there is no `pack` on a refusal at all.
    expect('pack' in result).toBe(false);
  });

  it('a misspelt word is told what it was nearly', () => {
    const result = check(wallpaper, documentFor(wallpaper, [{ ...good, pattern: 'ferns' }]));
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain('items[0].pattern');
    expect(problemText(result)).toContain('Did you mean "fern"');
  });

  it('a word that is nowhere near anything is not given a silly suggestion', () => {
    const result = check(wallpaper, documentFor(wallpaper, [{ ...good, ink: 'chartreuse' }]));
    expect(result.ok).toBe(false);
    expect(problemText(result)).not.toContain('Did you mean');
    expect(problemText(result)).toContain('the prompt');
  });

  it('an unknown key is refused rather than dropped', () => {
    const result = check(wallpaper, documentFor(wallpaper, [{ ...good, colour: 'moss' }]));
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain('items[0].colour');
    expect(problemText(result)).toContain('no field called');
  });

  it('a near-miss key gets the same courtesy as a near-miss value', () => {
    const result = check(wallpaper, documentFor(wallpaper, [{ ...good, tones: 'moss' }]));
    expect(problemText(result)).toContain('Did you mean "tone"');
  });

  it('a missing required field is named', () => {
    const { pattern: _dropped, ...withoutPattern } = good;
    const result = check(wallpaper, documentFor(wallpaper, [withoutPattern]));
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain('items[0].pattern');
    expect(problemText(result)).toContain('required');
  });

  it('an optional field may simply be absent', () => {
    const { tone: _t, edge: _e, blurb: _b, ...bare } = good;
    const result = check(wallpaper, documentFor(wallpaper, [bare]));
    expect(result.ok, problemText(result)).toBe(true);
  });

  it('the wrong category is refused with the right dialog named', () => {
    const sticker = packCategory('sticker')!;
    const result = check(wallpaper, documentFor(sticker));
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain('Stickers');
    // One problem, not a hundred field errors from checking the wrong shape.
    expect(result.ok ? 0 : result.problems.length).toBe(1);
  });

  it('a file with no alcovePack marker is refused by name', () => {
    const doc = documentFor(wallpaper) as Record<string, unknown>;
    delete doc.alcovePack;
    expect(problemText(check(wallpaper, doc))).toContain('alcovePack');
  });

  it('too many entries are refused with the ceiling stated', () => {
    const many = Array.from({ length: wallpaper.maxItems + 1 }, (_, i) => ({
      ...good,
      name: `Paper ${i}`,
    }));
    const result = check(wallpaper, documentFor(wallpaper, many));
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain(String(wallpaper.maxItems));
  });

  it('two entries with the same name are refused, because a name is how you tell them apart', () => {
    const result = check(wallpaper, documentFor(wallpaper, [good, { ...good }]));
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain('two entries');
  });

  it('an empty list is refused rather than imported as nothing', () => {
    expect(problemText(check(wallpaper, documentFor(wallpaper, [])))).toContain('nothing to import');
  });

  it('junk in place of the whole file does not throw', () => {
    for (const junk of [null, 42, 'hello', [], undefined]) {
      expect(() => check(wallpaper, junk)).not.toThrow();
      expect(check(wallpaper, junk).ok).toBe(false);
    }
  });
});

/* ==========================================================================
   4. READING WHAT A MODEL ACTUALLY HANDS BACK
   ========================================================================== */

describe('the file a model actually produces', () => {
  const wallpaper = packCategory('wallpaper')!;
  const body = JSON.stringify(documentFor(wallpaper));

  it('accepts clean JSON with no note', () => {
    const result = validatePackText(body, wallpaper, packCategory);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notes).toEqual([]);
  });

  it('accepts a code fence, and says it did', () => {
    const result = validatePackText('```json\n' + body + '\n```', wallpaper, packCategory);
    expect(result.ok, problemText(result)).toBe(true);
    if (result.ok) expect(result.notes.join(' ')).toContain('code fence');
  });

  it('accepts chat around the JSON, and says it did', () => {
    const result = validatePackText(
      `Sure! Here are six papers for you:\n\n${body}\n\nLet me know if you want more.`,
      wallpaper,
      packCategory,
    );
    expect(result.ok, problemText(result)).toBe(true);
    if (result.ok) expect(result.notes.join(' ')).toContain('writing around the JSON');
  });

  it('reports a syntax error rather than throwing', () => {
    const result = validatePackText('{ "alcovePack": 1, ', wallpaper, packCategory);
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain('not valid JSON');
  });

  it('an empty file is a sentence, not a stack trace', () => {
    expect(problemText(validatePackText('   ', wallpaper, packCategory))).toContain('empty');
  });

  it('extractJson leaves clean input alone', () => {
    expect(extractJson('{"a":1}')).toEqual({ json: '{"a":1}', note: null });
  });
});

/* ==========================================================================
   5. STICKERS ARE DRAWINGS, NOT PROGRAMS
   ========================================================================== */

describe('an imported drawing cannot do anything but be looked at', () => {
  const sticker = packCategory('sticker')!;
  const draw = (svg: string, name = 'thing'): ReturnType<typeof check> =>
    check(sticker, documentFor(sticker, [{ name, svg }]));

  const OK = '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#abc"/></svg>';

  it('takes a plain flat drawing', () => {
    expect(draw(OK).ok, problemText(draw(OK))).toBe(true);
  });

  it('refuses a script tag', () => {
    const result = draw(OK.replace('<rect', '<script>alert(1)</script><rect'));
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain('not a program');
  });

  it('refuses an event handler', () => {
    const result = draw(OK.replace('<rect', '<rect onload="fetch(1)"'));
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain('not a program');
  });

  it('refuses a drawing that points at somebody’s server', () => {
    const result = draw(OK.replace('<rect', '<image href="https://elsewhere.example/x.png"/><rect'));
    expect(result.ok).toBe(false);
    expect(problemText(result)).toContain('self-contained');
  });

  it('allows a local fragment reference, which is how gradients are used', () => {
    const withGradient =
      '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#a11"/><stop offset="1" stop-color="#e83"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>';
    // Gradients are inside the house style — CLAUDE.md is explicit that a
    // gentle gradient is pigment, and only a LIGHT MODEL is banned. Refusing
    // one here would be enforcing a rule the app does not have.
    expect(draw(withGradient).ok, problemText(draw(withGradient))).toBe(true);
  });

  it('refuses a drawing with no viewBox, because it could not be scaled', () => {
    const result = draw('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    expect(problemText(result)).toContain('viewBox');
  });

  it('refuses something that is not an SVG at all', () => {
    expect(problemText(draw('<html><body>hi</body></html>'))).toContain('<svg>');
  });

  it('refuses a truncated one and says it looks truncated', () => {
    expect(problemText(draw('<svg viewBox="0 0 10 10"><rect'))).toContain('truncated');
  });

  it('refuses one that is far too big to be a drawing', () => {
    const huge = `<svg viewBox="0 0 10 10">${'<rect/>'.repeat(20000)}</svg>`;
    expect(problemText(draw(huge))).toContain('ceiling');
  });

  it('lets a blur through, but says it will look like a visitor', () => {
    const blurred =
      '<svg viewBox="0 0 10 10"><filter id="b"><feGaussianBlur stdDeviation="2"/></filter><rect width="10" height="10" filter="url(#b)"/></svg>';
    const result = draw(blurred);
    // Not cruel: the reader's drawing, the reader's call. Said, not refused.
    expect(result.ok, problemText(result)).toBe(true);
    if (result.ok) expect(result.notes.join(' ')).toContain('drawn flat');
  });
});

/* ==========================================================================
   6. STALE ENTRIES DIE QUIETLY ON THE WAY OUT OF THE DATABASE
   ========================================================================== */

describe('a pack outliving the vocabulary it was written against', () => {
  const wallpaper = packCategory('wallpaper')!;

  it('an entry naming a motif the app no longer draws does not validate', () => {
    // This is what `store.hydrate` runs over every stored entry: an import is
    // all-or-nothing because the reader is standing there, but a READ has to
    // be total in the way resolveShelfDesign is — drop it, count it, say so.
    const checked = validatePackItem(
      wallpaper,
      { ...(wallpaper.example[0] as object), pattern: 'retired-motif' },
      'item',
    );
    expect(checked.item).toBeNull();
    expect(checked.problems.length).toBeGreaterThan(0);
  });

  it('an entry that is still good survives the same pass unchanged', () => {
    const checked = validatePackItem(wallpaper, wallpaper.example[0], 'item');
    expect(checked.item).not.toBeNull();
    expect(checked.item?.name).toBe((wallpaper.example[0] as Record<string, string>).name);
  });
});

/* ==========================================================================
   7. THE SUGGESTION MACHINERY
   ========================================================================== */

describe('did you mean', () => {
  it('measures distance the ordinary way', () => {
    expect(editDistance('fern', 'fern')).toBe(0);
    expect(editDistance('fern', 'ferns')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  it('suggests a near miss and stays quiet about a far one', () => {
    expect(nearestValue('herringbones', [...WALLPAPER_PATTERNS])).toBe('herringbone');
    expect(nearestValue('Trellis', [...WALLPAPER_PATTERNS])).toBe('trellis');
    expect(nearestValue('watercolour-splash', [...WALLPAPER_PATTERNS])).toBeNull();
  });
});

/* ==========================================================================
   8. IT IS PLUGGED IN
   ========================================================================== */

describe('the packs feature is reachable from the app', () => {
  const studio = strip(read('views', 'rail', 'LibraryStudio.tsx'));
  const customize = strip(read('views', 'rail', 'CustomizePanel.tsx'));
  const yours = strip(read('features', 'packs', 'YourDesigns.tsx'));
  const panel = strip(read('features', 'packs', 'PacksPanel.tsx'));
  const dialog = strip(read('features', 'packs', 'PackDialog.tsx'));

  it('the studio has a tab for it', () => {
    expect(customize).toContain('PacksPanel');
    expect(customize).toMatch(/tab\(\)\s*===\s*'own'/);
  });

  it('the reader’s papers and cases stand where papers and cases are chosen', () => {
    expect(studio).toContain('YourDesigns');
    expect(studio).toContain('axis="wallpaper"');
    expect(studio).toContain('axis="carpentry"');
  });

  it('every category can open its own popup', () => {
    // The reader asked for the popup to be per-category ("when uploading for
    // category it will open a popup"), so the panel must pass the id through
    // rather than always opening the same one.
    expect(panel).toMatch(/openPackDialog\(category\.id\)/);
    expect(yours).toMatch(/openPackDialog\(props\.axis\)/);
  });

  it('the popup carries all three parts the reader asked for', () => {
    expect(dialog, 'no upload button').toMatch(/data-pack-upload/);
    expect(dialog, 'no instructions').toMatch(/category\(\)\.howTo/);
    expect(dialog, 'no copyable prompt').toMatch(/promptForCategory/);
    expect(dialog).toMatch(/data-pack-copy-prompt/);
    // And the honest list, which is the part it would be easiest to leave out.
    expect(dialog).toContain('UNSUPPORTED_CATEGORIES');
  });

  it('an applied entry goes through the studio’s own save path', () => {
    const store = strip(read('features', 'packs', 'store.ts'));
    expect(store).toContain('saveWallpaper');
    expect(store).toContain('saveRoomDesign');
  });

  it('reuses the two importers that already existed rather than writing a third', () => {
    const intake = strip(read('features', 'packs', 'intake.ts'));
    expect(intake).toContain('templates/userStickers');
    expect(intake).toContain('sound/userSoundSetStore');
  });

  it('the preview tiles key on every axis they vary on', () => {
    // CLAUDE.md's standing trap: a cache validates nothing about a hit, so a
    // key missing an axis serves the wrong art to everyone who already has the
    // right art under it. These tiles vary on the room's colour AND on the
    // design, so both have to be in the key — and through the shared helpers,
    // not a local join that can fall an axis behind.
    expect(yours).toContain('resolved().key');
    expect(yours).toContain('wallpaperAxisKey');
    expect(yours).toContain('shelfDesignTag');
  });

  it('the long "yours" list is capped, like every other list in the app', () => {
    expect(yours).toContain('Capped');
    expect(panel).toContain('Capped');
  });

  it('its stylesheet is actually imported', () => {
    for (const file of ['PackDialog.tsx', 'PacksPanel.tsx', 'YourDesigns.tsx']) {
      expect(read('features', 'packs', file)).toContain("styles/packs.css");
    }
  });

  it('the popup’s way out is the shared top-left one', () => {
    // insert.css anchors .nb-ins-close top-left and top-left-exits.test.ts
    // gates it. Borrowing it is how this dialog stays in the convention
    // without a second rule that can drift out of it.
    expect(dialog).toContain('nb-ins-close');
    expect(dialog).not.toMatch(/nb-pack-close/);
  });

  it('has a QA bridge, because a file dialog cannot be clicked by a probe', () => {
    expect(strip(read('features', 'packs', 'store.ts'))).toContain('__nbPacks');
    // And a paste route, which is the only import path a browser test can drive.
    expect(dialog).toContain('data-pack-paste');
  });
});
