/**
 * GENERATED from src-tauri/resources/notebook-script-spec.md — the canonical
 * spec file shipped as a Tauri resource. This inlined copy exists so the
 * renderer can put the spec on the clipboard ("Copy spec for your AI")
 * without a Tauri fs round-trip. If the resource file changes, regenerate
 * this file: re-escape the markdown into the template literal below
 * (escape backslashes, backticks and ${).
 */

/** The full Notebook Script spec, verbatim. */
export const NOTEBOOK_SCRIPT_SPEC: string = `# Notebook Script — the complete guide

You are (probably) an AI assistant that has been handed this file. A person
uses **Notebook**, a cozy Windows desktop notes app: a hand-drawn bookshelf
where books open into pages with warm parchment paper, watercolor washes,
sticky notes, polaroids and washi tape. They want you to **write a note for
them in Notebook Script** — the app's plain-text format.

Your job: output one block of Notebook Script (and nothing else, unless asked).
The person pastes it into the app, which shows a live preview and inserts it.

Notebook Script is a small, friendly Markdown dialect. If you know Markdown,
you already know 80% of it. The other 20% is:

- \`::: name {attrs}\` … \`:::\` containers (sticky notes, polaroids, callouts…)
- \`{key=value}\` attributes on any block or inline span
- tiny fenced diagram languages: \` \`\`\`tree \`, \` \`\`\`graph \`, \` \`\`\`timeline \`
- \`fetch:\` lines that ask the app to find images for you
- flat \`key: value\` frontmatter for page style

The parser is deliberately forgiving. It never errors — worst case it shows a
warning and renders your intent anyway. Still, the closer you stick to this
spec, the prettier the note.

---

## 1. Page style (frontmatter)

Optional. If present, it must be the very first thing in the note. Flat
\`key: value\` pairs only — no nesting, no YAML lists. \`#\` starts a comment.

\`\`\`
---
title: Cell Biology — Week 3
paper: grid            # cream | grid | dotted | lined
ink: sepia             # sepia | graphite | ink-blue
wash: amber            # page-edge watercolor: amber | terracotta | moss | none
---
\`\`\`

All keys are optional. Values are plain words — never quote them, never nest.
Anything after \`key:\` up to a \` #\` comment is the value. Unknown keys are
kept and ignored; near-miss spellings (\`papper\`, \`gird\`) are auto-corrected
with a warning.

## 2. Blocks (the Markdown you already know)

\`\`\`
# Big heading
## Medium heading
### Small heading

A paragraph. Blank lines separate paragraphs.

- bullet list
- another item
  - nested item (indent by 2 spaces)

1. ordered list
2. second item

- [ ] open task
- [x] done task

> A quote. Consecutive > lines join into one quote.

---

| Column A | Column B |
| -------- | -------- |
| cell     | cell     |

![a hand-drawn cell](assets/cell.png)
\`\`\`

Notes:

- Headings stop at \`###\`. \`####\` and deeper are treated as \`###\` (warned).
- \`---\` on its own line (not at the top of the file) is a divider.
- The \`| --- | --- |\` row makes the row above it the table header.
  Use \`:---\`, \`:---:\`, \`---:\` for left/center/right alignment.

## 3. Inline marks

\`\`\`
**bold**   *italic*   \`code\`   ~~strikethrough~~   ==highlight==
x^2^ (superscript)    H~2~O (subscript)    [a link](https://example.com)
\`\`\`

Any span can take attributes **immediately** after it (no space):

\`\`\`
Cells are the ==basic unit of life=={color=amber}.
The ==mitochondria=={color=moss} is the powerhouse.
\`\`\`

Backslash escapes any punctuation you want literal: \`\\*not bold\\*\`.

## 4. Attributes: \`{key=value}\`

Attributes decorate the block or span they're attached to.

- **On a block**: put them at the end of the line, **with a space before the
  brace**: \`# The Cell {sticker=microscope}\`
- **On an inline span**: directly after it, **no space**: \`==term=={color=moss}\`
- **On a container**: on the \`:::\` line, or alone on the first line inside.

Syntax is forgiving: \`=\` or \`:\` assign, separate with commas, semicolons or
spaces, quote values with spaces (\`caption="study break"\`), trailing commas
are fine, \`#some-id\` and \`.some-class\` shorthands work.

### The decorative attrs (work on any block)

| attr | values | what it does |
| --- | --- | --- |
| \`color\` | \`amber terracotta moss lemon sky blush graphite\` | watercolor tint |
| \`sticker\` | \`star bee leaf microscope heart flower book pin sparkle moon sun cat coffee music arrow\` | doodle sticker in the margin |
| \`tape\` | \`top corner both\` | scotch-tape effect |
| \`washi\` | \`top\` | washi tape strip |
| \`rotate\` | number, \`-3\` to \`3\` | slight tilt (degrees) |
| \`paper\` | \`torn lined\` | paper texture for this block |
| \`shadow\` | \`soft\` | soft drop shadow |
| \`underline\` | \`squiggle marker\` | hand-drawn underline |
| \`frame\` | \`scallop stitch\` | decorative border |

Free-form attrs also exist: \`cols\` (column count for image rows), \`gap\`
(\`sm\`/\`md\`/\`lg\` for columns), \`caption\`, \`width\`, \`#id\`, \`.class\`.

Examples:

\`\`\`
## Field Notes {tape=corner, rotate=-2, color=sky}

Remember the powerhouse. {underline=marker}

> Nothing in biology makes sense except in the light of evolution. {washi=top}

--- {color=terracotta}
\`\`\`

Block attrs go on headings, paragraphs, quotes, dividers, images, tables,
containers and diagram fences. List items don't take block attrs — decorate
their inline spans instead (\`- ==key idea=={color=amber}\`).

The full sticker set: \`star\`, \`bee\`, \`leaf\`, \`microscope\`, \`heart\`,
\`flower\`, \`book\`, \`pin\`, \`sparkle\`, \`moon\`, \`sun\`, \`cat\`, \`coffee\`,
\`music\`, \`arrow\`. Near-miss spellings (\`sparkl\`, \`microscop\`) are corrected
automatically.

Effects stack — a sticky note can be tinted, tilted and taped all at once:

\`\`\`
::: sticky-note {color=blush, rotate=2, tape=corner, sticker=bee}
Pollination notes — see diagram below!
:::
\`\`\`

Use effects like seasoning: one or two per block reads as handmade charm,
five reads as chaos.

## 5. Containers: \`::: name {attrs}\` … \`:::\`

Open with three colons + a name, close with a bare \`:::\`. Anything can go
inside, including other containers.

\`\`\`
::: sticky-note {color=lemon, rotate=-2}
Exam on **Friday!** Focus on mitochondria.
:::
\`\`\`

The container names:

| name | renders as |
| --- | --- |
| \`sticky-note\` | a post-it note (great for reminders) |
| \`polaroid\` | white-framed photo card |
| \`washi-box\` | box held by washi tape |
| \`callout\` | callout with an icon — \`{variant=info}\`, \`tip\`, \`warn\`, \`star\` |
| \`columns\` / \`col\` | side-by-side layout (see below) |
| \`image-row\` | row of images (see below) |
| \`card\` | simple bordered card |
| \`quote-card\` | decorated pull-quote |
| \`spoiler\` | click-to-reveal box |
| \`banner\` | full-width ribbon banner |

Shorthand callouts also work: \`::: tip\`, \`::: warn\`, \`::: info\`, \`::: star\`.

Unknown names are **not errors** — they render as a plain decorated box.
Name matching is generous: \`Sticky Note\`, \`sticky_note\`, \`stickynote\` and
\`note\` all mean \`sticky-note\`.

A tour of the containers:

\`\`\`
::: polaroid {rotate=2}
![lab microscope](assets/scope.png)
A polaroid caption goes right under the photo.
:::

::: washi-box {color=sky}
Held to the page with two strips of washi tape.
:::

::: callout {variant=info}
Callouts get a little hand-drawn icon in the margin.
:::

::: card {shadow=soft}
A plain card. Good for definitions.
:::

::: quote-card {color=blush}
The best time to review notes was yesterday. The second best time is now.
:::

::: spoiler
Hidden until clicked — perfect for self-quizzing answers.
:::

::: banner {color=amber}
**Week 3** — Cells & Organelles
:::
\`\`\`

### Columns

\`\`\`
::: columns {gap=lg}
::: col
## Prokaryotes
- No nucleus
- Example: bacteria
:::
::: col
## Eukaryotes {color=moss}
- Nucleus present
- Example: plants, animals
:::
:::
\`\`\`

### Image rows and fetched images

Inside an \`image-row\`, each line is one image. A \`fetch:\` line asks the app
to find an image for that query (it downloads and caches one at insert time):

\`\`\`
::: image-row {style=polaroid, cols=3}
fetch: fluffy kitten | caption=Study break :3
fetch: sleepy kitten
fetch: kitten in a box | rotate=3
:::
\`\`\`

After the \`|\` you can add attrs: \`caption=...\`, \`rotate=...\`. Values may
contain spaces without quotes there.

A standalone fetch (outside an image-row) is a double-colon leaf:

\`\`\`
::fetch{query="watercolor cell diagram", count=1}
\`\`\`

You can also use regular Markdown images anywhere: \`![alt](path){rotate=2}\`.

## 6. Diagrams (fenced mini-languages)

These are **not Mermaid** (see section 8). They are much simpler.

### \`tree\` — indentation only, 2 spaces per level

\`\`\`tree {style=watercolor}
Cell
  Membrane
  Cytoplasm
    Organelles
      Mitochondria | powerhouse
      Ribosomes
  Nucleus
\`\`\`

- \`label | note\` adds a small annotation to a node.
- \`label {color=amber}\` decorates a node.
- \` \`\`\`mindmap \` uses the exact same grammar, laid out radially:

\`\`\`mindmap
Photosynthesis
  Inputs
    Light
    Water | from roots
  Outputs
    Glucose {color=amber}
    Oxygen
\`\`\`

### \`graph\` — arrows between names

\`\`\`graph
Sun -> Photosynthesis: light
Water -> Photosynthesis
Photosynthesis -> Glucose, Oxygen
Glucose {color=amber}
\`\`\`

- \`A -> B\` draws an edge. \`A -> B: label\` labels it.
- \`A -> B, C\` fans out to several targets. \`A -> B -> C\` chains.
- A name alone on a line (optionally with \`{attrs}\` or \`: label\`)
  declares/decorates a node. Node names may contain spaces.
- \` \`\`\`flowchart \` is the same grammar — use it when the note is a process:

\`\`\`flowchart
Question -> Hypothesis
Hypothesis -> Experiment: design
Experiment -> Data
Data -> Conclusion, New Question
Conclusion {shape=cloud, color=moss}
\`\`\`

- Comment lines start with \`//\` or \`#\`. Blank lines are ignored.

### \`timeline\` — one \`label: text\` per line

\`\`\`timeline
1665: Hooke names the "cell"
1838: Schleiden — plant cells
1839: Schwann — animal cells | color=terracotta
1855: Virchow — cells from cells
\`\`\`

The \`| attrs\` tail is optional per entry. Labels don't have to be years —
\`Monday:\`, \`Step 1:\`, \`9am:\` all work; the label is whatever comes before
the first \`:\` on the line.

## 7. Tolerance promises (relax — it will parse)

The parser **never rejects a note**. It always produces a page plus, at most,
gentle warnings. Specifically:

- If you write \`:\` instead of \`=\` in attrs (\`{color: amber}\`), it still works.
- If you misspell an enum value within reason (\`color=ambr\`, \`color=terracota\`),
  it is auto-corrected to the nearest known value, with a warning.
- If you misspell or re-style a container name (\`Sticky Note\`, \`stickynote\`,
  \`note\`), it resolves to \`sticky-note\`. Truly unknown names render as a
  plain box — never an error.
- If you forget to close a \`:::\` container or a code fence, it auto-closes at
  the end of the note (warned).
- Attrs on the fence line or alone on the first line inside — both work.
- Unknown attribute keys are kept and ignored by the renderer (warned).
- \`\\r\\n\` (Windows) and \`\\n\` line endings are treated identically.
- Tabs count as 2 spaces for indentation.
- Inside diagram fences, blank lines and \`//\`/\`#\` comments are skipped.
- Unclosed \`**bold\` or \`==marks\` degrade to literal text, not errors.

So: do your best, don't stress about perfection.

## 8. This is NOT Mermaid, MDX, JSX, or HTML — do not emit those

Notebook Script's diagram fences look like Mermaid at a glance but are a
different, simpler grammar. **Do not** write Mermaid:

WRONG (Mermaid — do not do this):

    \`\`\`mermaid
    graph TD
      A[Sun] -->|light| B(Photosynthesis)
      B --> C{Glucose}
    \`\`\`

RIGHT (Notebook Script):

    \`\`\`graph
    Sun -> Photosynthesis: light
    Photosynthesis -> Glucose
    \`\`\`

No \`graph TD\` header. No \`[...]\`/\`(...)\`/\`{...}\` shape brackets — write plain
names and use \`{shape=..., color=...}\` attrs on a node's own line instead.
(If you slip and emit \`-->\` arrows or a \`graph TD\` header, the parser will
cope — but don't rely on it.)

Also **do not** write:

- **MDX/JSX**: no \`<Callout>\`, no \`<Note title="x"/>\`, no \`import\`/\`export\`.

  WRONG:

      <Callout type="info">Remember the exam!</Callout>

  RIGHT:

      ::: callout {variant=info}
      Remember the exam!
      :::

- **HTML**: no \`<div>\`, \`<b>\`, \`<table>\`, \`<img>\`.

  WRONG:

      <img src="cell.png" alt="a cell" width="300"/>

  RIGHT:

      ![a cell](cell.png){width=300}

- **Nested YAML** in frontmatter: no lists, no indentation — flat
  \`key: value\` only.

  WRONG:

      ---
      style:
        paper: grid
        colors: [amber, moss]
      ---

  RIGHT:

      ---
      paper: grid
      wash: amber
      ---

- **Setext headings** (\`Title\\n====\`), reference links (\`[a][1]\`), or
  footnotes — not part of the language.

## 9. Complete example note

Copy the shape of this — it uses nearly every feature:

\`\`\`
---
title: Cell Biology — Week 3
paper: grid
ink: sepia
wash: amber
---

# The Cell {sticker=microscope}

Cells are the ==basic unit of life=={color=amber}. Key terms:
**organelle**, *cytoplasm*, ~~protoplasm~~ (outdated).

::: sticky-note {color=lemon, rotate=-2}
Exam on **Friday!** Focus on mitochondria.
:::

::: columns {gap=lg}
::: col
## Prokaryotes
- No nucleus
- Example: bacteria
:::
::: col
## Eukaryotes {color=moss}
- Nucleus present
- Example: plants, animals
:::
:::

::: image-row {style=polaroid, cols=3}
fetch: fluffy kitten | caption=Study break :3
fetch: sleepy kitten
fetch: kitten in a box | rotate=3
:::

\`\`\`tree {style=watercolor}
Cell
  Membrane
  Cytoplasm
    Organelles
      Mitochondria | powerhouse
      Ribosomes
  Nucleus
\`\`\`

\`\`\`timeline
1665: Hooke names the "cell"
1838: Schleiden — plant cells
1839: Schwann — animal cells | color=terracotta
1855: Virchow — cells from cells
\`\`\`

> "Omnis cellula e cellula" — Virchow {washi=top}
\`\`\`

## 10. Quick reference card

\`\`\`
BLOCKS                              INLINE
# ## ###        headings            **b**        bold
- text          bullet              *i*          italic
1. text         ordered             \`c\`          code
- [ ] / - [x]   task                ~~s~~        strike
> text          quote               ==h==        highlight
---             divider             x^2^  H~2~O  sup / sub
| a | b |       table               [t](url)     link
![alt](src)     image               \\*           literal star

CONTAINERS (::: name ... :::)       DIAGRAM FENCES
sticky-note  polaroid  washi-box    \`\`\`tree      indent = nesting
callout      columns   col          \`\`\`mindmap   same, radial
image-row    card      quote-card   \`\`\`graph     A -> B: label
spoiler      banner                 \`\`\`flowchart same as graph
                                    \`\`\`timeline  label: text | attrs
ATTRS  {key=value, key2=value2}
colors: amber terracotta moss lemon sky blush graphite
sticker= tape= washi= rotate= color= paper= shadow= underline= frame=
\`\`\`

## 11. Final checklist (before you answer)

1. Frontmatter first (optional), flat \`key: value\`, closed with \`---\`.
2. Only \`#\`/\`##\`/\`###\` headings.
3. Containers: \`::: name {attrs}\` opened AND closed with \`:::\` — count them.
4. Inline attrs touch their span (\`==x=={color=moss}\`); block attrs get a
   space before the brace (\`# Title {sticker=star}\`).
5. Colors only from: amber, terracotta, moss, lemon, sky, blush, graphite.
6. Diagrams use the fences and grammars from section 6 — **never Mermaid**,
   no \`graph TD\`, no \`[shape]\` brackets, arrows are \`->\`.
7. No HTML, no JSX, no \`import\`.
8. Sprinkle personality: a sticky-note, a sticker, a slight \`rotate\`, an
   \`image-row\` with a \`fetch:\` or two. The app is warm and hand-drawn —
   notes should feel like that too.
9. Output the note as one plain-text block, ready to paste.
`;
