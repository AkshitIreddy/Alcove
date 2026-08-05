# Design: script-language

## Recommendation
Hybrid Markdown dialect ("Notebook Script"): CommonMark-subset base + `:::name {attrs}` container/leaf directives + Pandoc-style `{attrs}` on any block/span + Mermaid-style fenced mini-languages for diagrams, parsed by a handwritten linear-time, never-failing tolerant parser in TypeScript.

## Rationale
LLMs are already fluent in every ingredient: plain Markdown (dominant in training data), Docusaurus/remark-style `:::` containers (the [generic directives proposal](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444) implemented by [remark-directive](https://github.com/remarkjs/remark-directive)), Pandoc `{#id .class key=val}` attributes, and Mermaid-style fenced diagram blocks â€” the [evidence on LLM+Mermaid](https://microsoft.github.io/genaiscript/blog/mermaids/) shows models produce mostly-valid diagram code but make small syntax slips, which argues for (a) simpler-than-Mermaid mini-grammars and (b) a forgiving parser rather than a validator that rejects. Alternatives lose on at least one hard requirement: MDX/JSX is unforgiving (one unclosed tag kills the doc) and verbose; YAML/JSON documents are diffable but miserable for prose-heavy notes and LLMs make indentation/quoting errors at scale; XML-ish tags are noisy and LLMs mismatch closing tags; Typst-like is too rare in training data; [Markdoc](https://markdoc.dev/docs/syntax) (Stripe) is the closest prior art and validates the "Markdown + typed tags + annotations" architecture, but its `{% tag %}` syntax is less common in training data than `:::` and its markdown-it/PEG pipeline is strict-by-design â€” we want its schema/validation idea with friendlier surface syntax. [Djot](https://djot.net/) (MacFarlane) proves the parsing strategy: a line-oriented, linear-time, no-backtracking block parser with attributes-on-anything is small and tractable to handwrite, which is exactly what we need for slop tolerance (accept `:` vs `=` in attrs, unclosed fences, fuzzy directive names) â€” tolerance rules that no off-the-shelf strict parser (remark, markdown-it) gives without fighting the library. A handwritten parser also gives exact source spans for round-tripping and zero dependency weight (cold-start/memory budget). Sources: [Markdoc syntax](https://markdoc.dev/docs/syntax), [Markdoc repo](https://github.com/markdoc/markdoc), [remark-directive](https://github.com/remarkjs/remark-directive), [directives proposal](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444), [Djot](https://djot.net/), [Djot repo](https://github.com/jgm/djot), [GenAIScript on fixing LLM Mermaid](https://microsoft.github.io/genaiscript/blog/mermaids/), [MermaidSeqBench](https://arxiv.org/pdf/2511.14967).

## Implementation plan
## 1. Surface syntax (what the spec file teaches)

One self-contained spec file shipped at `src-tauri/resources/notebook-script-spec.md` (~620 lines, every feature shown as a copy-pasteable example; app has a "Copy the format for your AI" button that reads it via Tauri resource API). That file is **generated** — narrative from `scripts/spec-template.md`, every reference table from `src/script/vocab.ts` (see section 6).

### Complete mini-example note
```
---
title: Cell Biology â€” Week 3
paper: grid            # cream | grid | dotted | lined
ink: sepia             # sepia | graphite | ink-blue
wash: amber            # page-edge watercolor wash: amber | terracotta | moss | none
---

# The Cell {sticker=microscope}

Cells are the ==basic unit of life=={color=amber}. Key terms: **organelle**, *cytoplasm*, ~~protoplasm~~ (outdated).

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
1838: Schleiden â€” plant cells
1839: Schwann â€” animal cells | color=terracotta
1855: Virchow â€” cells from cells
```

> "Omnis cellula e cellula" â€” Virchow {washi=top}
```

### Inventory
- **Blocks (Markdown base):** `#`â€“`###` headings, paragraphs, `-`/`1.` lists (nesting by 2-space indent), `> ` quotes, `---` divider, `| a | b |` tables, `![alt](src)` images, task lists `- [ ]`.
- **Inline:** `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `==highlight==`, `^sup^`, `~sub~`, `[link](url)`; any span may take trailing `{attrs}` (e.g. `==term=={color=moss}`).
- **Inline leaves (v3):** `$x^2$` maths, `[^ a note ]` footnotes, `[[Another page]]` page references. All three are LEAVES — opaque text, never markup-parsed — and all three fail soft into literal text, which is why the dollar rule requires a formula not to open or close against a space (so "$5 and $10" stays a sentence about money). Footnotes also accept Markdown's two-part `[^label]` + `[^label]: note` form, collected by the same pre-pass as `::let` and folded into the marker, because the note travels inside the marker in the editor too (fixed-height pages, overflow flows onward — see block-editor.md). A page reference carries only the NAME: ids belong to a library, not a document, so `ToTiptapOptions.resolvePageLink` is what turns one into a live `pageLink`, and an unresolved one degrades to its own words rather than to a dead chip.
- **Equation blocks (v3):** `$$ … $$`, either fenced over several lines or all on one. The body is verbatim — no inline pass, no trimming of interior lines, no `{{var}}` substitution — because a formula is source for a different renderer (`src/editor/nodes/mathTex.ts`).
- **Containers (`:::name {attrs}` â€¦ `:::`):** `sticky-note`, `polaroid`, `washi-box`, `callout` (variants info/tip/warn/star), `columns`/`col`, `image-row`, `card`, `quote-card`, `spoiler`, `banner`, the stationery and keepsake drawers (`index-card`, `envelope`, `stamp`, `tag`, `marginalia`, `pressed-flower`, `ticket-stub`, `postcard`, `ledger`, `photo-corner`, `wax-seal`, `map-pin`), and `toggle` â€” a fold, mapped to TipTap's `details`/`detailsSummary`/`detailsContent` triple with `title` as the summary. `toggle` is NOT `spoiler`: a spoiler hides one answer, a toggle organises a document and nests. Unknown names render as a generic decorated box â€” never an error.
- **Fenced mini-languages (info-string routed):** `tree`, `mindmap` (same indent grammar, radial layout), `graph`/`flowchart` (`A -> B: label`, `A -> B, C`; node decoration `A {shape=cloud, color=amber}` on its own line), `timeline` (`label: text | attrs`).
- **Leaf directives (v2):** `::let name = value` / `::let {a=1, b=2}` define document-scoped variables referenced as `{{name}}`; `::style name {attrs}` names a reusable attribute set applied with `{use=name}` (or `{use="a b"}`). Both are two-colon leaves — no closing `:::` — collected in a pre-pass so definitions are order-free.
- **Image fetch directive:** inside `image-row` (or standalone leaf `::fetch{query="kitten", count=3, style=polaroid}`), lines `fetch: <query> | key=valâ€¦`. The plan was that insert time resolves each via the Rust side and rewrites the block to concrete `image:` entries with cached local paths. **Half of that is built and the halves are not joined**: `fetch_images` exists in `src-tauri/src/media.rs` (Openverse, working, with a URL guard and a local asset cache) and `fetchImages()` wraps it in `src/editor/media/assets.ts` â€” and nothing in the app calls either. So a `fetch:` line parses, previews as "image search: â€¦" in the Insert Script dialog, and then arrives on the page as a paragraph reading `fetch: a kitten`. Until something joins them, do not put a `fetch:` in seeded content (the welcome book draws its kittens instead, `public/kittens/`).
- **~20 decorative effects** exposed two ways: container names (above) and universal block attrs: `{sticker=â€¦}` (star, bee, leaf, microscope, heart, â€¦), `{tape=top|corner|both}`, `{washi=top}`, `{rotate=-3..3}`, `{color=â€¦}` (amber, terracotta, moss, lemon, sky, blush, graphite), `{paper=torn|lined}`, `{shadow=soft}`, `{underline=squiggle|marker}`, `{frame=scallop|stitch}`.
- **Page styles:** flat `key: value` frontmatter only (no nested YAML â€” hand-parsed, `#` comments allowed).

## 2. Parser architecture (handwritten, no parser lib)

All TypeScript in the renderer: `src/script/` â€” `lexer.ts` is unnecessary; go straight line-oriented like Djot.

- `src/script/types.ts` â€” `ScriptDoc { frontmatter, blocks: Block[], diagnostics: Diag[], vars?, styles? }`; every `Block`/`Inline` node carries `{ srcStart, srcEnd }` byte offsets and normalized `attrs: Record<string,string|number|boolean>`. `Diag { severity: 'warn', code, message, span, line, column, expected? }` â€” there is no 'error' severity by design. `vars`/`styles` are omitted entirely when a note defines none, so pre-v2 documents keep their exact shape.
- `src/script/diagnostics.ts` (v2) - the `DiagCode` union (the stable contract the Insert Script dialog and the tests filter on), `diag()`/`pushDiag()` constructors, `expectedOneOf()` for "expected ..." prose, `locateDiags()` (offset to 1-based line/column, binary search over line starts) and `sortDiags()` (source order, stable - the post-passes run out of order).
- `src/script/resolve.ts` (v2) - variables and reusable styles. `scanDirectives()` lifts `::let`/`::style` lines out of the line stream before the block pass (skipping fence bodies) and records the consumed line indices, so every other source offset is untouched; `resolveVars()`/`resolveStyles()` expand definitions that reference definitions, with DFS cycle detection; `applyDefinitions()` walks the finished tree substituting `{{name}}` into text, attr values, hrefs, image src/alt, diagram labels and frontmatter (never into code spans) and merges `{use=name}` attrs *under* the block's own. Unknown names and cycles are diagnostics, never failures.
- `src/script/blockParser.ts` â€” single forward pass over lines, explicit container stack, **no backtracking** (Djot model). Recognizers in priority order: frontmatter (only at line 0), fence open/close (`:::+` or ```` ```+ ````), heading, divider, list item, quote, table row, image, paragraph (fallthrough â€” any unrecognized line becomes text; parser cannot fail).
- `src/script/attrParser.ts` â€” tolerant micro-parser for `{â€¦}`: accepts `=` or `:` as assignment, `,`/`;`/space separators, bare or quoted values, trailing commas, `#id` and `.class` shorthands. Unknown keys â†’ keep + warn. Enum values fuzzy-matched by Levenshtein â‰¤ 2 against the known palette/effect tables (`colour=ambr` â†’ `color=amber`, warn).
- `src/script/inlineParser.ts` â€” single-pass delimiter-stack tokenizer (CommonMark-style flanking rules simplified per Djot: `*`=strong, `_`=em also accepted as `**`/`*` Markdown forms). Unclosed delimiters degrade to literal text.
- `src/script/diagrams/{tree,graph,timeline}.ts` â€” one tiny parser each (~80 lines): tree/mindmap = indentation stack; graph = split on tolerant arrow regex `/-+>|=+>|â†’/`, comma fan-out; timeline = `label: rest | attrs`. Output typed diagram ASTs consumed by the SolidJS renderers.
- `src/script/normalize.ts` â€” directive-name canonicalization: lowercase, strip spaces/`-`/`_` (`Sticky Note` = `sticky-note` = `stickynote`), alias table (`note`â†’`sticky-note`, `pic-row`â†’`image-row`).

### Error-tolerance rules (documented verbatim in the spec so LLM slop and parser agree)
1. Fence open = 3+ markers; close = 2+ of same kind; nesting resolved by stack â€” a `:::` close pops the innermost open container; all containers auto-close at EOF (warn).
2. Info-string/attr slop per attrParser above; attrs may appear on the fence line or on the first line inside (both accepted).
3. Unknown container/fence names render generically, never fail; unknown attrs ignored with warning.
4. Inside diagram fences, blank lines and `//`/`#` comment lines are skipped; tabs = 2 spaces.
5. Guarantee: `parse()` is total â€” always returns a doc + diagnostics. The Insert Script dialog shows warnings inline ("line 12: unknown color 'ambr', using amber") with the parsed preview, and inserts anyway.
6. Diagnostics (v2) are precise, never fatal: every warning carries a stable `code`, 1-based `line`/`column` and, where the parser can say it, an `expected` string ("amber, terracotta or moss"). They are returned in source order. New coverage over v1's silence: junk/nested braces inside an attr list, `key` with no value, non-numeric `rotate`/`cols`, duplicate keys, frontmatter that was rejected (and why), indented "nested YAML", unknown page-style keys, `::: col` outside `::: columns`, ragged table rows, images with no src, runaway container nesting, and HTML/JSX/`import`/Setext lines (the four things a chatbot reaches for when it forgets which language it is writing).
7. Variables and styles (v2) fail soft the same way: an unknown `{{name}}` stays on the page verbatim with a warning naming the defined variables, an unknown `{use=x}` is simply not applied, and definition cycles are cut with a `var-cycle`/`style-cycle` warning instead of looping. Substitution happens after the block pass and inserts plain text only, so a variable can never inject structure. `{{name}}` is never expanded inside `` `code` `` spans or fence bodies.

## 3. Round-tripping
- `src/script/printer.ts` â€” deterministic canonical printer `print(doc): string`: stable attr order (id, class, then alphabetical), `=` assignment, `, ` separator, 3-marker fences, 2-space indents. Invariant (property-tested): `parse(print(doc))` deep-equals `doc` modulo spans/diagnostics.
- Printing v2 (`printDoc`): definitions are emitted after the frontmatter and before the blocks, names sorted, as `::let name = value` (quoted only when the value would be misread) and `::style name {attrs}`. `{use=name}` survives printing *alongside* the attrs it expanded to, which keeps the merge idempotent: reparsing merges the same style under the same explicit attrs and lands on the identical bag. The editor's own block model has no notion of definitions, so a note that has been edited in the app exports with the values already substituted and the `::let`/`::style` lines gone - exactly the "canonicalized" contract the sourceDirty flag already advertises.
- Storage: each page persists `{ doc: ScriptDoc-as-JSON, source: string | null, sourceDirty: boolean }` in the SQLite page row (Rust side). On Insert Script, `source` = the user's pasted text verbatim. Any subsequent edit in the editor sets `sourceDirty`. "Export Script" returns stored `source` if clean (byte-identical, preserves the LLM's slop â†’ diffable against what the AI wrote), else `print(doc)` (canonical). Because the printer is canonical and line-oriented, exports diff cleanly line-by-line.

## 4. Integration
- Insert Script button â†’ paste textarea â†’ `parse()` (sync, <5ms for typical notes; run in the renderer, no Rust round-trip) â†’ preview render â†’ on confirm, image `fetch:` entries resolved via a `#[tauri::command] fetch_images(query, count, source)` in `src-tauri/src/lib.rs` (reqwest â†’ Openverse API â†’ download to app-data cache, return local asset paths) â†’ blocks appended to the editor document. The editor's native block model IS `Block` from types.ts â€” no separate import AST.

## 5. Testing
- Vitest golden-file suite: `tests/fixtures/*.script` + expected JSON snapshot each.
- v2 suite `tests/script/v2.test.ts`: diagnostic codes/positions/expected text, variables (forward references, nesting, cycles, code-span immunity), styles (merge order, chained use, cycles), plus adversarial input (broken definitions everywhere, unterminated fences around them, 200-deep variable chains) and fast-check fuzz asserting every diagnostic stays located and severity-'warn'.
- Slop corpus: ~60 deliberately-broken variants (unclosed fences, `:` attrs, misspelled colors, mixed arrows) asserting parse-without-error + specific recoveries. Generate real samples by prompting 3â€“4 different LLMs with only the spec file and adding their raw outputs as fixtures.
- fast-check property tests: printer round-trip invariant; parser totality (random unicode soup never throws).

## 6. Keeping the spec honest (generated reference sections)

The spec is the interface between a chatbot and the parser, and it is the one artifact with no compiler behind it: a directive, effect, sticker or diagram added to `src/script/vocab.ts` and not to the spec means the chatbot writes script the app cannot read, silently, forever. So the reference half of the spec is generated and the whole thing is gated.

- **`src/script/vocab.ts` is the single source of truth.** Alongside the name tables it now carries doc tables — `CONTAINER_DOCS`, `STICKER_DOCS`, `ATTR_DOCS`, `DIAGRAM_DOCS`, `FRONTMATTER_DOCS`, `LEAF_DIRECTIVE_DOCS` — each typed `Record<NameUnion, Doc>` over the `as const` array it describes. Adding a name is therefore a *type error* until it has prose: `tsc` is what enforces documentation, not review. `SPEC_ATTR_DOMAINS` is the same as `ATTR_ENUM_DOMAINS` except `sticker`, whose live domain grows at runtime with the user's imported stickers while the shipped spec documents the built-ins.
- **`scripts/spec-template.md` holds the hand-written half** — what the language is for, the tone, the tour, the worked example, the "this is NOT Mermaid" contrast, the checklist — with `<!-- gen:name -->` placeholders where a reference table belongs.
- **`scripts/gen-spec.mjs` renders one into the other** (12 regions: frontmatter example, effects table, other-attrs table, sticker table, container table, container aliases, diagram fences, three quick-reference blocks, colour list, attr-key synonyms) and writes both `src-tauri/resources/notebook-script-spec.md` and the inlined `src/editor/script/spec.ts`. It loads the TypeScript vocab through esbuild's transform (no build step, no duplicated table in JS). A placeholder with no builder, or a builder with no placeholder, is a hard error — losing a whole table to a deleted placeholder is the failure mode this exists to prevent. `npm run spec` writes; `npm run spec:check` (and `npm run build`) verify.
- **`tests/script/spec-generated.test.ts` is the gate.** It regenerates in memory from the same two inputs and fails if either checked-in file differs, printing the first differing lines and `Run: npm run spec`. `missingFromSpec()` then checks the other direction — every container, sticker, attr key, fence, page-style key, leaf directive and enum value must literally appear in the shipped text, so a name that no region happens to print is caught too. The rest of the file asserts the vocabulary is what the parser *implements*: every canonical name and alias resolves, every enum value parses without a diagnostic, every spelling of every leaf directive is understood, and `DIAGRAM_SHAPE_VALUES` still equals the renderer's `DIAGRAM_SHAPES`.

Net effect: adding an insertable is "add the name, write one line of prose (the compiler insists), run `npm run spec`". Forgetting the last step is a red test, not a silent bug.

## Libraries
No parser/markdown dependency â€” handwritten ~1200-line TS parser in src/script/ (core requirement: slop tolerance and source spans)
fast-check ^4 (dev â€” property tests: round-trip + parser totality)
vitest ^3 (dev â€” golden-file suite)
nanoid ^5 (block IDs in the document model)
Rust side: reqwest 0.12 + serde_json 1 (already-typical Tauri deps) for the image-fetch command against Openverse/Pexels

## Risks
1) Handwritten-parser bugs (edge cases CommonMark spent years on). Mitigation: we implement a deliberately small Markdown subset (no setext headings, no lazy continuation, no reference links, no HTML passthrough â€” the spec is the contract, not CommonMark), Djot-style local/linear rules, plus golden-file + fuzz + real-LLM-output corpora from day one. 2) Over-tolerance can mask intent (fuzzy-matching `rows` to `rotate` etc.). Mitigation: Levenshtein cap of 2, only within same value domain, and every correction surfaces as a visible warning in the insert preview. 3) LLMs may emit Mermaid instead of our diagram grammars out of habit. Mitigation: spec explicitly says "not Mermaid" with contrastive examples, and the graph parser accepts Mermaid's `-->` arrow and `graph TD`-style header line (ignored with warning) as a compatibility ramp. 4) Image-fetch API instability/rate limits (Openverse). Mitigation: source abstraction with Pexels fallback, aggressive local caching, and graceful placeholder blocks (hand-drawn empty polaroid) when fetch fails so the note still renders. 5) Byte-exact export only holds until first edit â€” users may expect their AI's script preserved after tweaks. Mitigation: canonical printer keeps diffs minimal and the UI labels exports "canonicalized" when sourceDirty.

