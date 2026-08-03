// @vitest-environment node
/**
 * tests/brand-consistency.test.ts — every surface agrees with brand.json.
 *
 * ## Why this exists
 *
 * Renaming this app is a scavenger hunt across fifteen files in four languages,
 * and the last one (Notebook -> Bellanote) left `main.rs` calling
 * `notebook_lib::run()` after the crate had become `bellanote`. The Rust binary
 * did not compile AT ALL, and it stayed that way through several commits,
 * because `tsc` and 1,480 vitest tests were green the whole time — neither of
 * them can see Rust, and nothing else in CI built the binary.
 *
 * That is the failure this file is for: a rename that half-lands and reports
 * success. Every check below is one place the last rename actually broke or
 * nearly broke.
 *
 * ## Why it reads files as TEXT
 *
 * Deliberately. Parsing Cargo.toml properly or compiling main.rs would be more
 * correct and would also make this test depend on a toml parser and a Rust
 * toolchain, which is how a guard like this ends up skipped in the one
 * environment that needed it. A regex over a file that is three lines long is
 * enough to catch a name that did not change.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname ?? process.cwd(), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

interface Brand {
  name: string;
  slug: string;
  identifier: string;
  welcomeBookTitle: string;
  legacyWelcomeTitles: string[];
  art: { master: string };
  doNotRename: Record<string, string>;
}

const brand = JSON.parse(read('brand.json')) as Brand;

describe('brand.json is the source of truth', () => {
  it('names an app, a slug and a reverse-DNS identifier', () => {
    expect(brand.name).toMatch(/^[A-Z]/);
    expect(brand.slug).toBe(brand.name.toLowerCase());
    expect(brand.identifier).toMatch(/^[a-z0-9.]+$/);
    expect(brand.identifier).toContain(brand.slug);
  });
});

describe('the JavaScript side', () => {
  it('package.json is named for the app', () => {
    expect((JSON.parse(read('package.json')) as { name: string }).name).toBe(brand.slug);
  });

  it('the window title and the document title are the app', () => {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
      productName: string;
      identifier: string;
      app: { windows: Array<{ title: string }> };
    };
    expect(conf.productName).toBe(brand.name);
    expect(conf.identifier).toBe(brand.identifier);
    expect(conf.app.windows[0]?.title).toBe(brand.name);
    expect(read('index.html')).toContain(`<title>${brand.name}</title>`);
  });
});

describe('the Rust side', () => {
  const cargo = read('src-tauri/Cargo.toml');

  it('the crate and its lib are named for the app', () => {
    expect(cargo).toMatch(new RegExp(`^name = "${brand.slug}"$`, 'm'));
    expect(cargo).toMatch(new RegExp(`^name = "${brand.slug}_lib"$`, 'm'));
  });

  /**
   * THE ONE THAT BROKE.
   *
   * `main.rs` calls into the lib by its crate name, and that name is derived
   * from the app's — so a rename that misses this line produces a binary that
   * cannot be built, silently, for as long as nobody runs cargo.
   */
  it('main.rs calls the lib the Cargo manifest actually declares', () => {
    const libName = /^name = "([a-z0-9_]+_lib)"$/m.exec(cargo)?.[1];
    expect(libName, 'no [lib] name in Cargo.toml').toBeTruthy();
    expect(
      read('src-tauri/src/main.rs'),
      `main.rs must call ${libName}::run() — this is the line the last rename missed`,
    ).toContain(`${libName}::run()`);
  });
});

describe('what the reader sees', () => {
  it('the tray says the app name', () => {
    const tray = read('src-tauri/src/tray.rs');
    expect(tray).toContain(`"Open ${brand.name}"`);
    expect(tray).toContain(`.tooltip("${brand.name}")`);
  });

  it('a new bundle is stamped with the app name', () => {
    expect(read('src/features/transfer/format.ts')).toContain(`name: '${brand.name}'`);
  });

  it('the seeded book and the tour greet you by the app name', () => {
    expect(read('src/data/seed.ts')).toContain(brand.welcomeBookTitle);
    expect(read('src/features/tutorial/steps.ts')).toContain(`Welcome to ${brand.name}`);
  });

  it('the HTTP user agent identifies the app to third parties', () => {
    expect(read('src-tauri/src/media.rs')).toContain(`"${brand.name}/`);
  });
});

describe('the strings a rename must NOT touch', () => {
  /**
   * Each of these contains a past app name and breaks something real if it is
   * swept along with the rename. They are listed in brand.json with the reason;
   * this asserts they are still there.
   */
  it('keeps the writing language called Notebook Script', () => {
    expect(read('scripts/spec-template.md')).toContain('Notebook Script');
  });

  it('keeps the bundle format id, so old .nbk files still open', () => {
    expect(read('src/features/transfer/format.ts')).toContain("BUNDLE_FORMAT = 'notebook-bundle'");
  });

  /**
   * The welcome book's title is also the identity check that stops a second one
   * being seeded. Every past title has to stay reachable or a rename hands an
   * existing reader a duplicate book beside the one they have been writing in.
   */
  it('remembers every welcome-book title it has ever had', () => {
    const seed = read('src/data/seed.ts');
    expect(brand.legacyWelcomeTitles.length).toBeGreaterThan(0);
    for (const old of brand.legacyWelcomeTitles) {
      expect(seed, `seed.ts must still recognise the old title ${old}`).toContain(old);
    }
  });
});

describe('the art', () => {
  it('points at a master that exists', () => {
    expect(() => read(brand.art.master)).not.toThrow();
  });
});
