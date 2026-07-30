/**
 * src/features/templates/createFromScript.ts — shared "script → real book
 * pages" plumbing used by both the Markdown import (roadmap 25) and the
 * templates gallery (roadmap 26).
 *
 * The source is tolerant-parsed, split into page-sized sections
 * (one-page-per-H1 + capacity split, see split.ts), each section mapped to
 * editor JSON with the REAL storage schema (getSchema over the full
 * extension set, so containers/diagrams become their real nodes) and stored
 * with its printed canonical script as the page's scriptSource — "Export
 * Script" works on imported pages exactly like on pasted ones.
 */
import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { parse, print } from '../../script';
import type { Block, ScriptDoc } from '../../script/types';
import { scriptDocToTiptap } from '../../editor/script/toTiptap';
import { createEditorExtensions } from '../../editor/extensions';
import { createBook, listBooksByFloorRange } from '../../data/books';
import { createPage } from '../../data/pages';
import type { Book, Page, PageDoc } from '../../data/types';
import { deriveBookTitle, nextShelfSpot, splitBlocksIntoPages } from './split';

let schemaCache: Schema | null = null;

/** The storage schema (built once) — powers hasNode for script mapping. */
function storageSchema(): Schema {
  schemaCache ??= getSchema(createEditorExtensions());
  return schemaCache;
}

function hasNode(name: string): boolean {
  return storageSchema().nodes[name] !== undefined;
}

interface PageSection {
  doc: PageDoc;
  source: string;
}

/** Split a parsed script into per-page editor docs + printed sources. */
export function scriptDocToPageSections(doc: ScriptDoc): PageSection[] {
  const sections = splitBlocksIntoPages(doc.blocks);
  return sections.map((blocks: Block[], index) => {
    const sectionDoc: ScriptDoc = {
      // Frontmatter styles every page; printed only on the first page's
      // source so a re-export of page 1 round-trips it.
      frontmatter: doc.frontmatter,
      blocks,
      diagnostics: [],
    };
    const pageDoc = scriptDocToTiptap(sectionDoc, { hasNode });
    const source = print(
      index === 0
        ? sectionDoc
        : { frontmatter: {}, blocks, diagnostics: [] },
    );
    return { doc: pageDoc, source };
  });
}

export interface ScriptBookResult {
  book: Book;
  pages: Page[];
}

/**
 * Create a whole new shelved book from a script source. The book lands on
 * the first free shelf slot; the title comes from frontmatter/H1/fallback.
 */
export async function createBookFromScript(
  source: string,
  titleFallback: string,
): Promise<ScriptBookResult> {
  const doc = parse(source);
  const title = deriveBookTitle(doc, titleFallback);
  const shelved = await listBooksByFloorRange(0, 999);
  const spot = nextShelfSpot(shelved);
  const book = await createBook({ title, floor: spot.floor, slot: spot.slot });

  const sections = scriptDocToPageSections(doc);
  const pages: Page[] = [];
  for (const section of sections) {
    pages.push(
      await createPage({
        bookId: book.id,
        doc: section.doc,
        scriptSource: section.source,
      }),
    );
  }
  return { book, pages };
}

/** Append a script's pages to an existing book (template → current book). */
export async function appendScriptPagesToBook(
  bookId: string,
  source: string,
): Promise<Page[]> {
  const doc = parse(source);
  const sections = scriptDocToPageSections(doc);
  const pages: Page[] = [];
  for (const section of sections) {
    pages.push(
      await createPage({
        bookId,
        doc: section.doc,
        scriptSource: section.source,
      }),
    );
  }
  return pages;
}
