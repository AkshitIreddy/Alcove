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

  it('renders boxed expressions and keeps nested maths structural', () => {
    const html = mathToHtml('\\boxed{\\bar L = \\frac{a}{b}}', { display: true });

    expect(html).toContain('nb-m-boxed');
    expect(html).toContain('nb-m-overline is-short');
    expect(html).toContain('nb-m-frac');
    expect(html).not.toContain('nb-m-unknown');
    expect(parseMath('\\boxed{x}')[0]).toMatchObject({ kind: 'boxed' });
  });

  it('advertises the supported commands to generated documentation', () => {
    expect(KNOWN_MACROS).toEqual(
      expect.arrayContaining(['bar', 'overline', 'boxed']),
    );
  });
});
