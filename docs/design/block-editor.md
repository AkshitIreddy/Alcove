# Design: block-editor

## Recommendation
TipTap v3 (@tiptap/core on ProseMirror, no React dep) with ~300 LOC of vendored SolidJS bindings + Solid node views for all custom blocks

## Rationale
TipTap v3's core is genuinely framework-agnostic (@tiptap/core + @tiptap/pm only; React/Vue packages are optional wrappers), so it runs in SolidJS with a thin binding layer. The decisive 2025 event: Tiptap open-sourced 10 formerly-Pro extensions under MIT (June 2025, see tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap and HN 44202103), including exactly the ones this app needs â€” DragHandle, NodeRange (multi-block drag selection), UniqueID (stable block ids for the script-language mapping), Details (toggle blocks), Mathematics, TableOfContents. That removes the historical reason to avoid TipTap for Notion-style UIs. ProseMirror underneath gives the two things a custom editor cannot cheaply replicate: battle-tested IME/composition handling and transaction-based undo with a strict schema â€” plus prosemirror-tables, which is the only production-grade web table editing implementation. Alternatives: BlockNote is the closest feature match but its UI layer is React-only (vanilla mode means rebuilding all UI anyway, and you'd inherit its opinionated schema that fights custom block types) â€” blocknotejs.org/docs/getting-started/vanilla-js confirms. Lexical's core is framework-agnostic but custom decorator nodes and the whole plugin ecosystem lean React, tables/toggles are weaker, and IME fixes are still landing monthly (v0.47 changelog). EditorJS uses per-block contenteditables with no cross-block selection, weak undo, weak IME â€” disqualified at Notion-grade. Raw ProseMirror is viable but TipTap v3 is the same engine with the extension plumbing (commands, keymaps, input rules, suggestion utility) already written. Fully-custom Solid editor: Notion can afford per-block contenteditable because they employ a team to handle selection/IME/undo edge cases; for this project it's 3-6 months of edge-case work before feature work starts. An official @tiptap/solid PR (ueberdosis/tiptap#6175) was closed only for maintenance-bandwidth reasons â€” community bindings (@vrite/tiptap-solid 1.0.4, MIT) prove the pattern; we vendor rather than depend because they lag releases. Bundle size (~150-200 kB gz with extensions) is irrelevant in a Tauri desktop app loading from disk.

## Implementation plan
ARCHITECTURE â€” one ProseMirror/TipTap editor instance per open book page (not per block). Blocks are top-level nodes in a single doc; sections are container nodes so their children drag as one unit.

1) Solid bindings (src/editor/solid/, vendored, ~300 LOC, base on @vrite/tiptap-solid MIT source):
- createTiptapEditor(options): creates Editor in onMount(() => new Editor({element, extensions, content})), onCleanup(() => editor.destroy()); returns a signal Accessor<Editor|undefined>.
- createEditorTransaction(editor, selector): subscribes to editor 'transaction' event, re-runs selector into a signal â€” use for toolbar active-state, selection-dependent UI.
- SolidNodeViewRenderer(Component): returns a TipTap NodeViewRenderer. Implementation: per node view, createRoot(dispose => ...), render the Solid component into a host element with props delivered through a createStore({node, decorations, selected, updateAttributes, editor, getPos}); update() mutates the store (fine-grained â€” no VDOM diff, this is where Solid beats the React bindings); destroy() calls dispose. Component uses <NodeViewWrapper> / <NodeViewContent data-node-view-content> divs; map contentDOM to the element carrying data-node-view-content.

2) Extension list:
- @tiptap/starter-kit (v3 includes history/undo, headings, lists, blockquote, code-block, hard-break, horizontal-rule; disable its codeBlock, use lowlight variant)
- @tiptap/extension-unique-id â€” attribute 'id' (nanoid) on every block-level type; REQUIRED for script-language round-tripping and drag animations
- @tiptap/extension-drag-handle + @tiptap/extension-node-range â€” line-level drag handles; NodeRange gives shift/click multi-block selection that drags together; render the handle itself as a Solid-portal element positioned by the extension
- @tiptap/extension-details (+ details-summary, details-content) â€” toggle blocks
- @tiptap/extension-table (+ table-row, table-cell, table-header; v3 table kit)
- @tiptap/extension-task-list + task-item (nested: true) â€” todos
- @tiptap/extension-text-style (v3 bundles Color/FontFamily/FontSize) + @tiptap/extension-highlight (multicolor: true) â€” text color + highlight
- @tiptap/extension-link, @tiptap/extension-image, @tiptap/extension-placeholder ("Type / for commands"), @tiptap/extension-code-block-lowlight (lowlight/highlight.js grammars; shiki is heavier â€” skip)
- @tiptap/suggestion â€” slash menu: char: '/', items({query}) filters a command registry [{title, icon, keywords, command({editor, range})}]; render menu as a Solid component in a portal positioned with @floating-ui/dom (computePosition + flip + shift); keyboard nav via onKeyDown returning true to swallow arrows/enter.

3) Custom block nodes (each: Node.create + SolidNodeViewRenderer):
- callout: group 'block', content 'paragraph+', attrs {icon, tint: 'amber'|'terracotta'|'moss'}; Solid view renders watercolor-wash background SVG + icon picker.
- imageRow: group 'block', content 'image{1,4}', draggable: true, atom-ish layout: Solid view = flex row, per-image width attr, drag-to-resize dividers.
- diagram: group 'block', atom: true, attrs {kind, data (JSON string of strokes/shapes), width, height}; Solid view mounts your canvas/SVG diagram editor lazily; serializes to attrs.data on change (debounced editor.commands.updateAttributes).
- sticker: inline: true, group 'inline', atom: true, attrs {stickerId, scale, rotate}; renders SVG sprite.
- linkCard: group 'block', atom: true, attrs {url, title, description, imageDataUri, favicon}; metadata fetched by the Rust side (tauri invoke 'fetch_link_preview' â€” do OG-tag scraping in Rust, never in the webview, avoids CORS + keeps renderer clean); paste handler upgrades a bare-URL paragraph to linkCard via an input rule/paste rule.
- Images stored on disk via Tauri fs, src uses asset: protocol (convertFileSrc); image node attrs {src, naturalWidth, naturalHeight, align}.

4) Document JSON schema (this IS the storage format â€” persist editor.getJSON() verbatim; do not invent a parallel model):
{ "type": "doc", "attrs": { "pageStyle": "ruled"|"grid"|"blank", "lineHeightPx": 32 },
  "content": [
    { "type": "heading", "attrs": { "id": "b_x1", "level": 2 }, "content": [{ "type": "text", "text": "Mitosis", "marks": [{"type":"highlight","attrs":{"color":"amber"}}] }] },
    { "type": "callout", "attrs": { "id": "b_x2", "icon": "leaf", "tint": "moss" }, "content": [ {"type":"paragraph", ...} ] },
    { "type": "details", "attrs": { "id": "b_x3", "open": true }, "content": [ {"type":"detailsSummary",...}, {"type":"detailsContent", "content":[...]} ] },
    { "type": "diagram", "attrs": { "id": "b_x4", "kind": "freehand", "data": "{...}", "width": 640, "height": 320 } }
  ] }
pageStyle lives as a Document-node attribute (extend Document with addAttributes) so it serializes with the doc; CSS renders it: .page[data-style=ruled] uses repeating-linear-gradient background sized to lineHeightPx, and .ProseMirror { line-height: 32px } so text sits on the rules.

5) Script-language mapping (src/editor/script/): two pure functions over the JSON â€” docToScript(json): walk content, registry keyed by node.type emits lines ("## text", "- [ ] text", "> text", ":::callout icon=leaf tint=moss ... :::", "!diagram{id=b_x4 kind=freehand}" with data blocks fenced), marks emit inline spans (==hl:amber==, {color:#a05}); scriptToDoc(text): line-based parser with a container stack for :::fences, output validated by editor.schema.nodeFromJSON (throws on invalid â€” surface parse errors with line numbers). Round-trip test suite: for every fixture doc, expect scriptToDoc(docToScript(d)) deep-equals d (modulo regenerated ids â€” preserve ids by emitting them in the script).

6) Hand-drawn defaults: font stack on .ProseMirror â€” a handwriting font (e.g. a licensed variable font like 'Caveat'/'Shantell Sans' bundled as woff2 asset) with font-feature-settings for contextual alternates so repeated letters vary; headings get a slightly different weight/slant. All chrome (handles, menus) styled with pencil-texture borders (SVG filters: feTurbulence + feDisplacementMap on 1px strokes â€” cache as border-image, don't run live filters per frame).

7) Animation: on drop, use GSAP FLIP (Flip.getState on [data-id] block elements before the transaction, Flip.from after) for 60fps reorder settle; drag preview is a cloned node rendered to a lightweight ghost, not the live node. Keep ProseMirror decorations minimal (only selection halo + drag target line) â€” decorations across the whole doc are the usual perf killer.

8) Persistence: debounce (400ms) 'update' event â†’ serialize getJSON() â†’ tauri invoke save_page; History extension gives undo/redo (Mod-z/Mod-Shift-z) for free including IME compositions; store nothing else.

## Libraries
@tiptap/core ^3.14
@tiptap/pm ^3.14
@tiptap/starter-kit ^3.14
@tiptap/extension-drag-handle ^3.14
@tiptap/extension-node-range ^3.14
@tiptap/extension-unique-id ^3.14
@tiptap/extension-details ^3.14
@tiptap/extension-table ^3.14
@tiptap/extension-task-list ^3.14 + @tiptap/extension-task-item ^3.14
@tiptap/extension-text-style ^3.14
@tiptap/extension-highlight ^3.14
@tiptap/extension-link ^3.14
@tiptap/extension-image ^3.14
@tiptap/extension-code-block-lowlight ^3.14 + lowlight ^3
@tiptap/suggestion ^3.14
@floating-ui/dom ^1.6
nanoid ^5
gsap ^3.12 (Flip plugin)
solid-js ^1.9 (already in stack)
vendored (not npm-dep): @vrite/tiptap-solid 1.0.4 source as basis for src/editor/solid bindings

## Risks
(1) Solid bindings are community-grade â€” mitigated by vendoring the ~300 LOC into the repo (MIT) so we control upgrades; the binding surface (editor lifecycle + node view renderer) is small and stable across TipTap 3.x. (2) Solid reactivity inside node views: each node view must own its reactive root (createRoot) and updates must go through a store, or you get leaked computations and stale props â€” enforce via the single SolidNodeViewRenderer implementation and a lint rule against calling render() elsewhere. (3) Multi-block 'sections drag together': DragHandle + NodeRange covers contiguous multi-select drag, but persistent named sections should be modeled as a container node (like details) rather than relying on NodeRange, else section membership isn't in the JSON. (4) prosemirror-tables UX is functional but not Notion-polished (column drag, cell selection styling need custom CSS/plugins) â€” budget 1-2 weeks of table polish. (5) Very long pages (10k+ nodes) can slow ProseMirror â€” mitigate by paginating books into pages (already the product model) and keeping heavy custom views (diagram canvas) lazy-mounted with IntersectionObserver. (6) Tiptap the company keeps moving features to paid cloud tiers â€” the MIT extensions we rely on are already published and forkable, so worst case is freezing/forking versions; avoid any @tiptap-pro registry package. (7) Handwriting fonts with contextual alternates can slow layout on huge docs in WebView2 â€” test early; fall back to disabling calt beyond N blocks if needed. Sources: tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap, github.com/ueberdosis/tiptap/pull/6175, github.com/vriteio/tiptap-solid, npmjs.com/package/@tiptap/extension-drag-handle, blocknotejs.org/docs/getting-started/vanilla-js, lexical.dev/docs/getting-started/quick-start, github.com/facebook/lexical/releases.

