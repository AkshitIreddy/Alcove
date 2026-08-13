import { describe, expect, it } from 'vitest';
import {
  MAX_RENDER_LATEX_CHARACTERS,
  KNOWN_MACROS,
  mathToHtml,
  parseMath,
} from '../src/editor/nodes/mathTex';
import {
  displayMathFitPlan,
  displayMathFitScale,
  mathLatexAttribute,
  mathLatexSource,
} from '../src/editor/nodes/math';

describe('Notebook maths structural commands', () => {
  it('renders bar and overline as accents instead of unknown macro text', () => {
    const short = mathToHtml('\\bar L');
    const long = mathToHtml('\\overline{AB}');

    expect(short).toContain('nb-m-overline is-short');
    expect(short).toContain('>L<');
    expect(long).toContain('nb-m-overline');
    expect(long).toContain('>A<');
    expect(long).toContain('>B<');
    expect(short).not.toContain('nb-m-unknown');
    expect(long).not.toContain('nb-m-unknown');
  });

  it('renders the exact AI-authored average-length formula including TeX control-space', () => {
    const latex = '\\bar{L} = 2.15\\ \\text{bits per sound}';
    const html = mathToHtml(latex, { display: true });

    expect(parseMath(latex)).toMatchObject([
      { kind: 'overline', short: true },
      { kind: 'space' },
      { kind: 'glyph', text: '=', role: 'rel' },
      { kind: 'space' },
      { kind: 'glyph', text: '2.15', role: 'num' },
      { kind: 'space' },
      { kind: 'text', text: 'bits per sound', upright: true },
    ]);
    expect(html).toContain('nb-m-overline is-short');
    expect(html).toContain('>bits per sound<');
    expect(html).not.toContain('nb-m-unknown');
  });

  it('renders boxed expressions and keeps nested maths structural', () => {
    const html = mathToHtml('\\boxed{\\bar L = \\frac{a}{b}}', { display: true });

    expect(html).toContain('nb-m-boxed');
    expect(html).toContain('nb-m-overline is-short');
    expect(html).toContain('nb-m-frac');
    expect(html).not.toContain('nb-m-unknown');
    expect(parseMath('\\boxed{x}')[0]).toMatchObject({ kind: 'boxed' });
  });

  it.each([
    ['mathbin', 'bin', '+'],
    ['mathrel', 'rel', '+'],
    ['mathord', 'ord', '+'],
    ['mathop', 'fn', '+'],
    ['mathopen', 'open', '+'],
    ['mathclose', 'close', '+'],
    ['mathpunct', 'punct', '+'],
    ['mathinner', 'inner', '+'],
  ] as const)(
    'renders TeX classification command \\%s as one classified atom',
    (command, role, glyph) => {
      const latex = `a\\${command}{${glyph}}b`;
      const parsed = parseMath(`\\${command}{${glyph}}`);
      const html = mathToHtml(latex);

      expect(parsed[0]).toMatchObject({
        kind: 'classed',
        role,
        body: [{ kind: 'glyph', text: glyph }],
      });
      expect(html).toContain(`class="nb-m-classed nb-m-${role}"`);
      expect(html).toContain(`>${glyph}<`);
      expect(html).not.toContain(`\\${command}`);
      expect(html).not.toContain('nb-m-unknown');
    },
  );

  it('keeps internal classified-subformula spacing without double charging its edges', () => {
    const compact = mathToHtml('a\\mathrel+b');
    const grouped = mathToHtml('x\\mathbin{a+\\star b}y');

    expect(compact).toContain('class="nb-m-classed nb-m-rel"');
    expect(compact).toContain('class="nb-m-bin is-unary"');
    expect(grouped).toContain('class="nb-m-classed nb-m-bin"');
    expect(grouped).toContain('>⋆<');
  });

  it('renders named and explicit operators, including limits modifiers', () => {
    const named = parseMath(String.raw`\operatorname{argmax}_{x}`);
    const forced = parseMath(String.raw`\mathop{score}\limits_{x}^{n}`);
    const side = parseMath(String.raw`\sum\nolimits_{i=1}^{n}`);
    const stacked = parseMath(String.raw`\int\limits_{0}^{1}`);

    expect(named[0]).toMatchObject({
      kind: 'script',
      base: { kind: 'namedOperator', text: 'argmax', stackLimits: false },
      limits: false,
    });
    expect(forced[0]).toMatchObject({
      kind: 'script',
      base: { kind: 'classed', role: 'fn' },
      limits: true,
    });
    expect(side[0]).toMatchObject({
      kind: 'script',
      base: { kind: 'glyph', text: '∑' },
      limits: false,
    });
    expect(stacked[0]).toMatchObject({
      kind: 'script',
      base: { kind: 'glyph', text: '∫' },
      limits: true,
    });

    expect(mathToHtml(String.raw`\operatorname{argmax}_{x}`)).toContain('>argmax<');
    expect(mathToHtml(String.raw`\mathop{score}\limits_{x}^{n}`, { display: true }))
      .toContain('nb-m-limits');
    expect(mathToHtml(String.raw`\sum\nolimits_{i=1}^{n}`, { display: true }))
      .not.toContain('nb-m-limits');
    expect(mathToHtml(String.raw`\int\limits_{0}^{1}`, { display: true }))
      .toContain('nb-m-limits');

    const starred = parseMath(String.raw`\operatorname*{argmax}_{x}`);
    expect(starred[0]).toMatchObject({
      kind: 'script',
      base: { kind: 'namedOperator', text: 'argmax', stackLimits: true },
      limits: true,
    });
    expect(mathToHtml(String.raw`\operatorname*{argmax}_{x}`, { display: true }))
      .toContain('nb-m-limits');
  });

  it('advertises the supported commands to generated documentation', () => {
    expect(KNOWN_MACROS).toEqual(
      expect.arrayContaining([
        'bar', 'overline', 'boxed',
        'mathbin', 'mathrel', 'mathord', 'mathop',
        'mathopen', 'mathclose', 'mathpunct', 'mathinner',
        'operatorname', 'limits', 'nolimits',
        'textrm', 'textbf', 'lceil', 'rceil',
      ]),
    );
  });

  it('renders ordinary ceiling delimiters around the exact logarithm form an AI writes', () => {
    const latex = '\\lceil\\log_2 5\\rceil';
    const html = mathToHtml(latex);

    expect(parseMath(latex)).toMatchObject([
      { kind: 'glyph', text: '⌈', role: 'open' },
      { kind: 'script', base: { kind: 'text', text: 'log' }, sub: [{ kind: 'glyph', text: '2' }] },
      { kind: 'space' },
      { kind: 'glyph', text: '5', role: 'num' },
      { kind: 'glyph', text: '⌉', role: 'close' },
    ]);
    expect(html).toContain('>⌈<');
    expect(html).toContain('>⌉<');
    expect(html).not.toContain('nb-m-unknown');
  });

  it('keeps ceiling delimiters compatible with growing left/right fences', () => {
    const html = mathToHtml('\\left\\lceil \\frac{n}{2} \\right\\rceil');

    expect(html).toContain('nb-m-fence');
    expect(html).toContain('⌈');
    expect(html).toContain('⌉');
    expect(html).toContain('nb-m-frac');
    expect(html).not.toContain('nb-m-unknown');
  });

  it('renders AI shorthand fractions as one-token numerator and denominator', () => {
    const parsed = parseMath('2^{-1}=\\frac12+\\frac14+\\frac18+\\frac1{16}');
    const fractions = parsed.filter((atom) => atom.kind === 'frac');

    expect(fractions).toEqual([
      { kind: 'frac', num: [{ kind: 'glyph', text: '1', role: 'num' }], den: [{ kind: 'glyph', text: '2', role: 'num' }], small: false },
      { kind: 'frac', num: [{ kind: 'glyph', text: '1', role: 'num' }], den: [{ kind: 'glyph', text: '4', role: 'num' }], small: false },
      { kind: 'frac', num: [{ kind: 'glyph', text: '1', role: 'num' }], den: [{ kind: 'glyph', text: '8', role: 'num' }], small: false },
      { kind: 'frac', num: [{ kind: 'glyph', text: '1', role: 'num' }], den: [{ kind: 'glyph', text: '16', role: 'num' }], small: false },
    ]);
    expect(mathToHtml('\\frac12')).toContain('nb-m-frac-den\"><span class="nb-m-num">2<');
  });

  it('preserves exact source bytes through node attrs and HTML attrs', () => {
    const source = String.raw`  \mathop{score}\limits_{x_1}^{n+1} + \text{kitten & <tag>}  `;
    const node = { attrs: { latex: source } } as never;
    const element = {
      getAttribute: (name: string) => name === 'data-latex' ? source : null,
      textContent: 'fallback must not win',
    } as HTMLElement;

    expect(mathLatexSource(node)).toBe(source);
    expect(mathLatexAttribute.renderHTML({ latex: source })).toEqual({
      'data-latex': source,
    });
    expect(mathLatexAttribute.parseHTML(element)).toBe(source);
    expect(mathLatexSource({ attrs: { latex: 42 } } as never)).toBe('');
    expect(mathLatexAttribute.renderHTML({ latex: null })).toEqual({
      'data-latex': '',
    });
  });

  it('keeps display fitting in canonical layout pixels and independent of camera scale', () => {
    const intrinsic = displayMathFitScale(500, 800);
    expect(intrinsic).toBeCloseTo(0.6225, 8);
    // A camera may draw those same boxes at 31%, 100% or 240%; neither drawn
    // rectangle is an input to the decision.
    for (const camera of [0.31, 1, 2.4]) {
      expect(displayMathFitScale(500, 800)).toBe(intrinsic);
      expect(500 * camera).not.toBeNaN();
    }
    expect(displayMathFitScale(500, 2_000)).toBe(0.62);
    expect(displayMathFitPlan(500, 2_000)).toEqual({ scale: 0.62, wrap: true });
    expect(displayMathFitPlan(500, 800)).toEqual({ scale: 0.6225, wrap: false });
    expect(displayMathFitScale(500, 500)).toBeNull();
    expect(displayMathFitScale(500, 499.9)).toBeNull();
    expect(displayMathFitScale(0, 800)).toBeNull();
    expect(displayMathFitScale(Number.NaN, 800)).toBeNull();
  });

  it('is total and HTML-safe for malformed and adversarial source', () => {
    const hostile = [
      '',
      '   ',
      '}',
      '{{{{',
      String.raw`\frac`,
      String.raw`\frac{a`,
      String.raw`\sqrt[3{x}`,
      String.raw`\left(\frac{a}{b}`,
      String.raw`\right\rceil`,
      String.raw`x^^__{{`,
      String.raw`\unknown<script>alert(1)</script>`,
      '\u0000\ud800\udfff',
    ];

    for (const source of hostile) {
      expect(() => parseMath(source)).not.toThrow();
      expect(() => mathToHtml(source, { display: true })).not.toThrow();
      const html = mathToHtml(source, { display: true });
      expect(html).toMatch(/^<span class="nb-math-render is-display">/);
      expect(html).not.toContain('<script>');
    }

    const deeplyNested = `${'{'.repeat(15_000)}x${'}'.repeat(15_000)}`;
    expect(parseMath(deeplyNested)).toEqual([
      { kind: 'unknown', name: 'formula too long to render' },
    ]);
    expect(mathToHtml(deeplyNested)).toContain('formula too long to render');

    const stackDepth = `${'{'.repeat(8_000)}x${'}'.repeat(8_000)}`;
    expect(() => parseMath(stackDepth)).not.toThrow();
    expect(mathToHtml(stackDepth)).toContain('invalid formula');

    const oversized = 'x'.repeat(MAX_RENDER_LATEX_CHARACTERS + 1);
    expect(parseMath(oversized)).toEqual([
      { kind: 'unknown', name: 'formula too long to render' },
    ]);
  });
});
