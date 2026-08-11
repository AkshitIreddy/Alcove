import { readFileSync } from 'node:fs';
import { parse } from '../src/script/index';
import { splitNotebookScriptPages } from '../src/editor/script/pageBoundaries';
import { scriptDocToTiptap } from '../src/editor/script/toTiptap';

const sourcePath =
  process.argv[2] ??
  'C:/Users/akshi/Downloads/huffman-coding-kitten-shelter-notes.md';
const source = readFileSync(sourcePath, 'utf8');
const sourcePages = splitNotebookScriptPages(source);
const parsed = parse(source);
const tiptap = scriptDocToTiptap(parsed);
const content = tiptap.content ?? [];

console.log(
  JSON.stringify(
    {
      sourcePath,
      sourcePageCount: sourcePages.length,
      diagnostics: parsed.diagnostics,
      scriptBlockCount: parsed.blocks.length,
      tiptapBlockCount: content.length,
      horizontalRules: content.filter((node) => node.type === 'horizontalRule').length,
      types: content.map((node) => node.type),
    },
    null,
    2,
  ),
);
