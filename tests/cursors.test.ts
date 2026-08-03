// @vitest-environment node
/**
 * tests/cursors.test.ts — the drawn pointer.
 *
 * Four things are gated here, and each of them is a way this feature can be
 * wrong without anyone noticing:
 *
 *   1. THE FLAT RULE, inside the SVG. `tests/styles.test.ts` sweeps
 *      `src/styles/*.css` for blur and blend modes; the cursors are markup
 *      built by a module, so the same rule has to be checked where they are
 *      made. Every filled shape carries THE ink outline and nothing else does
 *      the outlining.
 *   2. THE TWO-GROUNDS RULE. A cursor crosses cream paper and dark timber in
 *      one gesture, so the body is always the light one. A set whose arrow had
 *      no cream in it would vanish on the shelf, and it would look fine on
 *      every specimen board drawn on paper.
 *   3. THE HOTSPOT lands inside the image and is a whole pixel. A hotspot
 *      outside the image is silently ignored by the browser (you get 0,0), and
 *      then every click in the app is off by the width of an arrow.
 *   4. THE SWEEP that rewrites the app's own `cursor:` declarations does not
 *      lose order, importance or an @media condition — and the app has no
 *      keyword it does not understand. That last one is a real gate on a real
 *      file, not a restatement of the source: it reads `src/styles/*.css`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FLAT } from '../src/art/flat';
import {
  CURSOR_ALIASES,
  CURSOR_FALLBACK,
  CURSOR_ROLES,
  CURSOR_SETS,
  CURSOR_SET_IDS,
  cursorImage,
  cursorValue,
  cursorVarName,
  cursorVars,
  isCursorSetId,
  roleForKeyword,
  type CursorRole,
  type CursorSetId,
} from '../src/art/cursors';
import {
  collectCursorOverrides,
  effectiveCursorSet,
  printCursorOverrides,
  resolveCursorSet,
  type RuleSlice,
} from '../src/features/settings/cursorSkin';
import {
  applySettingsTo,
  type SettingsRoot,
} from '../src/features/settings/apply';
import { DEFAULT_SETTINGS } from '../src/data/defaults';
import { mergeSettings } from '../src/data/settings';

const DRAWN: readonly CursorSetId[] = CURSOR_SET_IDS.filter((id) => id !== 'system');

/** Every `<path>` in a glyph, as its attribute soup. */
function paths(svg: string): string[] {
  return svg.match(/<path\b[^>]*\/>/g) ?? [];
}

function attr(tag: string, name: string): string | null {
  const hit = tag.match(new RegExp(`${name}='([^']*)'`));
  return hit === null ? null : hit[1]!;
}

/* --------------------------------------------------------------------------
   1. The flat rule, inside the markup
   ------------------------------------------------------------------------ */

describe('the flat rule holds inside every cursor', () => {
  it('outlines every filled shape with THE ink and no other colour', () => {
    const offenders: string[] = [];
    for (const set of DRAWN) {
      for (const role of CURSOR_ROLES) {
        for (const tag of paths(cursorImage(set, role)!.svg)) {
          const fill = attr(tag, 'fill');
          if (fill === null || fill === 'none') continue; // a mark, not a shape
          const stroke = attr(tag, 'stroke');
          if (stroke !== FLAT.ink) offenders.push(`${set}/${role}: stroke=${stroke}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no light model: no filter, blur, blend mode or partial opacity', () => {
    const banned = /filter=|feGaussian|blur|mix-blend|stop-opacity|opacity='0/i;
    const offenders = DRAWN.flatMap((set) =>
      CURSOR_ROLES.filter((role) => banned.test(cursorImage(set, role)!.svg)).map(
        (role) => `${set}/${role}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('reads no room colours — a repainted shelf must not repaint the pointer', () => {
    // `flatScheme()` is what a room swap moves. If this module ever imported
    // it, a cursor would change colour when the reader changed bookcase — the
    // one moving thing on screen they cannot look away from.
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'art', 'cursors.ts'),
      'utf8',
      // Comments stripped: the module's own header EXPLAINS that it must not
      // read the scheme, and a gate that a sentence about itself can fail is
      // a gate nobody is allowed to document.
    ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(source).not.toMatch(/\bflatScheme\s*\(/);
    expect(source).not.toMatch(/\bsetFlatScheme\b/);
  });
});

/* --------------------------------------------------------------------------
   2. The two grounds
   ------------------------------------------------------------------------ */

describe('every set reads on cream paper and on dark timber', () => {
  it('gives every state a light body', () => {
    const light = new Set([FLAT.cream, FLAT.creamDeep]);
    const offenders: string[] = [];
    for (const set of DRAWN) {
      for (const role of CURSOR_ROLES) {
        const fills = paths(cursorImage(set, role)!.svg)
          .map((tag) => attr(tag, 'fill'))
          .filter((fill): fill is string => fill !== null && fill !== 'none');
        if (!fills.some((fill) => light.has(fill))) offenders.push(`${set}/${role}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never fills a cursor with a timber or wall colour', () => {
    // These are the GROUNDS. A shape filled with one of them is invisible on
    // exactly the surface it was drawn to be seen against.
    const grounds = new Set<string>([
      FLAT.timber,
      FLAT.timberDark,
      FLAT.recess,
      FLAT.wall,
    ]);
    const offenders: string[] = [];
    for (const set of DRAWN) {
      for (const role of CURSOR_ROLES) {
        for (const tag of paths(cursorImage(set, role)!.svg)) {
          const fill = attr(tag, 'fill');
          if (fill !== null && grounds.has(fill)) offenders.push(`${set}/${role}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
   3. Shape of the emitted image, and the hotspot
   ------------------------------------------------------------------------ */

describe('cursorImage', () => {
  it('emits an SVG with the intrinsic size Chromium requires', () => {
    for (const set of DRAWN) {
      for (const role of CURSOR_ROLES) {
        const image = cursorImage(set, role)!;
        expect(image.svg.startsWith('<svg ')).toBe(true);
        expect(image.svg).toContain(`width='${image.size}'`);
        expect(image.svg).toContain(`height='${image.size}'`);
        expect(image.svg).toContain("viewBox='0 0 32 32'");
        expect(image.svg.endsWith('</svg>')).toBe(true);
      }
    }
  });

  it('puts the hotspot inside the image, on a whole pixel', () => {
    for (const set of DRAWN) {
      for (const role of CURSOR_ROLES) {
        const image = cursorImage(set, role)!;
        const [x, y] = image.hotspot;
        expect(Number.isInteger(x)).toBe(true);
        expect(Number.isInteger(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(image.size);
        expect(y).toBeLessThan(image.size);
      }
    }
  });

  it('puts the pointing states’ hotspot at the drawn tip, not the middle', () => {
    // Every arrow in every set points up-left out of the corner, so its
    // hotspot belongs in the corner. A centred hotspot on a pointer is the
    // classic version of this bug: the app still works, and every click lands
    // half an arrow away from where the reader aimed.
    for (const set of DRAWN) {
      for (const role of ['default', 'progress'] as const) {
        const [x, y] = cursorImage(set, role)!.hotspot;
        expect(x).toBeLessThanOrEqual(4);
        expect(y).toBeLessThanOrEqual(4);
      }
    }
  });

  it('scales the hotspot with the image', () => {
    // Bold ships at 40px from the same 32-unit drawing. A hotspot copied
    // across unscaled would sit a fifth of the way in from the tip.
    const paper = cursorImage('paper', 'move')!;
    const bold = cursorImage('bold', 'move')!;
    expect(bold.size).toBeGreaterThan(paper.size);
    expect(bold.hotspot[0]).toBeGreaterThan(paper.hotspot[0]);
  });

  it('keys its memo on the SET as well as the state', () => {
    // The app's recurring defect: a cache that validates nothing about a hit,
    // so a key missing an axis serves one set's art to everyone.
    const seen = new Map<string, string>();
    for (const set of DRAWN) {
      const url = cursorImage(set, 'default')!.url;
      const clash = seen.get(url);
      expect(clash, `${set} draws the same arrow as ${clash}`).toBeUndefined();
      seen.set(url, set);
    }
  });

  it('returns null for the system set, at every state', () => {
    for (const role of CURSOR_ROLES) expect(cursorImage('system', role)).toBeNull();
  });
});

describe('cursorValue', () => {
  it('always ends in the keyword the state replaces', () => {
    for (const set of CURSOR_SET_IDS) {
      for (const role of CURSOR_ROLES) {
        expect(cursorValue(set, role).endsWith(CURSOR_FALLBACK[role])).toBe(true);
      }
    }
  });

  it('is the bare keyword for the system set', () => {
    for (const role of CURSOR_ROLES) {
      expect(cursorValue('system', role)).toBe(CURSOR_FALLBACK[role]);
    }
  });

  it('quotes the url and prints the hotspot before the fallback', () => {
    const value = cursorValue('paper', 'pointer');
    const image = cursorImage('paper', 'pointer')!;
    expect(value).toBe(
      `url("${image.url}") ${image.hotspot[0]} ${image.hotspot[1]}, pointer`,
    );
  });

  it('never emits a raw # or space into the data URI', () => {
    // Both are legal inside a CSS url() only when quoted or escaped, and the
    // ink colour is a hex. Encoding the whole document is the one rule that
    // keeps every hex and every attribute space out of the parser's way.
    for (const set of DRAWN) {
      for (const role of CURSOR_ROLES) {
        const url = cursorImage(set, role)!.url;
        expect(url.includes('#')).toBe(false);
        expect(url.includes(' ')).toBe(false);
      }
    }
  });
});

describe('cursorVars', () => {
  it('writes the COMPLETE map for every set, system included', () => {
    for (const set of CURSOR_SET_IDS) {
      const vars = cursorVars(set);
      expect(Object.keys(vars).sort()).toEqual(
        CURSOR_ROLES.map(cursorVarName).sort(),
      );
    }
  });

  it('is the plain keywords for system, so switching back leaves nothing behind', () => {
    const vars = cursorVars('system');
    for (const role of CURSOR_ROLES) {
      expect(vars[cursorVarName(role)]).toBe(CURSOR_FALLBACK[role]);
    }
  });
});

/* --------------------------------------------------------------------------
   The sets themselves
   ------------------------------------------------------------------------ */

describe('the set list', () => {
  it('offers system, and offers it first', () => {
    expect(CURSOR_SET_IDS[0]).toBe('system');
    expect(CURSOR_SET_IDS).toContain('system');
  });

  it('stays under the ~20 cap that would need an "N more" control', () => {
    expect(CURSOR_SET_IDS.length).toBeLessThanOrEqual(20);
  });

  it('describes every set it lists', () => {
    for (const id of CURSOR_SET_IDS) {
      const spec = CURSOR_SETS[id];
      expect(spec.id).toBe(id);
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.blurb.length).toBeGreaterThan(10);
    }
    expect(Object.keys(CURSOR_SETS).sort()).toEqual([...CURSOR_SET_IDS].sort());
  });

  it('recognises its own ids and nothing else', () => {
    for (const id of CURSOR_SET_IDS) expect(isCursorSetId(id)).toBe(true);
    for (const junk of ['', 'PAPER', 'arrow', null, 7, {}]) {
      expect(isCursorSetId(junk)).toBe(false);
    }
  });

  it('opens a new install on a drawn set, not on the system one', () => {
    expect(DEFAULT_SETTINGS.cursorSet).not.toBe('system');
    expect(isCursorSetId(DEFAULT_SETTINGS.cursorSet)).toBe(true);
  });
});

/* --------------------------------------------------------------------------
   4. The sweep
   ------------------------------------------------------------------------ */

describe('roleForKeyword', () => {
  it('maps every state onto itself', () => {
    for (const role of CURSOR_ROLES) expect(roleForKeyword(role)).toBe(role);
  });

  it('folds the aliases the app actually writes', () => {
    expect(roleForKeyword('col-resize')).toBe('ew-resize');
    expect(roleForKeyword('row-resize')).toBe('ns-resize');
    expect(roleForKeyword('wait')).toBe('progress');
    expect(roleForKeyword('  POINTER ')).toBe('pointer');
  });

  it('leaves alone what it does not draw', () => {
    for (const junk of ['auto', 'none', 'copy', 'alias', 'no-drop', '']) {
      expect(roleForKeyword(junk)).toBeNull();
    }
  });

  it('resolves every alias to a state that exists', () => {
    for (const role of Object.values(CURSOR_ALIASES)) {
      expect(CURSOR_ROLES).toContain(role);
    }
  });
});

/**
 * The real stylesheets, read off disk.
 *
 * This is the check that stops the feature rotting: the sweep can only rewrite
 * a keyword it has a state for, so the day somebody writes `cursor: crosshair`
 * in a panel, that one element keeps the system cursor while everything around
 * it is drawn — and nothing else in the suite would say so.
 */
describe('the app states no cursor this module cannot draw', () => {
  const STYLES = join(import.meta.dirname, '..', 'src', 'styles');

  /**
   * Declarations only — never selectors.
   *
   * `cursors.css` itself matches on `[style*='cursor: grab']`, so a scan that
   * simply grepped for `cursor:` would read the app's own attribute selectors
   * as declarations and report `grab']` as a keyword nobody draws.
   */
  function cursorDeclarations(css: string): string[] {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const out: string[] = [];
    let depth = 0;
    let buffer = '';
    for (const char of clean) {
      if (char === '{') {
        depth += 1;
        buffer = '';
      } else if (char === '}' || char === ';') {
        if (depth > 0) {
          const colon = buffer.indexOf(':');
          if (colon > 0 && buffer.slice(0, colon).trim().toLowerCase() === 'cursor') {
            out.push(buffer.slice(colon + 1).trim());
          }
        }
        if (char === '}') depth = Math.max(0, depth - 1);
        buffer = '';
      } else {
        buffer += char;
      }
    }
    return out;
  }

  it('covers every keyword in src/styles', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(STYLES).filter((n) => n.endsWith('.css'))) {
      for (const value of cursorDeclarations(readFileSync(join(STYLES, file), 'utf8'))) {
        // An image or a var() is already someone's deliberate choice.
        if (/url\(|var\(|image-set\(/.test(value)) continue;
        const keyword = value
          .split(',')
          .pop()!
          .replace(/!important$/, '')
          .trim();
        if (keyword === '' || keyword === 'auto' || keyword === 'inherit') continue;
        if (roleForKeyword(keyword) === null) {
          offenders.push(
            `${file}: cursor: ${keyword} — add a state for it in src/art/cursors.ts, ` +
              'or an alias onto one that exists',
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every state a floor in styles/cursors.css', () => {
    const css = readFileSync(join(STYLES, 'cursors.css'), 'utf8');
    for (const role of CURSOR_ROLES) {
      expect(css).toContain(`${cursorVarName(role)}: ${CURSOR_FALLBACK[role]};`);
    }
  });

  it('carries the keyword as a var() fallback everywhere it reads one', () => {
    // `cursor: var(--x)` with no fallback is invalid at computed-value time if
    // the property is ever missing, and an invalid inherited property INHERITS
    // rather than reverting — one bad string would drag the arrow across every
    // text field in the app.
    const css = readFileSync(join(STYLES, 'cursors.css'), 'utf8');
    const bare = [...css.matchAll(/cursor:\s*var\((--nb-cur-[a-z-]+)\)/g)];
    expect(bare.map((m) => m[0])).toEqual([]);
  });
});

describe('collectCursorOverrides', () => {
  const rule = (
    selectorText: string,
    cursor: string,
    important = false,
  ): RuleSlice => ({
    selectorText,
    style: {
      cursor,
      getPropertyPriority: () => (important ? 'important' : ''),
    },
  });

  it('rewrites a keyword and keeps the author’s keyword as the fallback', () => {
    const [only] = collectCursorOverrides([rule('.a', 'col-resize')]);
    expect(only).toEqual({
      wrapper: '',
      selector: '.a',
      variable: '--nb-cur-ew-resize',
      fallback: 'col-resize',
      important: false,
    });
  });

  it('preserves source order', () => {
    const out = collectCursorOverrides([
      rule('.a', 'pointer'),
      rule('.b', 'grab'),
      rule('.c', 'text'),
    ]);
    expect(out.map((o) => o.selector)).toEqual(['.a', '.b', '.c']);
  });

  it('copies !important rather than adding or dropping it', () => {
    const out = collectCursorOverrides([
      rule('.a', 'pointer', true),
      rule('.b', 'pointer', false),
    ]);
    expect(out.map((o) => o.important)).toEqual([true, false]);
  });

  it('keeps an @media condition instead of flattening it', () => {
    const out = collectCursorOverrides([
      {
        media: { mediaText: '(max-width: 700px)' },
        cssRules: [rule('.a', 'pointer')],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.wrapper).toBe('@media (max-width: 700px)');
  });

  it('reads @supports too', () => {
    const out = collectCursorOverrides([
      { conditionText: '(display: grid)', cssRules: [rule('.a', 'grab')] },
    ]);
    expect(out[0]!.wrapper).toBe('@supports (display: grid)');
  });

  it('skips what it must not touch', () => {
    const out = collectCursorOverrides([
      rule('.img', 'url(data:image/svg+xml,x) 2 2, text'), // somebody drew this
      rule('.ours', 'var(--nb-cur-pointer, pointer)'), // our own output
      rule('.odd', 'copy'), // a state we do not draw
      rule('.empty', ''),
      rule('', 'pointer'),
      rule('.ok', 'pointer'),
    ]);
    expect(out.map((o) => o.selector)).toEqual(['.ok']);
  });

  it('does not grow when run over its own output', () => {
    const first = collectCursorOverrides([rule('.a', 'pointer')]);
    const printed = printCursorOverrides(first);
    const second = collectCursorOverrides([rule('.a', 'var(--nb-cur-pointer, pointer)')]);
    expect(printed).toContain('var(--nb-cur-pointer, pointer)');
    expect(second).toEqual([]);
  });
});

describe('printCursorOverrides', () => {
  it('prints one line per override, in order', () => {
    const css = printCursorOverrides([
      { wrapper: '', selector: '.a', variable: '--nb-cur-pointer', fallback: 'pointer', important: false },
      { wrapper: '', selector: '.b', variable: '--nb-cur-grab', fallback: 'grab', important: true },
    ]);
    expect(css).toBe(
      '.a { cursor: var(--nb-cur-pointer, pointer); }\n' +
        '.b { cursor: var(--nb-cur-grab, grab) !important; }',
    );
  });

  it('opens and closes an at-rule block exactly once per run', () => {
    const css = printCursorOverrides([
      { wrapper: '@media print', selector: '.a', variable: '--nb-cur-pointer', fallback: 'pointer', important: false },
      { wrapper: '@media print', selector: '.b', variable: '--nb-cur-grab', fallback: 'grab', important: false },
      { wrapper: '', selector: '.c', variable: '--nb-cur-text', fallback: 'text', important: false },
    ]);
    expect(css.match(/@media print \{/g)).toHaveLength(1);
    expect(css.match(/\}/g)).toHaveLength(4); // three declarations + the block
    expect(css.trimEnd().endsWith('.c { cursor: var(--nb-cur-text, text); }')).toBe(true);
  });

  it('is empty for an empty sweep', () => {
    expect(printCursorOverrides([])).toBe('');
  });
});

/* --------------------------------------------------------------------------
   Choosing, storing and the OS's veto
   ------------------------------------------------------------------------ */

describe('effectiveCursorSet', () => {
  it('hands the pointer back to the OS under forced colours', () => {
    for (const id of CURSOR_SET_IDS) expect(effectiveCursorSet(id, true)).toBe('system');
  });

  it('otherwise applies what the reader chose', () => {
    for (const id of CURSOR_SET_IDS) expect(effectiveCursorSet(id, false)).toBe(id);
  });
});

describe('resolveCursorSet', () => {
  it('takes a known id', () => {
    expect(resolveCursorSet('quill')).toBe('quill');
    expect(resolveCursorSet('system')).toBe('system');
  });

  it('falls back to a drawn set rather than throwing', () => {
    for (const junk of [undefined, null, '', 'nib', 42, { id: 'paper' }]) {
      expect(isCursorSetId(resolveCursorSet(junk))).toBe(true);
    }
  });
});

describe('mergeSettings', () => {
  it('keeps a stored set', () => {
    expect(mergeSettings({ cursorSet: 'botanical' }).cursorSet).toBe('botanical');
    expect(mergeSettings({ cursorSet: 'system' }).cursorSet).toBe('system');
  });

  it('degrades an unknown one to the shipped default', () => {
    for (const junk of [{ cursorSet: 'brush' }, { cursorSet: 3 }, {}, null]) {
      expect(mergeSettings(junk).cursorSet).toBe(DEFAULT_SETTINGS.cursorSet);
    }
  });

  it('leaves the editor’s writing cursor alone', () => {
    // Two settings, two meanings: `cursorStyle` is the nib inside a page.
    // Merging them was considered and rejected — it would have silently
    // changed what an existing reader's stored `cursorStyle` meant.
    const merged = mergeSettings({ cursorStyle: 'quill', cursorSet: 'pencil' });
    expect(merged.cursorStyle).toBe('quill');
    expect(merged.cursorSet).toBe('pencil');
  });
});

/* --------------------------------------------------------------------------
   Reaching the document
   ------------------------------------------------------------------------ */

describe('applySettingsTo', () => {
  class FakeRoot {
    attrs = new Map<string, string>();
    vars = new Map<string, string>();
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
    }
    style = {
      setProperty: (name: string, value: string): void => {
        this.vars.set(name, value);
      },
    };
    classList = { toggle: (): boolean => false };
  }

  const SILENT_SOUND = {
    setVolumes: () => undefined,
    muteAll: () => undefined,
    setReducedSound: () => undefined,
    startAmbient: () => undefined,
    stopAmbient: () => undefined,
    setSoundscape: () => undefined,
    setTypingSounds: () => undefined,
    setHourlyChime: () => undefined,
  };

  const applied = (set: CursorSetId, forcedColours = false): FakeRoot => {
    const root = new FakeRoot();
    applySettingsTo(
      { ...DEFAULT_SETTINGS, cursorSet: set },
      root as unknown as SettingsRoot,
      SILENT_SOUND,
      false,
      null,
      forcedColours,
    );
    return root;
  };

  it('turns the feature on with the attribute styles/cursors.css gates on', () => {
    expect(applied('quill').attrs.get('data-cursor-set')).toBe('quill');
  });

  it('writes the complete map, so no state of the last set survives', () => {
    const root = applied('pencil');
    for (const role of CURSOR_ROLES) {
      expect(root.vars.get(cursorVarName(role))).toBe(cursorValue('pencil', role));
    }
  });

  it('still writes all of them for system — as the plain keywords', () => {
    const root = applied('system');
    expect(root.attrs.get('data-cursor-set')).toBe('system');
    for (const role of CURSOR_ROLES) {
      expect(root.vars.get(cursorVarName(role))).toBe(CURSOR_FALLBACK[role]);
    }
  });

  it('lets forced colours override the reader’s pick without erasing it', () => {
    const root = applied('botanical', true);
    expect(root.attrs.get('data-cursor-set')).toBe('system');
    expect(root.vars.get('--nb-cur-default')).toBe('default');
  });

  it('is idempotent', () => {
    const once = applied('gilt');
    const twice = applied('gilt');
    expect([...twice.vars.entries()]).toEqual([...once.vars.entries()]);
  });
});

describe('the states a reader can actually be shown', () => {
  it('names a state for every role the picker lists', () => {
    // The strip in CursorSetPicker renders CURSOR_ROLES; a role with no image
    // would render an empty box and say nothing about why.
    for (const role of CURSOR_ROLES) {
      expect(cursorImage('paper', role)).not.toBeNull();
    }
  });

  it('covers grab and grabbing, which is what a book being pulled uses', () => {
    const shelf: CursorRole[] = ['grab', 'grabbing'];
    for (const role of shelf) expect(CURSOR_ROLES).toContain(role);
  });
});
