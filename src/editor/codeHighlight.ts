/**
 * src/editor/codeHighlight.ts — the highlighter, and how a language is guessed.
 *
 * One lowlight instance for the whole app, built once: `common` (the 37
 * grammars lowlight bundles) plus the 39 more this app's vocabulary names.
 * Registration is eager and synchronous on purpose — the decoration plugin
 * asks for a grammar inside a ProseMirror transaction, which cannot wait for a
 * dynamic import, and the alternative (a block that paints itself grey and
 * then flickers into colour a tick later) is worse than the ~90 KB.
 *
 * ## The wrapper around `highlightAuto`
 *
 * `@tiptap/extension-code-block-lowlight` calls `lowlight.highlightAuto(text)`
 * for every block with no language on it, and lowlight's own default is to
 * guess across EVERY registered grammar. At 76 grammars that is both slow (it
 * runs all of them, on every transaction that touches a code block) and worse
 * at its job: highlight.js scores by keyword density, so given six lines it
 * will cheerfully decide a shell script is Awk. The wrapper below pins the
 * guess to `AUTO_DETECT_SUBSET` — the languages a reader actually pastes.
 *
 * The object is a plain façade rather than a subclass because the plugin
 * type-checks its argument by feature (`['highlight','highlightAuto',
 * 'listLanguages'].every(isFunction)`) and also calls the optional
 * `registered`, which is what resolves `html` to the `xml` grammar.
 */

import { common, createLowlight } from 'lowlight';
import type { LanguageFn } from 'highlight.js';

import clojure from 'highlight.js/lib/languages/clojure';
import cmake from 'highlight.js/lib/languages/cmake';
import coffeescript from 'highlight.js/lib/languages/coffeescript';
import crystal from 'highlight.js/lib/languages/crystal';
import dart from 'highlight.js/lib/languages/dart';
import delphi from 'highlight.js/lib/languages/delphi';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import elixir from 'highlight.js/lib/languages/elixir';
import elm from 'highlight.js/lib/languages/elm';
import erlang from 'highlight.js/lib/languages/erlang';
import fortran from 'highlight.js/lib/languages/fortran';
import fsharp from 'highlight.js/lib/languages/fsharp';
import gcode from 'highlight.js/lib/languages/gcode';
import gherkin from 'highlight.js/lib/languages/gherkin';
import gradle from 'highlight.js/lib/languages/gradle';
import groovy from 'highlight.js/lib/languages/groovy';
import haskell from 'highlight.js/lib/languages/haskell';
import haxe from 'highlight.js/lib/languages/haxe';
import http from 'highlight.js/lib/languages/http';
import julia from 'highlight.js/lib/languages/julia';
import latex from 'highlight.js/lib/languages/latex';
import lisp from 'highlight.js/lib/languages/lisp';
import llvm from 'highlight.js/lib/languages/llvm';
import matlab from 'highlight.js/lib/languages/matlab';
import nginx from 'highlight.js/lib/languages/nginx';
import nim from 'highlight.js/lib/languages/nim';
import nix from 'highlight.js/lib/languages/nix';
import ocaml from 'highlight.js/lib/languages/ocaml';
import powershell from 'highlight.js/lib/languages/powershell';
import protobuf from 'highlight.js/lib/languages/protobuf';
import scala from 'highlight.js/lib/languages/scala';
import scheme from 'highlight.js/lib/languages/scheme';
import verilog from 'highlight.js/lib/languages/verilog';
import vhdl from 'highlight.js/lib/languages/vhdl';
import x86asm from 'highlight.js/lib/languages/x86asm';
import xml from 'highlight.js/lib/languages/xml';
import brainfuck from 'highlight.js/lib/languages/brainfuck';

import { AUTO_DETECT_SUBSET, type CodeLangName } from './codeLanguages';
import { resolveCodeLang } from '../script/normalize';

/* ============================ the one instance ============================ */

const engine = createLowlight(common);

engine.register({
  brainfuck,
  clojure,
  cmake,
  coffeescript,
  crystal,
  dart,
  delphi,
  dockerfile,
  dos,
  elixir,
  elm,
  erlang,
  fortran,
  fsharp,
  gcode,
  gherkin,
  gradle,
  groovy,
  haskell,
  haxe,
  http,
  julia,
  latex,
  lisp,
  llvm,
  matlab,
  nginx,
  nim,
  nix,
  ocaml,
  powershell,
  protobuf,
  scala,
  scheme,
  verilog,
  vhdl,
  x86asm,
  // `html` is an ALIAS of the xml grammar in highlight.js, not a grammar of
  // its own, and `listLanguages()` therefore never contains it. Registering
  // the grammar under the name as well means the id we store is the id the
  // highlighter is asked for — no alias resolution in the hot path, and no
  // block that silently loses its colours because the plugin's registration
  // check looked in the wrong place.
  html: xml as LanguageFn,
});

/**
 * The façade handed to the TipTap extension.
 *
 * `highlightAuto` is the only method that differs from the engine's: it pins
 * the guess to the everyday languages. See the header for why.
 */
export const lowlight = {
  highlight: (
    language: string,
    value: string,
    options?: Readonly<{ prefix?: string }>,
  ) => engine.highlight(language, value, options),
  highlightAuto: (value: string, options?: Readonly<{ prefix?: string }>) =>
    engine.highlightAuto(value, { ...options, subset: [...AUTO_DETECT_SUBSET] }),
  listLanguages: () => engine.listLanguages(),
  registered: (name: string) => engine.registered(name),
};

/** True when this app can actually colour `id`. */
export function canHighlight(id: string | null | undefined): boolean {
  if (id === null || id === undefined || id === '') return false;
  return engine.registered(id);
}

/* ============================== the guess ================================ */

/**
 * Marks that only appear in code.
 *
 * The gate exists because relevance alone cannot tell a sentence from a
 * stylesheet: "This is just a sentence I typed into a code block by accident."
 * scores 4 as CSS, which is exactly what a real one-line `SELECT` scores. So
 * the question "is this code at all" is answered by looking for the
 * punctuation prose does not use, BEFORE the highlighter is asked which code
 * it is. A sentence has commas and full stops; it does not have braces,
 * semicolons, angle brackets, sigils or a line that starts indented.
 */
const CODE_MARKS = /[{}[\]()<>;=|&#$@\\`]|=>|::|->|^\s*[-*+]\s|^\s{2,}\S/m;

/** A minimum worth guessing about. One word is not evidence of anything. */
const MIN_DETECT_CHARS = 12;

/**
 * The relevance a guess has to earn.
 *
 * Measured against real snippets rather than chosen: a three-line SQL SELECT
 * scores 4, a package.json 4.02, a GitHub Actions workflow 4, and a two-line
 * Python function 3. Anything higher than 3 loses the Python. The prose that
 * would otherwise sneak in at 4 never reaches this test — `CODE_MARKS` stops
 * it one step earlier, which is the right place to stop it.
 */
const MIN_RELEVANCE = 3;

/**
 * Guess `text`'s language, or null when there is no honest guess to make.
 *
 * Deliberately conservative in both directions. A wrong guess is cheap (the
 * language sits on the block, named, one click from being changed) but a
 * CONFIDENT wrong guess on a paragraph somebody pasted into a code block is
 * the app being clever at the reader, so anything that does not look like
 * code at all is left alone.
 */
export function detectLanguage(text: string): CodeLangName | null {
  const body = text.trim();
  if (body.length < MIN_DETECT_CHARS) return null;
  if (!CODE_MARKS.test(body)) return null;
  const result = engine.highlightAuto(body, { subset: [...AUTO_DETECT_SUBSET] });
  const language = result.data?.language;
  const relevance = result.data?.relevance ?? 0;
  if (typeof language !== 'string' || relevance < MIN_RELEVANCE) return null;
  return resolveCodeLang(language);
}

/* ========================= what the clipboard says ======================== */

/**
 * The language VS Code (and everything that copies its clipboard format)
 * declares on a copied selection.
 *
 * `vscode-editor-data` is a JSON blob whose `mode` is the editor's language
 * id — `typescriptreact`, `shellscript`, `jsonc`. Those are VS Code's names
 * rather than highlight.js's, so they go through the same alias table a fence
 * would; anything unrecognised gives null and the guess takes over.
 */
export function clipboardLanguage(
  data: DataTransfer | null | undefined,
): CodeLangName | null {
  if (data === null || data === undefined) return null;
  let raw: string;
  try {
    raw = data.getData('vscode-editor-data');
  } catch {
    return null;
  }
  if (raw === '') return null;
  let mode: unknown;
  try {
    mode = (JSON.parse(raw) as { mode?: unknown }).mode;
  } catch {
    // A clipboard is somebody else's data structure; a malformed one is a
    // reason to fall back to the guess, never a reason to break the paste.
    return null;
  }
  if (typeof mode !== 'string') return null;
  return resolveCodeLang(VSCODE_MODES[mode] ?? mode);
}

/** VS Code language ids whose spelling is its own rather than everyone's. */
const VSCODE_MODES: Readonly<Record<string, string>> = {
  javascriptreact: 'javascript',
  typescriptreact: 'typescript',
  shellscript: 'bash',
  'objective-c': 'objectivec',
  'objective-cpp': 'objectivec',
  vb: 'vbnet',
  bat: 'dos',
  plaintext: 'plaintext',
  jsonc: 'json',
  scminput: 'plaintext',
};

/* =========================== a pasted fence ============================== */

export interface FencedPaste {
  readonly language: CodeLangName | null;
  /** What the fence said, when it named something unknown. */
  readonly rawLanguage: string | null;
  readonly code: string;
}

/**
 * Is the clipboard ONE complete Markdown fence, and nothing else?
 *
 * Copying a snippet out of a chat window, a README or an AI answer brings the
 * fence along with it, and pasting that into a page used to produce three
 * paragraphs of which two were rows of backticks. Recognising the shape is
 * both the obvious fix and a safe one, because the test is strict: the text
 * has to OPEN with a fence and CLOSE with the matching run, with nothing
 * outside it. Prose that merely contains a fence is left to the normal paste,
 * because turning a whole pasted article into one code block would be a much
 * worse failure than not helping.
 */
export function fencedPaste(text: string): FencedPaste | null {
  const body = text.replace(/\r\n?/g, '\n').trim();
  const open = /^(`{3,}|~{3,})[ \t]*([^\n`]*)\n/.exec(body);
  if (open === null) return null;
  const marker = open[1];
  const closer = new RegExp(`\\n[ \\t]*${marker[0]}{${marker.length},}[ \\t]*$`);
  const close = closer.exec(body);
  if (close === null) return null;
  const info = open[2].trim().split(/\s+/)[0] ?? '';
  const language = info === '' ? null : resolveCodeLang(info);
  return {
    language,
    rawLanguage: language === null && info !== '' ? info : null,
    code: body.slice(open[0].length, close.index),
  };
}
