/**
 * Builds the AI-facing Notebook Script spec.
 *
 *   src/script/vocab.ts      names + prose (the single source of truth)
 *   scripts/spec-template.md narrative, with <!-- gen:name --> placeholders
 *        ↓
 *   src-tauri/resources/notebook-script-spec.md   shipped as a Tauri resource
 *   src/editor/script/spec.ts                     the same string, inlined
 *
 * Run `npm run spec` after touching either input. `npm run spec:check`
 * regenerates in memory and fails if the checked-in files differ — which is
 * also what tests/script/spec-generated.test.ts does, so a forgotten
 * regeneration is a red test rather than a chatbot writing script the parser
 * cannot read.
 *
 * The builders are exported and pure so the test can run them against the
 * TypeScript vocab directly; only `loadVocab()` needs esbuild.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_PATH = join(ROOT, 'scripts', 'spec-template.md');
export const VOCAB_PATH = join(ROOT, 'src', 'script', 'vocab.ts');
export const SPEC_MD_PATH = join(
  ROOT,
  'src-tauri',
  'resources',
  'notebook-script-spec.md',
);
export const SPEC_TS_PATH = join(ROOT, 'src', 'editor', 'script', 'spec.ts');

/**
 * Provenance line at the top of the shipped markdown. Kept to one short HTML
 * comment: this file is also pasted into a chatbot, so build chatter has no
 * business above "You are (probably) an AI assistant…".
 */
const BANNER =
  '<!-- Generated file — do not edit. ' +
  'Source: src/script/vocab.ts + scripts/spec-template.md (npm run spec). -->';

/** Notes the template carries for its own readers; the output drops them. */
const TEMPLATE_ONLY_RE = /<!-- template:[\s\S]*?-->\n*/g;

// ---------------------------------------------------------------------------
// Little markdown helpers
// ---------------------------------------------------------------------------

const code = (s) => `\`${s}\``;
/** A code span holding a fence marker — single backticks cannot nest. */
const fenceSpan = (lang) => `\`\` \`\`\`${lang} \`\``;
const codeList = (values, sep = ' ') => values.map(code).join(sep);
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
const widest = (strings) => strings.reduce((w, s) => Math.max(w, s.length), 0);

/** Greedy word wrap; never breaks a token, so code spans survive intact. */
function wrap(text, { width = 78, indent = '' } = {}) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (candidate.length > width && line !== '') {
      lines.push(line);
      line = indent + word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines.join('\n');
}

function table(headers, rows) {
  const out = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const row of rows) out.push(`| ${row.join(' | ')} |`);
  return out.join('\n');
}

/** Attr keys of one group, in KNOWN_ATTR_KEYS order (never alphabetical). */
function attrsOfGroup(v, group) {
  return v.KNOWN_ATTR_KEYS.filter((k) => v.ATTR_DOCS[k].group === group);
}

/** The values cell for an attr: its live domain, else the doc's description. */
function attrValues(v, key) {
  const domain = v.SPEC_ATTR_DOMAINS[key];
  if (domain !== undefined) return codeList(domain);
  const described = v.ATTR_DOCS[key].values;
  if (described === undefined) {
    throw new Error(
      `ATTR_DOCS.${key} has no enum domain and no 'values' description — ` +
        `add one in src/script/vocab.ts so the spec can describe it`,
    );
  }
  return described;
}

/** Aliases of `canonical` in a normalized alias table, minus the identity one. */
function aliasesFor(aliasTable, canonical) {
  const identity = canonical.replace(/[\s\-_]+/g, '');
  return Object.entries(aliasTable)
    .filter(([key, target]) => target === canonical && key !== identity)
    .map(([key]) => key);
}

// ---------------------------------------------------------------------------
// Region builders — one per <!-- gen:name --> placeholder
// ---------------------------------------------------------------------------

export const REGIONS = {
  /** The frontmatter example, with each key's live domain as its comment. */
  'frontmatter-example': (v) => {
    const keys = Object.keys(v.FRONTMATTER_DOCS);
    const left = keys.map((k) => `${k}: ${v.FRONTMATTER_DOCS[k].example}`);
    const w = widest(left);
    const body = keys.map((k, i) => {
      const domain = v.FRONTMATTER_ENUM_DOMAINS[k];
      const doc = v.FRONTMATTER_DOCS[k].does;
      const comment = domain === undefined ? doc : `${doc}: ${domain.join(' | ')}`;
      return `${pad(left[i], w)}   # ${comment}`;
    });
    return ['---', ...body, '---'].join('\n');
  },

  /** The universal decorations — the table people actually copy from. */
  'effects-table': (v) =>
    table(
      ['attr', 'values', 'what it does'],
      attrsOfGroup(v, 'effect').map((k) => [
        code(k),
        attrValues(v, k),
        v.ATTR_DOCS[k].does,
      ]),
    ),

  /** Everything that is not a universal decoration, and where it belongs. */
  'other-attrs': (v) =>
    table(
      ['attr', 'values', 'what it does', 'where'],
      ['layout', 'media', 'meta'].flatMap((group) =>
        attrsOfGroup(v, group).map((k) => [
          code(k),
          attrValues(v, k),
          v.ATTR_DOCS[k].does,
          v.ATTR_DOCS[k].where ?? 'anywhere',
        ]),
      ),
    ),

  stickers: (v) =>
    table(
      ['sticker', 'what it draws — when to reach for it'],
      v.STICKER_NAMES.map((name) => [code(name), v.STICKER_DOCS[name]]),
    ),

  containers: (v) =>
    table(
      ['name', 'renders as'],
      v.CONTAINER_NAMES.map((name) => {
        const doc = v.CONTAINER_DOCS[name];
        return [code(name), doc.note ? `${doc.renders} — ${doc.note}` : doc.renders];
      }),
    ),

  /** Every accepted spelling that is not just the canonical name restyled. */
  'container-aliases': (v) => {
    const rows = [];
    for (const name of v.CONTAINER_NAMES) {
      const plain = Object.entries(v.CONTAINER_ALIASES)
        .filter(([, a]) => a.name === name && a.attrs === undefined)
        .map(([key]) => key)
        .filter((key) => key !== name.replace(/-/g, ''));
      if (plain.length > 0) {
        rows.push([plain.map((a) => code(`::: ${a}`)).join(', '), code(`::: ${name}`)]);
      }
    }
    for (const variant of v.CALLOUT_VARIANTS) {
      const shorthands = Object.entries(v.CONTAINER_ALIASES)
        .filter(([, a]) => a.attrs?.variant === variant)
        .map(([key]) => key);
      if (shorthands.length > 0) {
        rows.push([
          shorthands.map((a) => code(`::: ${a}`)).join(', '),
          code(`::: callout {variant=${variant}}`),
        ]);
      }
    }
    return table(['you can write', 'you get'], rows);
  },

  'diagram-fences': (v) => {
    const rows = v.DIAGRAM_LANGS.map((lang) => {
      const also = aliasesFor(v.DIAGRAM_LANG_ALIASES, lang).filter(
        (a) => a !== 'mermaid',
      );
      return [
        fenceSpan(lang),
        v.DIAGRAM_DOCS[lang].grammar,
        also.length > 0 ? codeList(also, ', ') : '—',
      ];
    });
    const mermaid = v.DIAGRAM_LANG_ALIASES.mermaid;
    const footnote =
      mermaid === undefined
        ? []
        : [
            '',
            wrap(
              `A ${fenceSpan('mermaid')} fence is read with the ${code(mermaid)}` +
                ' grammar and warned: it is a compatibility ramp, not the' +
                ` language. Write ${fenceSpan(mermaid)} and the grammar below.`,
            ),
          ];
    return [table(['fence', 'grammar', 'also accepted'], rows), ...footnote].join('\n');
  },

  /**
   * Every language a code fence may name, in columns.
   *
   * Printed as a plain grid rather than a table with a "what it is" column:
   * the reader of this document is a chatbot deciding whether ` ```kotlin `
   * will work, and eighty rows of "the Kotlin language" answers that question
   * eighty times more slowly than a list does.
   */
  'code-fences': (v) => {
    const names = [...v.CODE_LANGS].sort();
    const colw = widest(names) + 2;
    const perRow = 5;
    const lines = ['Code fence languages (aliases in section 6b):', ''];
    for (let i = 0; i < names.length; i += perRow) {
      lines.push(
        names
          .slice(i, i + perRow)
          .map((n) => pad(n, colw))
          .join('')
          .trimEnd(),
      );
    }
    return ['```', ...lines, '```'].join('\n');
  },

  /** Quick-reference card: containers in three columns beside the fences. */
  'quickref-containers': (v) => {
    const names = [...v.CONTAINER_NAMES];
    const colw = widest(names) + 2;
    const left = ['CONTAINERS (::: name ... :::)'];
    for (let i = 0; i < names.length; i += 3) {
      left.push(names.slice(i, i + 3).map((n) => pad(n, colw)).join(''));
    }
    const fenceLabels = v.DIAGRAM_LANGS.map((l) => '```' + l);
    const fw = widest(fenceLabels) + 1;
    const right = [
      'DIAGRAM FENCES',
      ...v.DIAGRAM_LANGS.map(
        (l, i) => pad(fenceLabels[i], fw) + v.DIAGRAM_DOCS[l].card,
      ),
    ];
    const gutter = widest(left.map((l) => l.trimEnd())) + 4;
    const rows = Math.max(left.length, right.length);
    const out = [];
    for (let i = 0; i < rows; i++) {
      const l = left[i] ?? '';
      const r = right[i] ?? '';
      out.push(r === '' ? l.trimEnd() : pad(l.trimEnd(), gutter) + r);
    }
    return out.join('\n');
  },

  'quickref-attrs': (v) => [
    'ATTRS  {key=value, key2=value2}',
    `colors: ${v.WASH_COLORS.join(' ')}`,
    attrsOfGroup(v, 'effect')
      .map((k) => `${k}=`)
      .join(' '),
  ].join('\n'),

  'quickref-definitions': (v) => {
    const lines = Object.values(v.LEAF_DIRECTIVE_DOCS).flatMap((doc) => [
      doc,
      ...(doc.more ?? []),
    ]);
    const w = widest(lines.map((l) => l.syntax)) + 2;
    return [
      "DEFINITIONS (leaf directives — no closing ':::')",
      ...lines.map((l) => pad(l.syntax, w) + l.does),
    ].join('\n');
  },

  colors: (v) => v.WASH_COLORS.join(', '),

  'attr-aliases': (v) => {
    const byTarget = new Map();
    for (const [alias, target] of Object.entries(v.ATTR_KEY_ALIASES)) {
      if (alias === target) continue;
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push(alias);
    }
    const groups = [...byTarget].map(
      ([target, aliases]) => `${codeList(aliases, '/')} → ${code(target)}`,
    );
    return wrap(`- Some attribute keys have accepted synonyms: ${groups.join(', ')}.`, {
      indent: '  ',
    });
  },
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /<!-- gen:([a-z-]+) -->/g;

/**
 * Render the template against a vocab module. Throws — loudly and by name —
 * when a placeholder has no builder, or a builder has no placeholder: a
 * silently dropped reference table is exactly the failure this pipeline
 * exists to prevent.
 */
export function buildSpec(vocab, template) {
  const placed = new Set();
  const unknown = new Set();
  const body = template
    .replace(TEMPLATE_ONLY_RE, '')
    .replace(PLACEHOLDER_RE, (match, name) => {
      const build = REGIONS[name];
      if (build === undefined) {
        unknown.add(name);
        return match;
      }
      placed.add(name);
      return build(vocab);
    });
  if (unknown.size > 0) {
    throw new Error(
      `spec template asks for unknown region(s): ${[...unknown].join(', ')} — ` +
        `known regions are ${Object.keys(REGIONS).join(', ')}`,
    );
  }
  const orphans = Object.keys(REGIONS).filter((name) => !placed.has(name));
  if (orphans.length > 0) {
    throw new Error(
      `region(s) ${orphans.join(', ')} are generated but never placed — add ` +
        `<!-- gen:${orphans[0]} --> to scripts/spec-template.md or delete the builder`,
    );
  }
  // The banner is not in the template, so the template stays readable as prose.
  return `${BANNER}\n\n${body}`;
}

/** The frontend copy: the same markdown as one exported string literal. */
export function renderSpecModule(md) {
  return `/**
 * GENERATED FILE — do not edit by hand.
 * Built from src/script/vocab.ts + scripts/spec-template.md.
 * Regenerate with: npm run spec
 */

/** The complete Notebook Script spec, shown/copied for the user's AI. */
export const NOTEBOOK_SCRIPT_SPEC: string = ${JSON.stringify(md)};
`;
}

/**
 * Every name the parser knows that the spec never mentions. The generated
 * tables cover these by construction — this catches the other direction: a
 * name that no table happens to print (a new attr group, a value domain
 * attached to no documented key), which would otherwise ship as silence.
 */
export function missingFromSpec(vocab, md) {
  const mentions = (name) =>
    new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(md);
  const missing = [];
  const check = (what, names) => {
    for (const name of names) if (!mentions(name)) missing.push(`${what} '${name}'`);
  };
  check('container', vocab.CONTAINER_NAMES);
  check('sticker', vocab.STICKER_NAMES);
  check('attribute', vocab.KNOWN_ATTR_KEYS);
  check('diagram fence', vocab.DIAGRAM_LANGS);
  check('page-style key', Object.keys(vocab.FRONTMATTER_DOCS));
  check('leaf directive', Object.keys(vocab.LEAF_DIRECTIVE_DOCS));
  for (const [key, domain] of Object.entries(vocab.SPEC_ATTR_DOMAINS)) {
    check(`${key} value`, domain);
  }
  for (const [key, domain] of Object.entries(vocab.FRONTMATTER_ENUM_DOMAINS)) {
    check(`${key} value`, domain);
  }
  return missing;
}

/**
 * First few differing lines, as want/have pairs. Long lines are windowed
 * around the first differing character — spec.ts is one 20k-char string
 * literal, and printing it twice helps nobody.
 */
export function firstDifferences(want, have, limit = 6) {
  const a = want.split('\n');
  const b = have.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit * 2; i++) {
    if (a[i] === b[i]) continue;
    const x = a[i];
    const y = b[i];
    let at = 0;
    while (x !== undefined && y !== undefined && x[at] === y[at]) at++;
    const show = (line) => {
      if (line === undefined) return '(end of file)';
      if (line.length <= 200) return line;
      const from = Math.max(0, at - 60);
      const to = Math.min(line.length, at + 100);
      return `…${line.slice(from, to)}…  (at char ${at})`;
    };
    out.push(`  line ${i + 1}: want: ${show(x)}`);
    out.push(`  line ${i + 1}: have: ${show(y)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Load vocab.ts into a real module. esbuild is only needed on this path. */
async function loadVocab() {
  const { transform } = await import('esbuild');
  const ts = readFileSync(VOCAB_PATH, 'utf8');
  const { code: js } = await transform(ts, { loader: 'ts', format: 'esm' });
  const url = `data:text/javascript;base64,${Buffer.from(js, 'utf8').toString('base64')}`;
  return import(url);
}

async function main(argv) {
  const check = argv.includes('--check');
  const vocab = await loadVocab();
  const md = buildSpec(vocab, readFileSync(TEMPLATE_PATH, 'utf8'));
  const ts = renderSpecModule(md);

  if (!check) {
    writeFileSync(SPEC_MD_PATH, md, 'utf8');
    writeFileSync(SPEC_TS_PATH, ts, 'utf8');
    const missing = missingFromSpec(vocab, md);
    if (missing.length > 0) {
      console.error(
        `spec written, but it never mentions: ${missing.join(', ')}\n` +
          'Add it to a generated region in scripts/gen-spec.mjs.',
      );
      return 1;
    }
    console.log(
      `spec regenerated — ${md.length} chars, ` +
        `${Object.keys(REGIONS).length} generated regions.`,
    );
    return 0;
  }

  const problems = [];
  const onDisk = (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };
  for (const [path, want] of [
    [SPEC_MD_PATH, md],
    [SPEC_TS_PATH, ts],
  ]) {
    const have = onDisk(path);
    if (have !== want) {
      problems.push(`${path} is stale:`, ...firstDifferences(want, have));
    }
  }
  for (const name of missingFromSpec(vocab, md)) {
    problems.push(`the spec never mentions ${name}`);
  }
  if (problems.length > 0) {
    console.error(
      ['Notebook Script spec is out of date:', ...problems, '', 'Run: npm run spec'].join(
        '\n',
      ),
    );
    return 1;
  }
  console.log('spec is up to date.');
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
