// @vitest-environment node
/**
 * tests/media.test.ts — pure-logic tests for the media pipeline:
 *   1. fetchable-URL validation / SSRF guard (the TS mirror of the Rust
 *      guard in src-tauri/src/media.rs — used before invoking commands),
 *   2. asset rel_path → src resolver mapping,
 *   3. paste/drop decision matrix (classifyPaste) + image grouping.
 *
 * Runs in plain Node — only pure modules are imported (no DOM, no Tauri).
 */
import { describe, expect, it } from 'vitest';

import {
  checkFetchableUrl,
  hostOf,
  isBareUrl,
  isBlockedHost,
} from '../src/editor/media/urlGuard';
import {
  assetSrcFromRoot,
  normalizeRelPath,
} from '../src/editor/media/resolver';
import {
  classifyPaste,
  groupImageSources,
  type PasteContext,
} from '../src/editor/media/classify';

/* --------------------------- URL guard (SSRF) ---------------------------- */

describe('checkFetchableUrl', () => {
  it('accepts public https URLs', () => {
    expect(checkFetchableUrl('https://example.com/page').ok).toBe(true);
    expect(checkFetchableUrl('https://api.openverse.org/v1/images/').ok).toBe(true);
    expect(checkFetchableUrl('  https://en.wikipedia.org/wiki/Mitosis ').ok).toBe(true);
    expect(checkFetchableUrl('https://8.8.8.8/x').ok).toBe(true);
  });

  it('rejects non-https schemes and garbage', () => {
    for (const url of [
      'http://example.com',
      'ftp://example.com/file',
      'file:///C:/secrets.txt',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(checkFetchableUrl(url).ok, url).toBe(false);
    }
  });

  it('rejects localhost-ish hostnames', () => {
    for (const url of [
      'https://localhost/x',
      'https://LOCALHOST:8080/x',
      'https://foo.localhost/x',
      'https://printer.local/x',
      'https://db.internal/x',
      'https://router.home.arpa/x',
      'https://intranet/x', // single-label hostname
    ]) {
      expect(checkFetchableUrl(url).ok, url).toBe(false);
    }
  });

  it('rejects private / reserved IP literals', () => {
    for (const url of [
      'https://127.0.0.1/x',
      'https://10.0.0.8/x',
      'https://172.16.4.1/x',
      'https://172.31.255.255/x',
      'https://192.168.1.10/x',
      'https://169.254.169.254/latest/meta-data', // cloud metadata
      'https://100.64.3.2/x', // CGNAT
      'https://0.0.0.0/x',
      'https://[::1]/x',
      'https://[fe80::1]/x',
      'https://[fd00::5]/x',
      'https://[::ffff:192.168.0.1]/x',
    ]) {
      expect(checkFetchableUrl(url).ok, url).toBe(false);
    }
  });

  it('does not reject public IPs bordering private ranges', () => {
    expect(checkFetchableUrl('https://172.15.0.1/x').ok).toBe(true);
    expect(checkFetchableUrl('https://172.32.0.1/x').ok).toBe(true);
    expect(checkFetchableUrl('https://11.0.0.1/x').ok).toBe(true);
    expect(checkFetchableUrl('https://100.128.0.1/x').ok).toBe(true);
  });

  it('reports a reason on rejection', () => {
    expect(checkFetchableUrl('http://example.com').reason).toMatch(/https/);
    expect(checkFetchableUrl('https://127.0.0.1/').reason).toMatch(/private|local/);
  });
});

describe('isBlockedHost', () => {
  it('handles trailing dots, brackets and case', () => {
    expect(isBlockedHost('LocalHost.')).toBe(true);
    expect(isBlockedHost('[::1]')).toBe(true);
    expect(isBlockedHost('Example.COM')).toBe(false);
  });
});

describe('isBareUrl', () => {
  it('accepts a single trimmed web URL', () => {
    expect(isBareUrl('https://example.com')).toBe(true);
    expect(isBareUrl('  http://example.com/a?b=c#d  ')).toBe(true);
  });

  it('rejects prose, multi-word text and other schemes', () => {
    expect(isBareUrl('see https://example.com for more')).toBe(false);
    expect(isBareUrl('https://example.com and more')).toBe(false);
    expect(isBareUrl('ftp://example.com')).toBe(false);
    expect(isBareUrl('example.com')).toBe(false);
    expect(isBareUrl('')).toBe(false);
  });
});

describe('hostOf', () => {
  it('extracts the hostname, stripping www.', () => {
    expect(hostOf('https://www.example.com/a/b')).toBe('example.com');
    expect(hostOf('https://docs.rs/reqwest')).toBe('docs.rs');
    expect(hostOf('not a url')).toBe('');
  });
});

/* ------------------------------ resolver -------------------------------- */

describe('asset resolver mapping', () => {
  it('normalizes rel_paths (slashes, dots, traversal)', () => {
    expect(normalizeRelPath('images/abc.png')).toBe('images/abc.png');
    expect(normalizeRelPath('images\\abc.png')).toBe('images/abc.png');
    expect(normalizeRelPath('/images//abc.png')).toBe('images/abc.png');
    expect(normalizeRelPath('../../etc/passwd')).toBe('etc/passwd');
    expect(normalizeRelPath('./images/./x.jpg')).toBe('images/x.jpg');
  });

  it('joins an assets root and rel_path deterministically', () => {
    expect(assetSrcFromRoot('C:\\Users\\a\\AppData\\Roaming\\app\\assets', 'images/x.png')).toBe(
      'C:/Users/a/AppData/Roaming/app/assets/images/x.png',
    );
    expect(assetSrcFromRoot('/data/assets/', 'images/x.png')).toBe(
      '/data/assets/images/x.png',
    );
    expect(assetSrcFromRoot('/data/assets', '\\images\\..\\images\\x.png')).toBe(
      '/data/assets/images/images/x.png',
    );
  });
});

/* ------------------------- paste decision matrix ------------------------- */

function context(overrides: Partial<PasteContext>): PasteContext {
  return {
    imageFileCount: 0,
    text: '',
    selectionEmpty: true,
    inCodeBlock: false,
    ...overrides,
  };
}

describe('classifyPaste', () => {
  it('image files always win, regardless of text', () => {
    expect(classifyPaste(context({ imageFileCount: 1 })).kind).toBe('insert-images');
    expect(
      classifyPaste(
        context({ imageFileCount: 3, text: 'https://example.com' }),
      ).kind,
    ).toBe('insert-images');
    expect(
      classifyPaste(context({ imageFileCount: 2, inCodeBlock: true })).kind,
    ).toBe('insert-images');
  });

  it('bare URL at an empty selection upgrades to a link card', () => {
    const action = classifyPaste(context({ text: ' https://example.com/x ' }));
    expect(action).toEqual({
      kind: 'insert-link-card',
      url: 'https://example.com/x',
    });
    // http URLs still make a card (it just stays a plain chip — no preview)
    expect(classifyPaste(context({ text: 'http://example.com' })).kind).toBe(
      'insert-link-card',
    );
  });

  it('keeps default paste for URL over a range selection (text link UX)', () => {
    expect(
      classifyPaste(
        context({ text: 'https://example.com', selectionEmpty: false }),
      ).kind,
    ).toBe('default');
  });

  it('never upgrades inside code blocks', () => {
    expect(
      classifyPaste(
        context({ text: 'https://example.com', inCodeBlock: true }),
      ).kind,
    ).toBe('default');
  });

  it('falls through for prose, empty text, and non-URLs', () => {
    expect(classifyPaste(context({ text: 'hello world' })).kind).toBe('default');
    expect(classifyPaste(context({ text: '' })).kind).toBe('default');
    expect(
      classifyPaste(context({ text: 'see https://example.com today' })).kind,
    ).toBe('default');
  });
});

describe('groupImageSources', () => {
  it('groups into rows of at most four', () => {
    expect(groupImageSources(['a'])).toEqual([['a']]);
    expect(groupImageSources(['a', 'b', 'c', 'd'])).toEqual([['a', 'b', 'c', 'd']]);
    expect(groupImageSources(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f'],
    ]);
    expect(groupImageSources([])).toEqual([]);
  });
});
