// @vitest-environment node
/**
 * tests/packaging.test.ts — the Windows installer, checked from the repository.
 *
 * The installer is the one surface with no runtime and no typechecker: an NSIS
 * script is text until `makensis` sees it, the two BMPs are bytes until MUI
 * loads them, and a wrong hex or a stale path shows up as an ugly installer on
 * somebody else's machine, weeks later. Everything here is a fact that can be
 * read off disk without building anything.
 *
 * What it is guarding, in the order it matters:
 *
 *  1. **The uninstaller keeps the library by default.** Alcove is a notes app.
 *     Tauri's own uninstall page ships that checkbox unticked and
 *     `src-tauri/installer/alcove.nsh` must never tick it — a future "helpful"
 *     default would be irreversible for whoever hits it first.
 *  2. **The hook file is actually wired up.** An installer hook that is written
 *     and not named in `tauri.conf.json` is this repository's signature defect
 *     wearing a different hat: it passes review, it is never included, and the
 *     installer quietly stays the stock one.
 *  3. **The identifier is spelt the same in both places.** `alcove.nsh` cannot
 *     read `${BUNDLEID}` — it is included above the line that defines it — so
 *     it spells `com.alcove.app` out, and the page that tells a reader where
 *     their books are would lie if the identifier were ever changed.
 *  4. **The palette agrees across three languages.** `MUI_BGCOLOR` in the NSIS
 *     file, the ground the BMPs are painted on in the Python, and `FLAT.cream`
 *     in the TypeScript are the same colour, or the header art sits on a
 *     visible rectangle of the wrong cream.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FLAT } from '../src/art/flat';

const ROOT = resolve(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

/** Every `.ts`/`.tsx` under `src/`, for the one scan below that needs them all. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx') out.push(full);
  }
  return out;
}

/** Comments blanked, so prose explaining a ban cannot trip the ban. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

const CONF = JSON.parse(read('src-tauri', 'tauri.conf.json'));
const NSIS = CONF.bundle.windows.nsis;
const HOOKS = read('src-tauri', 'installer', 'alcove.nsh');
const LANG = read('src-tauri', 'installer', 'English.nsh');
const GEN_ICONS = read('scripts', 'gen-icons.py');

/** A `!define NAME "value"` out of an .nsh, or undefined. */
function nsisDefine(source: string, name: string): string | undefined {
  const m = new RegExp(`^!define\\s+${name}\\s+"([^"]*)"`, 'm').exec(source);
  return m?.[1];
}

describe('the uninstaller keeps the library', () => {
  it('never pre-ticks the delete checkbox', () => {
    // Tauri's page creates the box unticked and stores the answer in
    // `$DeleteAppDataCheckboxState`. The hook file may READ that variable —
    // it prints which way the answer went — but an assignment to it, or a
    // BM_SETCHECK, would be the hook overriding the reader.
    expect(HOOKS).not.toMatch(/StrCpy\s+\$DeleteAppDataCheckboxState/);
    expect(HOOKS).not.toMatch(/BM_SETCHECK/i);
  });

  it('tells the reader where the library is, in a form they can act on', () => {
    // Both spellings have a job. The expanded one goes on a page where
    // $APPDATA resolves at runtime; the %APPDATA% one goes where the string is
    // baked at compile time and would otherwise ship the literal word APPDATA.
    expect(nsisDefine(HOOKS, 'ALCOVE_LIBRARY')).toBe('$APPDATA\\${ALCOVE_IDENTIFIER}');
    expect(nsisDefine(HOOKS, 'ALCOVE_LIBRARY_TYPED')).toBe('%APPDATA%\\${ALCOVE_IDENTIFIER}');
    // …and the page that shows it exists and is declared, not merely written.
    expect(HOOKS).toMatch(/^UninstPage custom un\.AlcoveLibraryPage$/m);
    expect(HOOKS).toMatch(/^Function un\.AlcoveLibraryPage$/m);
    expect(HOOKS).toMatch(/^Function un\.AlcoveOpenLibrary$/m);
  });

  it('aborts its extra page on a silent or update run', () => {
    // Tauri runs the OLD uninstaller during an upgrade. A page that stops on a
    // headless run hangs the install, and `$PassiveMode` is declared below the
    // include, so the flags are re-read from $CMDLINE.
    expect(HOOKS).toMatch(/\$\{GetOptions\} \$CMDLINE "\/P"/);
    expect(HOOKS).toMatch(/\$\{GetOptions\} \$CMDLINE "\/UPDATE"/);
  });
});

describe('the installer hooks are reached', () => {
  it('tauri.conf.json names the hook and language files, and they exist', () => {
    expect(NSIS.installerHooks).toBe('installer/alcove.nsh');
    expect(NSIS.customLanguageFiles).toEqual({ English: 'installer/English.nsh' });
    for (const rel of [NSIS.installerHooks, NSIS.customLanguageFiles.English]) {
      expect(existsSync(join(ROOT, 'src-tauri', rel)), `${rel} is missing`).toBe(true);
    }
  });

  it('spells the bundle identifier the same way tauri.conf.json does', () => {
    expect(nsisDefine(HOOKS, 'ALCOVE_IDENTIFIER')).toBe(CONF.identifier);
  });

  it('defines every hook macro it claims to', () => {
    // Only the two that have work to do. Tauri guards each insertion with
    // `!ifmacrodef`, so an absent macro is silent — which is exactly why the
    // ones that ARE meant to exist are pinned here.
    expect(HOOKS).toMatch(/^!macro NSIS_HOOK_POSTINSTALL$/m);
    expect(HOOKS).toMatch(/^!macro NSIS_HOOK_POSTUNINSTALL$/m);
  });

  it('ships every language string Tauri’s template asks for', () => {
    // This file REPLACES Tauri's own English.nsh, so a string the template
    // references and this file omits renders as the literal text `$(name)` on
    // a page. The list is the set Tauri 2.11 generates.
    const required = [
      'addOrReinstall', 'alreadyInstalled', 'alreadyInstalledLong', 'appRunning',
      'appRunningOkKill', 'chooseMaintenanceOption', 'choowHowToInstall', 'createDesktop',
      'deleteAppData', 'dontUninstall', 'dontUninstallDowngrade', 'failedToKillApp',
      'installingWebview2', 'newerVersionInstalled', 'older', 'olderOrUnknownVersionInstalled',
      'silentDowngrades', 'unableToUninstall', 'uninstallApp', 'uninstallBeforeInstalling',
      'unknown', 'webview2AbortError', 'webview2DownloadError', 'webview2DownloadSuccess',
      'webview2Downloading', 'webview2InstallError', 'webview2InstallSuccess',
    ];
    const defined = new Set(
      [...LANG.matchAll(/^LangString\s+(\w+)\s/gm)].map((m) => m[1]),
    );
    expect([...required].filter((n) => !defined.has(n))).toEqual([]);
  });

  it('carries no unrendered handlebars', () => {
    // Tauri writes `{{product_name}}` into its own English.nsh and never
    // renders it, so the stock installer really does say "{{product_name}} is
    // running!". Ours uses ${PRODUCTNAME}, which NSIS resolves.
    // Comment lines are exempt — the note in English.nsh that explains the
    // bug has to be able to quote it.
    const code = (s: string) => s.split(/\r?\n/).filter((l) => !/^\s*;/.test(l)).join('\n');
    expect(code(LANG)).not.toMatch(/\{\{/);
    expect(code(HOOKS)).not.toMatch(/\{\{/);
  });

  it('cross-checks against the last generated script, when one is on disk', () => {
    // Only true after a local `npx tauri build`; target/ is not in the repo, so
    // this is a bonus check rather than a gate. It catches a CLI upgrade that
    // adds a language string, which the pinned list above cannot.
    const generated = join(
      ROOT, 'src-tauri', 'target', 'release', 'nsis', 'x64', 'installer.nsi',
    );
    if (!existsSync(generated)) return;
    const script = readFileSync(generated, 'utf8');
    const defined = new Set([...LANG.matchAll(/^LangString\s+(\w+)\s/gm)].map((m) => m[1]));
    const used = new Set(
      [...script.matchAll(/\$\((\w+)\)/g)]
        .map((m) => m[1])
        // MUI's own strings and NSIS's built-ins (`$(^Name)`) are not ours.
        .filter((n) => !n.startsWith('MUI_') && !n.startsWith('_')),
    );
    expect([...used].filter((n) => !defined.has(n)).sort()).toEqual([]);
  });
});

describe('the installer art', () => {
  const bmp = (name: string) => {
    const b = readFileSync(join(ROOT, 'src-tauri', 'icons', name));
    expect(b.subarray(0, 2).toString('latin1'), `${name} is not a BMP`).toBe('BM');
    return {
      width: b.readInt32LE(18),
      height: b.readInt32LE(22),
      bits: b.readUInt16LE(28),
      // Bottom-up rows, so the FIRST pixel of the pixel array is the
      // bottom-left corner — which for both of these is background.
      corner: (() => {
        const off = b.readUInt32LE(10);
        return `#${b[off + 2].toString(16).padStart(2, '0')}${b[off + 1]
          .toString(16)
          .padStart(2, '0')}${b[off].toString(16).padStart(2, '0')}`;
      })(),
      bytes: b.length,
    };
  };

  it('is the exact size MUI2 draws, in 24-bit colour', () => {
    // MUI stretches whatever it is given to the control, so a wrong size is
    // not an error — it is a blurry one. 24-bit matters too: NSIS renders
    // these through a control that knows nothing about alpha, and a 32-bit BMP
    // arrives with a black box where the transparency was.
    const header = bmp('installer-header.bmp');
    expect([header.width, header.height]).toEqual([150, 57]);
    expect(header.bits).toBe(24);

    const sidebar = bmp('installer-sidebar.bmp');
    expect([sidebar.width, sidebar.height]).toEqual([164, 314]);
    expect(sidebar.bits).toBe(24);
  });

  it('is drawn, not a mark on a field', () => {
    // The bitmaps used to be `alcove-art.png` pasted onto a flat rectangle,
    // which is what every boring installer looks like. A drawn scene has a
    // wide range of colours in it; a mark on a field is mostly one colour.
    // Cheap proxy, and it is the thing that would silently regress if
    // `build_installer_art` were ever reverted to a paste.
    const b = readFileSync(join(ROOT, 'src-tauri', 'icons', 'installer-sidebar.bmp'));
    const off = b.readUInt32LE(10);
    const seen = new Set<number>();
    for (let i = off; i + 2 < b.length; i += 3) seen.add((b[i] << 16) | (b[i + 1] << 8) | b[i + 2]);
    expect(seen.size).toBeGreaterThan(400);
  });

  it('grounds the header on the same cream MUI_BGCOLOR paints behind it', () => {
    // The header BMP does not fill its control at every DPI, and MUI paints
    // MUI_BGCOLOR behind and beside it. Two different creams there is a
    // rectangle a reader can see.
    const bg = nsisDefine(HOOKS, 'MUI_BGCOLOR');
    expect(bg).toBeDefined();
    expect(`#${bg!.toLowerCase()}`).toBe(FLAT.cream);
    expect(bmp('installer-header.bmp').corner).toBe(FLAT.cream);
  });

  it('draws from the app’s palette, not a second one', () => {
    // gen-icons.py is Python and cannot import art/flat.ts, so it mirrors the
    // hexes. This is what stops the mirror becoming a fork.
    const block = /^FLAT = \{$([\s\S]*?)^\}$/m.exec(GEN_ICONS);
    expect(block, 'no FLAT dict in scripts/gen-icons.py').not.toBeNull();
    const mirrored = Object.fromEntries(
      [...block![1].matchAll(/^\s*"(\w+)":\s*"(#[0-9a-f]{6})",$/gm)].map((m) => [m[1], m[2]]),
    );
    expect(Object.keys(mirrored).length).toBeGreaterThan(15);
    const wrong = Object.entries(mirrored).filter(
      ([k, v]) => (FLAT as Record<string, string>)[k] !== v,
    );
    expect(wrong, 'gen-icons.py has drifted from src/art/flat.ts').toEqual([]);
  });

  it('is named by tauri.conf.json, or none of it ships', () => {
    for (const rel of [NSIS.headerImage, NSIS.sidebarImage, NSIS.installerIcon, NSIS.uninstallerIcon]) {
      expect(rel, 'an nsis image slot is unset').toBeTruthy();
      expect(existsSync(join(ROOT, 'src-tauri', rel)), `${rel} is missing`).toBe(true);
    }
  });
});

/**
 * The one webview flag that is invisible in dev and fatal once installed —
 * which is this file's whole subject, so it lives here rather than with the
 * editor tests that can never observe it.
 *
 * Tauri's window config defaults `dragDropEnabled` to TRUE (tauri-utils
 * `config.rs`, `#[serde(default = "default_true")]`). When it is on,
 * tauri-runtime-wry hands wry a drag-drop handler, and wry's Windows
 * implementation walks the WebView2 child HWNDs — its own comment reads
 * "Enumerate child windows to find the WebView2 window and override!" —
 * calling `RevokeDragDrop` on each and registering an `IDropTarget` that
 * accepts nothing but `CF_HDROP`. WebView2's own drop target is gone, so the
 * DOCUMENT never receives `dragenter`/`dragover`/`drop`. It also calls
 * `SetAllowExternalDrop(false)`.
 *
 * The result: `dragstart` still fires (that is source-side, so the handle
 * lights up and the tour's step-10 fact still ticks) but the block never
 * moves, and dropping an image file onto a page does nothing either. Tauri's
 * own doc comment on the field says it outright: "Disabling it is required to
 * use HTML5 drag and drop on the frontend on Windows."
 *
 * Every browser probe passes, because a browser has no wry in it. This is the
 * only place the fact can be pinned.
 */
describe('the webview lets the frontend drag', () => {
  it('turns Tauri’s OS drag-drop handler OFF, or block dragging is dead once installed', () => {
    expect(
      CONF.app.windows[0]?.dragDropEnabled,
      'dragDropEnabled defaults to true, which revokes WebView2’s drop target and kills ' +
        'the block drag handle and image file drop in the installed build',
    ).toBe(false);
  });

  /**
   * The absence this test's NAME claims, which it never actually checked.
   *
   * It asserted `pastePlugin.ts` contains the string `handleDrop`, and a file
   * containing a word is not a file doing anything. Put `return false;` at the
   * top of `handleDrop`'s body — image file drop is dead, in dev and in the
   * installed build alike — and it passed, because the word was still there.
   * Both halves are now checked, and neither is a grep:
   *
   *   the ABSENCE — nothing in `src/` subscribes to Tauri's own drag-drop
   *                 event, which the flag above has switched off and which
   *                 would therefore never fire (this test);
   *   the PRESENCE — the web-standard handler, RUN, against a drop carrying an
   *                 image file (the next one).
   */
  it('and nothing has started depending on Tauri’s drag-drop event instead', () => {
    // `dragDropEnabled: false` means these never fire. A reader who wires one
    // gets a handler that is silent in the installed build and silent in a
    // browser too, so nothing they can run would tell them.
    const TAURI_DRAG = /onDragDropEvent|TauriEvent\.DRAG_|['"`]tauri:\/\/drag-/;
    const offenders = sourceFiles(join(ROOT, 'src'))
      .filter((file) => TAURI_DRAG.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'));
    expect(
      offenders,
      'these listen for Tauri’s OS drag-drop event, which `dragDropEnabled: false` ' +
        'above has switched off — the listener will never fire in the installed app',
    ).toEqual([]);
  });

  it('and the web-standard path really takes a dropped image', async () => {
    // The plugin itself, run in node: `handleDrop` is a synchronous decision
    // (take the drop, prevent the default, kick off the async store) and every
    // part of that decision is observable from a stub view. `isDestroyed` is
    // true so the insert that follows the await bows out without a schema.
    const { createMediaPastePlugin } = await import('../src/editor/media/pastePlugin');
    const props = (createMediaPastePlugin() as unknown as {
      props: {
        handleDrop(view: unknown, event: unknown, slice: unknown, moved: boolean): boolean;
      };
    }).props;

    let prevented = 0;
    const view = {
      isDestroyed: true,
      state: { schema: { nodes: {} }, doc: { content: { size: 0 } }, tr: {} },
      posAtCoords: () => ({ pos: 3 }),
      dispatch: () => {},
    };
    const drop = (files: Array<{ type: string }>) => ({
      dataTransfer: { files },
      clientX: 10,
      clientY: 20,
      preventDefault: () => {
        prevented += 1;
      },
    });

    expect(
      props.handleDrop(view, drop([{ type: 'image/png' }]), null, false),
      'a dropped image file must be TAKEN by the ProseMirror handler — this is the ' +
        'whole path that `dragDropEnabled: false` exists to keep alive',
    ).toBe(true);
    expect(prevented, 'taking the drop without preventing the default drops the file twice').toBe(1);

    // …and it still declines the two it should: an internal block drag, and a
    // drop carrying no image. Otherwise `return true` everywhere would pass the
    // line above while eating every other drop in the editor.
    expect(props.handleDrop(view, drop([{ type: 'image/png' }]), null, true)).toBe(false);
    expect(props.handleDrop(view, drop([{ type: 'text/plain' }]), null, false)).toBe(false);
    expect(prevented).toBe(1);
  });
});

describe('the release workflow', () => {
  const WF = read('.github', 'workflows', 'release.yml');

  it('builds and uploads BOTH Windows installers', () => {
    expect(WF).toMatch(/webviewInstallMode.*offlineInstaller/);
    expect(WF).toMatch(/nsis\/\*-setup\.exe/);
    expect(WF).toMatch(/nsis\/\*-setup-offline\.exe/);
  });

  it('refuses to publish unless BOTH Windows installers reached the release', () => {
    // Uploading several paths with `if-no-files-found: error` proves only that
    // at least one path matched. The release job therefore has its own list of
    // promised file patterns, and the offline setup must be named separately:
    // `*-setup.exe` does not match `*-setup-offline.exe`.
    const presenceGate = /for pattern in ([^;]+); do/.exec(WF)?.[1] ?? '';
    expect(presenceGate).toContain("'*-setup.exe'");
    expect(presenceGate).toContain("'*-setup-offline.exe'");
  });

  it('still builds all three platforms', () => {
    for (const name of ['windows-x64', 'macos-universal', 'linux-x64']) {
      expect(WF).toContain(`name: ${name}`);
    }
  });

  it('patches the webview mode rather than editing the checked-in config', () => {
    // One source of truth for the default. If the workflow ever stopped using
    // `--config`, the repository would have two answers to "what does the
    // default installer do about WebView2".
    expect(CONF.bundle.windows.webviewInstallMode.type).toBe('embedBootstrapper');
    expect(WF).toMatch(/tauri build --bundles nsis \\\r?\n\s*--config '/);
  });

  it('asks the second build for a DIFFERENT mode than the default', () => {
    // The two builds differing is the entire reason the second one exists. A
    // `--config` patch naming the mode the config already has would burn
    // twenty minutes producing a byte-identical copy of the first installer
    // and publish it as `-setup-offline.exe` — a name promising the one thing
    // it would not do, handed to exactly the readers who have no internet to
    // discover that with.
    const patched = /"webviewInstallMode":\s*\{\s*"type":\s*"(\w+)"/.exec(WF)?.[1];
    expect(patched).toBe('offlineInstaller');
    expect(patched).not.toBe(CONF.bundle.windows.webviewInstallMode.type);
  });

  it('installs the runtime silently, in both installers', () => {
    // `silent: false` lets Microsoft's installer draw its own progress window
    // in the middle of ours. That breaks `Alcove_<version>_x64-setup.exe /S`,
    // which is what the installer QA in CLAUDE.md leans on to keep GUI windows
    // off the owner's desktop — a run that is meant to be headless stops being
    // headless only on the machines that lack the runtime, so it survives
    // every test on a machine that has it.
    expect(CONF.bundle.windows.webviewInstallMode.silent).toBe(true);
    expect(WF).toMatch(/"type":\s*"offlineInstaller",\s*"silent":\s*true/);
  });
});
