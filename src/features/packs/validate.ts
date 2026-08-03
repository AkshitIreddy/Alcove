/**
 * src/features/packs/validate.ts — the importer's judgement, and the reason a
 * refusal is worth reading.
 *
 * The brief for this feature had one hard rule in it:
 *
 *   "Validate on import and say plainly what was wrong when something fails.
 *    A pack that silently half-imports is worse than a rejection."
 *
 * So two properties hold here and both are tested:
 *
 *   ALL OR NOTHING.  One bad item refuses the whole file. Importing eleven of
 *                    twelve wallpapers leaves a reader with no way to know
 *                    which one is missing or why, and no way to fix it — they
 *                    would have to diff their own file against the app.
 *   EVERY PROBLEM HAS A PLACE.  `items[3].ink` and a sentence. "Invalid pack"
 *                    is the message that makes somebody delete the file.
 *
 * A third property is a courtesy rather than a rule: where a value is nearly
 * right, the problem says what it was nearly. Models write `herringbones` and
 * `face-frame`, and "did you mean herringbone?" turns a dead end into an edit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY AN UNKNOWN KEY IS AN ERROR AND NOT A SHRUG
 * ─────────────────────────────────────────────────────────────────────────
 * Ignoring `"colour": "moss"` because the field is called `tone` is a silent
 * half-import wearing a different hat: the pack lands, the reader looks at a
 * wall that is not the colour they asked for, and nothing anywhere said why.
 * So unknown keys are refused, by name, with the real field list attached.
 *
 * The one place tolerance is right is the WRAPPER. Models fence their output
 * in ```json and sometimes greet you first. Neither can hide a mistake in the
 * data, so both are stripped — and reported as a note, so a reader who wants
 * a clean file knows theirs is not one.
 */

import {
  PACK_FORMAT,
  fieldKeys,
  nearestValue,
  type PackCategory,
  type PackCategoryId,
  type PackCheck,
  type PackField,
  type PackProblem,
} from './schema';

/** One validated entry: every value is a string by the time it is in here. */
export type PackItem = Readonly<Record<string, string>>;

export interface ValidatedPack {
  readonly category: PackCategoryId;
  readonly name: string;
  /** '' when the file named nobody. */
  readonly author: string;
  readonly items: readonly PackItem[];
}

const MAX_PACK_NAME = 60;

/* ========================================================================== *
 *                              reading the file                              *
 * ========================================================================== */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Pull JSON out of whatever the reader actually saved.
 *
 * Three shapes arrive in practice: clean JSON, JSON inside a ```json fence,
 * and JSON with a sentence of chat in front of it. The last two are what a
 * model hands back when it forgets it was asked for a file, and refusing them
 * would be refusing the reader for somebody else's mistake — so the object is
 * taken from the first `{` to the last `}` and the fact is reported as a note.
 */
export function extractJson(text: string): { json: string; note: string | null } {
  const trimmed = text.trim();
  const fence = /^```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i.exec(trimmed);
  if (fence !== null) {
    return { json: fence[1]!.trim(), note: 'your file was wrapped in a code fence — I read the JSON inside it' };
  }
  if (trimmed.startsWith('{')) return { json: trimmed, note: null };
  const open = trimmed.indexOf('{');
  const close = trimmed.lastIndexOf('}');
  if (open >= 0 && close > open) {
    return {
      json: trimmed.slice(open, close + 1),
      note: 'your file had writing around the JSON — I read the part between the braces',
    };
  }
  return { json: trimmed, note: null };
}

/**
 * Parse the text of a pack file. Total: a syntax error comes back as a
 * problem carrying the line the parser choked on, not as a thrown exception
 * inside a click handler.
 */
export function parsePackText(text: string): PackCheck<{ value: unknown }> {
  if (text.trim() === '') {
    return { ok: false, problems: [{ where: 'the file', message: 'it is empty.' }] };
  }
  const { json, note } = extractJson(text);
  try {
    return { ok: true, pack: { value: JSON.parse(json) as unknown }, notes: note === null ? [] : [note] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      problems: [
        {
          where: 'the file',
          message: `it is not valid JSON — ${detail}. If an assistant wrote it, ask for the file again with nothing but JSON in it.`,
        },
      ],
    };
  }
}

/* ========================================================================== *
 *                             one field at a time                            *
 * ========================================================================== */

const SVG_BANNED: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  {
    pattern: /<script[\s>]/i,
    message: 'it contains a <script> tag. A sticker is a drawing, not a program.',
  },
  {
    pattern: /<foreignObject[\s>]/i,
    message: 'it contains a <foreignObject>, which embeds a whole web page inside the drawing.',
  },
  {
    pattern: /\son[a-z]+\s*=/i,
    message: 'it carries an event handler (an on… attribute). A sticker is a drawing, not a program.',
  },
  {
    pattern: /javascript:/i,
    message: 'it contains a javascript: link.',
  },
];

/** Every href / src / url() in the source, so an outward reference can be seen. */
function svgReferences(svg: string): string[] {
  const out: string[] = [];
  for (const match of svg.matchAll(/(?:xlink:)?(?:href|src)\s*=\s*["']([^"']*)["']/gi)) {
    out.push(match[1]!.trim());
  }
  for (const match of svg.matchAll(/url\(\s*["']?([^"')]*)["']?\s*\)/gi)) {
    out.push(match[1]!.trim());
  }
  return out;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Check one SVG. Errors are things that would import badly or reach outside
 * the app; the FLAT-STYLE complaints are notes, because taste is the reader's
 * and the rule here is the reader's own: you do not have to be too cruel.
 */
function checkSvg(
  svg: string,
  field: Extract<PackField, { kind: 'svg' }>,
  where: string,
  problems: PackProblem[],
  notes: string[],
): void {
  const source = svg.trim();
  if (!/^<svg[\s>]/i.test(source)) {
    problems.push({ where, message: 'it does not begin with an <svg> tag. Give me one complete SVG element, as a string.' });
    return;
  }
  if (!/<\/svg>$/i.test(source)) {
    problems.push({ where, message: 'it does not end with </svg>. It looks truncated — ask for it again, or shorten the drawing.' });
    return;
  }
  const bytes = byteLength(source);
  if (bytes > field.maxBytes) {
    problems.push({
      where,
      message: `it is ${Math.round(bytes / 1024)} KB, and the ceiling is ${Math.round(field.maxBytes / 1024)} KB. That is far bigger than a drawn sticker — it usually means a photograph was pasted in as base64.`,
    });
    return;
  }
  if (!/viewBox\s*=/i.test(source)) {
    problems.push({
      where,
      message: 'it has no viewBox, so the app cannot scale it. Add one — viewBox="0 0 64 64" is a good default.',
    });
  }
  for (const banned of SVG_BANNED) {
    if (banned.pattern.test(source)) problems.push({ where, message: banned.message });
  }
  for (const reference of svgReferences(source)) {
    if (reference === '' || reference.startsWith('#') || reference.startsWith('data:image/')) continue;
    problems.push({
      where,
      message: `it points at "${reference}", which is outside the drawing. A sticker has to be self-contained — it lives in your notes, not on somebody's server.`,
    });
    break;
  }
  // Taste, not correctness — the app is drawn flat and this will look like a
  // visitor, but it is the reader's sticker and it will import.
  if (/feGaussianBlur|feDropShadow/i.test(source)) {
    notes.push(`${where}: this drawing uses a blur filter. The app is drawn flat — it will import, and it will look like it came from somewhere else.`);
  }
}

function checkField(
  field: PackField,
  raw: unknown,
  where: string,
  problems: PackProblem[],
  notes: string[],
): string | null {
  if (raw === undefined || raw === null || raw === '') {
    if (field.required) {
      problems.push({ where, message: `this is required — ${field.label}.` });
    }
    return null;
  }
  if (typeof raw !== 'string') {
    problems.push({
      where,
      message: `it should be text in quotes, and it is ${Array.isArray(raw) ? 'a list' : typeof raw}.`,
    });
    return null;
  }

  switch (field.kind) {
    case 'text': {
      const value = raw.trim();
      if (value === '') {
        if (field.required) problems.push({ where, message: `this is required — ${field.label}.` });
        return null;
      }
      if (value.length > field.maxLength) {
        problems.push({
          where,
          message: `it is ${value.length} characters and the ceiling is ${field.maxLength}. Shorten it — this is ${field.label}.`,
        });
        return null;
      }
      return value;
    }
    case 'enum': {
      const value = raw.trim();
      if (field.values.includes(value)) return value;
      const near = nearestValue(value, field.values);
      problems.push({
        where,
        message:
          near === null
            ? `"${value}" is not one of the ${field.values.length} words this field accepts. The full list is in the prompt — copy it and ask again.`
            : `"${value}" is not one of the words this field accepts. Did you mean "${near}"?`,
      });
      return null;
    }
    case 'svg': {
      checkSvg(raw, field, where, problems, notes);
      return raw.trim();
    }
  }
}

/* ========================================================================== *
 *                                  one item                                  *
 * ========================================================================== */

/**
 * Validate one entry against a category.
 *
 * Exported because the STORE re-runs it on everything it reads back out of
 * SQLite. A reader's pack outlives the vocabulary it was written against —
 * a motif could be renamed — and the read path has to be total in the same
 * way `resolveShelfDesign` is: a stale entry is dropped and counted, never
 * thrown and never drawn as something it is not.
 */
export function validatePackItem(
  category: PackCategory,
  raw: unknown,
  where: string,
): { item: PackItem | null; problems: readonly PackProblem[]; notes: readonly string[] } {
  const problems: PackProblem[] = [];
  const notes: string[] = [];

  if (!isRecord(raw)) {
    return {
      item: null,
      problems: [
        {
          where,
          message: `it should be an object with ${fieldKeys(category).map((k) => `"${k}"`).join(', ')} in it, and it is ${Array.isArray(raw) ? 'a list' : typeof raw}.`,
        },
      ],
      notes,
    };
  }

  const allowed = new Set(fieldKeys(category));
  for (const key of Object.keys(raw)) {
    if (allowed.has(key)) continue;
    const near = nearestValue(key, [...allowed]);
    problems.push({
      where: `${where}.${key}`,
      message:
        near === null
          ? `there is no field called "${key}" here. The fields are ${[...allowed].join(', ')}.`
          : `there is no field called "${key}" here. Did you mean "${near}"?`,
    });
  }

  const item: Record<string, string> = {};
  for (const field of category.fields) {
    const value = checkField(field, raw[field.key], `${where}.${field.key}`, problems, notes);
    if (value !== null) item[field.key] = value;
  }

  return { item: problems.length === 0 ? item : null, problems, notes };
}

/* ========================================================================== *
 *                                 the file                                   *
 * ========================================================================== */

/**
 * Validate a whole manifest against the category the reader opened.
 *
 * `expected` is the dialog they are standing in. A stickers file dropped into
 * the wallpapers dialog is a refusal WITH the fix in it — "open the Stickers
 * dialog instead" — rather than a hundred bewildering field errors from
 * checking sticker items against wallpaper fields.
 */
export function validatePack(
  raw: unknown,
  expected: PackCategory,
  lookup: (id: unknown) => PackCategory | null,
): PackCheck<ValidatedPack> {
  const problems: PackProblem[] = [];
  const notes: string[] = [];

  if (!isRecord(raw)) {
    return {
      ok: false,
      problems: [
        {
          where: 'the file',
          message: `the top of the file should be an object — { "alcovePack": ${PACK_FORMAT}, "category": "${expected.id}", … } — and it is ${Array.isArray(raw) ? 'a list' : typeof raw}.`,
        },
      ],
    };
  }

  /* -- the envelope -- */

  const format = raw.alcovePack;
  const formatNumber = typeof format === 'number' ? format : Number(format);
  if (format === undefined) {
    problems.push({
      where: 'alcovePack',
      message: `this is missing. Every pack starts with "alcovePack": ${PACK_FORMAT}, which is how the app tells a pack from any other JSON file.`,
    });
  } else if (!Number.isFinite(formatNumber) || formatNumber !== PACK_FORMAT) {
    problems.push({
      where: 'alcovePack',
      message: `this app reads pack format ${PACK_FORMAT}, and the file says ${JSON.stringify(format)}.`,
    });
  }

  const declared = raw.category;
  const declaredCategory = lookup(declared);
  if (declared === undefined) {
    problems.push({
      where: 'category',
      message: `this is missing. It should be "${expected.id}".`,
    });
  } else if (declaredCategory === null) {
    problems.push({
      where: 'category',
      message: `"${String(declared)}" is not a category this app knows.`,
    });
  } else if (declaredCategory.id !== expected.id) {
    return {
      ok: false,
      problems: [
        {
          where: 'category',
          message: `this is a ${declaredCategory.plural} pack, and you are in the ${expected.plural} dialog. Close this and open ${declaredCategory.title} instead — the file itself looks fine.`,
        },
      ],
    };
  }

  const rawName = raw.name;
  let name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name === '') {
    problems.push({
      where: 'name',
      message: 'this is missing — a pack needs a name, because that is what you will see in the list afterwards.',
    });
  } else if (name.length > MAX_PACK_NAME) {
    name = name.slice(0, MAX_PACK_NAME);
    notes.push(`the pack name was longer than ${MAX_PACK_NAME} characters, so I shortened it`);
  }

  const rawAuthor = raw.author;
  const author = typeof rawAuthor === 'string' ? rawAuthor.trim().slice(0, MAX_PACK_NAME) : '';

  /* -- the items -- */

  const items: PackItem[] = [];
  if (!Array.isArray(raw.items)) {
    problems.push({
      where: 'items',
      message: `this should be a list of ${expected.plural}, in square brackets. ${raw.items === undefined ? 'It is missing.' : `It is ${typeof raw.items}.`}`,
    });
  } else if (raw.items.length === 0) {
    problems.push({ where: 'items', message: 'the list is empty, so there is nothing to import.' });
  } else if (raw.items.length > expected.maxItems) {
    problems.push({
      where: 'items',
      message: `there are ${raw.items.length} of them and one pack holds at most ${expected.maxItems}. Split it into two files.`,
    });
  } else {
    const seen = new Set<string>();
    raw.items.forEach((entry, index) => {
      const where = `items[${index}]`;
      const checked = validatePackItem(expected, entry, where);
      problems.push(...checked.problems);
      notes.push(...checked.notes);
      if (checked.item === null) return;
      const key = (checked.item.name ?? '').toLowerCase();
      if (key !== '' && seen.has(key)) {
        problems.push({
          where: `${where}.name`,
          message: `two entries are both called "${checked.item.name}". Give them different names — the name is how you will tell them apart.`,
        });
        return;
      }
      seen.add(key);
      items.push(checked.item);
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, pack: { category: expected.id, name, author, items }, notes };
}

/** Read text, then validate it — the whole file path, in one call. */
export function validatePackText(
  text: string,
  expected: PackCategory,
  lookup: (id: unknown) => PackCategory | null,
): PackCheck<ValidatedPack> {
  const parsed = parsePackText(text);
  if (!parsed.ok) return parsed;
  const checked = validatePack(parsed.pack.value, expected, lookup);
  if (!checked.ok) return checked;
  return { ok: true, pack: checked.pack, notes: [...parsed.notes, ...checked.notes] };
}
