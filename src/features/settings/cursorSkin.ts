/**
 * features/settings/cursorSkin.ts — putting the drawn cursor on the app.
 *
 * `art/cursors.ts` draws the states and `styles/cursors.css` declares the
 * fourteen custom properties they arrive in. This module is the part that has
 * to deal with the app as it actually is, and that is one hard problem plus
 * one easy one.
 *
 * ## The easy half: publishing a set
 *
 * `cursorVars(set)` → fourteen `--nb-cur-*` properties written onto <html>,
 * plus a `data-cursor-set` attribute that turns the whole thing on. Switching
 * sets rewrites fourteen strings and nothing else. `applySettingsTo` in
 * ./apply.ts does exactly this, against an injected root, so it is covered by
 * the node tests along with every other setting.
 *
 * ## The hard half: the forty-eight declarations already in the tree
 *
 * `cursor` is an inherited property, so setting the arrow on <html> reaches
 * every element that has no cursor of its own. It does NOT reach the ones that
 * do — and this app states a cursor 117 times across `src/styles/`. Without
 * something for those, a reader picks "Scriptorium", sees a drawn nib over the
 * shelf backdrop, and the system hand on all forty-eight buttons. That is
 * worse than not shipping the feature.
 *
 * Three approaches were considered and two were rejected:
 *
 *   - **Edit the app's stylesheets** to say `var(--nb-cur-pointer)` in all 117
 *     places. Correct, and it rots: the 118th declaration written next month
 *     is a plain keyword again, and nothing catches it.
 *   - **A hand-written override sheet** listing the selectors. Same rot, plus
 *     a second copy of every selector to keep in step.
 *   - **Read the stylesheets back and rewrite what is there** — this file.
 *     `document.styleSheets` is the app's own CSS after the bundler has had
 *     it, so the sweep sees exactly the declarations that exist, including
 *     ones from a feature stylesheet imported lazily an hour into a session.
 *
 * The rewrite is `selector { cursor: var(--nb-cur-<role>, <keyword>) }`, in
 * source order, appended after everything else. Order matters and is
 * preserved: a copy sits at the same specificity as its original and later in
 * the document, so among the copies the same rule wins that won before, and a
 * declaration this sweep does not understand still beats a copy it outranks.
 *
 * That last clause has one exception, and it is why `tests/cursors.test.ts`
 * reads `src/styles/*.css` and fails on any keyword this module cannot draw.
 * Two rules of EQUAL specificity, the first with a keyword we rewrite and the
 * second with one we do not, resolve by source order — and the copy of the
 * first lands after both, so it would win a fight it used to lose. The gate
 * makes that unreachable: every cursor keyword in the tree has a state, so
 * every one of them gets a copy, so the copies preserve the original order
 * among themselves. Adding `cursor: cell` to a stylesheet without giving it a
 * state fails the suite rather than quietly changing a cursor somewhere else.
 *
 * What it cannot reach is an inline `style` attribute — including the one that
 * matters most, `world.ts` writing `canvas.style.cursor = 'grabbing'` while a
 * book is being dragged off the shelf. Those are handled by the `!important`
 * attribute-substring rules in `styles/cursors.css`, which is the only place
 * `!important` appears in this feature.
 */

import '../../styles/cursors.css';

import {
  cursorVarName,
  isCursorSetId,
  roleForKeyword,
  type CursorSetId,
} from '../../art/cursors';

/** The attribute `styles/cursors.css` gates every one of its rules on. */
export const CURSOR_SET_ATTR = 'data-cursor-set';

/** The id of the single <style> element the sweep owns. */
export const OVERRIDE_STYLE_ID = 'nb-cursor-overrides';

/* ----------------------------------------------------------------------------
   Which set is actually in force
   -------------------------------------------------------------------------- */

/**
 * The set to apply, given the reader's choice and the OS's.
 *
 * Windows High Contrast (`forced-colors: active`) is not a colour scheme, it
 * is somebody telling every app on the machine that they need the system's own
 * rendering to see it. A drawn cream-and-ink pointer is precisely the thing
 * that mode exists to replace, so the OS wins — the same call `apply.ts` makes
 * for reduced motion, and for the same reason: an app cannot offer *more*
 * decoration than the reader asked the OS to allow.
 *
 * Deliberately NOT a write: the stored preference is untouched, so turning
 * High Contrast off gives the reader their set back without re-picking it.
 */
export function effectiveCursorSet(
  chosen: CursorSetId,
  osForcedColours: boolean,
): CursorSetId {
  return osForcedColours ? 'system' : chosen;
}

/** True when the OS is in a forced-colours mode (false where matchMedia is absent). */
export function osForcedColours(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(forced-colors: active)').matches;
}

/** A stored value read back as a set id, falling back to the house arrow. */
export function resolveCursorSet(value: unknown): CursorSetId {
  return isCursorSetId(value) ? value : 'paper';
}

/* ----------------------------------------------------------------------------
   The sweep — pure half
   -------------------------------------------------------------------------- */

/**
 * The slice of a CSS declaration block this file needs.
 *
 * Structural rather than `CSSStyleDeclaration` so `tests/cursors.test.ts` can
 * hand the walk a plain object: the whole point of splitting the sweep into a
 * pure half is that the interesting logic (order, `!important`, nesting,
 * what to skip) is testable in a node environment with no browser at all.
 */
export interface StyleSlice {
  cursor?: string;
  getPropertyPriority?(property: string): string;
}

/** The slice of a CSSRule this file needs — style rules and grouping rules. */
export interface RuleSlice {
  /** Present on a style rule. */
  selectorText?: string;
  style?: StyleSlice;
  /** Present on a grouping rule (@media, @supports, @layer, @container). */
  cssRules?: ArrayLike<RuleSlice>;
  /** @media's condition. */
  media?: { mediaText?: string };
  /** @supports / @container's condition. */
  conditionText?: string;
}

/** One rewritten declaration, ready to print. */
export interface CursorOverride {
  /** The at-rule the original sat inside, or '' at the top level. */
  wrapper: string;
  selector: string;
  /** The custom property to read. */
  variable: string;
  /** The keyword it falls back to — always the ORIGINAL author's keyword. */
  fallback: string;
  important: boolean;
}

/**
 * Values that are already ours, or already an image.
 *
 * `styles/cursors.css` and this module's own output both say
 * `var(--nb-cur-…)`, and the editor's writing cursors say `url(…)`. Copying
 * either would be, in the first case, a rule that rewrites itself on every
 * pass and grows the sheet without bound, and in the second, a silent
 * downgrade of a cursor somebody already drew for that exact element.
 */
function isRewritable(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === '') return false;
  return !v.includes('var(') && !v.includes('url(') && !v.includes('image-set(');
}

/** The `@media …` / `@supports …` line a grouping rule should be re-emitted in. */
function wrapperFor(rule: RuleSlice): string {
  const media = rule.media?.mediaText;
  if (typeof media === 'string' && media.trim() !== '') return `@media ${media}`;
  const condition = rule.conditionText;
  if (typeof condition === 'string' && condition.trim() !== '') {
    return `@supports ${condition}`;
  }
  return '';
}

/**
 * Every `cursor: <keyword>` declaration in a rule list, in source order.
 *
 * Nested grouping rules keep their condition: flattening an `@media (max-width:
 * 700px)` rule to the top level would apply a phone's cursor on a desktop,
 * which is exactly the class of bug a sweep like this is expected to cause and
 * has to be written not to.
 */
export function collectCursorOverrides(
  rules: ArrayLike<RuleSlice>,
  wrapper = '',
  out: CursorOverride[] = [],
): CursorOverride[] {
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i]!;
    const nested = rule.cssRules;
    if (nested !== undefined && typeof rule.selectorText !== 'string') {
      const inner = wrapperFor(rule);
      collectCursorOverrides(nested, inner !== '' ? inner : wrapper, out);
      continue;
    }
    const selector = rule.selectorText;
    const value = rule.style?.cursor;
    if (typeof selector !== 'string' || selector.trim() === '') continue;
    if (typeof value !== 'string' || !isRewritable(value)) continue;

    // A shorthand-free single keyword is all a `cursor` can be once the images
    // are excluded above; anything with a comma in it was a fallback list and
    // the LAST entry is the keyword that would have been used.
    const keyword = value.split(',').pop()!.trim().toLowerCase();
    const role = roleForKeyword(keyword);
    if (role === null) continue;

    out.push({
      wrapper,
      selector,
      variable: cursorVarName(role),
      fallback: keyword,
      important: rule.style?.getPropertyPriority?.('cursor') === 'important',
    });
  }
  return out;
}

/**
 * The override sheet's text.
 *
 * Consecutive overrides sharing a wrapper are printed inside one at-rule block
 * rather than one block each — purely so the generated sheet is readable when
 * somebody opens dev tools and wonders where their cursor came from.
 */
export function printCursorOverrides(
  overrides: readonly CursorOverride[],
): string {
  const lines: string[] = [];
  let open = '';
  for (const o of overrides) {
    if (o.wrapper !== open) {
      if (open !== '') lines.push('}');
      if (o.wrapper !== '') lines.push(`${o.wrapper} {`);
      open = o.wrapper;
    }
    const indent = open === '' ? '' : '  ';
    const bang = o.important ? ' !important' : '';
    lines.push(
      `${indent}${o.selector} { cursor: var(${o.variable}, ${o.fallback})${bang}; }`,
    );
  }
  if (open !== '') lines.push('}');
  return lines.join('\n');
}

/* ----------------------------------------------------------------------------
   The sweep — DOM half
   -------------------------------------------------------------------------- */

/**
 * The sheets to read, minus our own.
 *
 * A cross-origin stylesheet throws on `.cssRules`; none of the app's do (Vite
 * serves them same-origin and Tauri bundles them), but a devtools extension or
 * a future webfont CDN would, and one throw here would leave the app with no
 * overrides at all rather than with the ones it could read.
 */
function readableSheets(doc: Document): CSSStyleSheet[] {
  const out: CSSStyleSheet[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    const owner = sheet.ownerNode as Element | null;
    if (owner !== null && 'id' in owner && owner.id === OVERRIDE_STYLE_ID) continue;
    try {
      // Touching cssRules is what throws, so it has to happen inside the try.
      if (sheet.cssRules.length >= 0) out.push(sheet as CSSStyleSheet);
    } catch {
      // Unreadable: nothing to rewrite, nothing to report.
    }
  }
  return out;
}

/** Signature of the current CSS, so an unchanged tree is not re-swept. */
let lastSignature = '';

/**
 * Re-read the app's stylesheets and rebuild the override sheet.
 *
 * Idempotent and cheap to call: it hashes the sheet count and rule counts
 * first, and returns without touching the DOM when nothing has changed. That
 * matters because `applySettings` runs on every settings write — a slider
 * dragged across its range would otherwise re-parse every stylesheet in the
 * app forty times a second.
 */
export function refreshCursorOverrides(doc: Document = document): boolean {
  const sheets = readableSheets(doc);
  // Rule count AND source length. Count alone is a weak fingerprint under
  // Vite's HMR, where a stylesheet is replaced by an edited copy that very
  // often has exactly as many rules as it did a moment ago — and then the
  // override sheet keeps pointing at declarations that no longer exist.
  const signature = sheets
    .map((sheet) => {
      try {
        const owner = sheet.ownerNode as { textContent?: string | null } | null;
        return `${sheet.cssRules.length}:${owner?.textContent?.length ?? 0}`;
      } catch {
        return '0:0';
      }
    })
    .join('/');
  if (signature === lastSignature) return false;
  lastSignature = signature;

  const overrides: CursorOverride[] = [];
  for (const sheet of sheets) {
    try {
      // `RuleSlice` is a weak type (every field optional) so TypeScript will
      // not take a `CSSRuleList` for one without being told; the shape is a
      // real subset, which is the point of describing it structurally.
      collectCursorOverrides(
        sheet.cssRules as unknown as ArrayLike<RuleSlice>,
        '',
        overrides,
      );
    } catch {
      // A sheet that became unreadable between the two reads: skip it.
    }
  }

  let node = doc.getElementById(OVERRIDE_STYLE_ID);
  if (node === null) {
    node = doc.createElement('style');
    node.id = OVERRIDE_STYLE_ID;
  }
  node.textContent = `/* generated by features/settings/cursorSkin.ts — do not edit */\n${printCursorOverrides(overrides)}`;
  // Always re-append: the sheet has to be LAST, and a stylesheet added after
  // it (a lazily imported feature sheet) would otherwise outrank every copy.
  doc.head.append(node);
  return true;
}

let observer: MutationObserver | null = null;
let pending = 0;

/**
 * Keep the override sheet last and current as stylesheets arrive.
 *
 * Half the app's CSS is imported by the feature that needs it — `media.css` by
 * the image node, `transfer.css` by the transfer panel, `flip.css` by the flip
 * surface — so the sweep at boot sees perhaps half the declarations that will
 * eventually exist. Without this, opening the image resizer for the first time
 * in a session would give you the system's diagonal arrows for the rest of it.
 */
export function watchStyleSheets(doc: Document = document): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  observer?.disconnect();
  observer = new MutationObserver(() => {
    if (pending !== 0) return;
    // Coalesced: Vite's HMR can add and remove a dozen <style> nodes in one
    // task, and a sweep per node would parse every sheet a dozen times.
    pending = window.setTimeout(() => {
      pending = 0;
      refreshCursorOverrides(doc);
    }, 120);
  });
  observer.observe(doc.head, { childList: true });
  return () => {
    observer?.disconnect();
    observer = null;
    if (pending !== 0) {
      window.clearTimeout(pending);
      pending = 0;
    }
  };
}

