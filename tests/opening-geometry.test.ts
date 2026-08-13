import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const spreadCss = readFileSync('src/styles/spread.css', 'utf8');
const openingCss = readFileSync('src/styles/opening.css', 'utf8');
const readerCss = readFileSync('src/styles/reader.css', 'utf8');

describe('opening and live page geometry contract', () => {
  it('shares one fixed 1334 by 920 canvas', () => {
    expect(spreadCss).toMatch(/\.nb-spread-fit-frame\s*\{[\s\S]*?width:\s*1334px;[\s\S]*?height:\s*920px;/);
    expect(openingCss).toMatch(/\.nb-opening-fit-frame\s*\{[\s\S]*?width:\s*1334px;[\s\S]*?height:\s*920px;/);
  });

  it('keeps focus modes camera-only', () => {
    expect(readerCss).not.toMatch(/data-focus-level='(?:page|leaf)'[^}]*\.nb-spread-stage\s*\{[^}]*width:/);
    expect(readerCss).not.toMatch(/data-solo-leaf[^}]*\{[^}]*flex:\s*0\s+0\s+0/);
  });

  it('keeps the thumbnail filmstrip out of paper layout flow', () => {
    expect(spreadCss).toMatch(/\.nb-thumb-strip\s*\{[\s\S]*?position:\s*absolute;/);
  });
});
