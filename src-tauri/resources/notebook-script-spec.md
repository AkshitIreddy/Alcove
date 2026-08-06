<!-- Generated file — do not edit. Source: src/script/vocab.ts + scripts/spec-template.md (npm run spec). -->

# Notebook Script — the complete guide

You are (probably) an AI assistant that has been handed this file. A person
uses **Alcove**, a cozy Windows desktop app built like a picture book: flat-drawn
shelves and walls, with ruled pages inside — warm parchment paper, handwriting-style
type, block editor, diagrams, tape, stickers, watercolor washes, sticky notes,
polaroids and washi tape. They want you to **write a
note for them in Notebook Script** — the app's plain-text format.

Your job: output one block of Notebook Script (and nothing else, unless asked).
The person pastes it into the app, which shows a live preview and inserts it.

Notebook Script is a small, friendly Markdown dialect. If you know Markdown,
you already know 80% of it. The other 20% is:

- `::: name {attrs}` … `:::` containers (sticky notes, polaroids, callouts…)
- `{key=value}` attributes on any block or inline span
- tiny fenced diagram languages: ` ```tree `, ` ```graph `, ` ```timeline `
  (any other fence language is ordinary highlighted code — section 6b)
- `fetch:` lines that ask the app to find images for you
- flat `key: value` frontmatter for page style
- `::let name = value` variables, used as `{{name}}` (section 4)
- `::style name {attrs}` reusable decoration, applied with `{use=name}`

The parser is deliberately forgiving. It never errors — worst case it shows a
warning and renders your intent anyway. Still, the closer you stick to this
spec, the prettier the note: every warning names the line, the column and what
it expected there, and the person pasting your note will read them.

---

## 1. Page style (frontmatter)

Optional. If present, it must be the very first thing in the note. Flat
`key: value` pairs only — no nesting, no YAML lists. `#` starts a comment.

```
---
title: Cell Biology — Week 3   # the note's own title
paper: grid                    # paper style: cream | grid | dotted | lined
ink: sepia                     # handwriting color: sepia | graphite | ink-blue
wash: amber                    # page-edge watercolor: amber | terracotta | moss | none
---
```

All keys are optional. Values are plain words — never quote them, never nest.
Anything after `key:` up to a ` #` comment is the value. Unknown keys are
kept and ignored; near-miss spellings (`papper`, `gird`) are auto-corrected
with a warning.

## 2. Blocks (the Markdown you already know)

```
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
```

Notes:

- Headings stop at `###`. `####` and deeper are treated as `###` (warned).
- `---` on its own line (not at the top of the file) is a divider.
- The `| --- | --- |` row makes the row above it the table header.
  Use `:---`, `:---:`, `---:` for left/center/right alignment.

## 3. Inline marks

```
**bold**   *italic*   `code`   ~~strikethrough~~   ==highlight==
x^2^ (superscript)    H~2~O (subscript)    [a link](https://example.com)
```

Any span can take attributes **immediately** after it (no space):

```
Cells are the ==basic unit of life=={color=amber}.
The ==mitochondria=={color=moss} is the powerhouse.
```

Backslash escapes any punctuation you want literal: `\*not bold\*`.

### Maths

Write TeX between dollars. Inline inside a sentence, `$$` for an equation on
its own line:

```
The area is $\pi r^2$, and the error term stays below $\epsilon$.

$$
E = mc^2
$$
```

`$$ x = 1 $$` on one line works too. Everything between the dollars is handed
to the maths renderer untouched — no Notebook Script markup applies inside a
formula. A lone `$` is just a dollar sign: money like "$5 and $10" is safe,
because a formula may not open or close against a space.

### Footnotes

A marker in the prose, carrying its own note:

```
The mitochondrion has its own genome[^ 16,569 base pairs in humans. ].
```

The Markdown two-part form is understood as well, and folds into the same
thing:

```
The mitochondrion has its own genome[^dna].

[^dna]: 16,569 base pairs in humans.
```

Notes are plain text (no bold, no links inside a note) and are printed at the
foot of the page they land on.

### Links to other pages

Double brackets name another page in the reader's library:

```
The numbers are on [[Photosynthesis]], and the method on [[Method notes]].
```

If a page by that name exists, this becomes a live reference and the other
page grows a backlink; if not, it quietly reads as the words themselves.

## 4. Attributes: `{key=value}`

Attributes decorate the block or span they're attached to.

- **On a block**: put them at the end of the line, **with a space before the
  brace**: `# The Cell {sticker=microscope}`
- **On an inline span**: directly after it, **no space**: `==term=={color=moss}`
- **On a container**: on the `:::` line, or alone on the first line inside.

Syntax is forgiving: `=` or `:` assign, separate with commas, semicolons or
spaces, quote values with spaces (`caption="study break"`), trailing commas
are fine, `#some-id` and `.some-class` shorthands work.

### The decorative attrs (work on any block)

| attr | values | what it does |
| --- | --- | --- |
| `color` | `amber` `terracotta` `moss` `lemon` `sky` `blush` `graphite` | watercolor tint |
| `sticker` | `star` `bee` `leaf` `microscope` `heart` `flower` `book` `pin` `sparkle` `moon` `sun` `cat` `coffee` `music` `arrow` | doodle sticker in the margin |
| `tape` | `top` `corner` `both` `left` `right` | scotch-tape effect |
| `washi` | `top` `left` `corner` | washi tape strip |
| `rotate` | number, `-3` to `3` | slight tilt, in degrees |
| `paper` | `torn` `lined` `graph` `aged` `index` | paper texture for this block |
| `shadow` | `soft` `lifted` `stacked` | soft drop shadow |
| `underline` | `squiggle` `marker` `dotted` `double` `circled` | hand-drawn underline |
| `frame` | `scallop` `stitch` `double` `rope` `ticket` | decorative border |
| `font` | `hand` `casual` `marker` `script` `chalk` `note` `serif` `book` `mono` | lettering this block is written in |
| `ink` | `sepia` `graphite` `ink-blue` `crimson` `moss` | ink colour for this block |
| `size` | `xs` `sm` `md` `lg` `xl` | lettering size |
| `align` | `left` `center` `right` | which way the lines are ranged |

Everything else is scoped to where it makes sense:

| attr | values | what it does | where |
| --- | --- | --- | --- |
| `variant` | `info` `tip` `warn` `star` | which callout | on `callout` |
| `gap` | `sm` `md` `lg` | space between columns | on `columns` |
| `cols` | number | how many images per row | on `image-row` |
| `style` | `polaroid` `plain` `washi` `watercolor` | how images and diagram nodes are framed | on `image-row`, images, diagram fences |
| `title` | free text | the label written on the thing | on `card`, `index-card`, `toggle`, `pressed-flower`, `ticket-stub`, `postcard`, `ledger`, `photo-corner`, `wax-seal`, `map-pin` |
| `shape` | `rect` `cloud` `circle` | node outline | on `graph`/`flowchart` nodes |
| `width` | number | width in pixels | on images |
| `query` | free text | what to search for | on `::fetch` |
| `count` | number | how many images to fetch | on `::fetch` |
| `caption` | free text | caption under the image | on images and `fetch:` lines |
| `src` | a path | image path | on images (usually written as `![alt](src)`) |
| `alt` | free text | image description | on images |
| `id` | a word (`#name` works too) | anchor name | anywhere |
| `class` | a word (`.name` works too) | extra class | anywhere |
| `use` | a style name, or several in quotes | apply a named `::style` | anywhere |

Examples:

```
## Field Notes {tape=corner, rotate=-2, color=sky}

Remember the powerhouse. {underline=marker}

> Nothing in biology makes sense except in the light of evolution. {washi=top}

--- {color=terracotta}
```

Block attrs go on headings, paragraphs, quotes, dividers, images, tables,
containers and diagram fences. List items don't take block attrs — decorate
their inline spans instead (`- ==key idea=={color=amber}`).

The sticker set — near-miss spellings (`sparkl`, `microscop`) are corrected
automatically:

| sticker | what it draws — when to reach for it |
| --- | --- |
| `star` | a five-pointed doodle star — favourites, gold-star results |
| `bee` | a little bee — nature, pollination, busywork |
| `leaf` | a single leaf — biology, autumn, growth |
| `microscope` | a microscope — lab work, close reading, science |
| `heart` | a hand-drawn heart — things loved or cared about |
| `flower` | a small bloom — spring, botany, something cheerful |
| `book` | a closed book — reading lists, references, homework |
| `pin` | a push-pin — pinned reminders, 'do not lose this' |
| `sparkle` | a four-point sparkle — ideas, magic, a nice result |
| `moon` | a crescent moon — night, sleep, phases, endings |
| `sun` | a rayed sun — mornings, energy, weather |
| `cat` | a curled cat — pets, comfort, a break |
| `coffee` | a steaming mug — study breaks, mornings, long sessions |
| `music` | an eighth note — songs, practice, rhythm |
| `arrow` | a curved arrow — 'see this', a pointer to the next thing |

Effects stack — a sticky note can be tinted, tilted and taped all at once:

```
::: sticky-note {color=blush, rotate=2, tape=corner, sticker=bee}
Pollination notes — see diagram below!
:::
```

Use effects like seasoning: one or two per block reads as handmade charm,
five reads as chaos.

### Variables: `::let name = value`, used as `{{name}}`

Write a value once, use it everywhere. A `::let` line is a leaf directive —
two colons, no closing `:::`:

```
::let course = Cell Biology
::let week = 3
::let {teacher="Dr. Ito", room=B12}

# {{course}} — week {{week}}

Taught by {{teacher}} in {{room}}.
```

- Definitions are document-wide and order-free: `{{course}}` works above the
  `::let` that defines it, and inside containers.
- Values are plain text. A value may reference other variables
  (`::let title = {{course}} notes`) but never carries markup — `**bold**` in a
  value stays literal.
- `{{name}}` works in prose, headings, list items, table cells, image paths,
  captions, diagram labels, attribute values (`{color={{tint}}}`) and even the
  frontmatter (`title: {{course}}`). It does **not** work inside `` `code` ``.
- Names ignore case, dashes and underscores: `{{course-name}}` finds
  `::let Course_Name`.
- An undefined `{{name}}` is left on the page exactly as written and warned
  ("unknown variable 'name'"), so nothing silently disappears. A cycle
  (`a` → `b` → `a`) is broken and warned.

### Reusable styles: `::style name {attrs}`, applied with `{use=name}`

Name a set of attributes once, then decorate many blocks with it:

```
::style hero {color=amber, rotate=-2, tape=corner}
::style quiet {color=graphite}

# The Cell {use=hero}

::: sticky-note {use=hero, color=lemon}
Explicit attrs win — this note is lemon, still tilted and taped.
:::

Footnote-ish aside. {use=quiet}
```

- `{use=name}` works on any block, container, inline span or diagram node.
- Apply several at once with quotes: `{use="hero quiet"}` (later wins).
- A style may build on another: `::style loud {use=hero, sticker=star}`.
- Attributes written on the block beat the ones the style brings.
- An unknown style name is warned and simply not applied.

Both directives are optional sugar — a note that never uses them is still
perfectly good Notebook Script. Reach for them when a note repeats the same
value or the same decoration three or more times.

## 5. Containers: `::: name {attrs}` … `:::`

Open with three colons + a name, close with a bare `:::`. Anything can go
inside, including other containers.

```
::: sticky-note {color=lemon, rotate=-2}
Exam on **Friday!** Focus on mitochondria.
:::
```

The container names:

| name | renders as |
| --- | --- |
| `sticky-note` | a post-it note (great for reminders) |
| `polaroid` | white-framed photo card |
| `washi-box` | box held to the page by washi tape |
| `callout` | callout with a hand-drawn icon in the margin |
| `columns` | side-by-side layout — holds `col` children |
| `col` | one column — only inside `columns` |
| `image-row` | row of images — see below |
| `card` | simple bordered card (good for definitions) |
| `quote-card` | decorated pull-quote |
| `spoiler` | click-to-reveal box (good for self-quizzing) |
| `banner` | full-width ribbon banner |
| `index-card` | ruled index card with a red header rule — recipes, flashcards, one fact per card |
| `envelope` | paper envelope with an open flap (letters, keepsakes) |
| `stamp` | perforated postage stamp with a postmark |
| `tag` | luggage tag on a string (a short label for what follows) |
| `marginalia` | small side note in a ruled margin — an afterthought, in a smaller hand |
| `pressed-flower` | a botanical specimen taped to a mount card — `title` is the label — species, place, date |
| `ticket-stub` | a torn ticket with a perforated stub — concerts, trains, cinemas; `title` is the stub legend |
| `postcard` | a divided-back postcard — message left, address lines right — `title` is the postmark |
| `ledger` | a ruled accounts strip with a figures column — money, tallies, scores; `title` names the account |
| `photo-corner` | a print held to the page by four paper corners — `title` is the pencil caption underneath |
| `wax-seal` | a blob of sealing wax over a ribbon, pressed with a monogram — `title` is the monogram — one or two letters |
| `map-pin` | a pin dropped in the margin with the walk in behind it — places, travel notes; `title` is the place name |
| `toggle` | a fold in the page — click the title to open it — `title` is the summary line; toggles may hold anything, including other toggles |

Unknown names are **not errors** — they render as a plain decorated box. Name
matching is generous too: case, spaces, `-` and `_` are all ignored, so
`Sticky Note`, `sticky_note` and `stickynote` are one name. On top of that:

| you can write | you get |
| --- | --- |
| `::: note`, `::: sticky`, `::: postit` | `::: sticky-note` |
| `::: photo` | `::: polaroid` |
| `::: washi` | `::: washi-box` |
| `::: twocolumns` | `::: columns` |
| `::: column` | `::: col` |
| `::: picrow`, `::: images`, `::: photorow`, `::: gallery` | `::: image-row` |
| `::: box`, `::: panel` | `::: card` |
| `::: quote`, `::: blockquote` | `::: quote-card` |
| `::: details`, `::: hidden` | `::: spoiler` |
| `::: recipe`, `::: filecard`, `::: flashcard` | `::: index-card` |
| `::: letter` | `::: envelope` |
| `::: postage` | `::: stamp` |
| `::: luggagetag`, `::: label` | `::: tag` |
| `::: sidenote`, `::: margin`, `::: aside` | `::: marginalia` |
| `::: specimen`, `::: herbarium`, `::: botanical`, `::: pressed` | `::: pressed-flower` |
| `::: ticket`, `::: stub`, `::: admitone` | `::: ticket-stub` |
| `::: postalcard` | `::: postcard` |
| `::: accounts`, `::: tally`, `::: expenses` | `::: ledger` |
| `::: photocorners`, `::: photomount`, `::: snapshot` | `::: photo-corner` |
| `::: seal`, `::: wax`, `::: sealingwax`, `::: sealed` | `::: wax-seal` |
| `::: pin`, `::: place`, `::: location`, `::: waypoint` | `::: map-pin` |
| `::: fold`, `::: foldout`, `::: collapse`, `::: collapsible`, `::: accordion`, `::: disclosure` | `::: toggle` |
| `::: info` | `::: callout {variant=info}` |
| `::: tip`, `::: hint` | `::: callout {variant=tip}` |
| `::: warn`, `::: warning`, `::: caution` | `::: callout {variant=warn}` |
| `::: star`, `::: important` | `::: callout {variant=star}` |

A tour of the containers:

```
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
```

### Columns

```
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
```

### Image rows and fetched images

Inside an `image-row`, each line is one image. A `fetch:` line asks the app
to find an image for that query (it downloads and caches one at insert time):

```
::: image-row {style=polaroid, cols=3}
fetch: fluffy kitten | caption=Study break :3
fetch: sleepy kitten
fetch: kitten in a box | rotate=3
:::
```

After the `|` you can add attrs: `caption=...`, `rotate=...`. Values may
contain spaces without quotes there.

A standalone fetch (outside an image-row) is a double-colon leaf:

```
::fetch{query="watercolor cell diagram", count=1}
```

You can also use regular Markdown images anywhere: `![alt](path){rotate=2}`.

## 6. Diagrams (fenced mini-languages)

These are **not Mermaid** (see section 8). They are much simpler.

| fence | grammar | also accepted |
| --- | --- | --- |
| `` ```tree `` | indentation only, 2 spaces per level | `treediagram` |
| `` ```mindmap `` | the `tree` grammar, laid out radially | `mind` |
| `` ```graph `` | `A -> B: label`, one edge per line | `digraph`, `network` |
| `` ```flowchart `` | the `graph` grammar, for processes | `flow` |
| `` ```timeline `` | one `label: text` per line | `chronology` |

A `` ```mermaid `` fence is read with the `flowchart` grammar and warned: it
is a compatibility ramp, not the language. Write `` ```flowchart `` and the
grammar below.

### The `tree` fence

```tree {style=watercolor}
Cell
  Membrane
  Cytoplasm
    Organelles
      Mitochondria | powerhouse
      Ribosomes
  Nucleus
```

- `label | note` adds a small annotation to a node.
- `label {color=amber}` decorates a node.
- ` ```mindmap ` uses the exact same grammar, laid out radially:

```mindmap
Photosynthesis
  Inputs
    Light
    Water | from roots
  Outputs
    Glucose {color=amber}
    Oxygen
```

### The `graph` fence

```graph
Sun -> Photosynthesis: light
Water -> Photosynthesis
Photosynthesis -> Glucose, Oxygen
Glucose {color=amber}
```

- `A -> B` draws an edge. `A -> B: label` labels it.
- `A -> B, C` fans out to several targets. `A -> B -> C` chains.
- A name alone on a line (optionally with `{attrs}` or `: label`)
  declares/decorates a node. Node names may contain spaces.
- ` ```flowchart ` is the same grammar — use it when the note is a process:

```flowchart
Question -> Hypothesis
Hypothesis -> Experiment: design
Experiment -> Data
Data -> Conclusion, New Question
Conclusion {shape=cloud, color=moss}
```

- Comment lines start with `//` or `#`. Blank lines are ignored.

### The `timeline` fence

```timeline
1665: Hooke names the "cell"
1838: Schleiden — plant cells
1839: Schwann — animal cells | color=terracotta
1855: Virchow — cells from cells
```

The `| attrs` tail is optional per entry. Labels don't have to be years —
`Monday:`, `Step 1:`, `9am:` all work; the label is whatever comes before
the first `:` on the line.

## 6b. Code fences

A fence whose language is **not** one of the five above is **code**, and its
body is kept exactly as you wrote it — indentation, blank lines, and every
character that would otherwise read as markup:

```python
def totals(**kwargs):

    weights = {"a": 1}
    return _sum_(weights)
```

- Nothing inside a code fence is parsed. `**bold**`, `_em_`, `{{variables}}`
  and `{attrs}` are all just characters in your program.
- The language names the colours. Aliases work — `js`, `ts`, `py`, `c++`,
  `yml`, `sh`, `toml`, `Objective-C` — and an unknown one still makes a code
  block, just an uncoloured one (with a warning).
- No language at all (` ``` ` on its own) is fine and is not warned about.
- Use four or more backticks when the code itself contains three.

```
Code fence languages (aliases in section 6b):

bash          brainfuck     c             clojure       cmake
coffeescript  cpp           crystal       csharp        css
dart          delphi        diff          dockerfile    dos
elixir        elm           erlang        fortran       fsharp
gcode         gherkin       go            gradle        graphql
groovy        haskell       haxe          html          http
ini           java          javascript    json          julia
kotlin        latex         less          lisp          llvm
lua           makefile      markdown      matlab        nginx
nim           nix           objectivec    ocaml         perl
php           plaintext     powershell    protobuf      python
r             ruby          rust          scala         scheme
scss          sql           swift         typescript    vbnet
verilog       vhdl          wasm          x86asm        xml
yaml
```

## 7. Tolerance promises (relax — it will parse)

The parser **never rejects a note**. It always produces a page plus, at most,
gentle warnings. Specifically:

- If you write `:` instead of `=` in attrs (`{color: amber}`), it still works.
- Some attribute keys have accepted synonyms:
  `colour`/`bg`/`background`/`highlight` → `color`, `rotation` → `rotate`,
  `columns` → `cols`, `typeface`/`face`/`family`/`fontfamily` → `font`,
  `pen`/`inkcolor`/`textcolor` → `ink`, `fontsize`/`scale` → `size`,
  `textalign`/`alignment`/`justify` → `align`, `uses`/`apply`/`usestyle` →
  `use`.
- If you misspell an enum value within reason (`color=ambr`, `color=terracota`),
  it is auto-corrected to the nearest known value, with a warning.
- If you misspell or re-style a container name (`Sticky Note`, `stickynote`,
  `note`), it resolves to `sticky-note`. Truly unknown names render as a
  plain box — never an error.
- If you name a fence language nobody knows, you still get a code block; it
  is simply not coloured (warned).
- If you forget to close a `:::` container or a code fence, it auto-closes at
  the end of the note (warned).
- Attrs on the fence line or alone on the first line inside — both work.
- Unknown attribute keys are kept and ignored by the renderer (warned).
- `\r\n` (Windows) and `\n` line endings are treated identically.
- Tabs count as 2 spaces for indentation.
- Inside diagram fences, blank lines and `//`/`#` comments are skipped.
- Unclosed `**bold` or `==marks` degrade to literal text, not errors.

So: do your best, don't stress about perfection.

### …but every recovery is reported

Tolerance is not silence. Each recovery above produces a warning that names
the line, the column and what was expected, and the app lists them next to the
preview. The ones you are most likely to trigger:

| what you wrote | what you are told |
| --- | --- |
| `{color=chartreuse}` | unknown color 'chartreuse' — expected amber, terracotta, moss… |
| `{rotate=slightly}` | 'rotate' expects a number |
| `{color=amber, color=moss}` | attribute 'color' is set twice — the last wins |
| `{color}` | attribute 'color' needs a value — expected `color=amber` |
| `::: wobbly-box` | unknown container — expected sticky-note, polaroid… |
| a `:::` or ` ``` ` left open | closed at end of note |
| `::: col` with no `::: columns` | renders as a plain box |
| a table row with the wrong cell count | row has 3 cells but the header has 2 |
| `<Callout>` / `<div>` / `import` | that is JSX/HTML/JS, not Notebook Script |
| `{{typo}}` | unknown variable — with the list of defined ones |
| `{use=ghost}` | unknown style — with the list of defined ones |

Nothing on that list stops the note from being inserted. They are there so a
person can see what you meant versus what the app understood.

## 8. This is NOT Mermaid, MDX, JSX, or HTML — do not emit those

Notebook Script's diagram fences look like Mermaid at a glance but are a
different, simpler grammar. **Do not** write Mermaid:

WRONG (Mermaid — do not do this):

    ```mermaid
    graph TD
      A[Sun] -->|light| B(Photosynthesis)
      B --> C{Glucose}
    ```

RIGHT (Notebook Script):

    ```graph
    Sun -> Photosynthesis: light
    Photosynthesis -> Glucose
    ```

No `graph TD` header. No `[...]`/`(...)`/`{...}` shape brackets — write plain
names and use `{shape=..., color=...}` attrs on a node's own line instead.
(If you slip and emit `-->` arrows or a `graph TD` header, the parser will
cope — but don't rely on it.)

Also **do not** write:

- **MDX/JSX**: no `<Callout>`, no `<Note title="x"/>`, no `import`/`export`.

  WRONG:

      <Callout type="info">Remember the exam!</Callout>

  RIGHT:

      ::: callout {variant=info}
      Remember the exam!
      :::

- **HTML**: no `<div>`, `<b>`, `<table>`, `<img>`.

  WRONG:

      <img src="cell.png" alt="a cell" width="300"/>

  RIGHT:

      ![a cell](cell.png){width=300}

- **Nested YAML** in frontmatter: no lists, no indentation — flat
  `key: value` only.

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

- **Setext headings** (`Title\n====`), reference links (`[a][1]`), or
  footnotes — not part of the language.

## 9. Complete example note

Copy the shape of this — it uses nearly every feature:

```
---
title: Cell Biology — Week 3
paper: grid
ink: sepia
wash: amber
---

::let course = Cell Biology
::let week = 3
::style pinned {color=lemon, rotate=-2, tape=corner}

# The Cell {sticker=microscope}

{{course}} — week {{week}}. Cells are the ==basic unit of life=={color=amber}.
Key terms: **organelle**, *cytoplasm*, ~~protoplasm~~ (outdated).

::: sticky-note {use=pinned}
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

```tree {style=watercolor}
Cell
  Membrane
  Cytoplasm
    Organelles
      Mitochondria | powerhouse
      Ribosomes
  Nucleus
```

```timeline
1665: Hooke names the "cell"
1838: Schleiden — plant cells
1839: Schwann — animal cells | color=terracotta
1855: Virchow — cells from cells
```

> "Omnis cellula e cellula" — Virchow {washi=top}
```

## 10. Quick reference card

```
BLOCKS                              INLINE
# ## ###        headings            **b**        bold
- text          bullet              *i*          italic
1. text         ordered             `c`          code
- [ ] / - [x]   task                ~~s~~        strike
> text          quote               ==h==        highlight
---             divider             x^2^  H~2~O  sup / sub
| a | b |       table               [t](url)     link
![alt](src)     image               \*           literal star
$$ … $$         equation            $x^2$        maths
                                    [^ note ]    footnote
                                    [[Page]]     link to a page

CONTAINERS (::: name ... :::)                   DIAGRAM FENCES
sticky-note     polaroid        washi-box       ```tree      indent = nesting
callout         columns         col             ```mindmap   same, radial
image-row       card            quote-card      ```graph     A -> B: label
spoiler         banner          index-card      ```flowchart same as graph
envelope        stamp           tag             ```timeline  label: text | attrs
marginalia      pressed-flower  ticket-stub
postcard        ledger          photo-corner
wax-seal        map-pin         toggle
ATTRS  {key=value, key2=value2}
colors: amber terracotta moss lemon sky blush graphite
color= sticker= tape= washi= rotate= paper= shadow= underline= frame= font= ink= size= align=

DEFINITIONS (leaf directives — no closing ':::')
::let course = Cell Biology   define a variable
::let {week=3, room=B12}      define several at once
{{course}}                    use one, anywhere
::style hero {color=amber}    name a set of attrs
{use=hero}                    apply it to a block or span
{use="hero quiet"}            apply several
::fetch{query="a kitten"}     ask the app to find an image
fetch: a kitten | caption=hi  one per line in an image-row
```

## 11. Final checklist (before you answer)

1. Frontmatter first (optional), flat `key: value`, closed with `---`.
2. Only `#`/`##`/`###` headings.
3. Containers: `::: name {attrs}` opened AND closed with `:::` — count them.
4. Inline attrs touch their span (`==x=={color=moss}`); block attrs get a
   space before the brace (`# Title {sticker=star}`).
5. Colors only from: amber, terracotta, moss, lemon, sky, blush, graphite.
6. Diagrams use the fences and grammars from section 6 — **never Mermaid**,
   no `graph TD`, no `[shape]` brackets, arrows are `->`.
7. No HTML, no JSX, no `import`.
8. Every `{{name}}` you write has a matching `::let name = …` somewhere, and
   every `{use=name}` has a matching `::style name {…}`. If you only use a
   value once, skip the variable and write the value.
9. Sprinkle personality: a sticky-note, a sticker, a slight `rotate`, an
   `image-row` with a `fetch:` or two. The app is warm and hand-drawn —
   notes should feel like that too.
10. Output the note as one plain-text block, ready to paste.
