/**
 * src/features/packs/prompt.ts — the copyable AI prompt, GENERATED.
 *
 * The reader asked for "a custom ai prompt they give to an ai that will tell
 * it the specifications of how to build and package it for the user to upload
 * it here". The word that carries the weight is *specifications*: a prompt
 * that describes a format the importer does not accept is worse than no
 * prompt, because the reader does the work, pastes the result, and is told it
 * is wrong by an app that told them what to write.
 *
 * So nothing here is prose about the format. Every field name, every allowed
 * word, every ceiling and every rule is read off `categories.ts`, which reads
 * them off the vocabulary modules themselves. The prompt cannot say "one of
 * fifty motifs" while the app draws fifty-one.
 *
 * `tests/packs.test.ts` closes the loop from the other end: it lifts the
 * example out of the generated prompt and runs it through the real importer.
 * If a rule changes and the example stops importing, the suite says so before
 * a reader does.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE SOUND PROMPT ASKS FOR A SCRIPT
 * ─────────────────────────────────────────────────────────────────────────
 * A chat window cannot hand back a WAV. Asking for one produces either a
 * refusal or, worse, a base64 blob that decodes to noise. What a model IS good
 * at is writing the twenty lines of arithmetic that synthesise a click — this
 * repo's own cues are made exactly that way by `scripts/gen-sounds.mjs` — so
 * the files prompt asks for a generator, and the reader runs it once.
 */

import type { FileIntake, PackCategory, PackField } from './schema';
import { PACK_FORMAT } from './schema';

const RULE = '─'.repeat(66);

/** Wrap a comma-separated word list to a readable column under an indent. */
function wrapList(words: readonly string[], indent: string, width = 74): string {
  const lines: string[] = [];
  let line = indent;
  words.forEach((word, index) => {
    const piece = index === words.length - 1 ? word : `${word},`;
    if (line !== indent && line.length + piece.length + 1 > width) {
      lines.push(line);
      line = indent;
    }
    line = line === indent ? indent + piece : `${line} ${piece}`;
  });
  if (line.trim() !== '') lines.push(line);
  return lines.join('\n');
}

function bullets(items: readonly string[]): string {
  return items.map((item) => `  • ${item}`).join('\n');
}

function heading(text: string): string {
  return `${RULE}\n${text}\n${RULE}`;
}

/** One field, as the model needs to see it: name, whether it must be there, what it takes. */
function describeField(field: PackField): string {
  const required = field.required ? 'required' : 'optional';
  const head = `  "${field.key}"  (${required})  ${field.label}`;
  switch (field.kind) {
    case 'text':
      return [
        head,
        `      text, up to ${field.maxLength} characters`,
        field.note === undefined ? null : `      ${field.note}`,
      ]
        .filter((line) => line !== null)
        .join('\n');
    case 'svg':
      return [
        head,
        `      one complete <svg> element as a JSON string, up to ${Math.round(field.maxBytes / 1024)} KB`,
        field.note === undefined ? null : `      ${field.note}`,
      ]
        .filter((line) => line !== null)
        .join('\n');
    case 'enum':
      return [
        head,
        `      exactly one of these ${field.values.length} words, spelled as written:`,
        wrapList(field.values, '        '),
        field.note === undefined ? null : `      ${field.note}`,
      ]
        .filter((line) => line !== null)
        .join('\n');
  }
}

/** The envelope, with this category's own id and ceiling in it. */
function envelope(category: PackCategory): string {
  const required = category.fields.filter((f) => f.required).map((f) => `"${f.key}"`);
  return [
    '{',
    `  "alcovePack": ${PACK_FORMAT},`,
    `  "category": "${category.id}",`,
    '  "name": "<what to call the whole collection>",',
    '  "author": "<who made it — optional>",',
    '  "items": [',
    `    { ${required.join(': …, ')}: … },`,
    `    … between 1 and ${category.maxItems} of them …`,
    '  ]',
    '}',
  ].join('\n');
}

function exampleBlock(category: PackCategory): string {
  const doc = {
    alcovePack: PACK_FORMAT,
    category: category.id,
    name: `Example ${category.plural}`,
    author: 'the manual',
    items: category.example,
  };
  return ['```json', JSON.stringify(doc, null, 2), '```'].join('\n');
}

/* ========================================================================== *
 *                              manifest prompts                              *
 * ========================================================================== */

function manifestPrompt(category: PackCategory): string {
  return [
    `You are making a customisation pack for Alcove — a desktop notes app drawn`,
    `by hand: a warm parchment bookshelf world you keep notebooks in.`,
    '',
    `I want ${category.plural}: ${category.blurb}.`,
    `Tell me what you would like them to be about, or use what I have told you.`,
    '',
    heading('WHAT TO HAND BACK'),
    `ONE file, called ${category.fileName}, containing nothing but JSON.`,
    'No commentary before it. No markdown fence around it. Just the file.',
    '',
    heading('THE SHAPE OF THE FILE'),
    envelope(category),
    '',
    heading('EACH ENTRY'),
    category.fields.map(describeField).join('\n\n'),
    '',
    heading('RULES THE IMPORTER ENFORCES'),
    'It refuses the WHOLE file if any of these is broken — nothing half-imports',
    '— so check them before you answer.',
    bullets(category.rules),
    '',
    heading('WHAT MAKES A GOOD ONE'),
    bullets(category.craft),
    '',
    heading('AN EXAMPLE THAT IMPORTS CLEANLY'),
    exampleBlock(category),
    '',
    'Now write mine.',
    '',
  ].join('\n');
}

/* ========================================================================== *
 *                                files prompts                               *
 * ========================================================================== */

function fileTable(files: FileIntake): string {
  const width = Math.max(...files.naming.map((n) => n.name.length)) + 2;
  return files.naming
    .map((slot) => {
      const stem = `${slot.name}.wav`.padEnd(width + 4);
      const also =
        slot.alsoAccepts.length === 0
          ? ''
          : `  (also accepted: ${slot.alsoAccepts.join(', ')})`;
      return `  ${stem}${slot.label}${also}`;
    })
    .join('\n');
}

function filesPrompt(category: PackCategory): string {
  const files = category.files;
  if (files === undefined) return manifestPrompt(category);
  return [
    'You are making a set of interface sounds for Alcove — a desktop notes app',
    'drawn by hand: a warm parchment bookshelf world you keep notebooks in.',
    '',
    'You cannot hand me audio in a chat window, so hand me the next best thing:',
    '',
    heading('WHAT TO HAND BACK'),
    'ONE self-contained Node script, make-sounds.mjs, that I can run with',
    '`node make-sounds.mjs` and that writes the .wav files itself. Use only the',
    'Node standard library — no npm packages, no downloads, no samples fetched',
    'from anywhere. Synthesise every sound from arithmetic: an envelope over a',
    'few oscillators, filtered noise for the wooden and papery ones. Write',
    '16-bit PCM mono at 44100 Hz.',
    '',
    'Put every file in one folder, and name the folder after the set — the',
    'folder name becomes the name of my set in the app.',
    '',
    heading('THE FILES, AND WHAT EACH ONE IS FOR'),
    'Name each file after the moment it plays. These names are matched exactly,',
    'so use them as written:',
    '',
    fileTable(files),
    '',
    'Every one of them is OPTIONAL. A set with three sounds in it is a working',
    'set — the app plays its own for everything I do not give it. If I have',
    'asked for a small set, write a small set rather than padding it out.',
    '',
    heading('RULES THE IMPORTER ENFORCES'),
    bullets(category.rules),
    '',
    heading('WHAT MAKES A GOOD ONE'),
    bullets(category.craft),
    '',
    heading('THE FOLDER I SHOULD END UP WITH'),
    ['```text', `${'my-set/'}`, ...files.naming.slice(0, 4).map((n) => `  ${n.name}.wav`), '  …', '```'].join('\n'),
    '',
    'Now write the script.',
    '',
  ].join('\n');
}

/* ========================================================================== *
 *                                  the door                                  *
 * ========================================================================== */

/** The prompt for one category, built from its schema. */
export function promptForCategory(category: PackCategory): string {
  return category.intake === 'files' ? filesPrompt(category) : manifestPrompt(category);
}

/**
 * The example JSON embedded in a generated prompt, as text.
 *
 * Exported for the suite, which lifts it back out and runs it through the real
 * importer. That round trip is the whole guarantee this module offers: an
 * example nobody checks is a promise, and a promise in a prompt is the thing
 * that wastes the reader's afternoon.
 */
export function exampleJsonInPrompt(prompt: string): string | null {
  const match = /```json\n([\s\S]*?)\n```/.exec(prompt);
  return match === null ? null : match[1]!;
}
