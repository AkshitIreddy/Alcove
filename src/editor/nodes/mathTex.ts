/**
 * A small TeX renderer — enough maths for a notebook, in the app's own hand.
 *
 * WHY THERE IS A PARSER HERE AT ALL
 *
 * TipTap's Mathematics extension is not installed (extensions.ts says so at the
 * top, and package.json agrees), and it renders through KaTeX, whose Computer
 * Modern is a different world from a page of Patrick Hand on cream paper. So
 * this renders a DOCUMENTED SUBSET of TeX into plain HTML that the page's own
 * serif face draws, with no dependency and no webfont of its own.
 *
 * The subset is the maths a reader actually writes in a notebook:
 *   x^2  a_i  x^{n+1}          superscripts and subscripts, nested
 *   \frac{a}{b}  \tfrac  \dfrac stacked fractions with a rule
 *   \sqrt{x}  \sqrt[3]{x}       radicals with a vinculum
 *   \bar L  \overline{AB}       a short or long bar above an expression
 *   \boxed{x=1}                  a ruled box around an expression
 *   \sum_{i=1}^{n}  \int_0^1    big operators, limits over/under in display
 *   \left( … \right)           delimiters that grow with what they hold
 *   \alpha … \Omega, 130 macros greek, relations, arrows, set theory
 *   \sin \log \max …            upright function names
 *   \text{like this}            upright prose inside maths
 *
 * What it deliberately does NOT do: matrices, alignment, cases, arrays,
 * \over, custom macros. Those are documents, not afterthoughts, and half a
 * matrix renderer is worse than none.
 *
 * TOTALITY is the contract, exactly as it is for the script parser
 * (src/script/): `mathToHtml` NEVER throws and always returns markup. An
 * unknown macro renders as its own name in a muted colour, an unclosed group
 * closes itself at the end, a stray `}` is dropped. A reader typing at speed
 * gets a wrong-looking formula, never a broken page.
 *
 * The whole file is pure and DOM-free — it returns a STRING — so the layout
 * decisions unit-test in Node.
 */

// ---------------------------------------------------------------------------
// The symbol table
// ---------------------------------------------------------------------------

/** Macros that stand for one glyph. Everything else is structure. */
const SYMBOLS: Readonly<Record<string, string>> = {
  // greek, lower
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ',
  varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς',
  tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω',
  // greek, upper
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // binary operators
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '⋅', ast: '∗',
  star: '⋆', circ: '∘', bullet: '∙', oplus: '⊕', ominus: '⊖',
  otimes: '⊗', odot: '⊙', wedge: '∧', vee: '∨', setminus: '∖',
  // relations
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅',
  propto: '∝', ll: '≪', gg: '≫', subset: '⊂', subseteq: '⊆',
  supset: '⊃', supseteq: '⊇', in: '∈', notin: '∉', ni: '∋',
  cup: '∪', cap: '∩', perp: '⊥', parallel: '∥', mid: '∣',
  // arrows
  to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←',
  Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔',
  mapsto: '↦', uparrow: '↑', downarrow: '↓', implies: '⟹', iff: '⟺',
  // quantifiers and logic
  forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬',
  therefore: '∴', because: '∵',
  // misc
  infty: '∞', partial: '∂', nabla: '∇', emptyset: '∅', varnothing: '∅',
  aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', wp: '℘',
  angle: '∠', triangle: '△', square: '□', diamond: '⋄',
  // Delimiters also work without an explicit `\left` / `\right` pair.
  // `FENCE_GLYPHS` below handles the growing form; these entries are the
  // ordinary form used by formulas such as `\lceil\log_2 5\rceil`.
  langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  vert: '|', Vert: '‖',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…',
  prime: '′', degree: '°', percent: '%', checkmark: '✓',
  // spacing macros collapse to a thin space
  ',': ' ', ';': ' ', ':': ' ', '!': '',
  // escaped punctuation
  '{': '{', '}': '}', $: '$', '&': '&', '#': '#', _: '_', '%': '%',
  backslash: '\\',
};

/** Big operators — they take their limits ABOVE and BELOW when displayed. */
const BIG_OPERATORS: Readonly<Record<string, string>> = {
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭',
  oint: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂',
  bigvee: '⋁', bigwedge: '⋀',
};

/** Function names — set upright, and given a thin space before their argument. */
const FUNCTIONS: readonly string[] = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg',
  'max', 'min', 'sup', 'inf', 'lim', 'limsup', 'liminf', 'mod', 'Pr',
];

/** `\lim` and friends stack their limits like a big operator does. */
const LIMIT_FUNCTIONS: readonly string[] = ['lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf'];

/** Every macro this renderer knows, for the cheat sheet and the tests. */
export const KNOWN_MACROS: readonly string[] = [
  ...Object.keys(SYMBOLS),
  ...Object.keys(BIG_OPERATORS),
  ...FUNCTIONS,
  'frac', 'dfrac', 'tfrac', 'sqrt',
  'text', 'textrm', 'mathrm', 'textbf', 'mathbf', 'mathit', 'operatorname',
  'bar', 'overline', 'boxed',
  'mathbin', 'mathrel', 'mathord', 'mathop',
  'mathopen', 'mathclose', 'mathpunct', 'mathinner',
  'limits', 'nolimits', 'left', 'right', 'quad', 'qquad',
];

/**
 * Rendering is deliberately bounded while the stored LaTeX remains exact.
 * A pasted megabyte of braces must not lock the reader while producing a
 * megabyte of nested spans. The source attribute/node JSON is untouched; this
 * cap governs only the disposable presentation tree.
 */
export const MAX_RENDER_LATEX_CHARACTERS = 20_000;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'macro'; name: string }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'sup' }
  | { kind: 'sub' }
  | { kind: 'char'; text: string }
  | { kind: 'space' };

const LETTER = /[A-Za-z]/;
const DIGIT = /[0-9]/;

function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\\') {
      i += 1;
      if (i >= source.length) break;
      const next = source[i]!;
      if (LETTER.test(next)) {
        let name = '';
        while (i < source.length && LETTER.test(source[i]!)) {
          name += source[i]!;
          i += 1;
        }
        out.push({ kind: 'macro', name });
      } else {
        out.push({ kind: 'macro', name: next });
        i += 1;
      }
      continue;
    }
    if (ch === '{') {
      out.push({ kind: 'open' });
      i += 1;
      continue;
    }
    if (ch === '}') {
      out.push({ kind: 'close' });
      i += 1;
      continue;
    }
    if (ch === '^') {
      out.push({ kind: 'sup' });
      i += 1;
      continue;
    }
    if (ch === '_') {
      out.push({ kind: 'sub' });
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      out.push({ kind: 'space' });
      i += 1;
      continue;
    }
    if (DIGIT.test(ch)) {
      let number = '';
      while (i < source.length && (DIGIT.test(source[i]!) || source[i] === '.')) {
        number += source[i]!;
        i += 1;
      }
      out.push({ kind: 'char', text: number });
      continue;
    }
    out.push({ kind: 'char', text: ch });
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

export type Atom =
  /** One glyph, with the class that says how it is set. */
  | { kind: 'glyph'; text: string; role: 'var' | 'num' | 'bin' | 'rel' | 'punct' | 'open' | 'close' | 'ord' | 'fn' }
  | { kind: 'row'; body: Atom[] }
  | { kind: 'frac'; num: Atom[]; den: Atom[]; small: boolean }
  | { kind: 'root'; index: Atom[] | null; body: Atom[] }
  | { kind: 'overline'; body: Atom[]; short: boolean }
  | { kind: 'boxed'; body: Atom[] }
  | { kind: 'classed'; body: Atom[]; role: 'bin' | 'rel' | 'ord' | 'fn' | 'open' | 'close' | 'punct' | 'inner' }
  | { kind: 'namedOperator'; text: string; stackLimits: boolean }
  | { kind: 'script'; base: Atom; sup: Atom[] | null; sub: Atom[] | null; limits: boolean }
  | { kind: 'text'; text: string; upright: boolean; bold: boolean }
  | { kind: 'fence'; open: string; close: string; body: Atom[] }
  | { kind: 'space'; wide: boolean }
  | { kind: 'unknown'; name: string };

const BINARY = new Set(['+', '-', '*', '/', '±', '∓', '×', '÷', '⋅', '∗', '⋆', '∘', '∙', '⊕', '⊖', '⊗', '⊙', '∧', '∨', '∖']);
const RELATION = new Set(['=', '<', '>', '≤', '≥', '≠', '≈', '≡', '∼', '≃', '≅', '∝', '≪', '≫', '⊂', '⊆', '⊃', '⊇', '∈', '∉', '∋', '⊥', '∥', '→', '←', '↔', '⇒', '⇐', '⇔', '↦', '⟹', '⟺', ':']);
const OPEN_DELIM = new Set(['(', '[', '{', '⟨', '|', '‖', '⌊', '⌈']);
const CLOSE_DELIM = new Set([')', ']', '}', '⟩', '⌋', '⌉']);
const PUNCT = new Set([',', ';', '.', '!', '?']);

function glyphRole(text: string): Extract<Atom, { kind: 'glyph' }>['role'] {
  if (text.length === 1 && LETTER.test(text)) return 'var';
  if (DIGIT.test(text[0] ?? '')) return 'num';
  if (BINARY.has(text)) return 'bin';
  if (RELATION.has(text)) return 'rel';
  if (OPEN_DELIM.has(text)) return 'open';
  if (CLOSE_DELIM.has(text)) return 'close';
  if (PUNCT.has(text)) return 'punct';
  return 'ord';
}

/** Delimiter macros `\left`/`\right` accept these; `.` means "nothing". */
const FENCE_GLYPHS: Readonly<Record<string, string>> = {
  '(': '(', ')': ')', '[': '[', ']': ']', '|': '|',
  '.': '', langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', vert: '|', Vert: '‖',
};

interface Cursor {
  /** Private parser buffer. Commands may split a compact numeric token when
   * TeX's one-token argument rule requires it (`\frac12` = 1 over 2). */
  readonly tokens: Token[];
  index: number;
}

function peek(cursor: Cursor): Token | undefined {
  return cursor.tokens[cursor.index];
}

/** The next group: `{…}` as a row, or the single atom that follows. */
function parseArgument(cursor: Cursor): Atom[] {
  while (peek(cursor)?.kind === 'space') cursor.index += 1;
  const token = peek(cursor);
  if (token === undefined) return [];
  if (token.kind === 'open') {
    cursor.index += 1;
    return parseRow(cursor, true);
  }
  const atom = parseNucleus(cursor);
  return atom === null ? [] : [atom];
}

/**
 * One command argument with TeX's actual unbraced-token semantics.
 *
 * The ordinary tokenizer deliberately keeps `12.5` together so a number is
 * one glyph run. A command without braces is different: `\frac12` means the
 * next token (`1`) is the numerator and the following token (`2`) is the
 * denominator. Splitting only this private token buffer preserves compact
 * ordinary numbers while making AI-authored shorthand fractions correct.
 */
function parseCommandArgument(cursor: Cursor): Atom[] {
  while (peek(cursor)?.kind === 'space') cursor.index += 1;
  const token = peek(cursor);
  if (token?.kind === 'char' && token.text.length > 1) {
    const first = token.text[0]!;
    const rest = token.text.slice(1);
    cursor.tokens[cursor.index] = { kind: 'char', text: rest };
    return [{ kind: 'glyph', text: first, role: glyphRole(first) }];
  }
  return parseArgument(cursor);
}

/** `[…]` — only `\sqrt` takes one, and only immediately. */
function parseOptionalArgument(cursor: Cursor): Atom[] | null {
  const token = peek(cursor);
  if (token === undefined || token.kind !== 'char' || token.text !== '[') return null;
  cursor.index += 1;
  const body: Atom[] = [];
  while (cursor.index < cursor.tokens.length) {
    const next = peek(cursor)!;
    if (next.kind === 'char' && next.text === ']') {
      cursor.index += 1;
      break;
    }
    const atom = parseAtom(cursor);
    if (atom === null) break;
    body.push(atom);
  }
  return body;
}

/** Everything up to `}` (or the end — an unclosed group closes itself). */
function parseRow(cursor: Cursor, untilClose: boolean): Atom[] {
  const body: Atom[] = [];
  while (cursor.index < cursor.tokens.length) {
    const token = peek(cursor)!;
    if (token.kind === 'close') {
      cursor.index += 1;
      if (untilClose) return body;
      continue; // a stray `}` is dropped rather than fatal
    }
    const atom = parseAtom(cursor);
    if (atom === null) break;
    body.push(atom);
  }
  return body;
}

/** Read the plain text of a `\text{…}`-style argument, braces and all. */
function parseTextArgument(cursor: Cursor): string {
  while (peek(cursor)?.kind === 'space') cursor.index += 1;
  if (peek(cursor)?.kind !== 'open') {
    const token = peek(cursor);
    if (token === undefined) return '';
    cursor.index += 1;
    return token.kind === 'char' ? token.text : '';
  }
  cursor.index += 1;
  let depth = 1;
  let text = '';
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index]!;
    cursor.index += 1;
    if (token.kind === 'open') {
      depth += 1;
      text += '{';
    } else if (token.kind === 'close') {
      depth -= 1;
      if (depth === 0) break;
      text += '}';
    } else if (token.kind === 'space') text += ' ';
    else if (token.kind === 'char') text += token.text;
    else if (token.kind === 'macro') text += `\\${token.name}`;
    else if (token.kind === 'sup') text += '^';
    else if (token.kind === 'sub') text += '_';
  }
  return text;
}

function macroAtom(cursor: Cursor, name: string): Atom | null {
  // TeX's control-space (`\ `) requests an inter-word space after a command.
  // AI-authored equations use it naturally before `\text{…}`; treating the
  // blank command name as unknown painted a literal red `\ ` in an otherwise
  // valid formula such as `\bar{L}=2.15\ \text{bits per sound}`.
  if (name === ' ') return { kind: 'space', wide: false };
  if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
    return {
      kind: 'frac',
      num: parseCommandArgument(cursor),
      den: parseCommandArgument(cursor),
      small: name === 'tfrac',
    };
  }
  if (name === 'sqrt') {
    const index = parseOptionalArgument(cursor);
    return { kind: 'root', index, body: parseCommandArgument(cursor) };
  }
  if (name === 'bar' || name === 'overline') {
    return { kind: 'overline', body: parseCommandArgument(cursor), short: name === 'bar' };
  }
  if (name === 'boxed') {
    return { kind: 'boxed', body: parseCommandArgument(cursor) };
  }
  if (
    name === 'mathbin' ||
    name === 'mathrel' ||
    name === 'mathord' ||
    name === 'mathop' ||
    name === 'mathopen' ||
    name === 'mathclose' ||
    name === 'mathpunct' ||
    name === 'mathinner'
  ) {
    const role = ({
      mathbin: 'bin',
      mathrel: 'rel',
      mathord: 'ord',
      mathop: 'fn',
      mathopen: 'open',
      mathclose: 'close',
      mathpunct: 'punct',
      mathinner: 'inner',
    } as const)[name];
    return { kind: 'classed', body: parseCommandArgument(cursor), role };
  }
  if (name === 'operatorname') {
    // KaTeX/LaTeX's starred form is the common spelling for a named operator
    // whose bounds belong above/below in display maths (`\operatorname*{argmax}`).
    const star = peek(cursor);
    const stackLimits = star?.kind === 'char' && star.text === '*';
    if (stackLimits) cursor.index += 1;
    return {
      kind: 'namedOperator',
      text: parseTextArgument(cursor),
      stackLimits,
    };
  }
  if (name === 'text' || name === 'mathrm' || name === 'textrm') {
    return { kind: 'text', text: parseTextArgument(cursor), upright: true, bold: false };
  }
  if (name === 'mathbf' || name === 'textbf') {
    return { kind: 'text', text: parseTextArgument(cursor), upright: true, bold: true };
  }
  if (name === 'mathit') {
    return { kind: 'text', text: parseTextArgument(cursor), upright: false, bold: false };
  }
  if (name === 'quad' || name === 'qquad') {
    return { kind: 'space', wide: name === 'qquad' };
  }
  if (name === 'left' || name === 'right') return fenceAtom(cursor, name);
  const big = BIG_OPERATORS[name];
  if (big !== undefined) return { kind: 'glyph', text: big, role: 'fn' };
  if (FUNCTIONS.includes(name)) return { kind: 'text', text: name, upright: true, bold: false };
  const symbol = SYMBOLS[name];
  if (symbol !== undefined) {
    return symbol === '' ? { kind: 'space', wide: false } : { kind: 'glyph', text: symbol, role: glyphRole(symbol) };
  }
  return { kind: 'unknown', name };
}

/** `\left( … \right)` — the body, plus the pair that grows around it. */
function fenceAtom(cursor: Cursor, which: string): Atom {
  const readDelim = (): string => {
    while (peek(cursor)?.kind === 'space') cursor.index += 1;
    const token = peek(cursor);
    if (token === undefined) return '';
    cursor.index += 1;
    if (token.kind === 'char') return FENCE_GLYPHS[token.text] ?? token.text;
    if (token.kind === 'macro') return FENCE_GLYPHS[token.name] ?? SYMBOLS[token.name] ?? '';
    if (token.kind === 'open') return '{';
    if (token.kind === 'close') return '}';
    return '';
  };
  // A `\right` with no `\left` is somebody mid-edit; render its delimiter.
  if (which === 'right') {
    return { kind: 'glyph', text: readDelim(), role: 'close' };
  }
  const open = readDelim();
  const body: Atom[] = [];
  let close = '';
  while (cursor.index < cursor.tokens.length) {
    const token = peek(cursor)!;
    if (token.kind === 'macro' && token.name === 'right') {
      cursor.index += 1;
      close = readDelim();
      break;
    }
    if (token.kind === 'close') {
      // Ran out of group before `\right` — close the fence here.
      break;
    }
    const atom = parseAtom(cursor);
    if (atom === null) break;
    body.push(atom);
  }
  return { kind: 'fence', open, close, body };
}

/**
 * True when a base takes its scripts stacked over and under rather than
 * beside it — and only in display style, which is why the flag is read again
 * at render time.
 *
 * Integrals are the exception every typesetter makes: `\int_0^1` sets its
 * limits at the side even in display, because a bound stacked on a ∫ collides
 * with the line above it.
 */
const SIDE_LIMIT_OPERATORS = new Set([
  BIG_OPERATORS.int,
  BIG_OPERATORS.iint,
  BIG_OPERATORS.iiint,
  BIG_OPERATORS.oint,
]);

function takesLimits(atom: Atom): boolean {
  if (atom.kind === 'glyph' && atom.role === 'fn') {
    return (
      Object.values(BIG_OPERATORS).includes(atom.text) &&
      !SIDE_LIMIT_OPERATORS.has(atom.text)
    );
  }
  if (atom.kind === 'namedOperator') return atom.stackLimits;
  return atom.kind === 'text' && atom.upright && LIMIT_FUNCTIONS.includes(atom.text);
}

/**
 * One atom WITHOUT its scripts.
 *
 * The split matters: `x^2_i` is x with both scripts, not x with a superscript
 * of "2 subscript i". An argument of `^` or `_` is a nucleus, so it must not
 * be allowed to swallow the script that follows it.
 */
function parseNucleus(cursor: Cursor): Atom | null {
  const token = peek(cursor);
  if (token === undefined) return null;

  let base: Atom | null = null;
  switch (token.kind) {
    case 'space':
      cursor.index += 1;
      return { kind: 'space', wide: false };
    case 'open':
      cursor.index += 1;
      base = { kind: 'row', body: parseRow(cursor, true) };
      break;
    case 'close':
      return null;
    case 'macro':
      cursor.index += 1;
      base = macroAtom(cursor, token.name);
      break;
    case 'char':
      cursor.index += 1;
      base = { kind: 'glyph', text: token.text, role: glyphRole(token.text) };
      break;
    case 'sup':
    case 'sub':
      // A script with nothing in front of it: TeX errors, we render an empty
      // base so the reader sees where their exponent went.
      base = { kind: 'row', body: [] };
      break;
    default:
      return null;
  }
  return base;
}

function parseAtom(cursor: Cursor): Atom | null {
  const base = parseNucleus(cursor);
  if (base === null) return null;
  if (base.kind === 'space') return base;

  // Scripts, in either order, at most one of each. `\limits` and
  // `\nolimits` are postfix modifiers rather than visible atoms, and TeX lets
  // them sit before or after the scripts (`\sum\limits_{i=1}^n`). Treating
  // them as ordinary unknown macros detached the bounds from their operator.
  let sup: Atom[] | null = null;
  let sub: Atom[] | null = null;
  let forcedLimits: boolean | null = null;
  for (;;) {
    const next = peek(cursor);
    if (next === undefined) break;
    if (
      next.kind === 'macro' &&
      (next.name === 'limits' || next.name === 'nolimits')
    ) {
      cursor.index += 1;
      forcedLimits = next.name === 'limits';
      continue;
    }
    if (next.kind === 'sup' && sup === null) {
      cursor.index += 1;
      sup = parseArgument(cursor);
      continue;
    }
    if (next.kind === 'sub' && sub === null) {
      cursor.index += 1;
      sub = parseArgument(cursor);
      continue;
    }
    break;
  }
  if (sup === null && sub === null) return base;
  return {
    kind: 'script',
    base,
    sup,
    sub,
    limits: forcedLimits ?? takesLimits(base),
  };
}

/**
 * Parse `latex` into atoms. Total — any string produces a tree, and the tree
 * is what the tests read.
 */
export function parseMath(latex: string): Atom[] {
  if (latex.length > MAX_RENDER_LATEX_CHARACTERS) {
    return [{ kind: 'unknown', name: 'formula too long to render' }];
  }
  try {
    const cursor: Cursor = { tokens: tokenize(latex), index: 0 };
    return parseRow(cursor, false);
  } catch {
    // Deeply adversarial nesting can exhaust JavaScript's call stack before a
    // tolerant recursive parser reaches the closing brace. Parsing remains
    // total: show a visible diagnostic atom, while the exact source continues
    // to live in the node attribute and is available for editing/export.
    return [{ kind: 'unknown', name: 'invalid formula' }];
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * How tall a row stands, in "one line of maths" units.
 *
 * This is what makes `\left(` grow around a fraction rather than sit beside it
 * at the height of a comma. It is an estimate on purpose: exact metrics need
 * font measurement, and the whole point of this renderer is that it never
 * touches the DOM.
 */
export function atomHeight(atoms: readonly Atom[]): number {
  let tallest = 1;
  for (const atom of atoms) {
    let height = 1;
    switch (atom.kind) {
      case 'frac':
        height = atomHeight(atom.num) + atomHeight(atom.den);
        break;
      case 'root':
        height = atomHeight(atom.body) + 0.2;
        break;
      case 'overline':
        height = atomHeight(atom.body) + 0.18;
        break;
      case 'boxed':
        height = atomHeight(atom.body) + 0.25;
        break;
      case 'script':
        height = atom.limits
          ? atomHeight([atom.base]) + (atom.sup ? 0.7 : 0) + (atom.sub ? 0.7 : 0)
          : atomHeight([atom.base]) + 0.4;
        break;
      case 'fence':
        height = atomHeight(atom.body);
        break;
      case 'row':
        height = atomHeight(atom.body);
        break;
      default:
        height = 1;
    }
    if (height > tallest) tallest = height;
  }
  return tallest;
}

/**
 * A `+` or `−` with nothing to its left to bind to is a SIGN, not an
 * operation: `-b` is negative b, `a - b` is a subtraction, and the difference
 * is a whole space of air on the left. TeX decides this from what precedes the
 * symbol, and so does this — the row is the only place that knows.
 */
function isUnaryHere(atom: Atom, previous: Atom | undefined): boolean {
  if (atom.kind !== 'glyph' || atom.role !== 'bin') return false;
  if (atom.text !== '+' && atom.text !== '-' && atom.text !== '±' && atom.text !== '∓') {
    return false;
  }
  if (previous === undefined) return true;
  if (previous.kind !== 'glyph') return false;
  return (
    previous.role === 'bin' ||
    previous.role === 'rel' ||
    previous.role === 'open' ||
    previous.role === 'punct'
  );
}

function renderRow(atoms: readonly Atom[], display: boolean): string {
  let previous: Atom | undefined;
  const out: string[] = [];
  for (const atom of atoms) {
    out.push(renderAtom(atom, display, isUnaryHere(atom, previous)));
    if (atom.kind !== 'space') previous = atom;
  }
  return out.join('');
}

function span(cls: string, inner: string, style?: string): string {
  const styleAttr = style === undefined ? '' : ` style="${style}"`;
  return `<span class="${cls}"${styleAttr}>${inner}</span>`;
}

function renderAtom(atom: Atom, display: boolean, unary = false): string {
  switch (atom.kind) {
    case 'glyph':
      return span(
        `nb-m-${atom.role}${unary ? ' is-unary' : ''}`,
        escapeHtml(atom.text),
      );
    case 'row':
      return span('nb-m-row', renderRow(atom.body, display));
    case 'text':
      return span(
        `nb-m-text${atom.upright ? '' : ' is-italic'}${atom.bold ? ' is-bold' : ''}`,
        escapeHtml(atom.text),
      );
    case 'namedOperator':
      return span('nb-m-text nb-m-operator-name', escapeHtml(atom.text));
    case 'space':
      return span(`nb-m-space${atom.wide ? ' is-wide' : ''}`, '');
    case 'unknown':
      return span('nb-m-unknown', escapeHtml(`\\${atom.name}`));
    case 'frac':
      return span(
        `nb-m-frac${atom.small ? ' is-small' : ''}`,
        span('nb-m-frac-num', renderRow(atom.num, display)) +
          span('nb-m-frac-den', renderRow(atom.den, display)),
      );
    case 'root': {
      const index =
        atom.index === null || atom.index.length === 0
          ? ''
          : span('nb-m-root-index', renderRow(atom.index, display));
      return span(
        'nb-m-root',
        `${index}<span class="nb-m-root-sign">√</span>${span(
          'nb-m-root-body',
          renderRow(atom.body, display),
        )}`,
      );
    }
    case 'overline':
      return span(
        `nb-m-overline${atom.short ? ' is-short' : ''}`,
        renderRow(atom.body, display),
      );
    case 'boxed':
      return span('nb-m-boxed', renderRow(atom.body, display));
    case 'classed':
      // The outer class is the classification the author explicitly asked
      // for. The first/last child retain their semantic markup but CSS removes
      // their edge spacing, preventing `\mathrel+` from receiving both the
      // relation's spacing and the nested plus's binary spacing.
      return span(`nb-m-classed nb-m-${atom.role}`, renderRow(atom.body, display));
    case 'fence': {
      // Scale the delimiters to the content instead of measuring it: one line
      // of maths is 1, a fraction is 2, and 1.05 of leading looks right.
      const height = atomHeight(atom.body);
      const scale = Math.min(2.6, Math.max(1, height * 1.05));
      const style = scale > 1.05 ? `transform: scaleY(${scale.toFixed(2)})` : undefined;
      const open =
        atom.open === '' ? '' : span('nb-m-fence-glyph', escapeHtml(atom.open), style);
      const close =
        atom.close === '' ? '' : span('nb-m-fence-glyph', escapeHtml(atom.close), style);
      return span('nb-m-fence', `${open}${span('nb-m-row', renderRow(atom.body, display))}${close}`);
    }
    case 'script': {
      const base = renderAtom(atom.base, display);
      if (atom.limits && display) {
        const over =
          atom.sup === null ? '' : span('nb-m-limit', renderRow(atom.sup, display));
        const under =
          atom.sub === null ? '' : span('nb-m-limit', renderRow(atom.sub, display));
        return span('nb-m-limits', `${over}${span('nb-m-big', base)}${under}`);
      }
      const scripts =
        (atom.sup === null ? '' : span('nb-m-sup', renderRow(atom.sup, display))) +
        (atom.sub === null ? '' : span('nb-m-sub', renderRow(atom.sub, display)));
      // One wrapping unit: a multiline safety layout may break BETWEEN atoms,
      // never between x and its exponent/subscript.
      return span('nb-m-scripted', `${base}${span('nb-m-scripts', scripts)}`);
    }
    default:
      return '';
  }
}

export interface MathRenderOptions {
  /** Display style: centred on its own line, limits stacked on big operators. */
  readonly display?: boolean;
}

/**
 * `latex` as HTML. Never throws; an empty or blank source renders a visible
 * placeholder rather than nothing, so an equation block is never invisible.
 */
export function mathToHtml(latex: string, options: MathRenderOptions = {}): string {
  const display = options.display ?? false;
  const cls = `nb-math-render${display ? ' is-display' : ''}`;
  if (latex.trim() === '') {
    return span(cls, span('nb-m-placeholder', display ? 'equation' : 'math'));
  }
  try {
    return span(cls, renderRow(parseMath(latex), display));
  } catch {
    // Belt and braces: the parser is written to be total, and this is what
    // happens if it ever stops being.
    return span(cls, span('nb-m-unknown', escapeHtml(latex)));
  }
}
