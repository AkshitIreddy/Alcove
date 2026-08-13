import { describe, expect, it } from 'vitest';
import { KNOWN_MACROS, mathToHtml, parseMath } from '../src/editor/nodes/mathTex';

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

  it('renders TeX classification commands instead of leaking their source', () => {
    const compact = mathToHtml('a\\mathrel+b');
    const grouped = mathToHtml('x\\mathbin{\\star}y');

    expect(parseMath('\\mathrel+')[0]).toMatchObject({
      kind: 'classed',
      role: 'rel',
      body: [{ kind: 'glyph', text: '+' }],
    });
    expect(compact).toContain('class="nb-m-rel"');
    expect(compact).toContain('>+<');
    expect(grouped).toContain('class="nb-m-bin"');
    expect(grouped).toContain('>⋆<');
    expect(compact).not.toContain('\\mathrel');
    expect(grouped).not.toContain('\\mathbin');
  });

  it('advertises the supported commands to generated documentation', () => {
    expect(KNOWN_MACROS).toEqual(
      expect.arrayContaining(['bar', 'overline', 'boxed', 'mathrel', 'mathbin', 'lceil', 'rceil']),
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
});
