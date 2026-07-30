/**
 * src/features/templates/importMarkdown.ts — roadmap item 25: open .md
 * file(s), tolerant-parse them as Notebook Script (Markdown is a strict
 * subset, so plain Markdown just works) and create one new shelved book per
 * file — one page per H1, capacity split for headingless walls of text.
 *
 * File access:
 * - Tauri: plugin-dialog open picker; bytes read by the `read_markdown_file`
 *   Rust command (src-tauri/src/import.rs — BOM/UTF-16-aware decoding for
 *   Notepad-saved files), falling back to plugin-fs readTextFile while the
 *   command is unregistered.
 * - Browser dev: a hidden <input type=file data-nb-import> (Playwright
 *   drives it with setInputFiles in tests/e2e/import-export.spec.ts).
 */
import { isTauri } from '../../data/db';
import type { Book } from '../../data/types';
import { appState } from '../../state/app';
import { editorState } from '../../editor/state';
import { notify } from '../../editor/script/exporters/toast';
import { play } from '../../sound/engine';
import { createBookFromScript } from './createFromScript';
import { titleFromFileName } from './split';

const MD_EXTENSIONS = ['md', 'markdown', 'txt'];

interface NamedSource {
  /** Filename-derived fallback title. */
  title: string;
  text: string;
}

async function readTauriFile(path: string): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('read_markdown_file', { path });
  } catch {
    // Command not registered yet → plain UTF-8 read via the fs plugin.
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(path);
  }
}

async function pickTauriSources(): Promise<NamedSource[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: true,
    filters: [{ name: 'Markdown', extensions: MD_EXTENSIONS }],
  });
  if (picked === null) return [];
  const paths = Array.isArray(picked) ? picked : [picked];
  const sources: NamedSource[] = [];
  for (const path of paths) {
    try {
      sources.push({
        title: titleFromFileName(path),
        text: await readTauriFile(path),
      });
    } catch {
      notify(`could not read ${titleFromFileName(path)}`);
    }
  }
  return sources;
}

/** Browser dev: hidden file input (also the Playwright hook). */
function pickBrowserSources(): Promise<NamedSource[]> {
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLInputElement>(
      'input[data-nb-import]',
    );
    existing?.remove();

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.multiple = true;
    input.setAttribute('data-nb-import', 'true');
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(input);

    let settled = false;
    const finish = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      const files = Array.from(input.files ?? []);
      const sources: NamedSource[] = [];
      for (const file of files) {
        try {
          sources.push({
            title: titleFromFileName(file.name),
            text: await file.text(),
          });
        } catch {
          notify(`could not read ${file.name}`);
        }
      }
      input.remove();
      resolve(sources);
    };

    input.addEventListener('change', () => void finish());
    // Cancelled pickers fire no event — clean up when focus returns.
    window.addEventListener(
      'focus',
      () => setTimeout(() => void finish(), 1200),
      { once: true },
    );
    input.click();
  });
}

/**
 * Full import flow: pick file(s) → tolerant parse → new book(s) → open the
 * first one. Returns the created books (empty when cancelled).
 */
export async function importMarkdownBooks(): Promise<Book[]> {
  const sources = isTauri()
    ? await pickTauriSources()
    : await pickBrowserSources();
  if (sources.length === 0) return [];

  const books: Book[] = [];
  for (const source of sources) {
    try {
      const { book } = await createBookFromScript(source.text, source.title);
      books.push(book);
    } catch {
      notify(`could not import “${source.title}”`);
    }
  }
  if (books.length === 0) return books;

  void play('pop-soft');
  notify(
    books.length === 1
      ? `imported “${books[0].title}”`
      : `imported ${books.length} books`,
  );
  const first = books[0];
  editorState.setOpenBookId(null);
  queueMicrotask(() => {
    editorState.setOpenBookId(first.id);
    appState.openBook(first.id);
  });
  return books;
}
