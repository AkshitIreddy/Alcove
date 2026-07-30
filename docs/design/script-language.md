# Design: script-language

## Recommendation
Hybrid Markdown dialect ("Notebook Script"): CommonMark-subset base + `:::name {attrs}` container/leaf directives + Pandoc-style `{attrs}` on any block/span + Mermaid-style fenced mini-languages for diagrams, parsed by a handwritten linear-time, never-failing tolerant parser in TypeScript.

## Rationale
LLMs are already fluent in every ingredient: plain Markdown (dominant in training data), Docusaurus/remark-style `:::` containers (the [generic directives proposal](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444) implemented by [remark-directive](https://github.com/remarkjs/remark-directive)), Pandoc `{#id .class key=val}` attributes, and Mermaid-style fenced diagram blocks â€” the [evidence on LLM+Mermaid](https://microsoft.github.io/genaiscript/blog/mermaids/) shows models produce mostly-valid diagram code but make small syntax slips, which argues for (a) simpler-than-Mermaid mini-grammars and (b) a forgiving parser rather than a validator that rejects. Alternatives lose on at least one hard requirement: MDX/JSX is unforgiving (one unclosed tag kills the doc) and verbose; YAML/JSON documents are diffable but miserable for prose-heavy notes and LLMs make indentation/quoting errors at scale; XML-ish tags are noisy and LLMs mismatch closing tags; Typst-like is too rare in training data; [Markdoc](https://markdoc.dev/docs/syntax) (Stripe) is the closest prior art and validates the "Markdown + typed tags + annotations" architecture, but its `{% tag %}` syntax is less common in training data than `:::` and its markdown-it/PEG pipeline is strict-by-design â€” we want its schema/validation idea with friendlier surface syntax. [Djot](https://djot.net/) (MacFarlane) proves the parsing strategy: a line-oriented, linear-time, no-backtracking block parser with attributes-on-anything is small and tractable to handwrite, which is exactly what we need for slop tolerance (accept `:` vs `=` in attrs, unclosed fences, fuzzy directive names) â€” tolerance rules that no off-the-shelf strict parser (remark, markdown-it) gives without fighting the library. A handwritten parser also gives exact source spans for round-tripping and zero dependency weight (cold-start/memory budget). Sources: [Markdoc syntax](https://markdoc.dev/docs/syntax), [Markdoc repo](https://github.com/markdoc/markdoc), [remark-directive](https://github.com/remarkjs/remark-directive), [directives proposal](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444), [Djot](https://djot.net/), [Djot repo](https://github.com/jgm/djot), [GenAIScript on fixing LLM Mermaid](https://microsoft.github.io/genaiscript/blog/mermaids/), [MermaidSeqBench](https://arxiv.org/pdf/2511.14967).

## Implementation plan
## 1. Surface syntax (what the spec file teaches)

One self-contained spec file shipped at `src-tauri/resources/notebook-script-spec.md` (~450 lines, every feature shown as a copy-pasteable example; app has a "Copy spec for your AI" button that reads it via Tauri resource API).

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
- **Containers (`:::name {attrs}` â€¦ `:::`):** `sticky-note`, `polaroid`, `washi-box`, `callout` (variants info/tip/warn/star), `columns`/`col`, `image-row`, `card`, `quote-card`, `spoiler`, `banner`. Unknown names render as a generic decorated box â€” never an error.
- **Fenced mini-languages (info-string routed):** `tree`, `mindmap` (same indent grammar, radial layout), `graph`/`flowchart` (`A -> B: label`, `A -> B, C`; node decoration `A {shape=cloud, color=amber}` on its own line), `timeline` (`label: text | attrs`).
- **Image fetch directive:** inside `image-row` (or standalone leaf `::fetch{query="kitten", count=3, style=polaroid}`), lines `fetch: <query> | key=valâ€¦`. At insert time the app resolves each via the Rust side (Openverse/Pexels free API, key optional) and rewrites the block to concrete `image:` entries with cached local paths â€” the fetch line is preserved in source, resolution stored in the block model.
- **~20 decorative effects** exposed two ways: container names (above) and universal block attrs: `{sticker=â€¦}` (star, bee, leaf, microscope, heart, â€¦), `{tape=top|corner|both}`, `{washi=top}`, `{rotate=-3..3}`, `{color=â€¦}` (amber, terracotta, moss, lemon, sky, blush, graphite), `{paper=torn|lined}`, `{shadow=soft}`, `{underline=squiggle|marker}`, `{frame=scallop|stitch}`.
- **Page styles:** flat `key: value` frontmatter only (no nested YAML â€” hand-parsed, `#` comments allowed).

## 2. Parser architecture (handwritten, no parser lib)

All TypeScript in the renderer: `src/script/` â€” `lexer.ts` is unnecessary; go straight line-oriented like Djot.

- `src/script/types.ts` â€” `ScriptDoc { frontmatter, blocks: Block[], diagnostics: Diag[] }`; every `Block`/`Inline` node carries `{ srcStart, srcEnd }` byte offsets and normalized `attrs: Record<string,string|number|boolean>`. `Diag { severity: 'warn', message, span }` â€” there is no 'error' severity by design.
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

## 3. Round-tripping
- `src/script/printer.ts` â€” deterministic canonical printer `print(doc): string`: stable attr order (id, class, then alphabetical), `=` assignment, `, ` separator, 3-marker fences, 2-space indents. Invariant (property-tested): `parse(print(doc))` deep-equals `doc` modulo spans/diagnostics.
- Storage: each page persists `{ doc: ScriptDoc-as-JSON, source: string | null, sourceDirty: boolean }` in the SQLite page row (Rust side). On Insert Script, `source` = the user's pasted text verbatim. Any subsequent edit in the editor sets `sourceDirty`. "Export Script" returns stored `source` if clean (byte-identical, preserves the LLM's slop â†’ diffable against what the AI wrote), else `print(doc)` (canonical). Because the printer is canonical and line-oriented, exports diff cleanly line-by-line.

## 4. Integration
- Insert Script button â†’ paste textarea â†’ `parse()` (sync, <5ms for typical notes; run in the renderer, no Rust round-trip) â†’ preview render â†’ on confirm, image `fetch:` entries resolved via a `#[tauri::command] fetch_images(query, count, source)` in `src-tauri/src/lib.rs` (reqwest â†’ Openverse API â†’ download to app-data cache, return local asset paths) â†’ blocks appended to the editor document. The editor's native block model IS `Block` from types.ts â€” no separate import AST.

## 5. Testing
- Vitest golden-file suite: `tests/fixtures/*.script` + expected JSON snapshot each.
- Slop corpus: ~60 deliberately-broken variants (unclosed fences, `:` attrs, misspelled colors, mixed arrows) asserting parse-without-error + specific recoveries. Generate real samples by prompting 3â€“4 different LLMs with only the spec file and adding their raw outputs as fixtures.
- fast-check property tests: printer round-trip invariant; parser totality (random unicode soup never throws).

## Libraries
No parser/markdown dependency â€” handwritten ~1200-line TS parser in src/script/ (core requirement: slop tolerance and source spans)
fast-check ^4 (dev â€” property tests: round-trip + parser totality)
vitest ^3 (dev â€” golden-file suite)
nanoid ^5 (block IDs in the document model)
Rust side: reqwest 0.12 + serde_json 1 (already-typical Tauri deps) for the image-fetch command against Openverse/Pexels

## Risks
1) Handwritten-parser bugs (edge cases CommonMark spent years on). Mitigation: we implement a deliberately small Markdown subset (no setext headings, no lazy continuation, no reference links, no HTML passthrough â€” the spec is the contract, not CommonMark), Djot-style local/linear rules, plus golden-file + fuzz + real-LLM-output corpora from day one. 2) Over-tolerance can mask intent (fuzzy-matching `rows` to `rotate` etc.). Mitigation: Levenshtein cap of 2, only within same value domain, and every correction surfaces as a visible warning in the insert preview. 3) LLMs may emit Mermaid instead of our diagram grammars out of habit. Mitigation: spec explicitly says "not Mermaid" with contrastive examples, and the graph parser accepts Mermaid's `-->` arrow and `graph TD`-style header line (ignored with warning) as a compatibility ramp. 4) Image-fetch API instability/rate limits (Openverse). Mitigation: source abstraction with Pexels fallback, aggressive local caching, and graceful placeholder blocks (hand-drawn empty polaroid) when fetch fails so the note still renders. 5) Byte-exact export only holds until first edit â€” users may expect their AI's script preserved after tweaks. Mitigation: canonical printer keeps diffs minimal and the UI labels exports "canonicalized" when sourceDirty.

