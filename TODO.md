# Alcove — running TODO

## ✅ Post-0.7.3 Agent supervisor and authored release notes (completed 2026-08-18)

- [x] Let the model own semantic task mode and recover from structured tool
      errors without allowing it to bypass source, revision or Insert gates.
- [x] Keep transport/protocol/auth/budget recovery deterministic because those
      failures occur before the model can observe a tool result.
- [x] Replace generic commit-derived GitHub release prose with a checked-in,
      version-matched release note authored for the actual work.
- [x] Exercise diverse conversation, image, source, misclassification,
      wrong-tool, provider failure, retry and release-publication cases.
- [x] Drive the production panel in Playwright, inspect the normal and recovery
      frames, and watch deliberate controls fail.
- [x] Prevent an unread relevant attachment from reporting coverage complete,
      make its source read exclusive before drafting, and recover one malformed
      source-routing stream with a counted corrective turn.

## ✅ Post-0.7.3 Agent image intake (completed 2026-08-18)

- [x] Stop Cohere source-intake requests from using an incompatible strict
      tool envelope before the first source tool can run.
- [x] Let readers drag image/source files onto the Agent composer, with a clear
      drop affordance and the same managed-attachment path as the picker.
- [x] Reproduce both paths in the running app, inspect their screenshots and
      watch deliberate provider/drop failures make the regression gate fail.

## ✅ 0.7.3 — resilient update checks (released 2026-08-17)

The owner authorised a 0.7.3 patch release after the 0.7.1 desktop missed the
0.7.2 update offer. The signed feed is live and the updater implementation did
not change between 0.7.0 and 0.7.1; the fragile part was one delayed attempt
whose failure was swallowed for the remainder of the session.

Commits `1ea0525` and `1f67b65` plus annotated tag `v0.7.3` were pushed
normally. GitHub Actions run `32034995134` passed the shared gate, Windows,
Linux and universal macOS builds, then publication. The live non-draft Release
contains 13 assets; all 12 checksum entries match GitHub's uploaded SHA-256
digests, and `latest.json` names signed updater packages for Windows, Linux and
both macOS architectures.

- [x] Return current, available and failed outcomes from one shared updater.
- [x] Retry transient startup failures twice and retain them in diagnostics.
- [x] Add a manual System settings action and installed-version footer.
- [x] Verify startup recovery plus available/current/error Settings states at
      wide and compact sizes, and watch deliberate broken controls fail.
- [x] Pass the release gates, push and verify the signed 0.7.3 release.

## ✅ 0.7.2 — personal writing desks (released 2026-08-17)

The owner authorised a 0.7.2 patch release for the soft writing-desk palette,
field-only book zoom, quiet back arrow and reliable Cohere connection check.
Linen is the first onboarding choice. Page geometry and stored notebook content
remain unchanged. Existing README pictures and the demo remain accurate and
must not be regenerated for this patch.

Commits `78e0739`, `c4a2aed` and `96c034b` plus annotated tag `v0.7.2` were
pushed normally. GitHub Actions run `32026243461` passed the shared gate,
Windows, Linux and universal macOS builds, then publication. The live
non-draft Release contains 13 assets; all 12 checksum entries match GitHub's
uploaded SHA-256 digests, and `latest.json` names signed updater packages for
Windows, Linux and both macOS architectures.

- [x] Feature Linen among the first eight onboarding writing desks.
- [x] Verify all 25 desks, wide and narrow layouts, field-only wheel zoom and
      unchanged canonical page geometry in Playwright.
- [x] Watch the deliberate white-desk sabotage fail.
- [x] Pass the complete release gates, push and verify the 0.7.2 release.

## ✅ Post-0.7.1 writing-desk palette expansion (completed 2026-08-17)

- [x] Grow the writing-desk vocabulary to 25 individually authored pigments,
      rebalanced around soft roses, pinks, garden greens, clear blues and sunny
      yellows instead of dull browns, greys or over-saturated fields.
- [x] Keep Linen plus seven clear everyday tints first and place the remaining 17
      behind the app's truthful “more writing desks” disclosure in Settings
      and onboarding.
- [x] Preserve legible bare chrome on every desk without changing page or book
      geometry.
- [x] Drive the compact and expanded choices in Playwright, inspect the
      rendered palette, and watch a deliberate colour sabotage fail.

## ✅ Post-0.7.1 reader follow-up (completed 2026-08-17)

- [x] Reproduce and fix Cohere key connection failures in localhost and the
      native app, with useful redacted error text instead of a generic message.
- [x] Add a persisted writing-desk colour choice in Settings and the first-run
      taste questionnaire.
- [x] Let a plain wheel over the empty writing desk zoom the whole book without
      changing page geometry, wrapping or pagination.
- [x] Keep the back arrow quiet on hover: no enlargement and no expanding
      “back to shelf” label.
- [x] Drive all changed states in Playwright, inspect the screenshots, and run
      focused tests plus TypeScript before reporting completion.

## ✅ 0.7.1 — larger open-book camera (released 2026-08-17)

The owner authorised a 0.7.1 patch release for the larger camera-fitted open
book and removal of the redundant visible title band. Page, cover and editor
geometry remain canonical; only the whole-book camera scale changes. The
existing README screenshots and demo remain accurate and must not be
regenerated for this patch.

Commits `ac9d7c4` and `6c36460` plus annotated tag `v0.7.1` were pushed normally.
GitHub Actions run `32012560268` passed the shared gate, Windows, Linux and
universal macOS builds, then publication. The live non-draft Release contains
13 assets; all 12 checksum-manifest entries match GitHub's uploaded SHA-256
digests, and `latest.json` names signed updater packages for all four supported
platform targets.

- [x] Verify large → small → large and rail-panel open/close with exact page
      IDs, stored documents, block positions and wrapping unchanged.
- [x] Run the normal Playwright visual gate and watch its deliberate cramped-
      camera/title sabotage fail.
- [x] Pass the release type, fast-test, Notebook Script and strict README gates,
      plus all 53 Rust tests.
- [x] Publish and verify the signed 0.7.1 release assets and checksum manifest.

## ✅ 0.7.0 — native Agent and resilient notebook editing (2026-08-17)

The owner approved the rebuilt README images and demo and authorised release as
0.7.0. Commit `ffba36a` and annotated tag `v0.7.0` were pushed normally without
rewriting history. GitHub Actions run `32007389408` passed the gate, Windows,
Linux and universal macOS builds, and publication. The live non-draft Release
has 13 assets: installers/packages, four-platform signed updater metadata and a
12-entry checksum manifest whose hashes match the uploaded assets.

Release-prep checkpoint: TypeScript, the 147-test fast gate, the 642-test broad
Vitest suite, all 53 Rust tests plus `cargo check`, Notebook Script generation,
and strict README composition are green. The atomic README capture produced 25
current stills; its sabotage control failed without modifying the accepted set.
The accepted 178.57-second demo contains 2,656 source frames, and its dense
transition boards were inspected before the WebP/MP4 pair was promoted.

### Editor correctness

- [x] Move a multi-block selection to the previous page as one ordered,
      atomic selection. Never silently move only its first block, duplicate a
      block, or partially move the range when the destination cannot accept it.
- [x] Tune inline emoji optical baseline slightly downward while preserving
      the rule grid and line metrics at native and fitted book scales.

- [x] Window, panel, monitor-resolution and monitor-DPI changes must be camera-
      only: preserve one canonical CSS page/layout box and scale the whole book
      to fit. Never rewrap, persistently repaginate, duplicate a section, or
      leave a different document when the original size returns. Verify repeated
      full → minimum → full and DPR 1 → 2 with exact DOM geometry, page IDs and
      JSON equality.
- [x] Right-click must open the same block menu for ordinary text, a selection
      spanning several blocks, display maths, code and every custom node-view;
      preserve a multi-block text selection when the click lands inside it.
- [x] Backspace at the start of the first block on a non-first page must pull
      that block into available room on the previous page. Cover both text and
      the display-math source editor, without duplication when the previous page
      is full.
- [x] Render TeX classification commands such as `\mathrel+` and `\mathbin`
      instead of showing their source as unknown red text.
- [x] Show “Type / for commands…” only on the active empty page, never in an
      intentional blank paragraph between authored blocks.
- [x] Keep Welcome-page inline stickers/emblems clear of ruled-paper strokes.

### Recovery history — default on and deliberately generous

- [x] Replace the 20-item page-history ring with protected, durable, generous
      per-page history plus whole-book checkpoints. A restore creates a new
      checkpoint and never destroys the state being left.
- [x] Retain dense recent versions and progressively spaced daily/weekly/monthly
      recovery points. Never prune the newest, a manually protected checkpoint,
      or the last known whole-book state.
- [x] Add a default-on Settings control. Turning protected history off requires
      an explicit warning that future recovery points stop; existing recovery
      data is not silently deleted.
- [x] Verify restart persistence, page restore, whole-book restore, bounded
      pruning and crash-safe checkpoint writes.

### Demo and documentation acceptance

- [x] Remove the owner-rejected Agent context-scope explainer from the panel,
      replace the Agent's open-book mark with an original Alcove toy-robot
      face, and verify every small/large icon context before recapturing.
- [x] Regenerate and inspect the full seekable demo plus README screenshots
      only after the editor, emoji, Agent copy and robot mark changes settle.

- [x] Keep ruled-paper lines continuous through the canonical centre gutter
      with every rail panel open and after it closes; a camera/layout change
      must not erase a wide middle band or leave a smaller permanent seam.
- [x] Keep the first conversational Agent reply contained inside its message
      card at every supported panel width, with long unbroken and formatted
      content wrapping safely.
- [x] Project settled conversational tool boundaries as ordinary chat turns for
      Cohere while retaining the complete raw audit history locally, so “add to
      book” uses the immediately preceding explanation without asking for it
      again. Gate the exact production-panel flow twice at both supported QA
      sizes and keep a deliberate provider-rejection witness alive.
- [x] Start the frozen Agent demonstration with an empty attachment tray. The
      kitten image may enter only as explicit task evidence when the study-page
      request begins, and must not remain as a pre-attached source.
- [x] Make review/modal/approval transitions state-ordered and camera-safe:
      no off-screen root interpolation, no blank parchment interval, no
      `Adding three pages` status before the visible Insert click, and no
      synthetic user review message in the product timeline.
- [x] After approval, land the live reader on the first inserted Huffman spread
      before closing the Agent; never expose the old Local video spread for a
      beat and then jump later.
- [x] Expand maths regression coverage beyond the reported `\mathrel` case:
      classification/operator commands, malformed input, exact source/attrs,
      context menu, cross-page movement, resize/focus/DPR invariance and safe
      fallback must all be exercised.

- [x] Use the supplied kitten image and explain Huffman coding with kittens;
      keep the native preview exactly three balanced pages at both README and
      demo viewports.
- [x] Slow question typing, show believable Thinking/Brainstorming pauses,
      keep readiness after visual review, and record review/insert actions in
      the conversation timeline.
- [x] Remove blank camera frames, fake opening transitions, rapid post-insert
      page turns and camera bounce. Review every transition as dense frames,
      not only contact-sheet samples.
- [x] After insertion, close the Agent panel and deliberately visit all three
      new pages. Demonstrate ordinary page writing on the Welcome writing page
      without disturbing the Agent-authored layout.
- [x] Keep the wider, quieter Agent panel readable; preview must have scroll,
      previous/next controls and a useful whole-page fit.
- [x] Make the opening Studio changes perceptible at README size while keeping
      the shelf palette restrained rather than vivid.
- [x] Rebuild README screenshots and both `demo.webp` and seekable `demo.mp4`,
      inspect native stills plus dense frame ranges, then promote the pair
      atomically. Stop the exclusive `:1420` server afterward.

### Sources and portability already implemented; keep gated

- [x] Confirm broad inert text/code/data/HTML, DOCX, XLSX and PPTX extraction,
      500-character managed `Pasted text.txt`, smart table/code/data paste, and
      block copy/download for images, video, tables, code and other portable
      content in the final focused gates.
- [x] Image prompt handoff remains explicit reader opt-in only. Text veil stays
      off by default and is risk reduction, not a promise of anonymity.
- [x] Reusing the same PDF in a follow-up keeps one content-addressed attachment,
      source manifest and coverage ledger instead of re-uploading/re-ingesting.
- [x] Keep the twenty new emblem programs unique and append-only, and keep the
      onboarding Agent preview isolated from the first-use credential sheet.
- [x] Structured paste must never silently truncate rows, misclassify ordinary
      comma prose, overflow an unsplittable table, or escape a code block. Cover
      compact JSON/code and rich clipboard payloads explicitly.
- [x] Block portability must preserve original bytes, MIME and file extension
      for every accepted image/video type, including image-row children.

## 🚧 ACTIVE — in-book AI agent (implemented, unreleased, awaiting owner review)

### 2026-08-14 owner localhost follow-up

- [x] Make **Insert into book** finish in one bounded transaction on a large
      notebook: JSON-storage-equivalent PageDocs must not fail exact receipt
      verification, settlement must visit only affected pages, and Refresh
      must not recreate an invariant apply/rollback loop. Prove the real
      48-page Insert button path in Playwright, including timing and rollback
      sabotage, before marking this complete.
- [x] Keep that localhost Insert transaction responsive: coalesce the browser
      MemoryDb's row-by-row `localStorage` rewrites into one task-level flush,
      preserve immediate-reload durability through `pagehide`, and gate real
      48-page clicks on animation-frame gaps and Chrome long tasks. Three fresh
      runs completed in 355–903 ms with 100–150 ms maximum frame gaps, versus
      the reproduced 817–1,117 ms stall before the fix.

- [x] Keep the typing caret/indicator optically inside the ruled text line at
      native and fitted page scales; it must not cut through either adjacent
      paper rule.
- [x] Make a reviewed Agent preview retain its exact durable render receipt
      until Insert has applied or the reader explicitly abandons it. Reproduce
      and close the supplied `exact reviewed draft is no longer available`
      failure.
- [x] Make **Refresh preview** a bounded recovery of the already-reviewed
      draft/target, not a return to unrestricted placement and draft tools;
      prove it cannot loop through repeated `propose_insertion` and unchanged
      `submit_notebook_script` calls.
- [x] Render Agent conversation Markdown consistently (headings, bold, lists,
      code and paragraphs) without exposing raw punctuation or collapsing the
      reply card.
- [x] Require semantically appropriate native catalogue craft for ordinary
      multi-page generated notes instead of accepting headings plus plain
      bullets only, while preserving explicit plain/minimal/verbatim requests
      and the explicit-only external-image rule.

- [x] Make the final-preview **Insert into book** action apply the exact reviewed
      pages once. It must not turn the approval into synthetic reader messages,
      ask for a refreshed approval, or complete without a notebook mutation.
- [x] Add a compact, keyboard-friendly search field to the open-book Table of
      Contents, with useful matching, result feedback, empty state and unchanged
      heading/page navigation.
- [x] Render final-preview pages on the same resolved paper colour/style as the
      destination book, and replace the heavy brown preview surround with a
      calmer Alcove-native presentation that keeps the page visually primary.
- [x] Prove unchanged notebook/source content reuses its durable embedding/index
      work across turns and restarts, while ordinary conversation and unrelated
      work do not invoke RAG/search merely because a book or source exists.

  Verified together: 207 focused Agent/TOC tests, the 147-test fast gate,
  TypeScript, strict README composition, an adversarial 48-page + blank-stock
  revision probe, and the live two-viewport Agent flow. The reviewed page order
  remains an exact prefix while Alcove may append blank stock; full structural
  history still invalidates on later blank-page edits. Embeddings reuse exact
  content digests across tasks/restarts and only changed chunks call Embed.

### 2026-08-14 conversational tool-loop redesign

- [x] Keep transient task/start/preparation/completion receipts scoped to the
      reader turn that owns them; starting a follow-up must never resurrect
      progress bars beneath an already-finished answer.
- [x] Persist each model-authored clarification and the reader's exact reply as
      ordinary conversation messages. Never render the same question twice,
      remove it after answering, or rewrite `yes` as `response: yes`.
- [x] Replace form-like requirement options with one concise natural-language
      question when material information is genuinely missing. The next model
      turn interprets the free-text answer and chooses the appropriate typed
      tools itself.
- [x] Keep semantic choices model-owned while making deterministic workflow
      phases explicit: Alcove exposes only the tools that can make material
      progress from the current receipt, rejects hidden-tool drift, and keeps
      source/revision authority plus final approval outside model discretion.
- [x] Regress the copied 2026-08-14 trace: `hi` → explain a topic → `add to
      book` → clarification answer must reach a reviewed insertion proposal
      without duplicate questions, repeated no-op plans, a copied Script
      handoff, or a chat-only completion.
- [x] Bound provider cost and repair churn: compact provider-only history while
      retaining the full durable audit trail, keep notebook revisions local,
      reject unchanged Script resubmissions, stop repeated no-progress calls,
      and use the full Cohere reasoning budget only for composition, source
      selection, conversation and visual judgment. The deterministic healthy
      targetless insertion path reaches immutable preview in nine model turns
      while the production panel's existing default target makes its path eight;
      the exact supplied no-op loop stops at seven instead of exhausting all
      twenty-four, and alternating blocked/no-op tools cannot evade the
      reader-turn watchdog.

Completed with per-reader-turn intent and budgets, durable natural questions,
exact reply identity, semantic repeat-question and no-progress guards, and
capability-based typed tools behind the existing immutable-preview approval
boundary. Focused adversarial tests and the live `?fx=force` panel probe cover
the copied trace, later unrelated chat turns, failure recovery and a deliberately
reintroduced retired question form. After two earlier green repetitions, the
final frozen-source Playwright gate ran all four runtime scenarios at 1500×940,
1360×850 and 1200×800: 12/12 normal contexts reached the exact 9-turn
targetless, 8-turn production-default,
7-provider/5-accepted-call watchdog and 10-turn Preserve All outcomes. A further
3/3 sabotage matrix rejected an intentionally premature draft and recovered in
the exact ten-step source workflow (`GATE ALIVE`). Across the final 15 contexts
there were zero repairs, retrieval/Cohere/network/browser errors, stale activity
bars, conflicts, overflow or book mutations; every one of the 27 final
panel/error/modal captures was inspected at original size.

**Status — 2026-08-12:** the provider-neutral LangGraph runtime, secure Rust
Cohere gateway, production notebook/source adapters, real PageEditor preview
sandbox, model-first visual review loop, approval-only whole-book apply path,
left-rail panel, integrated rendered selection preview, Settings and onboarding
mention are in the source tree. It also supports grounded conversational answers
that leave the book untouched, portable picture slots with copyable generation
prompts and exact dimensions, an optional local Text veil, and a tour-only panel
preview that never opens the credential sheet. The native Agent is **not in the
linked v0.6.6 installers** and no commit, version, tag, push or publication is
authorised beyond local atomic commits.

The large unchecked list below is the original design/acceptance ledger, not a
claim that implemented items remain absent. The final expansion security audit,
focused native-Agent/type/Rust gates, responsive native-preview checks, Settings
and onboarding visual checks, and frozen representative demo review are green.
The remaining deliberate product limitation is that **every PDF page** stays
fail-closed for preserve-all requests until verified full-page rastering exists
(embedded JPEG figures are supporting evidence only, and there is no OCR).
Text veil protects recognizable text, not pixels in attached images or scanned
PDF pages, and the UI says so. The selected-text path uses an integrated native-
page render, not an inline text diff. The owner authorised small local atomic
commits as safety checkpoints. Versioning, release-note finalisation, pushing,
tagging and publication still require a later explicit go-ahead.

A redacted live-provider compatibility smoke exercised both supplied key classes
against the production catalogue. It found and removed the unsupported
citation-mode and `tool_choice` request fields. The generic Cohere V2 contract
advertises `tool_choice: REQUIRED`, but the live Command A+ trial and production
endpoints rejected it for Alcove's production catalogue. Alcove keeps mandatory
notebook/source call selection as a local graph invariant, retains the accepted
`strict_tools` request over sanitized schemas, and lets ordinary source-free
conversation answer naturally.
One rejected conversational envelope gets one counted, tool-free prose
recovery attempt; a second failure pauses behind one visible recovery card,
without duplicating `run.failed` in the transcript. The desktop and localhost
transports retain local protocol validation plus a safe singleton-phase
fallback. Terminal provider failures restart from the durable graph state when
the reader presses Retry, and failed attempts consume the provider budget. The
graph is the sole chat-retry owner,
so one counted call is one real Cohere `/v2/chat` attempt on both desktop and
localhost; native Embed, Rerank and credential checks keep their separate
bounded retries. The public animation uses a frozen, human-vetted Command A+
fixture and does not call Cohere during playback.

### Product decision

- [ ] Add one first-class **AI agent** button to the open-book left rail. It is
      not a chatbot bolted onto the app and not a second onboarding flow: the
      tour only mentions that it exists, while first use happens in its own
      rail sheet. This is the SAME vertical tool rail as Customize book, Page
      style, Catalogue/stickers, TOC, History, Ribbon and In and out—not a
      control inside In and out and not a new toolbar elsewhere.
- [ ] Draw an Alcove-native `AgentIcon`: a bowed open page with one writing
      stroke ending in a four-point sparkle, using flat colour, one `FLAT.ink`
      outline and the rail's hand-drawn geometry. Do not use a robot head,
      stock magic wand, glow, gradient lighting or a generic chat bubble.
- [ ] Keep the complete workflow inside this one panel. Remove the proposed
      separate topic/preset form: a reader can simply describe the task, and
      the agent asks only the missing high-value questions before it works.
- [ ] Reuse the existing Creative Direction presets and custom directions as
      optional context chips inside the conversation/composer. Replace native
      dropdowns with the app's paper-card combobox/menu pattern; let the reader
      inspect a preset, borrow it into a custom direction, edit it in a proper
      centred sheet, or leave style to sensible defaults.
- [ ] Give the composer an app-drawn attach button and expand button. Expand
      opens a centred, roomy writing sheet without losing draft text,
      attachments, context choices or the agent thread.

### Agency philosophy — binding

- [ ] Give the model the same kind of **goal-directed freedom Codex has inside
      its authorized workspace**. Alcove supplies a broad, typed notebook and
      source toolbelt; the agent decides what to inspect, what questions to ask,
      how to structure the work, whether to search or read exhaustively, when
      to revise its plan and which validation/repair action is useful. Do not
      turn it into a hidden wizard whose strategy was chosen by UI code.
- [ ] Treat prebuilt workflows as skills and good defaults, not rails. The
      agent may follow, skip, repeat, reorder or combine them when the user's
      goal warrants it, and may create explicit subplans for source study,
      notebook composition, visuals, verification and revision.
- [ ] Put freedom behind a deterministic capability boundary rather than
      reducing it: read/inspect/search/plan/draft/validate/render tools may run
      autonomously inside the selected book and attached sources; external
      access and mutations remain scoped; final book writes remain previewed,
      reversible and explicitly approved.
- [ ] Make the work observable like a Codex task. Stream the evolving plan,
      concise reasoning summaries, questions, tool name + arguments, progress,
      useful tool observations, source coverage, diagnostics, draft changes and
      final messages in chronological order. Never expose raw private hidden
      chain-of-thought; translate it into honest, useful work notes instead.
- [ ] Make **native visual self-review** the reason this belongs inside Alcove.
      Before insertion the agent builds a disposable draft book, paginates it
      with the real editor rules, renders the real pages, inspects those page
      images plus parser/layout findings, revises awkward work and rerenders.
      Text-only confidence is not a preview and is not sufficient.
- [ ] The agent is the **first reviewer**, not the reader. Intermediate renders,
      diagnostics and repair rounds are autonomous and merely visible in the
      activity stream; they do not create approval chores. Interrupt the reader
      only for materially missing intent or a blocker the agent cannot resolve,
      then show one polished final preview for change feedback or insertion.
- [ ] A request such as “do not lose any information from this PDF” is a change
      in strategy, not a prompt decoration. The agent can inspect the complete
      source manifest, read every page/chunk (in multiple passes when needed),
      maintain a coverage ledger, ask about ambiguous scans and prove that all
      source units were represented. Top-k retrieval must never silently
      substitute for an explicit full-coverage instruction.

### Provider and orchestration decision

- [ ] Ship a provider-neutral `AgentProvider` boundary with **Cohere as the
      first provider**, so notebook workflow, approvals and UI do not become
      coupled to one vendor's request schema.
- [ ] Use a **LangGraph.js durable agent loop**, not a fixed state-machine
      conveyor belt and not an unbounded swarm. The model owns planning and tool
      choice; LangGraph owns resumable task state, interrupts, streaming,
      cancellation and recovery; Alcove owns capabilities, validation and
      transactional writes.
- [ ] Use Cohere's native V2 request shape behind that graph. The current
      `@langchain/cohere` JavaScript page still marks image input unsupported,
      while Alcove needs images and current Command A+ features. Start with a
      small proof spike: if the current adapter proves full text/tool/stream/
      image parity, use it; otherwise keep LangGraph and implement a narrow
      Cohere model adapter over Alcove's Rust gateway rather than giving up the
      supported features or adding a Python/Node sidecar.
- [ ] Default the Cohere connector to `command-a-plus-05-2026` after runtime
      capability validation. It is the current text+image, reasoning, tool-use
      model. Keep the model id remotely/configurably replaceable so a retired
      model does not require rewriting the agent graph.
- [ ] Give the agent an **adaptive RAG and full-reading tool suite**, not a
      reader-facing RAG checkbox and not one hardcoded source policy. It can put
      a small source directly in context, search/index/rerank a large corpus,
      inspect arbitrary page ranges, or deliberately traverse every source unit
      for a lossless/coverage-sensitive task.
- [ ] Prove Cohere's current retrieval stack in Phase 0: `embed-v4.0` for
      multilingual text plus rendered PDF-page/image embeddings, and
      `rerank-v4.0-fast` by default (with `rerank-v4.0-pro` reserved for a
      quality-sensitive final pass). Use local SQLite/FTS retrieval before paid
      reranking where it is sufficient, cache embeddings by content hash, and
      never re-embed unchanged sources. The UI says which sources/pages were
      used and shows citations; it does not ask the reader to understand RAG.
- [ ] Put a visible default budget around ordinary work, not a strategy cage.
      The agent can extend/revise a plan when source coverage or quality truly
      needs it, while the UI shows calls/context/coverage and offers Stop.
      Network retries remain bounded to 408/429/5xx; accidental loops, repeated
      identical calls and unproductive tool churn are detected and interrupted.
- [ ] Stream useful product phases (`reading sources`, `planning`, `drafting`,
      `checking the script`, `building preview`, `waiting for you`) and the
      assistant's user-facing messages. Never expose or persist hidden
      chain-of-thought.

### Keys, privacy and first use

- [ ] On the first AI Agent open only, show a quiet centred setup sheet with
      **Trial/evaluation key**, **Production/enterprise key**, **Use for this
      session**, **Save securely**, **Test key**, a link to create a Cohere key,
      and **Skip for now**. Skipping opens the agent in an unconfigured state
      and sends nothing; it must not block the rest of Alcove.
- [ ] After first use, move all credential management to a dedicated
      **Settings → Integrations → AI agent** section: connection status,
      self-declared key kind, Test, Replace, Remove/Disconnect, privacy summary
      and default context policy. The provider validation endpoint does not
      report trial versus production tier, so make the choice editable rather
      than pretending Alcove can infer it. Keep the normal agent panel clean—
      at most one compact `not connected`/provider-status line linking to
      Settings, never a permanent key-management card.
- [ ] Support trial keys for non-sensitive evaluation, but do not describe them
      as appropriate for private notebooks. Current Cohere limits are 20 Chat
      requests/minute and 1,000 calls/month; more importantly, Cohere says
      trial inputs/outputs may be used for R&D, should not contain personal
      information, and its products are not intended for personal/household
      use. The reader must actively acknowledge this when using a trial key.
- [ ] Run a credential-storage spike before UI work: prefer the operating
      system vault (Windows Credential Manager, macOS Keychain, Linux Secret
      Service); evaluate official Tauri Stronghold only if its unlock secret is
      not itself persisted insecurely. If no secure Linux vault exists, offer
      session-only rather than plaintext fallback.
- [ ] Keep the saved key behind Rust. The WebView sees it only while the reader
      types it, submits it immediately, clears the field/reactive state, and
      never receives it again. Do not place it in SQLite settings, localStorage,
      IndexedDB, URLs, logs, crash reports, exports, backups, graph checkpoints
      or telemetry.
- [ ] Add narrow Rust commands for key test/save/delete and normalized Cohere
      V2 streaming requests. Redact authorization headers and provider bodies
      from errors. Add key rotation/removal and an obvious `Disconnect Cohere`
      action.
- [ ] Default context to the current selection/page plus explicitly attached
      sources—not the whole book or library. Show exactly what will be sent,
      with toggles for current page, nearby pages or whole book. Add Delete
      thread / Forget sources controls and keep cloud tracing off by default.

### Agent graph and human checkpoints

- [ ] Persist one versioned graph thread per user task, associated with a book,
      using an Alcove SQLite checkpointer. State contains messages, task brief,
      source ids/digests, plan, draft, diagnostics, page anchors, status and
      apply receipt; it never contains API keys, raw attachment bytes or
      runtime handles.
- [ ] Implement this resumable capability loop (a common route, not a mandatory
      order):

      ```text
      user goal -> agent plans -> agent chooses tools
        -> inspect notebook / inspect or retrieve complete sources / ask user
        -> revise plan -> draft or patch -> inspect diagnostics/layout/render
        -> repeat useful work until agent proposes a result
        -> exact native rendered preview + insertion approval
        -> stale-book conflict check -> atomic apply -> verify receipt
      ```

- [ ] Ask a small group of high-information questions in one turn and include
      **Use sensible defaults**. Topic/intent and a usable desired outcome are
      normally the only blocking facts; audience, depth, length and style can
      receive visible assumptions that the reader may edit.
- [ ] Ask where the result belongs and reconfirm it on the preview: at the
      current caret, replacing the selection, before/after the current page,
      at the beginning/end of the book, or as newly inserted pages. Show the
      proposed location and expected page count before any mutation.
- [ ] Make every book-writing operation a deterministic approval gate. The
      model may only propose `submit_notebook_script`/`NotebookPatch`; it never
      receives unrestricted page, SQL, filesystem or editor commands.
- [ ] Give every draft/apply attempt a run id, draft version and idempotency
      key. Re-read the book revision before apply; if pages changed meanwhile,
      stop at a conflict card instead of overwriting. Apply in one transaction,
      verify content/page ids, and create one complete book-level Undo step.
- [ ] Make Stop real: abort the provider stream, suppress late events by run id,
      prevent entry to the apply node, and retain the last complete checkpoint
      for optional resume. App restart/network loss should resume from a safe
      checkpoint, never repeat insertion.

### Notebook generation, preview and revisions

- [ ] Make the live Notebook Script spec/catalogue the canonical generation
      source. Retrieve only the relevant syntax, page/card/callout/lettering/
      diagram/sticker/tape/trim and Creative Direction sections per graph node,
      so agent prompts cannot drift from the format guide shipped to people.
- [ ] Have Cohere return the large artifact through a strict
      `submit_notebook_script` tool argument. Keep requirements, plans, audits
      and patches schema-validated; do not combine Cohere `response_format`
      with tools/documents where its API forbids that combination.
- [ ] Refactor manual Paste Script and AI apply onto one shared
      `applyNotebookScript` service: same tolerant parser, diagnostics,
      placeholder/media resolution, authored page boundaries, overflow
      settlement, duplicate prevention, protected pages and whole-import Undo.
- [ ] Expose local parser, image-reference, page-ledger, dry-layout and rendered
      preview checks as first-class tools. The agent chooses and repeats the
      useful repair work, but cannot mark a parser/layout failure as successful
      merely because a model score is high.
- [ ] Add an isolated draft-sandbox service: exact TipTap schema, page styles,
      pagination, media placeholders/assets, headings, diagrams and fixed page
      dimensions, but no writes to the live book. Key every preview by draft
      hash/generation so late renders and stale agent observations cannot be
      mistaken for the current draft.
- [ ] Add a `render_draft_pages` / `inspect_draft_render` tool pair. Return page
      manifests and capped page images to Command A+ for visual review; let it
      inspect selected pages or every page, record concrete layout/quality
      findings, revise the script and request a new render. Preserve original
      local image assets while sending only analysis-sized preview images.
- [ ] Show the complete draft in a trustworthy preview: page count, insertion
      target, sources/citations, parser/layout status, assumptions and affected
      pages. Show the SAME exact rendered pages the agent inspected, with a
      page/spread filmstrip, zoom/full-preview, visual-review findings and
      revision history. Let the reader approve, reject, change location, or
      send feedback without losing the thread. Only explicit approval copies
      the isolated draft into the live book.
- [ ] Tie later revision requests to the last apply receipt and current page
      revisions. The agent proposes a scoped diff, calls out conflicts with
      user edits, asks follow-ups when intent is ambiguous and requires approval
      again before changing the book.

### Images, PDFs and source grounding

- [ ] Accept local PNG/JPEG/WebP/non-animated GIF and PDF attachments with
      explicit size/type caps, preview/remove controls, hashing and cancellation.
      Preserve the original image asset for insertion/fullscreen viewing; make
      a resized analysis copy only for the model request.
- [ ] Do **not** pretend Cohere accepts arbitrary PDFs directly. Extract PDF
      text locally by page and preserve page anchors. V1 may expose byte-valid
      embedded JPEG figures only; it has no OCR or full-page PDF raster. Until a
      verified full-page raster exists, every PDF page must remain unresolved
      for preserve-all work even when extracted text looks complete.
- [ ] Cite attached sources at page/figure level in plans and generated notes.
      If extraction is weak, say so and ask whether the reader wants OCR/
      visual analysis rather than silently inventing content.
- [ ] Use a three-level retrieval policy: direct grounded context for a small
      source; local FTS/semantic candidate retrieval plus Cohere Rerank for a
      long text source; page-image/text embeddings plus Rerank for visual or
      mixed PDFs. Record page/chunk ids in the plan so every cited claim can be
      traced back to the attachment and stale indexes can be invalidated.
- [ ] Treat every attachment, OCR result and image as untrusted data. A
      quarantined source-reader step gets no tools and returns typed facts,
      anchored excerpts and prompt-injection warnings. Instructions found
      inside a source never change the user's goal, permissions or insertion
      approval.
- [ ] V1 does not browse arbitrary URLs or generate new images. If image
      generation is added later it needs a separate provider/tool, clear
      consent and the existing aspect-ratio/role requirements; Cohere itself
      returns text rather than generated image assets.

### Conversation and selection UX

- [ ] Build the AI Agent rail sheet in the same parchment/ink language as other
      book sheets: task threads, source chips, readable assistant/user cards,
      compact phase ledger, app-styled menus, retry/stop, citations, preview
      card and a fixed composer. The panel may scroll; pages never do.
- [ ] Preserve one task thread across panel close/reopen and allow a new task,
      rename, delete and resume. Summarize old conversation locally and send
      only recent turns plus canonical task/plan/source state to avoid stale,
      expensive context.
- [ ] Add one Alcove AI action to the existing text-selection toolbar. It opens
      a small hand-drawn prompt card above the selection, with optional quick
      intents (rewrite, shorten, clarify, continue) and free text. The sandbox
      integrates the replacement into the captured target-page document and
      shows that exact native rendered page for approval—not an inline text diff
      and not an immediate mutation.
- [ ] Anchor selection rewrites to page/block ids and a document revision. If
      the reader edits or moves the selection while the request runs, refuse
      the stale patch and ask them to reselect.
- [ ] Add only a mention to onboarding: where the AI Agent icon lives, that it
      uses the reader's own provider key, and that nothing is sent until they
      open it and consent. Do not put key setup or a forced agent task in the
      tour.

### Delivery order and gates

- [ ] **Phase 0 — proof spikes:** validate a trial and production key through
      the actual secure Rust path; prove current Command A+ text, streaming,
      strict tools, images, citations and cancellation; measure Embed v4 plus
      Rerank v4 quality/call cost on text and mixed-PDF fixtures; prove
      LangChain Cohere parity or lock in the custom LangGraph provider adapter;
      select the secure credential backend. Use only synthetic/non-sensitive
      fixtures. Never print, screenshot, commit or echo local development key
      values.
- [ ] **Phase 1 — safe foundation:** provider interface, Rust gateway, secure
      key lifecycle, graph/checkpointer, typed state/events, fake provider,
      cancellation, redaction and deterministic approval policy.
- [ ] **Phase 2 — generation path:** intake/follow-ups, spec retrieval, source
      ingestion, planning/drafting/repair graph, shared script apply service,
      dry-run preview, placement choices, atomic apply and Undo.
- [ ] **Phase 3 — UI:** rail icon/panel, styled creative-direction menus,
      expandable composer, attachments, streaming phases, citations, preview/
      approval/conflict cards and thread management.
- [ ] **Phase 4 — selected-text AI:** anchored mini composer, transform graph,
      integrated target-page render and stale-selection protection.
- [ ] **Phase 5 — acceptance:** deterministic fake-provider tests first, then
      redacted real-key smoke tests and an adversarial eval set covering missing
      requirements, long/malformed output, text/scanned/mixed PDFs, images,
      prompt injection, rate limit/auth/network failures, cancellation/restart,
      stale-book conflicts, exactly-once insertion, Undo and revisions.
- [ ] Visually inspect the real rail panel, key gate, expanded composer,
      attachment states, follow-up choices, progress, preview, insertion target,
      selection popover, errors and narrow-height layouts. Also inspect several
      generated notebooks page by page; zero parser errors, duplicate sections,
      page overflow, missing media, stale writes or unapproved mutations is the
      release floor.
- [ ] After owner acceptance, update the downloadable AI guide relationship,
      onboarding mention, README/manual/privacy text and release notes. Keep the
      manual copy/download flow as a provider-independent fallback rather than
      deleting it.

### Research authority (recheck at implementation time)

- Cohere: [rate limits](https://docs.cohere.com/v2/docs/rate-limits),
  [Command A+](https://docs.cohere.com/docs/command-a-plus),
  [tool use](https://docs.cohere.com/v2/docs/tool-use-overview/),
  [structured outputs](https://docs.cohere.com/v2/docs/structured-outputs),
  [image inputs](https://docs.cohere.com/v2/docs/image-inputs),
  [Embed v4](https://docs.cohere.com/docs/cohere-embed),
  [Rerank v4](https://docs.cohere.com/v2/docs/rerank),
  [privacy policy](https://cohere.com/privacy).
- LangChain/LangGraph: [JS agent overview](https://docs.langchain.com/oss/javascript/langchain/agents),
  [persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence),
  [interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts),
  [functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api),
  [ChatCohere JS capability table](https://docs.langchain.com/oss/javascript/integrations/chat/cohere).
- Security/design: [OWASP Agentic Top 10](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/),
  [Tauri Stronghold](https://v2.tauri.app/plugin/stronghold/),
  [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

## ✅ 0.6.6 — safer pictures and whole-import undo (2026-08-11)

- [x] Make one `Ctrl+Z` restore the complete pre-import book after a successful
      multi-page Notebook Script insertion, including source provenance and
      authored page boundaries.
- [x] Persist both sides of a move to the previous page before changing spreads
      so remounting the source leaf cannot reconstruct a duplicate block.
- [x] Stop manual image enlargement at the current page's capacity while
      retaining the original asset bytes and full resolution.
- [x] Fit tall originals completely inside the large-image viewer at 100%, keep
      zoom and drag-to-pan, and centre the image toolbar's Alcove line icons.
- [x] Open the normal block context menu from either the picture itself or the
      unused horizontal lane beside a narrow standalone picture.
- [x] Add a right-click trash-dock menu with Open and a two-step Empty action.

## ✅ 0.6.5 — safer page flow and faithful book copies (2026-08-11)

- [x] Keep manually positioned books at the exact chosen shelf location instead
      of pulling them back toward the nearest generated cluster.
- [x] Offer cover-only and full-book duplication while preserving the exact
      procedural exterior, emblem, cover metadata and pinned binding.
- [x] Add pages before or after an existing leaf from its context menu and move
      text or media blocks across page boundaries, including back into space on
      the previous page.
- [x] Eliminate the stale-save race that could duplicate whole imported
      sections, and settle every populated spread before completing insertion.
- [x] Fit oversized uploads to the available page space without resampling the
      original image used by the full-screen viewer.
- [x] Tell image-generating assistants the intended role, orientation, aspect
      ratio and approximate pixel dimensions for every requested picture.
- [x] Keep inline emoji just above Alcove's writing rules without changing the
      stored document or its exports.

## ✅ 0.6.4 — page typography and AI-layout repair (2026-08-11)

- [x] Align complete inline emoji sequences with Alcove's handwritten text
      without changing stored documents or exports.
- [x] Replace the Creative Direction diamond with an optically centred,
      monochrome Alcove sparkle.
- [x] Render standard TeX control spaces, including the reported average-code-
      length formula with `\bar` and `\text`.
- [x] Label heading-less TOC leaves as section continuations, retain authored
      interior blanks and omit unused trailing stocked leaves.
- [x] Require AI-authored headings, setup sentences and introduced visuals to
      share one planned page instead of adding a risky pagination guess.
- [x] Add explanatory commit paragraphs to generated What's new / What's fixed
      release notes.

## ✅ 0.6.3 — AI authoring and rich-import release scope (2026-08-11)

- [x] Give the downloadable AI guide selectable Creative Directions, a proper
      custom-brief editor and the complete live paper/card/callout/lettering/
      diagram/sticker/trim catalogue; keep Paste Script focused on insertion.
- [x] Copy parser diagnostics, accept the expanded paper/effect vocabulary,
      resolve requested open images or upload fallbacks, and preserve document-
      wide values across protected `::page` boundaries.
- [x] Keep multi-page imports on the chosen leaf/spread, reuse fresh blank
      leaves, reflow after large images decode, and carry headings/lead-ins with
      the blocks they introduce.
- [x] Add durable browser-development media, a zoomable drag-to-pan image
      viewer, corrected TeX ceilings/fractions/fitting, and stable table/list
      snapshot geometry.
- [x] Add copy/paste actions to colour wells; centre the Creative Direction
      diamond optically; refresh Welcome onboarding and all public manuals.
- [x] Put What's new and What's fixed first in generated GitHub release notes
      and reuse the compiled Windows binary for the offline installer bundle.

## ✅ BOOK APOCALYPSE — shipped in 0.6.0 (2026-08-10)

This is the authoritative book-status block. The owner authorized a book-only
hard reset with forced migration; shelf carpentry, wallpaper and room options
were explicitly out of scope and remain reachable.

- [x] Replace the spine vocabulary with 3 straight shapes, 18 construction-led
      materials, 59 authored spine programmes and 67 named bindings; normalize all retired
      book ids into the new system.
- [x] Remove all spine text and empty title furniture while retaining complete,
      balanced cover titles.
- [x] Curate the cover to 16 unified emblems, 12 continuous frames, 15 title
      treatments, 10 lettering hands, 6 visibly distinct page edges and 3
      endband constructions; remove charms, hardware, corner protectors and
      inset plates from applied state and Studio.
- [x] Rebuild Surprise around one focal-programme budget, the final safe emblem
      authority, no wallpaper/hardware/charm stacking, no more than two automatic
      bands, exact emblem pairing and 24 persistent locks.
- [x] Migrate persisted book appearances at v14 without touching pages, titles,
      shelf placement, bookcases, shelf carpentry or wallpaper.
- [x] Redesign Welcome as a Grand-blue Gilt Quarto with a clean titleless spine,
      two cords, one foliate lozenge and an intricate Renaissance-panel cover.
- [x] Add the default-off updater option to replace Welcome pages/binding even
      after edits, with persistence, boot-order safety and version gating.
- [x] Remove the orange/duplicate backing from dragged, held and carried books.
- [x] Pass final running-app QA (`ok: true`, `pageErrors: []`), the 4,096-recipe
      Surprise sweep, 72 final direction/adversarial specimens, true-size
      vocabulary/surface boards, TypeScript and focused final gates.

## Historical open list — superseded for book work (2026-08-10)

**Start with `HANDOFF.md`.** The owner-tested batch below shipped in Alcove
**v0.5.1** on 2026-08-09. GitHub Actions run `31309926868` passed every gate,
all three platform builds, updater-manifest validation and publication. Inspect
`git log --oneline origin/main..HEAD` and the working tree before acting; do not
discard or push future work without owner permission.

**These items are symptoms and priorities, not implementation specs.** Prior
agents wrote some of the “how” (file names, timers, cue names). **Claude should
rethink each task once** — reproduce, measure, and ship a better fix if you see
one. Tick the outcome, not the exact recipe in the bullet.

Work **in this order** unless blocked:

- [x] **Post-v0.5.1 — adaptive spine title composition:** one exported resolver
      now owns both the rendered spine geometry and the preview hit targets.
      Title size and room reserve a real exclusion zone; raised cords move above
      or below it and reduce only when no legal station remains, while tooling,
      endbands and ornaments relocate or yield with structured diagnostics. A
      readable-size floor and quiet label fallback prevent direct lettering from
      shrinking into marks. More than 900 short/tall/thin/wide combinations and
      a 30-cell native-size board were checked; an independent refutation found
      no remaining cord, ornament, contrast or truncation blocker.
- [x] **Book Apocalypse — final Surprise composition:** the old axis sampler and
      its furniture pile-ups were replaced by a deterministic one-focal-programme
      search over the hard-reset vocabulary. It has 24 persistent locks, seven
      safe automatic emblems, exact spine/cover emblem pairing, at most two
      automatic bands and no charms, hardware, corners, inset plates, wallpaper
      fields or spine text. The final 4,096-recipe quality sweep and 40-cell
      adversarial board have zero report failures or malformed book forms.
- [x] **Post-v0.5.1 — AI format save:** the native save picker now has the
      scoped `write_file` command authority it was missing, while the browser
      object-URL fallback remains intact. Notebook Script accepts an intentional
      empty image with a `placeholder` prompt; the Insert Script preview shows
      a real picture-needed card, and the inserted block can be filled in-place
      by choosing or dropping one image without losing its alt text, caption,
      frame, width or effects. Parser/printer, TipTap and generated AI guides
      round-trip the syntax. Fifteen focused save/placeholder tests pass.
- [x] **Post-v0.5.1 — Book Studio quality and workflow final integration:** the
      companion spine/cover preview, direct part targeting and ordered
      publication remain, but the option surface now exposes only the curated
      Book Apocalypse system. The running app proved 24 unique Surprise locks,
      unified Book emblem, Cover frame and Edge treatment controls, no retired
      furniture or spine-title controls, and `pageErrors: []`.
- [x] **Portable local video parity:** video nodes now carry the same durable
      `assetRelPath` as pictures, travel in both lossless and Notebook Script
      parcels, scrub the source library root and rebase onto the destination.
      Captionless, bracketed, multiline and backslash captions round-trip; the
      focused portability/parser gate passes 21 cases.
- [x] **Final demo after the frozen Surprise fix:** the full existing tour was
      captured on the frozen 0.6 source with 61 visible books (20/20/20 plus
      Welcome), sharing the exact same titles, bindings, order and saturated
      jewel/earth palette as the README shelf. It retains the explicit
      Lapis→Garnet shelf colour beats, redesigned Book Studio, local video and kittens. The
      1,758-frame deterministic capture encoded to `docs/readme/img/demo.webp`;
      the loop anchor measured MSE 0.0069. The owner
      explicitly waived agent frame review and will judge this file before push.
- [x] **Post-v0.5.1 — updater release-note formatting:** the installed updater
      no longer prints GitHub's raw `<div>`, image, heading, emphasis and table
      source inside one paragraph. It safely renders the “What changed” summary
      as headings, lists, emphasis and external links, while omitting the
      GitHub-only masthead and installer-choice table. This stays on `main` for
      the next tagged version; 0.5.1 itself was not retagged or replaced.
- [x] **v0.5.1 candidate — corner-turn page silhouette:** allow the curling
      sheet to travel beyond the settled book rectangle and overlap adjacent
      reader chrome during the gesture. Do not squeeze/clamp the rendered leaf
      merely to keep it inside the book/title-panel bounds; settled pages must
      retain their existing clipping and layout. **Still open after owner
      retest:** 64px of gesture-only canvas overscan removed the outer clipping
      bound but did not change the projected sheet silhouette; the curl still
      read as squished into the settled book. **Owner confirmed the replacement:**
      the vertex shader now projects the cylinder's real `pos.y` for
      corner turns while retaining depth-only baseline compensation; corner y
      room scales to 24% of leaf height and projection strength no longer
      changes with framebuffer size. At `p=.65`, the shipped leaf geometry
      measures 106px above the settled page and visibly crosses the title.
- [x] **v0.5.1 candidate — effect-level page navigation:** clicking the inline
      page links on “Pages point at pages” and the three buttons inside “Need a
      way back?” must navigate to their target leaf inside the open book. They
      must not fall through to the shelf or leave a highlighted focus/window
      rectangle on the left. Same-book jumps no longer reopen/reset the reader;
      the exact Welcome link stayed in book view throughout a 500ms trace.
- [x] **v0.5.1 candidate — Book Studio preview parity:** the spine preview must
      show the complete binding that the same book displays on its shelf,
      including the shelf renderer's ornament/reserved-space context rather
      than the incomplete plain-background variant. Preview rendering now
      receives the persisted binding id used by the shelf renderer.
- [x] **v0.5.1 candidate — new-book hover geometry:** hovering the shelf's New
      book slot must keep its plus centred and upright; no directional rotation
      or rightward drift. Hover/focus now scales without rotation; the measured
      glyph centre remains within 0.01px of the slot centre.
- [x] **v0.5.1 candidate — tray ambience policy:** background ambience should
      stop while Alcove is hidden in the system tray by default. Add a persisted
      Sound setting that can opt into continuing it in the tray, and resume the
      selected ambience correctly when the window returns. Rust now reports
      successful tray hide/show state to the sound engine, which preserves the
      selected bed while retiring/resuming voices according to the new opt-in.

### Owner retest — 2026-08-08

#### Release blockers — newest owner pass

- [x] Settings chapter rail: selecting Library files or Help now moves and keeps
      the active gilt marker on that icon instead of snapping back to System.
- [x] Keep the custom-cursor scrollbar behavior while restoring the old slim,
      quiet visual weight; the DOM track is 9px and its visible thumb is 5px.
- [x] Book opening no longer exposes empty ruled leaves while TipTap/content is
      mounting. Keep the already-rendered focused cover/shelf as the visual
      owner until the first populated spread has completed a paint opportunity.
- [x] **Owner-confirmed — page-turn snapshot text and special-block motion.**
      The Welcome `Esc` keycap remains whole, ordered markers keep their live
      style/advance, and cards/diagrams no longer move right during a turn.
      Snapshot capture now carries the mounted inline/list/marker contracts,
      keys freshness to the keyed `.nb-page`, and applies top-level geometry
      after node-view geometry. The old order reproduced a +40px callout shift;
      the corrected order measured 0px on both axes. The broad nested absolute-
      positioning freeze was removed. The owner tested and accepted the result.
- [x] Rapid soundscape switching and turning off Play ambience now stop every
      superseded, active or still-loading loop. Generation authority plus a
      tracked voice set closes late `play()` races; a 32ms de-click prevents
      cached switches from accumulating beds. Four focused tests cover the
      reported switch/off cases.
- [ ] **Owner opening retest — held-cover handoff fix staged:** pull or drag a
      book out, let it settle, then click the cover to enter. The cover now
      becomes inert but remains the painted visual owner until `readerReady`;
      overlay removal and shelf-away happen in the same reactive commit. A
      focused transition trace found no shelf-only frame; confirm on localhost.
- [x] Owner confirmed the right-hand destination corner/shadow fix. It keeps
      one DOM owner and the same 34px size, 0.75 opacity and no transform
      before/during/after both directions.

- [x] Replace the book studio's action card with one compact Randomise dice
      button at the preview's upper-right; remove Surprise Me and Follow the
      Room from this panel entirely.
- [x] Keep the selected app cursor over every styled scrollbar track/thumb;
      dragging a scrollbar must not fall back to the Windows arrow.
- [x] Snapshot geometry diagnosis completed and ruled out as the remaining
      text-motion cause: live, mounted and first-visit offscreen “Ink Between
      Words” captures agree at 0px vertical offset. The top-level freeze remains
      for margin/list fidelity, but the surviving defect was shader projection.
- [x] Revert the unsuccessful destination-corner shadow experiment completely.
      It did not settle the corner and made the reverse turn look worse; both
      the CSS/scene change and its commit are now explicitly reversed. The
      pre-experiment presentation is restored for owner retest.
- [x] Keep Library Studio's top Surprise Me room roller and its preset-mood
      choices. Remove only Back to one room, Plain again, and the duplicate Add
      a floor control (the shelf rail owns that action).
- [x] Replace the Your own tab's “not yet, and why” refusal list with working
      add/import paths. Do not advertise an unsupported upload category; every
      card shown there must accept, validate, persist and surface its result.

- [x] Superseded the earlier live-DOM/snapshot-handoff theory with direct bitmap
      evidence. The hidden moving leaf and its cached texture agree; vertical
      displacement was introduced later by curl projection, now replaced by
      the baseline-invariant renderer tracked above.
- [x] Align the open book's centre binding/shadow with the actual centre seam
      of the outer cover at every fitted spread size. The page gutter and cover
      outline now share the exact 50% axis through a symmetric two-board open-
      cover renderer; runtime centres differed by less than 0.01px.
- [x] Restore the missing ink outline at both upper corners of every rail/studio
      panel, including clipped or scrollable panel states.
- [ ] **Owner shelf retest — implementation staged:** make a saved book
      customization invalidate and rebuild its shelf spine
      immediately on return to the library; no manual refresh may be required.
      Persistence now publishes after SQLite commits, the mounted shelf re-reads
      the book row, then invalidates and rebakes that spine.
- [x] Put one compact, light Randomise dice beside the Book Studio preview;
      remove Surprise Me and Follow the Room from Book Studio. Keep the room-
      level Surprise Me action at the top of Library Studio with mood presets.
- [x] Replace native panel scrollbar hit targets with an app-drawn DOM control,
      preserving the selected cursor over the track, thumb and drag. The same
      fixed control now serves Settings without scrolling away with its sheet.
- [x] Add a persistent nine-icon chapter rail to the left edge of Settings.
      Each icon jumps to its visible section, participates in the focus trap,
      exposes an accessible name, and uses the app's own hover tooltip.
- [x] Redesign the seeded Welcome binding without overwriting a customized
      book: remove the OUTER ribbon accessory, remove the white/red spine mark,
      and replace the hourglass spine silhouette with a solid binding shape.
      The inner between-page bookmark remains blue.
- [x] Replace the new-library room default with a grand, intricate, vivid
      composition while keeping brown timber acceptable: choose an ornate
      shelf build/carving, richer wallpaper/palette, and a vivid coherent UI
      accent (red, pink or blue) for Settings and primary controls. Keep corrupt-
      data fallbacks plain and independent from the authored default.
- [x] Update the full-length demo storyboard to open on that authored default
      room and explicitly show changing shelf carving/build. Preserve the
      existing breadth and panel tour; do not shorten it. Source and rendered
      artifact are now updated.
- [x] Replace focus mode's floating corner panel and separate exit chip with a
      focus-only 50px left rail. Preserve every book/pages/one-page, zoom, leaf
      and recenter control; add Settings and Leave focus to the same rail and
      hide the duplicate global settings gear while focus is active.
- [x] Make visual confetti deliberately silent and lighter. A visual burst
      dispatches no audio; disabled/minimal/reduced-motion completion retains
      the ordinary `check-done` cue. Rendering is capped at one 28-particle,
      760ms burst with a 1.25× backing store and no pointer-click layout read.
- [x] Rerender the full-length animated WebP after owner acceptance: 105.21s,
      1,473 loop frames, 9,054,084 bytes and seam MSE 0.059027777777777776.
      Preserve the original tour, reach Card Room through the real picker, and
      add named Lapis Cabinet → Garnet shelf-only colour changes. The owner
      explicitly waived Codex's manual visual inspection; record the 20
      temporal-triage findings (worst `round-trip-residue @ f0825`). No selector
      or applied-state choice was omitted.
- [x] Release sibling Gifsmith `0.3.3` with optional temporal review. Full gate
      218/218, 108-file tarball, Node 18/24 and clean-install CI green; npm
      `latest` and the non-draft GitHub `v0.3.3` Release are live. This does not
      authorize an Alcove push.
- [x] Push the local **Alcove** commits and publish `v0.5.0`. `main` was pushed
      through `e340d32`, annotated tag `v0.5.0` was created without rewriting
      history, and GitHub Actions run `31303803710` completed every gate plus
      Windows, universal macOS, Linux and Publish jobs. The live, non-draft,
      non-prerelease Release has 13 assets, complete checksums and signed
      updater metadata for four platform keys. Alcove was not installed,
      uninstalled or launched as an installer on the owner's machine.

#### Earlier staged owner retest

- [ ] **Owner retest — implementation staged:** preserve the app-styled table
      scrollbars in page-turn snapshots; the foreignObject/canvas copy must not
      fall back to browser scrollbar chrome. The capture now suppresses clone-
      invented overflow and draws overflowing thumbs as ordinary token-coloured
      DOM, because browser scrollbar pseudo-elements cannot cross foreignObject.
- [ ] **Owner retest — implementation staged:** make the centre binding
      physically continuous in both turn directions:
      keep the departing side visible until the sheet covers it, reveal the
      arriving side progressively behind the sheet, and keep both halves at
      the settled size/colour whenever exposed. Each page shader now owns one
      binding half, including the moving sheet; there is no final overlay.
- [ ] **Owner retest — implementation staged:** keep the bottom outer page-
      corner shadow exactly the same apparent size during the curl and after
      landing. The GL scene now reads the live hover transition's destination
      scale/opacity instead of reverting to the unscaled CSS width.
- [x] **Superseded by the reopened blocker above:** eliminate the remaining live-
      page to snapshot text movement and the resulting mid-turn text anomalies
      for ordinary and special blocks. Offscreen pages now use the exact left/
      right leaf size and side-specific cascade; the dependency patch also
      covers Vite's source/HMR entry instead of only production bundles.
- [x] **Superseded by the Welcome redesign above:** change the seeded Welcome
      book's outer marker and inner ribbon from red back to blue, without
      replacing a reader-customized binding or ribbon. Seed v11 uses Navy
      outside and broad Cornflower silk inside, with exact-value migration.

### Completed owner retest — 2026-08-08

- [x] Eliminate page-turn static on isolated slow turns as well as rapid turns;
      do not treat burst overlap as the only failure mode.
- [x] Rebuild the middle-page treatment so it belongs to the selected paper:
      matching colour/ruling, no pasted strip, no premature reveal from behind
      the moving page, and no abrupt rule cutoff at the gutter.
- [x] Eliminate the remaining pre-turn and mid-turn vertical text movement on
      both visible pages.
- [x] Make both shipped Welcome bookmark layers red; set the inner bookmark's
      default style to the existing Festive Gift option, and remove the brown
      fill from the cut-out corner treatment.
- [x] Prebuild blank destination pages with the selected paper/ruling before
      navigation so a white leaf never flashes before its lines appear.

- [x] Eliminate intermittent static during rapid page turns through playback
      scheduling that stays clean under bursts.
- [x] Repair the remaining page-turn seams: no top-left clipping on a
      bottom-right turn, no shrinking outer-edge/corner shadow, no delayed
      left half of the gutter shadow, and no text/card/diagram movement on
      either stationary or destination page.
- [x] Remove the leading empty gap before the first cursor choice in Settings.
- [x] Make “mute background sounds when unfocused” opt-in rather than enabled
      by default, without changing an existing reader's saved preference.
- [x] Let the installer choose where the reader's library data is stored and
      make the selected location reach the running app safely.
- [x] Superseded: the seeded Welcome book's earlier blue marker was replaced
      by the owner-selected red marker and Festive Gift ribbon above.
- [x] Play the book-opening cue when the pulled cover is opened into the book,
      separately from the shelf pull/drag cue.
- [x] Keep forward navigation available through arbitrarily many blank pages;
      stock pages ahead without imposing a trailing-blank ceiling.
- [x] Restore audible book-open, page-turn and sidebar cues after the audio
      runtime migration; keep the unlock path reliable after focus changes.
- [x] Keep the complete destination page prepared before a turn begins, and
      keep the right-hand leaf/page stack fixed in screen space throughout the
      curl instead of shifting left and snapping back.
- [x] Remove the development-only bottom-right `Shelf / Book` switch pill from
      the open-book view.
- [x] Prevent double ruling in special blocks that own their own internal lines.
- [x] Audit the Welcome source and correct heading/media spacing, including the
      “one picture properly” example.
- [x] Ship only the animated WebP demo; remove the duplicate GIF path.
- [x] Retire automated visual/audio/E2E/probe suites and retain only the parser,
      pagination and version smoke gate plus TypeScript compilation.
- [x] Install the personal global `build-without-fear` Codex skill outside the
      repository.

### 0 — Rework testing

- [x] **Superseded 2026-08-08:** retire the historical unit, Playwright, visual,
      probe and sound-metric systems. Keep only `npx tsc --noEmit` and the three
      non-visual/non-audio invariants in `tests/smoke.test.ts`. The owner accepts
      visual and audio behaviour directly.

### 1 — Sound

- [x] Static / crackle: onboarding step changes, profile preview rapid-fire,
      page-turn playback.
- [x] Right-click must **not** play page-turn (wrong cue).
- [x] Todo confetti is deliberately silent. Do not play the former celebration
      pop and do not stack `check-done` under a visual burst; use the ordinary
      quiet checkbox cue only when no visual celebration will run.
- [x] Superseded: the sourced CC0 celebration WAV remains available to old
      sound-set data, but the confetti effect no longer dispatches it.

### 2 — Page flip

- [x] Shadow / paper colour still landing late after turn — prefetch / raster
      cache / gutter band timing. Prove with stage-2 frame captures.

### 3 — Onboarding

- [x] Slow down dwell / celebrate timers (owner: too fast).
- [x] Thumbnail strip auto-closes when tour advances.

### 4 — Editor

- [x] Ruled lines: text sits on the rules; user-adjustable gap (page style).

### 5 — Stickers / blocks

- [x] Ledger + postcard: real two-column layout (not one block pretending).
- [x] Slash menu: no overflow/clipping in narrow right column.

### 6 — Media

- [x] Drag-drop video onto page.
- [x] Context menu: Insert submenu, Copy link.

### 7 — Desktop / ship polish

- [x] Auto-updater (Tauri plugin + dialog + signed GitHub Release feed).
      The first updater-enabled installer is a one-time manual upgrade from
      v0.4.0; releases after that update in-app.
- [x] NSIS installer taglines.
- [x] Close-to-tray.
- [x] Mute sounds when window unfocused.

### Finishing after owner localhost review

- [x] Re-render the full-length animated WebP after the owner approves this
      localhost build. Keep the complete existing studio sequence and every
      rail panel, use
      TOC/thumbnails once each, retain the ruled ledger and kitten spreads, and
      do not shorten the tour. Completed 2026-08-09 at the owner's request;
      final candidate is 105.21 seconds and 9,054,084 bytes. It also keeps Card
      Room through the full picker and shows blue → red shelf colour. Manual
      visual inspection was explicitly waived for this render.

### Blocked on owner

- [ ] CI workflow on ordinary commits (Actions minutes).
- [ ] Pin to Start `E_ACCESSDENIED` (needs keyboard grant).
- [x] Add the updater signing private key to GitHub Actions secrets before the
      first updater-enabled release. The local ignored key signed a smoke file,
      `TAURI_SIGNING_PRIVATE_KEY` was added without exposing its value, and the
      v0.5.0 workflow proved four signed updater platform entries. Existing
      0.4.0 installs still need one manual bootstrap installer.
- [x] `git push` / tag only when the owner says. The owner authorized v0.5.0 on
      2026-08-09; `main` and annotated tag `v0.5.0` were pushed normally. No
      force-push or history rewrite was performed.

---

## ⏸ Archive — earlier checkpoints (historical)

The sections below are dated reports and completed work. **Do not treat old
`[x]` items as open.** Use only `## 🎯 OPEN` above for current work.

## ⏸ PAUSED CHECKPOINT — 2026-08-06 (superseded)

See `HANDOFF.md` **2026-08-07** section. Spine blockers f0206/f0322 were fixed
in an earlier branch; current `main` is docs-only at `b847c9d` — re-verify
flip/sound fixes in the open list above.

## 🎯 OPEN — superseded index (2026-08-06)

The map below is **stale**. Use `## 🎯 OPEN — owner testing pass (2026-08-07)` at
the top of this file instead.

This index exists because the file below it is 3,900 lines of dated reports and
293 done items interleaved with the 12 still open. The detail for every row
below lives at its line number IN THIS FILE — this is a map, not a copy, so
nothing here can drift out of sync with the real entry.

**See also [`HANDOFF.md`](HANDOFF.md)** for the fuller picture: what state the
tree is in right now, what's uncommitted, and what to check first.

### Blocked on the owner (a real decision, not busywork)

- `:1089` **Nothing checks an ordinary commit.** No push/PR CI workflow exists;
  adding one spends the owner's Actions minutes. Their call, not an agent's.

### The release sequence — do these IN ORDER, on a dev server nothing else is
### writing to (see `:1236` for the full six-step breakdown and why order matters)

1. `:1110` **Run the history rewrite.** `scripts/shrink-history.mjs --yes`,
   verified safe by a full rehearsal on a throwaway clone (GO, not just
   planned) — 1,406.6 MB → 317.9 MB, zero live files touched. Then `--remap`,
   then force-push `main` **and `--tags`** (both, or the release pipeline
   silently diffs against the wrong "previous" tag), then `git tag v0.4.0`.
   *Actually, do this LAST — see the numbered order at `:1236`; it's listed
   first here only because it has no dependency on anything else finishing.*
2. [x] `npm run visual`, full matrix. The quiet-tree sabotage reported MOVE on
   71/71 distinct frames and `GATE ALIVE`; the comparison reached 63/64 exact,
   the remaining back-tab timer race was pinned, and that surface then repeated
   at 0px twice. Representative baselines were inspected at original size.
3. [x] `:1181` Re-captured all 24 README shots from clean `718d14c`. The broken
   hero run left the set byte-identical; the partial hero kept set identity at
   0.3.0; the full run promoted 24 pictures + manifest at once as Alcove 0.4.0.
   Every alt was visually checked and six stale descriptions were corrected.
4. [x] `npm run readme:build`; rechecked the 0.4.0 arithmetic. Leaf capacity
   remains 25.66/19.41 lines and columns 592/434px. The refined default budget
   is 16.41 lines; seeded estimates average 81% (85% max), and live named leaves
   average 88% (97% max). The minimum-window ceiling is 52% of the default leaf.
5. [x] `:1223` Re-render the demo. Five renders with local Gifsmith; render **#5**
   is the candidate (1192 frames, 77s, seam MSE 0.115, 17 temporal findings,
   ~35% shorter post-click holds). **f0206 and f0322 are gone.** `probe-spine-settle.mjs`
   GATE ALIVE.
6. Tag and ship.

### Smaller, not release-blocking

- `:2024` **Pin to Start fails with `E_ACCESSDENIED`.** Needs the owner at the
  keyboard for the real right-click grant; do not use the `ConfigureStartPins`
  policy (needs admin, replaces their whole pinned layout).

### Superseded — kept for the original quote, not actionable on their own

- `:142`, `:297` are the FIRST, bare reports of the turn-symptom and demo-looks-
  broken complaints. Both are superseded by the measured, gated follow-up
  entries at `:170` and `:228` — read those instead.
- `:303` **"the visual harness should detect frame-to-frame changes, ideally in
  gifsmith"** — very likely already built: `gifsmith`'s `src/review/` (~1,300
  lines: `detect.ts`, `signal.ts`, `atlas.ts`, `ledger.ts`) exists and
  `scripts/probe-turn-face.mjs` in THIS repo cites "the temporal review of the
  demo" as having found the wrong-spread defect above. Not verified from this
  side — check `gifsmith`'s own commit log and tests before assuming it shipped
  cleanly; that repo is separate and this session did not audit it directly.

### Uncommitted work in flight, from a background agent this session lost track of

- `src/flip/offscreenPages.ts`, `src/flip/FlipSurface.tsx`, `src/views/BookView.tsx`
  carry ~176 lines of uncommitted, additive changes (`git diff --stat` to see
  them) that appear to make offscreen flip-face captures DRAIN a staged page
  before photographing it — which would plausibly explain the "wrong spread"
  finding above, since an undrained page's stale content is exactly what a
  stale flip texture would show. **Not verified, not tested, not committed.**
  Read the diff, run `npx tsc --noEmit` and the flip test suite, and either
  finish and commit it or revert it — do not leave it sitting uncommitted.

---

## 🔴 Reported 2026-08-05 (fourth pass) — the demo, and the bugs it exposed

Recorded verbatim (grammar tidied only) from two messages while the 0.3 demo was
being reviewed frame by frame.

## 🔴 Reported 2026-08-06 — what a still-frame review cannot see

- [x] **The landing page loads its shadow and paper colour half a second late.**
      FIXED, and the diagnosis in the original entry — "preload for the
      adjacent pages" — turned out to be impossible rather than merely
      untried. `ccd822f`

      Nothing in the DOM was ever late: every property the leaf's look is made
      of (paper colour, fore-edge hairlines, the ruling stack, the two doc
      attributes it's computed from) was already settled on the sample the new
      leaf appeared in, 0ms, every turn. What was late was a VIEW — the gutter
      band, its crease and the dog-ear are DOM siblings of the flip surface,
      buried under the curl canvas's `position:absolute; inset:0` for
      557-1039ms per turn, and the landing (two editors mounting, two documents
      parsing, the pagination drain) starves the frame that finally takes the
      overlay down. A preload cannot touch this — both marks sit outside every
      `.nb-sheet-paper`, and a page texture is a capture of a sheet; the probe
      now asserts that rather than assuming it. Fixed by drawing the band and
      the dog-ear ABOVE the overlay for the length of a turn, conditional on
      `.is-flipping` so nothing about the resting spread moves.

      Independently verified: mechanism traced and confirmed, the fix
      neutralised and re-measured back to the reported baseline, and a second
      capture harness built from scratch that jams the main thread for 4.5s and
      screenshots through it. Two things found and left open rather than
      silently accepted:

        - **A new mark during the turn.** At high lift the band is now a
          vertical stripe cutting through the moving sheet's own text —
          intended to read as a crease shadow where the page passes through the
          binding, but that is a judgement, not a measurement. Worth a look
          before calling it settled.
        - **No automated gate protects the raise.** Delete the two `:has()`
          rules and nothing goes red except a probe that is not in CI. A case
          in `tests/styles.test.ts` asserting both selectors exist and resolve
          above `--z-flip` would be cheap and is not written yet.

      *(observed in the RUNNING APP, not in the recording — this one is real)*
      > "Another bug: let's say I turn a page, then it goes to the next page, it
      > doesn't have the shading — for example the shadow in the middle — the
      > page looks whitish for maybe 0.5 seconds and then all of it comes. So it
      > feels like it loads those effects when the user finishes turning the
      > pages. I only mean the shadow and page colour thing, everything else is
      > fine. Maybe you should preload those effects for the next pages so the
      > user doesn't see that flicker. We want it to be close to a real book,
      > right."

      Note this is NOT the landing flicker fixed in 28c7691. That one was the
      raster cache writing `.snapshotting` onto the leaf the reader was looking
      at, and it is gone — `snapOnVisible` never fires now. This is a different
      thing arriving late: the gutter shadow and the paper wash on the page just
      landed on. Preload them for the adjacent pages, the way the flip already
      warms their bitmaps.

- [ ] **A frame review of the SHIPPED demo, before any of it is re-rendered —
      and "future pages showing" has a boring explanation.** Two frames read at
      full size, `f0705` and `f0857`:

      Both show a leaf carrying **the tail of the previous authored page
      followed by the whole of the next one**. 705's left leaf opens with "A
      page that fills up simply flows onto the next one" and the no-save callout
      — the foot of the *Writing* page — and then runs the entire *Every mark
      there is* page underneath it. 857's right leaf does the same with *Two
      other ways in* and *The stationery drawer*.

      That is not a flip bug and it is not the recorder. It is the over-full
      seed: v6 pages cost 136% of the leaf they landed on, so the drain was
      permanently mid-cascade and a leaf's WHOLE document — including the tail
      about to move on — was on screen while it happened. A viewer watching that
      at 14fps and calling it *"future pages showing"* is describing it
      accurately. Fixed at source by seed v7 and the window-derived budget, so
      the re-render should not be able to produce it; **check these two moments
      specifically** when it does.

      **And a correction about the method, which is the more useful half.** On
      the 4×4 board this looked like a THIRD symptom — a right leaf holding
      nothing but a heading, which is exactly the reported *"bottom content on
      the right page disappears"*. At full size that leaf is fully inked. The
      board was wrong and I nearly wrote it down. `demo-sheets.mjs` exists to
      LOCATE a frame; the judging has to happen at `--frame=NNNN`, and a finding
      that never left the thumbnail is not a finding.

- [x] **A temporal review of the demo (gifsmith's frame-diff tooling, run by a
      separate workflow) found the right leaf briefly showing the WRONG spread,
      five times: frames 579, 695, 926, 1043, 1089.** FIXED and watched red
      against the same build with `?settleahead=0`: normal **0/6** wrong turns,
      fix disabled **6/6**, all six showing a genuinely different right page.

      The adjacent spread is never mounted while its flip faces are captured,
      so the cache photographed its stored document before pagination had
      drained it. Each drain pushes a tail into the next page, making an
      unread stored page contain content from further along the book — exactly
      the 120-frames-early page seen at f579. Offscreen staging now measures
      against the live leaf capacity, removes the real overflowing tail before
      rasterization, and hands that carry back to BookView so the document the
      reader lands on is the document they were shown.

      Two follow-up defects in the first attempted fix were caught by the gate
      and the pictures rather than accepted: a diagram whose JSON has no text
      was misclassified as an empty block, and a persisted StarterKit trailing
      paragraph was carried onto the next page, visibly shifting the landing
      down one ruled line. The probe now compares structural page signatures;
      the staged drain preserves trailing bookkeeping; the host uses the exact
      source PageDoc as a compare-and-swap token; and a capture must remain
      outside the mounted spread for its whole lifetime before it may settle.
      Four pure regression cases pin the phantom and stale-document rules in
      `tests/offscreen-pages.test.ts`.

      The shape every time: the curl finishes, both leaves are fully painted
      with no transition chrome, and for two or three frames the RIGHT leaf
      shows a spread from ELSEWHERE in the book before snapping to the correct
      one. At f579 the wrongly-shown page is one the demo does not legitimately
      reach for another 120 frames — so this reads as a genuine content mix-up,
      not a rounding artefact.

      Why no DOM-sampling probe in this repo could have caught it on its own:
      during a curl the live leaves are `visibility: hidden` with their text
      still in them, so a probe reading the DOM reports an inked leaf however
      wrong the picture on screen actually is. What the reader sees is a WebGL
      texture from `flip/rasterCache`, and the probe reads that layer instead.

      Given everything else measured today about the recorder (14fps
      compressing a 450ms turn into ~6 output frames, `capture: 'deterministic'`
      costing zero rendered frames to a main-thread stall), the prior should be
      "recorder artefact" rather than "app bug" until traced — but f579's
      120-frame-early page is specific enough that it deserves the trace rather
      than being waved off with that prior. Run `probe-turn-face.mjs` against
      the running app before the next demo re-render.

- [x] **The curl freezes near the end of the first turn after a panel closes.**
      REFUTED as a headless SwiftShader presentation artefact, not a cache or
      application-main-thread stall. The repaired pointer-driven probe now
      measures the timing it previously only printed incidentally, defaults to
      no screencast, rejects real HMR, traces the raster cache and offscreen
      `toCanvas`, records long tasks, visibility and font lifecycle, and has a
      live `midcurl` sabotage watched red (**18 missing-face frames, ~280ms,
      GATE ALIVE**).

      The original hypothesis is false. On a reproduced 2,710ms turn the two
      missing presentation intervals were 845ms and 1,331ms, but
      `cache.suspend()` entered with no work in flight, no capture or
      offscreen raster overlapped either interval, and no browser long task
      overlapped them. A warmed-panel run refuted first-mount and font work;
      a no-panel run on the same destination was clean (529ms, 20ms worst
      gap); CDP screencast amplified the pause but did not create it.

      The isolating control was the compositor path: with the normal book
      panel-fit translate+scale, a warmed Page style close produced a 320ms
      rAF gap and 1,074ms landing hold; the identical run with only that
      transform disabled measured 23ms and 145ms. Visibility stayed `visible`
      and fonts stayed `loaded`. The report was found only under headless
      SwiftShader, while the owner had already said the web-server app did not
      show the turn symptoms. Changing the real panel-fit behavior to appease
      software rendering would reintroduce the actual covered-book defect, so
      no production code changed. Evidence lives under
      `qa/demo-freeze-{cause,no-panels,page-style-warm,no-panel-fit}/`.

      *(found while trying to reproduce the three symptoms — none of which
      reproduced at the time, and this appeared to)*

      Measured at 1360x850, the demo's own viewport, driving the demo's own
      sequence. A turn is designed to take 450ms and measures 436-518ms. The
      first turn after a rail panel is closed:

          frozen at p=0.89 for 1,154ms   (beginFlip → land: 1,720ms)
          other runs, same turn:          2,523ms and 617ms

      Live that is a page stuck nine tenths of the way over for more than a
      second, which is the worst possible place to stop — the reader is looking
      at a sheet standing on its edge. **It will never appear in the GIF**:
      `capture: 'deterministic'` puts the scene on a virtual clock, so a
      main-thread stall costs zero rendered frames. That is the recorder working
      exactly as designed and it means the recording cannot be used to find
      this class of defect at all.

      A hypothesis to test rather than assume: opening a panel scales the whole
      spread 1 → 0.7691 and closing it scales back, so every cached page bitmap
      is at the wrong scale the moment a panel moves. If closing kicks off a
      re-rasterise of the visible pages, the next `beginFlip` is contending with
      it for the main thread. That would explain why it is the FIRST turn after
      a close and not the second.

      Related and smaller, same measurement: **every turn ends with a 135-191ms
      hold at p=1** while the raster→DOM swap runs. Consistent, all seven turns.
      Worth knowing whether that is the swap costing 140ms or a timer waiting
      140ms for it.

- [ ] **THE THREE PAGE-TURN SYMPTOMS DO NOT REPRODUCE IN THE APP.** *(now
      MEASURED, not merely reported — see below; and the third one has an
      explanation that is not a bug)*

      Driven at the demo's own viewport with the demo's own sequence, per
      animation frame, with each check's gate watched failing first:

        - **Skipping.** 7 turns × 2 runs, ~600 frames. Every commit moved
          exactly +1 spread; page count constant at 32; one
          beginFlip/settle/land per press, never overlapping. Gate: a TOC jump
          across two spreads turns it red.
        - **Future pages.** The three faces `beginFlip` actually uploaded
          textures for, compared against the faces named on every later frame:
          **0 divergent frames of 176 mid-curl**. All 7 turns took the WebGL
          curl. Gate: clearing the cache after upload flags 12 frames.
          Structural bonus — with a cold cache the app REFUSES to curl and takes
          the rigid fold, so "curl onto blank paper" is unreachable by that
          route.
        - **The right page's foot emptying when a panel opens.** 30 panel
          slides, 2,400+ frames, per-block presence/height/clip/hit-test: 0
          lost, 0 clipped, 0 zero-height, stored text identical. Gate: a
          `clip-path` on the leaf reports 4-20 blocks lost — and it was INERT
          TWICE before it worked (a 90px clip that never reached the words, then
          a hit test counting an ancestor as a hit). Trusted only once the
          picture and the number agreed.

      **What the third one actually is.** Opening a panel scales the spread
      1 → 0.7691 over ~280ms about a centre origin on a 743px stage, so the
      page's bottom edge travels **~86px up the screen**. Nothing is lost; the
      words get 23% smaller and the foot moves up. Across ~4 GIF frames that
      reads exactly as "the bottom content disappeared".

      **And why the recording reads as broken at all.** A measured curl is
      436-518ms; the GIF is 14fps at speed 1.1 = 78.6ms of scene time per
      frame, so a whole turn is **~6 output frames, of which ~4 show the sheet
      at an angle** — against 26-30 frames live. Then `ctx.advance(1900)` holds
      a motionless spread for the other ~18. A turn that is four frames of
      motion inside twenty-four is not a turn a viewer can read.

      Two things learned that cost a run each, kept so they do not again:

        - **`page.screenshot()` returns blank cream paper on this app in
          headless Chromium.** A probe using it on the spread will manufacture a
          "blank page" defect that is not there. Use a CDP screencast.
        - **A Vite hot update tearing the view down mid-curl looks exactly like
          the bug.** One run reported `spread 0 → -1 → 0` with the flip frozen
          at p=0.82 and the stage absent for 250ms — that was another agent
          saving a file. Any probe measuring this app on a shared dev server
          must detect HMR and reloads and say it saw none.
      > "I didn't notice any of the bugs I mentioned in the gif's video when I
      > was testing in the web server."

      That is decisive and it redirects the whole investigation. Skipping pages,
      future pages showing, and the foot of the right page emptying were all
      seen ONLY in the recording. So the prime suspect is the RECORDING
      PIPELINE, not `src/flip/`:

        - frames dropped or mis-paced by the deterministic capture;
        - the loop trim splicing a frame from elsewhere in the timeline — "a
          future page showing" is exactly what a bad seam looks like;
        - GIF palette/dither quantisation making a half-drawn frame read as
          different content.

      The temporal detector being built is still exactly the right tool — it
      just has a different subject. Point it at the pipeline first: compare the
      captured PNG frames against the encoded output, and the pre-trim sequence
      against the post-trim one. A defect present in the GIF and absent in the
      source frames is gifsmith's; one present in both is the app's.

- [ ] **The demo looks broken during page turns, in three ways.**
      > "The current demo seems to be broken during page turns — it's hard to
      > say what happens. Sometimes it's like pages are skipping during a turn,
      > sometimes it's like future pages showing, sometimes when a panel opens
      > the bottom content on the right page disappears."

- [ ] **The visual harness must detect massive frame-to-frame changes, and it
      should live in gifsmith.**
      > "I think you need to fix whatever visual testing harness you're using,
      > to be able to detect massive visual frame changes or something, to be
      > able to find these kinds of bugs — and ideally add it to gifsmith."

      They are right about the gap and it is structural, not an oversight. The
      review that found 26 defects samples every 7th frame and hands each STILL
      to an agent. Two consequences: at 14fps a 0.5s sample interval steps
      straight over a one-frame flash, and an agent judging a single frame has
      no way to know it differs from its neighbours. Every defect that review
      found was visible in one frame standing alone — a duplicated block, a
      blank shelf, a clipped heading. Nothing it can do would find "the page
      skipped" or "content vanished and came back", because those are
      properties of a SEQUENCE.

      What is needed is temporal: decode consecutive frames, and flag where the
      change between them does not fit the motion around it — a spike against
      both neighbours (a flash or a skipped frame), a region losing its ink and
      regaining it (content disappearing), a jump during a turn larger than the
      turn's own rate of change. Frame numbers out, a contact strip of the
      neighbourhood for a human or an agent to look at.

      It belongs in gifsmith because gifsmith already owns every frame, their
      timestamps and the loop analysis, and because the same defect class ruins
      any scripted demo, not just this one.

### The app bugs the demo exposed

- [x] **Make the Welcome book behave like any other book.** DONE, and in the
      order the ruling implies: the flowing was left alone, the duplication was
      fixed, the reader got the size lever, and only then was the seed re-cut
      so the pages fit the leaf they land on rather than the leaf they were
      written against.  `e095e2a` `9d64c10`

      `PAGE_LINE_BUDGET` is derived from the window now, off two laws measured
      at five sizes — the chrome above and below a leaf is a constant 179px and
      the 32px rule grid does not scale with the frame. Cut for 1280x800, the
      window `tauri.conf.json` opens: 16.41 lines rather than 23.5. Cutting for
      the 960x620 minimum would guarantee nothing ever reflows and would put
      the page ceiling at 52% of the leaf a NEW READER SEES, which is the
      half-empty pages already reported once.

      Seed v7 is the same thirty-two leaves saying the same things in fewer
      words. Every v6 page cost 136% of the leaf it landed on — the tour turned
      into 46 leaves the moment it was opened, which was pagination doing
      exactly its job. The estimator now averages 81% of the default leaf and
      peaks at 85%; live named leaves average 88% and peak at 97%, while the
      same leaves average 65% at 1600x1000.

      Two side effects worth recording. `probe-diagram-scale.mjs` was written
      before assuming a diagram's cost moves with the window: `.nb-dg-svg` is
      `width: 100%`, which SAYS it scales, and being wrong there would have
      gutted three leaves for nothing. And **f778 went with it** (see below) —
      the verifier who rejected the first footnote fix said the real cause was
      an over-full page, and it was.

      *(the owner's ruling on the capacity question — the answer is "stop
      special-casing it")*
      > "Wait, you did need to say something on the book filling thing? Just make
      > it work like any other book — if it's too big it goes to the next page.
      > Or just give the user the option to make it tiny by resizing, perhaps you
      > also use that method in the welcome book. I mean again, we want it to
      > behave like a real book."

      So the page-count growth is NOT the bug and must not be chased: content
      that will not fit flowing onward is what a real book does, and it is the
      contract the whole editor is built on. What was wrong was the DUPLICATION
      on the way (fixed separately), not the flowing.

      What this does turn into is a feature that already exists and is broken —
      see the next item. Giving the reader a size lever is the honest version of
      "make it tiny", and it is what lets a page hold what its author intended
      without anybody guessing a window size.

      Consequence for `PAGE_LINE_BUDGET`: it is still derived at 1600x1000 while
      the app opens at 1280x800, and it should be derived from the window
      constants rather than written beside them. But it is now a QUALITY issue
      (how full a seeded page looks) rather than a correctness one.

- [x] **The "body size" slider does not touch page text at all.** FIXED — the page reads the setting, the rule grid is derived from the type (constant 1.600 leading at every size, all 27 rulings from one line), and 22 lines fit at 15px against 16 at 21px. `PageEditor` now DECLARES `settings.bodyFontSize`: the drain already re-ran, but by accident — three pixels of unrelated chrome moving the leaf box was what notified it, and that would have failed silently as clipped text.

      `src/features/settings/apply.ts:285` writes the reader's choice out as a
      CSS variable, and `src/styles/editor.css:192` sets `.nb-prose` — the page
      text, the thing the row's own hint calls "reading type on every page" — to
      a hardcoded `font-size: 20px`. So the slider moves the UI, the search
      sheet, the transfer panel and the tour, and moves the one surface it
      names not at all.

      Fixing it is what makes the owner's "give the user the option to make it
      tiny by resizing" real. Three things have to move together: the page text
      reads the setting; the RULE GRID scales with it, because a leaf is ruled
      paper and the words have to sit on the rules; and the pagination
      re-measures, so shrinking the type genuinely fits more on a page instead
      of leaving the old fold in place. `CLAUDE.md` forbids handwriting below
      13px and the slider floor is 15px, so the range is already safe.

- [x] **Headings land at the foot of a page, or vanish a second after a turn.** FIXED with the duplication bug — a block duplicated above them was pushing everything down.
      > "If you notice the gif, sometimes the headings are at the bottom of the
      > page or go missing after a second when the page turn happens — like
      > completely wrong. Again not sure if this is a code bug or a GIF
      > rendering bug, so figure it out."

- [x] **A section appears duplicated on the following page.** FIXED. This was the wax-seal page, and it was the drain reading a pre-drain document.
      > "There is some page with a big A in a circle saying 'pressed when soft'
      > something, so there is a bug in the gif where it shows the same section
      > copied on the next page as well. Not sure if it is part of the welcome
      > book, but I don't know."

- [x] **A click lands on one thing and something else responds.**
      > "There is a bug where the mouse clicks on something in the gif but
      > something else happens — for example in the gif, in the studio, it
      > clicks on one theme but another theme is selected."

      DIAGNOSED, and it is not a misdirected click. Fifty-seven agents looked at
      the recording frame by frame; at frame 99 the amber selected marker is on
      **The House Room** while the panel's own subtitle already reads "presets
      gilt salon" and the world is unmistakably the Gilt Salon. Frames 95-99 are
      byte-identical, so the screen holds still for ~350ms with the room painted
      and the wrong card ticked; the stale window is f0089-f0099, ~770ms. At
      f0100 exactly 4500 px change, confined to the two cards' borders and label
      bands, with the world unmoved. The panel's selected state arrives late.

      **Ticked as diagnosed, NOT as re-verified — check it in the re-render.**
      The ring is a CSS class on a card whose `is-active` reads the same signal
      the subtitle does, and the subtitle was already right in that frame, so
      nothing in the panel's own wiring explains a lag. What does explain it is
      a blocked main thread: no frames paint during a stall, so a class that
      changed on time still appears late, and 770ms sits squarely inside the
      ~900ms studio stall `ce4166f` removed (design change 124ms → 0ms of
      blocked main thread). That is the same story as f225, which was ticked
      for the same reason.
      It is a story, though, and the frame that would settle it is in a
      recording that no longer describes this build. When the demo is
      re-rendered, find the moment a preset is chosen and check the ring and the
      subtitle change on the SAME frame. If they do not, this is open again and
      the diagnosis above is wrong.

- [x] **A blank page at the end, and a blank screen on the way back.**
      > "I noticed at the end of the gif it shows a blank page, and also when
      > 'back to shelf' is clicked, for a second it shows just a blank screen."

      Both fixed. The blank SCREEN was `ShelfView` being unmounted for the whole
      time a book was open, so pressing back rebuilt the entire Pixi world —
      3 blank frames and a 236ms window with no room at all, now 0 and never.
      The blank PAGE was measured rather than assumed: all 1397 frames of the
      old recording were decoded and the page area checked for ink against a
      luma threshold that tells page cream (241) from the wall (226), so a shelf
      rebuild could not be miscounted. Zero frames showed a blank page even
      then; what the reader saw was the blank screen at the end of the turn
      sequence, which is the same defect.

- [x] **The page-turn animation is not visible at all, and the flicker remains.**
      > "Page turn animation is not even visible in the gif, along with page
      > flicker that still happens."

      FIXED, and it was the demo pressing a key that does not turn a page.
      `arrowFlipAction(key, isTyping)` returns null when the active element is a
      typing target, and after a book is opened the caret IS in the page — so
      every ArrowRight in the recording was a caret move. Neither the app nor
      the recorder was at fault: `probe-curl-capture.mjs` showed that with the
      editor blurred the flip runs for 17 frames and the CDP screencast catches
      11 of them, with the curl plainly visible in the captured JPEG.

      Measured on both recordings, diffing the RIGHT-HAND PAGE only so a rail
      sheet sliding cannot be mistaken for a turn:

          old   34 page changes, 17 INSTANT CUTS, no curl anywhere
          new   18 page changes,  1 instant cut, 11 ANIMATED runs of 0.36-0.50s

      Frame 694 of the new recording shows the leaf lifted with the next page's
      words through the gap. The instant cuts falling 17 -> 1 is the other half:
      most of them were never turns, they were the duplication rewriting the
      page under the reader.

      (Recorded here after the fact — both entries were lost from this file
      during a bulk edit and restored once the loss was noticed.)

- [x] **The Welcome book's first page teaches two things that contradict each
      other, four lines apart.** **RULED — arrows do not turn pages.**
      > "well we can not make arrow keys turn pages then"

      That is the fourth option below taken: no new keybinding, no "except
      while typing" caveat, no Escape-to-leave. **Arrows do not turn pages and
      nothing in the app or its documentation says they do.** A binding that
      works only in a state the reader is rarely in, and cannot be described
      honestly in one line, is exactly what is being removed — the app's own
      first page proved it by having to teach both.

      What is left to a reader, all of it already there and already true in
      every focus state: drag a page edge, click the drawn curl at the corner
      (`page-curl` and `page-corner` in `src/data/keybindings.ts`), the table of
      contents on Ctrl+Alt+T, the thumbnail strip on Ctrl+Alt+M.

      The surfaces to fix: `arrowFlipAction` in `src/views/spread.ts` and its
      caller in `BookView.tsx`; the `page-turn` house action advertising
      `←  →`; `docs/readme/part-1-users.md` (README is composed from it, never
      edited by hand); any tour step that presses or waits for an arrow — that
      one can STRAND a reader rather than merely mislead them; and the welcome
      page's own bullet, which is the last one because `src/data/seed.ts` is
      being re-cut by another workflow as this is written.

      **DONE, all of it, plus a second binding the survey above missed.**
      `9375f9e` `0521c4c`. A completely independent `window` keydown listener
      inside `src/flip/FlipSurface.tsx` was calling `flipNext`/`flipPrev`
      directly — found not by reading but by the inverted e2e test (below)
      going red against a tree where the first binding was already gone.
      `tests/e2e/pages.spec.ts`'s old passing test is now "arrow keys do not
      turn the page" — inverted rather than deleted, because a removal nothing
      watches is a removal that comes back.

      *(the original entry follows — a product question, the owner's to rule on,
      not a bug to quietly fix)*

      Page 1 of the tour, in order:

          ::: callout {variant=tip}
          Click the ruled lines and type. …
          :::

          - Drag to pan the shelf, scroll to zoom
          - Click a book to bring it forward, again to open
          - Arrow keys turn pages, or drag a corner

      Do the first thing and the last thing stops being true. `arrowFlipAction`
      returns null while the caret sits in a typing target — deliberately, and
      correctly for an editor, because an arrow key belongs to the text before
      it belongs to the book. So a reader who follows the callout, types a word,
      and then presses → gets a caret move and a page that does not turn, within
      the first minute of using the app.

      This surfaced sideways: the demo recording pressed → after opening a book
      and filmed no page turns at all for exactly this reason (fixed there by
      blurring first). The app half of it was written down in `demo-gif.mjs` as
      "a real question about the app, not about this file" and never given an
      entry of its own. It has one now.

      The options, none of them obviously right:

        - **Say it properly on the page** — "click outside the writing, then
          arrow keys turn pages; or drag a corner any time". Cheapest, honest,
          and slightly deflating for line three of the tour.
        - **Escape leaves the page**, and say so. One key, learnable, and it
          gives the reader something to do rather than a caveat.
        - **Turn on → only when the caret is at the very end of the last block**
          (and ← at the very start). This is what a physical book does, it never
          steals a keystroke that had somewhere to go, and it costs a real
          decision about what "the end" means when a page ends in a table.
        - **Leave it and drop the line.** Corners already turn pages and the
          dog-ear is drawn on every leaf.

      Not to be decided by an agent: it changes what the app's own first lesson
      says.

### The duplication fix, and the discipline that caught the first attempt

- [x] **Reading a book duplicated its content.** FIXED, and the fix is the
      SECOND attempt — the first was reverted for losing typed text.

      The mechanism, traced three independent ways and none of them the one I
      proposed: both leaves of a spread mount and drain in ONE synchronous Solid
      flush, but a drain's removal reached the store on a microtask while
      `onOverflow` fired synchronously. So the left leaf's carry read the right
      page's PRE-DRAIN document, put back blocks the right leaf had already
      given away, and `bumpDocVersion` then remounted that leaf so its new
      editor drained the same tail a second time. The first duplicate exists
      with ZERO page turns. The drain now publishes to the store BEFORE handing
      the blocks up.

      **The regression probes were written FIRST and proved to fail against the
      reverted attempt**, so nothing could be declared done against a test that
      never fires. Real output, v1 versus the shipped fix:

          R1  probe-turn-advance.mjs
              v1:  turn 2 jumped spread 1 -> 20 (delta 19) onto an empty left
                   leaf; turns 3-6 dead at spread 20; 32 pages -> 46 on reading
              now: 6 turns, delta 1 each, 0 jumps, 0 blank leaves

          R2  probe-turn-focus.mjs
              v1:  4 of 6 turns ended with document.activeElement on
                   `.tiptap.ProseMirror`, and every ArrowRight after that was
                   swallowed by `isTyping`
              now: 0 presses that did not advance, focus stays on <body>

          R3  probe-typed-persistence.mjs
              v1:  39 of 40 markers stored, 4 runs out of 4 (and on a fifth the
                   view tore itself down at line 25 and FIFTEEN lines never
                   reached storage)
              now: 40 of 40 typed, on screen and in storage, with the caret
                   carried across a spread

      Two caveats the probe author recorded rather than hid: the typing loss is
      sensitive to the gap — at 60ms between lines v1 keeps all 40, so the probe
      types with NO pause so the 400ms save debounce never gets a quiet moment;
      and it reads the stored rows out of the stub DB's localStorage blob rather
      than through `import('/src/data/pages.ts')`, because on an HMR'd dev
      server that import can resolve to a second copy of `db.ts` with its own
      MemoryDb. It also reports INCONCLUSIVE and exits 1 if the caret never
      crossed a spread, so it cannot pass by never asking the question.

### Three more the frame-by-frame review found, which nobody had reported

- [x] **The whole shelf world blanks for half a second when a design is applied.**

      FIXED — and the diagnosis it was handed (a `generateTexture(stage)` render-
      group problem) was WRONG. Disproved against the running app before
      anything was changed:

        - `generateTexture(stage)` called in isolation does not blank the canvas
          — 415 colours before, 415 after, 415 after the next render;
        - suppressing EVERY screen render across a whole preset apply (31 of
          them) and holding for 3s does not blank it either — a blocked main
          thread simply shows the previous frame, which is what it should do.

      The real mechanism, proven with a POSITIVE CONTROL rather than argued:
      hand one live sprite a destroyed texture and render. The render throws
      `TypeError: Cannot read properties of null (reading 'addressModeU')`
      **after** the renderer has already cleared the canvas, and the region
      collapses to 152 colours, 99% of them `233,226,208` — `--wall`, the
      `.shelf-root` background, showing through a transparent canvas. That
      screenshot is indistinguishable from demo frame f0090, and frames
      90/127/280 are 84% that exact colour.

      Which means it was already cured by the fix two entries down: destroying
      every spine texture synchronously at the top of the apply is what handed a
      live sprite a dead texture. Their own comment names it — "Pixi nulls a
      destroyed texture's matrix, which surfaces during render, taking the whole
      stage down for a frame". On the current tree, every `app.render()` across
      three slow and six rapid applies: zero throws, zero blank frames.

      A real defect in the fade was fixed on the way regardless: a second preset
      applied inside the first fade's 0.42s photographed the STILL-DISSOLVING
      first snapshot — a double exposure. Measured at two concurrent fades from
      clicks 150ms apart. The snapshot now hangs in a sibling `overlay` and
      photographs `scene` rather than the stage it is about to be added to, and
      the fade is guarded on `roomChanged` — without which a snapshot taken on a
      no-op notification would hang over the world at full opacity forever.

- [x] **The gate meant to catch the blank world could never fire.**

      `blank = rows.filter(r => r.colours <= 3)` — and two genuinely blank frames
      scored 140 and 152, because the measured rectangle includes the dock and
      zoom pill that survive. Now a proportional threshold against the SETTLED
      frame, plus a `settledColours < 60` failure so a run cannot divide by its
      own blank frame and call itself clean.

      Proved by reproducing the defect rather than by reverting a fix that never
      caused it: `--sabotage` frees the cornice texture under its live sprite
      mid-apply. Sabotaged it reports `minColours 140`, `emptiestRatio 0.164`,
      `GATE ALIVE`, exit 1; clean it reports `emptiestRatio 1`, exit 0, twice.
      One subtlety is commented in place — before the repair existed, EVERY
      frame was blank, so the denominator was blank too, the ratio came out at
      1.0, and the gate declared itself inert while working perfectly.

- [x] **The case repaints in two halves.**

      FIXED, and it was not a cache key — my guess was wrong and the diagnosis
      disproved it with the frames: a stale key cannot heal, and these healed.
      At f136 every part is correct art from the SAME keys that served f130's
      mixture, and f130-f135's old values are byte-identical to f116 — the
      outgoing room's own art still on the sprites.

      The real cause was ordering. `EnvTextures.landPart()` assigned each part
      and fired `onReady` the moment that part's own bake resolved, and
      `art/bake.ts`'s fairness pump releases exactly ONE producer per turn — so
      the four parts landed on four different turns and each repainted alone.
      `bakeCase` now stages all four bitmaps and commits them in ONE synchronous
      block, so no observer can see a mixed set. Measured on the running app:
      `caseSpreadMs` 97/77/20 -> 0, `twoRoomFrames` 4/2/1 -> 0.

      Two amplifiers fixed with it: the pump scheduled its next turn from inside
      the turn callback, so `lastProducerMs` was always one producer stale and a
      4ms plank was charged an idle callback earned by a wallpaper tile baked
      minutes earlier; and `onReady` firing four times in one tick made
      `handleEnvReady` re-stamp every mounted floor to a RenderTexture four
      times back to back.

- [x] **Every book loses its art and becomes a flat rectangle.**

      FIXED. Also not a cache key: the flat slabs are the app's own documented
      placeholder. `floorView.applyTexture` sets `Texture.WHITE` +
      `placeholderTint(...)` whenever `factory.pick()` returns undefined, and
      `SpineFactory.invalidateAll()` destroyed every baked spine texture
      SYNCHRONOUSLY at the top of the apply — before a single new pixel had been
      drawn, and with the atlas keyed by identity (`variant|bookId`) rather than
      by content, so there was nowhere to keep the outgoing pixels.

### The second frame review — 26 confirmed became 2, and 0 regressions

Run against the re-rendered demo, primed with the list of already-fixed defects
so a reappearance would be flagged as a regression rather than a fresh find.
**Zero regressions.** Every fix reached the picture. 2 confirmed, 4 refuted.

- [x] **f337 — "My Library" sliced through its cap height in the studio.**
      NOT AN APP DEFECT, and worth writing down because the review's evidence
      was right while its conclusion was not. It measured the cut precisely — no
      ink at all in the four rows above the line, every glyph starting on the
      same row, a flat top across mixed letterforms — and called it "a hard
      container clip, not typography". It is: `.nb-studio-tabs` is a PINNED
      strip with an opaque background, and covering what scrolls beneath it is
      its job. Reproduced in the live app by scrolling the panel the way the
      demo does, then measured the card unscrolled: 227px tall, thumbnail
      present, nothing squashed.

      What was wrong was the demo's `scrollIntoView({ block: 'center' })`, which
      parked a heading halfway under the strip and held it there for the whole
      time the studio was open. Now `block: 'nearest'`, which moves the least it
      can. The lesson is the general one: a confirmed finding is a confirmed
      OBSERVATION, and the mechanism still has to be traced before it is a bug.

- [x] **f442 — the first page has no ruled lines, on the page that says it has.**
      A REAL defect, and the frame review found it by noticing the left leaf was
      a flat cream field while the right one was ruled. Measured: the left page
      reads 236.33-238.33 with std 0.42 across its whole width — no horizontal
      structure at any pitch — while the right page's rule rows dip 32 levels
      below paper.

      The cause is in the seed, not the renderer. `data/seed.ts` opened page 1
      with `paper: cream`, and `PAPER_TO_PAGE_STYLE` maps `cream` to **blank**.
      So the Welcome book's first page — the first thing every new reader sees —
      was blank paper carrying a callout that reads *"Click anywhere on the
      ruled lines and start typing."* Now `paper: lined`. The two LEGACY page
      sets keep `cream`: they exist to be matched against old libraries during
      migration, and editing them would stop them matching.

### Two latent defects found on the way, neither of them reported

- [x] **A 32-bit hash files the case bakes — and it DOES collide, on colours a
      reader can pick.**

      The 60 authored rooms are fine: all 60 swept through the old
      `fnv1a(schemeKey(…)).toString(36)` gave 0 collisions. But the input space
      is not 60 — `libraryPrefs.composeScheme` folds a READER-TYPED `timberHex`
      through `palette.caseFaces`, so it is millions of schemes wide. Sweeping
      400,000 timber hexes (223,070 distinct schemes) hit **6 collision pairs**.

      The first: timber `#0043a9` (navy) and `#006b82` (teal) both tag
      `9sjds2` — the same plank, recess, post and cornice served to whichever
      room asked for them second. `art/bake.ts`'s header had named this exact
      risk as its reason for keying on full parameter strings, and `textures.ts`
      hashed the key before handing it over, undoing that for nothing.

      Fixed by passing the key through in full. `roomTag` is gone; the four
      bakes call a new pure `caseBakeKey(part, w, h, roomKey)` in
      `libraryKey.ts`, which is also where `FLAT_ART_VERSION` now lives — so the
      whole string a bake is filed under is spelled in the one module a node
      test can load. That was the real defect behind the defect: `themeKeyOf`
      was being proved injective one step away from the string that actually
      reached `bakeCached`. The key is reordered so `params.slice(0, 96)` in the
      profile ring still identifies the part.

      Pinned: the navy/teal pair as a regression asserting the old hash DID
      collide and the new key does not, plus a 156,000-key sweep
      (60 schemes x 52 builds x 50 patterns).

- [x] **`bookDesignTag()` is dead as a cache key, and a test guards it anyway.**

      Verdict: the binding IS covered, but not for the reason the three comments
      gave — **the spine caches are invalidation-keyed, not content-keyed.**
      Established by driving the running app and diffing screenshot crops rather
      than by reading: pinning `plain-cloth` moved 11.6% of the crop, pinning
      `full-morocco` another 8.9%, unpinning restored the seeded binding with
      **0 differing pixels**, and re-pinning gave 0 again — a real cache hit, not
      an absent cache.

      The decisive case is the one `pinnedPresetId` cannot carry: with the
      factory epoch observed at 1 before and after and the binding held at
      `plain-cloth`, a `__shelfSetBookStyle` edit still repainted **14.7%** of
      the crop. Neither key component moved, so the mechanism is
      `SpineFactory.invalidate` destroying the texture — not a key.

      `bookDesignTag` is kept and its purpose written down: it is the tests'
      observable for "are these two resolved bindings different pixels", which
      is the only way to show 50 shapes x 50 coverings x 189 presets are
      genuinely distinct — a specimen board shows one binding and can never show
      that two differ. Four comment sites and the design-doc table corrected.

      The fake coverage was replaced with a real gap it exposed: nothing tested
      `ownBindingId`, which IS load-bearing for a key — the composed
      `own:shape/material/decoration/gilt` id is the params cache's whole view of
      a hand-composed binding, so two agreeing on an id would share one
      `ResolvedBookStyle`. Now a round-trip, a 255,000-combination injectivity
      sweep, and a no-collision-with-preset-ids check.

### Twelve more the frame review confirmed, none of them reported by hand

Each was raised by an agent looking at a contact sheet, then confirmed by a
second agent pulling the full-size frame and trying to refute it. 26 findings
were confirmed and 18 refuted. Frames are on disk under `qa/demo/frames/`.

- [x] **f421 — "opening the book…" holds a bare cream window for 1.2 seconds.**
      17 straight frames of an empty screen with one caption on it. The Suspense
      fallback in `App.tsx` was added to stop a genuinely blank gap; it is now
      the gap. And at f428 the synthetic cursor parks on the caption and covers
      a word, so the only text on screen reads "openin  the book…".

- [x] **f629 — a diagram vanishes into its own placeholder just before a turn.**
      The hand-drawn tree on the right page is replaced by an empty dashed
      rectangle as the page turns.

- [x] **f617 — a key cap breaks across a line.** FIXED with `display: inline-block` rather than `nowrap`, so an over-long cap becomes a two-line pill instead of running off a page that has no scrollbar. A 59-character unbreakable token overflowed the column by 168px before; contained now. "Ctrl Alt N" renders as two
      half-open pills. A key cap is a single object and must not wrap.

- [x] **f778 — a footnote collides with a callout.** GONE, and by the route the
      verifier named rather than the one the first attempt took: the fullness
      was fixed (seed v7 + a window-derived budget) and the footnote came with
      it. Measured at both windows with `scripts/probe-footnote-overprint.mjs`
      — three rails, every one with the foot to itself, at 1280x800 and at
      1600x1000. Then looked at.

      **And the gate was watched failing first.** `--sabotage` blanks the rail
      out of the prose's padding-bottom, which is the reader's own defect, and
      the probe reports OVERPRINT on 2 of 3 rails with the offending paragraph
      and its overshoot in pixels. A probe that only ever prints CLEAR proves
      nothing about the app and everything about itself.

      *(a fix was attempted and REJECTED by the verifier; the real cause is an
      over-full page)*

      The footnote at the foot of the left page is overprinted by "The seven
      washes" card and its wash. The first attempt changed the page splitter and
      reported itself fixed; an independent agent refused it, two ways:

        - **Code path.** `splitBlocksIntoPages` has exactly one caller in `src/`
          — `features/templates/createFromScript.ts`, which is Markdown import
          and the templates gallery. The Welcome book is built by
          `buildWelcomePageDocs` in `data/seed.ts`, one source string to one
          page, with no estimator anywhere. The book in that frame never goes
          through the splitter, so a splitter change cannot be its fix.
        - **A/B on the running app.** With `split.ts` restored to HEAD the leaf
          renders identically — same layout, same spacing. The overlap measured
          24px with the change and 26px without it.

      What that verifier measured instead is the real story, and it is the
      capacity thread again: leaves at rest holding 16, 25, 27 and 33 top-level
      blocks with last-block bottoms at 1631, 2725, 3117 and 4421px against a
      772px page. A footnote cannot sit at the foot of a page whose content is
      five times the paper. Fix the fullness and this goes with it.

- [x] **f869 — the way back becomes invisible while a panel is open.** Reduced to
      a pale grey arrow with no label and no outline, against the Table of
      contents sheet. It is supposed to recede, not disappear.

- [x] **f1198 — a postcard's message overflows its own card**, the last line cut
      through by the card's bottom border; and a picture caption beside it is cut
      off mid-word.

- [x] **f225 — the studio panel draws its thumbnails in the wrong place.**

      GONE on the current tree, and it was almost certainly never a layout bug.
      Re-checked by driving the running app, scrolling the panel to the section
      the frame showed empty, and counting: **51 tile canvases, 0 blank** — then
      looking at the screenshot, where "how it is built" carries eight filled
      thumbnails and a "44 more…" tile, all inside their own cards.

      What f225 caught was the frame budget in `designArt.tsx` meeting a blocked
      main thread. A card that misses its cache is painted on the first frame
      with room in it — and the studio open was stalling for ~900ms with no
      frames at all, so the queue could not drain and the cards sat empty for as
      long as the stall lasted. Fixing the stalls fixed the symptom.

- [x] **f295 — a floor draws one hairline sliver of a book** while the floor
      above is half-populated with featureless blocks.

      REPRODUCED and REFUTED. Re-checked against the running app rather than a
      recording, because the app can be asked what width a book is SUPPOSED to
      be — `scripts/probe-sliver.mjs`, which walks the shelf and compares three
      numbers per book: `BookStyle.thickness` (the store), `visual.w` (the row's
      layout) and |scale.x| × `texture.orig.width` (the pixels Pixi rasterizes).

        - **The sliver is a book at its true width.** Narrowest drawn/expected
          ratio over 7,239 sampled frames — twelve zooms, both LOD boundaries
          and their hysteresis bands, live wheel zooms through both, panning, a
          bookcase switch, three room applies — is **1.0000**, and 263
          store-to-pixel comparisons across five camera stops disagree **zero**
          times. What a sliver actually is: `SPINE_THICKNESS_RANGE.min` is 8
          world px and the pamphlet class (8–13px) is 9% of every shelf, which
          is the art direction's own "a 7px pamphlet standing next to a 54px
          atlas". Eight world px is 6.4 screen px at the demo's 80%, 4.0 at
          50%, 1.7 at 19%. A floor holding one pamphlet draws one hairline, and
          a 6× crop shows a complete spine in it — two gilt bands, ink outline,
          taper.
        - **No floor ever draws fewer books than it holds.** Zero shortfall
          frames; a floor is fully populated on the frame it mounts (toData 0ms,
          toFirstSprite 0ms, toFull 0ms). No book overhangs a rail either.
        - **Both gates were watched failing.** `--sabotage` narrows one live
          sprite to 5% and pops half of another floor's visuals: the probe
          reports 1.15px against an expected 23px and 83 shortfall frames, and
          prints WIDTH GATE ALIVE / POPULATION GATE ALIVE. The sabotaged frame
          also shows what a REAL sliver looks like, and it is indistinguishable
          by eye from the legitimate pamphlet — which is the whole reason this
          had to be settled by arithmetic.
        - **The featureless blocks are the cold start, and only the cold
          start.** Warm: zero placeholder frames across 725 frames of panning
          and 871 of wheel-zooming — a floor re-entering the window mounts
          already textured. A room preset apply flashes 31–65ms per book (1–4
          frames) under the 0.42s theme-fade photograph, and an A/B says the
          retirement generation is holding: colour-only 0 flashes, wallpaper-only
          0, one carpentry direction 52 at 16–33ms. A bookcase switch is 15–81ms
          (the other case's spines are evicted from the atlas). But on a page
          load the whole shelf stands as flat tinted blocks for **173ms to 3.2s**
          across nine measurements — a wall, not a ramp, everything flipping
          within ~90ms of everything else, because the queue goes out in one
          batch to a three-worker pool. Never permanent: nothing was ever left
          untextured. (Headless SwiftShader on a machine shared with three other
          agents, so the seconds are an upper bound; the honest number wants a
          Tauri-window measurement.)
        - **The frame itself is gone.** `demo.gif` was re-rendered and is 1177
          frames, not the 1397 the finding was named against, so the numbering
          has moved; the current f0295 is the Library studio open over a shelf
          of properly bound spines. A featureless-block detector (validated at
          0.051 for a known placeholder shelf against 0.235 settled, after two
          earlier versions were thrown out as inert) ranks nothing in the new
          recording as featureless except the pulled-out book cover and the
          saturated studio rooms.
        - **Why it looked like a defect.** Put the reproduction through the
          recording's own 900×562 and 256-colour palette and a correctly drawn
          shelf reads exactly as reported: one hairline on the lower floor, and
          four books above it whose label plates and bands the palette flattens
          into featureless blocks.

- [x] **Nine tests were proven unable to fail.** *(the sharpened version of "most
      testing we do now is useless" — asked as "which tests CANNOT fail?" and
      answered by mutating the code they claim to guard)*

      15 source files mutated across 15 different \`src/\` files: nine tests stayed
      green against a real, re-committed defect; five went red and are therefore
      earning their place; one was green but guards unreachable defensive code.
      A sample of 87 files, not a census.

      **The worst is `art-themes.test.ts:513`, and it is the only finding where
      the entire 2,745-test suite went green on a live defect.** It proves the
      flat scheme's cache tag is injective over the 60 authored schemes — all 60
      differ in case colours, so an axis dropped from the tag is invisible. With
      `...scheme.cloths.flat()` removed from `tagOf`, a scheme and the same
      scheme with its cloths reordered both tag `49800n`. That is exactly the
      failure CLAUDE.md singles out: a cache validates nothing about a hit, so a
      key missing an axis serves the wrong art to everyone who already has the
      right art under that key.

      The others, each with the mutation that fooled it:

        - `catalogue-reach.test.ts:41/:54` — `catalogueEffects()` is
          `EFFECT_AXES.flatMap(...)` in the test file, so it asks whether
          `EFFECT_AXES` is in a set built from `EFFECT_AXES`. The panel it names
          is never read. Re-committing the original bug (5 values per axis
          instead of 50) leaves 17/17 green, plus 223 tests in four other files.
        - `tutorial.test.ts:402` (+ :419, :433, :455) — extracts numerals with
          `/-?\d+(\.\d+)?/g` then asserts each is finite. The regex can only
          match well-formed numerals, and `NaN` produces no match at all: the
          one case the docblock says it guards is the one case it cannot see.
          A `NaN` control point makes every tutorial arrow disappear, green.
        - `panel-keys.test.ts:91` — greps un-comment-stripped source for
          `usePanelKeys(`, so a docblock mention satisfies every dialog in the
          file. Replacing the real call with `void 0` stays green.
        - `stationery-drawn.test.ts:232` — an `||` chain ending in a clause that
          matches every entry's `id`, so the three meaningful clauses are
          unreachable. `/postcard` inserting a plain paragraph: 93/93 green.
        - `packaging.test.ts:266` — named "nothing has started depending on
          Tauri's drag-drop event instead", asserts only that a file CONTAINS
          `handleDrop`, never the absence. Killing image drop entirely: green.
        - `tooltip.test.ts:41` — expected offsets built by calling the function
          under test, so `GAP` is unpinned. 11 → 40: whole file green.
        - `sound-sets.test.ts:735` — a >500/<=1500 window on `PREVIEW_MS` and
          the function never called. Dropping the last beat takes it to 620:
          green.
        - `roll-gates.test.ts:104` — `toMatch(/WALLPAPER_PRESETS/)` over a file
          the picker list does not live in. (Covered elsewhere:
          `design-cache-keys.test.ts:335` DOES catch it.)
        - Four more that read no product file at all, so no mutation can exist:
          two in `plugged-in.test.ts` (one over a literally empty exemption map,
          one arithmetically unfalsifiable), `tooltips.test.ts:86` — the file's
          OWN anti-vacuity guard, which re-types its regex and tests it against
          a literal instead of asserting the sweep found any files — and a
          `expect(2.5 / 2.5).toBe(1)`.

      **The shape, and it is not laziness.** Both patterns are a test written
      where the product could not be imported: the MIRROR reimplements the one
      construction step and asserts it against its own inputs; the TOKEN GREP
      asserts a file contains an identifier, which proves the wiring was once
      written and not that it still does anything. The fixes are known —
      `shelf-headroom.test.ts` and `stationery-drawn.test.ts` already read
      modules as source and assert their shape, and `design-cache-keys.test.ts`
      already tests a key differentially and went RED under mutation.

      **DONE — all nine, `1ea6835`.** Each watched red against the exact
      mutation that fooled the old version, then green on revert. The
      cache-tag fix also gained a dedicated case for cloth REORDERING (same
      hexes, different arrangement, different shelf) — the actual shape of
      the audit's collision, which a per-field nudge alone cannot catch.

- [x] **Replace most of the test suite with AI-in-the-loop visual verification.**
      > "I want there to be some sort of AI (you) in the loop testing where you
      > check each part of the gif to verify and find these issues. Most testing
      > we do now is useless in fact and can be removed. What is important is
      > for you to visually verify the UI and visuals of the things as you do
      > it, and for that to be the testing mechanism instead."

      BUILT, and it is now the documented mechanism in CLAUDE.md's Verify
      section. `scripts/demo-sheets.mjs` tiles a recording into numbered 4x4
      boards and prints the frame number of every tile; `--frame=NNNN` and
      `--range=A-B` pull frames back at full size. One agent per board, told to
      LOOK rather than reason; a second agent pulls each named frame and tries
      to REFUTE it.

      First run over 1397 frames: **26 confirmed, 18 refuted.** It found content
      duplicating on read, the shelf blanking for half a second, a case
      repainting in two halves, every book losing its art, a key cap breaking
      across a line, a footnote overprinted by a callout — none of which the
      2729 unit tests could see, and most of which nobody had reported.

      NOT ticked as "remove the rest of the suite", and deliberately: those 2729
      tests caught real regressions this same week, including the README facts
      drifting and the pagination contract. What was actually wrong was that
      nothing looked at the pixels. Both now exist. The one lesson worth
      carrying is written beside it in CLAUDE.md — **a gate nobody has watched
      fail is not a gate** — because two of this week's checks were inert: a
      blank-frame threshold that could never fire, and a CLI test that called
      the parser instead of the binary.

- [x] **Delegate to agents and review their work.** This is how the work has run
      since it was asked for, and it is worth writing down what the review
      layer actually caught, because the answer is "enough to justify itself
      several times over":

        - a duplication fix that took the measurement to zero and **lost typed
          text** — 22 lines typed, 10 stored. Reverted, and redone with its
          regression probes written first and proved to fail against the
          discarded attempt.
        - a diagnosis of mine ("two writers on one row") rejected by three
          independent agents, correctly.
        - "the repaint is a stale cache key" — disproved in one sentence: *a
          stale key cannot heal, and these healed.*
        - an attack agent that commented the pagination fix out for an A/B,
          wrote "restored immediately after the run", and never restored it.
        - an agent that ran `git stash push -- src` and swept up another
          agent's in-flight `BookView.tsx`.
        - a probe gate that scored 140/152 on genuinely blank frames, because
          `colours <= 3` is not a blankness test.
        - a CLI test that asserted a broken product — it called the parser
          directly while the binary still printed the old error.

      The last four are the argument for the practice rather than against it:
      every one is a thing a single writer would have shipped, and each was
      found by somebody whose only job was to disbelieve. The rule that came
      out of it is now in CLAUDE.md — **a gate nobody has watched fail is not a
      gate** — along with its corollary, that a confirmed finding is a
      confirmed OBSERVATION and the mechanism still has to be traced before it
      is a bug.

      > "Maybe you focus on dedicating tasks to AI agents and reviewing their
      > work as an extra measure."

### Shipping

- [x] **The release page's own tagline still gets the naming backwards.** FIXED,
      and the hunch at the foot of this entry was right — there were three more,
      all of them outside the sweep's reach and all of them read by somebody who
      is not in the repo: `brand.json`'s tagline (the source every other surface
      is checked against), the Cargo description that becomes the Windows
      executable's metadata, and the NSIS welcome page — the first sentence
      anybody installing the app reads, on a dialog, before the app exists.
      `2887d32`

      HANDOFF.md went in the same pass, deleted rather than corrected: it was
      written for the private `AkshitIreddy/notebook` repo at 48 commits and
      1,026 tests, and every line is done or reversed — the 118-second startup
      freeze, "there is currently no way to create a book anywhere in the app",
      eleven failing tests, and a page and a half of art direction for the
      painterly pipeline `RESET-render-architecture.md` deleted. That last part
      is why it could not simply be left alone.

      `scripts/release-notes.mjs:112` printed
      **"A hand-drawn bookshelf that opens into real pages."** on every GitHub
      Release. Under the owner's ruling that is inside out: the BOOKSHELF is the
      flat half and the PAGES are the hand-drawn one. It should read something
      like *"A flat-drawn bookshelf that opens into hand-drawn pages."*

      The naming sweep changed 16 occurrences and left 118 that were accurate,
      but it was scoped to `README.md`, `docs/` and `src/` — it never looked in
      `scripts/`, so the one line that goes out on the release page itself was
      the one it could not see. Worth checking the rest of `scripts/` and
      `.github/` for the same reason.

      Not fixed yet only because the file is being edited by the release audit
      as this is written; a second writer would lose that work.

- [ ] **Nothing checks an ordinary commit.** *(the owner's call — it spends
      their Actions minutes)*

      `.github/workflows/` holds exactly one file, `release.yml`, and it runs on
      a tag. There is no push workflow and no pull-request workflow, so every
      gate this repository has — typecheck, the retained fast and release logic
      gates, `spec:check`, `readme:check`, the icon container check — fires for the first time when a
      release is already being cut. Everything in between is gated by whoever
      remembers to run it.

      That is how a failing Rust test survived: `cargo test` was in no workflow
      at all, and the Verify list in CLAUDE.md said `check`, which compiles
      without running anything. It has been added to the Windows build job as a
      stopgap, but that still fires at tag time.

      The fix is a `ci.yml` on push and PR that runs the Gates job's contents.
      It is not free — every push spends minutes — so it is the owner's
      decision, not a thing to switch on for them. Options if the cost matters:
      run it only on `main`, or only on paths that can break it (`src/**`,
      `src-tauri/**`, `tests/**`).

- [ ] **Rewrite the history and force-push.** *(authorized — "on online as
      well"; rehearsed on a throwaway clone, fixed, now GO)*

      **The rehearsal came back NO-GO first, and that is the whole value of it.**
      Everything mechanical was sound — 261 commits in, 261 out, none emptied;
      both tags remapped and byte-identical; `refs/stash` rewritten and still
      reachable; all 75 SHA references in TODO.md verified commit-for-commit
      against the originals, with the verifier itself sabotaged first because
      its first version silently matched nothing (`grep -P` refusing the
      locale) and would have "passed" while asserting nothing.

      What it caught was the RULES. They reached 26 files tracked at HEAD —
      eighteen QA drivers under `qa/verify/`, the kept discarded duplication
      fix under `qa/wip/`, four capture scripts inside `shots-now/hero/`, three
      run reports — five of them cited by name from live source, all of them
      0.52 MB of the 1,101 MB saved. filter-repo re-checks-out, so they would
      have left the disk too. Fixed in `4498c87`, and the promise is now an
      enforced invariant rather than a paragraph: nothing tracked at HEAD may
      be matched by a removal rule, checked in both modes, watched failing.

      1,406.6 MB → 317.9 MB. Three more facts from the rehearsal worth having
      before the real run:

        - **`git gc` afterwards is pointless** — filter-repo already repacks
          and prunes. An aggressive gc took 71 seconds and moved 228M to 228M.
        - **The reflog is wiped**, so the bundle really is the only undo. It is
          written beside the repository now, not into gitignored `qa/tmp/`.
        - **A tag checkout no longer reproduces its released tree** — v0.2.0
          loses 1,174 paths and v0.3.0 loses 1,531, all of them capture output.
          Both still build. Worth knowing before somebody diffs a tag against
          a downloaded source archive and finds them different. **Do this LAST, after the 0.4.0 content is final and before the
      tag**, because a rewrite moves every SHA and a tag placed first would be
      left pointing at a commit that no longer exists.

      The clean pass untracked and deleted 469 MB + 88 MB from the WORKING TREE
      and said so at the time: *it does not shrink a clone, git still holds
      every old copy.* It holds 1.4 GB of them. Measured by summing every blob
      in `--all` by its top two path segments:

        qa/**            ~685 MB   capture leftovers, refutation scratch,
                                   comparison boards, every one of them the
                                   output of a run that has already been read
        shots-now/**     ~223 MB   room-rank, roster, hero, dice — same
        assets/generated  ~89 MB   the painterly pipeline's baked output
        assets/photoreal  ~23 MB   its source material, deleted with it
        assets/scenes     ~17 MB
        assets/cutouts    ~16 MB

      That is a gigabyte of a 1.4 GB repository, and **every path above is
      already absent from the working tree or gitignored** — the four `assets/`
      directories do not exist at all. Nobody loses anything they can currently
      open.

      Three things must survive, and the filter has to be written to spare them
      rather than to catch everything with the same prefix:

        - `qa/baseline/**` — the LIVE visual-regression pictures. 22.7 MB, 65
          tracked files, and `npm run visual` compares against them.
        - `shots-now/*.mjs` — the capture scripts themselves. Only the
          capture-output subdirectories go.
        - `docs/readme/img/**` and `public/sounds/**` — shipped.

      Two costs to accept out loud rather than discover:

        - **Every commit SHA in this file and in `docs/readme/releases.md`
          becomes wrong.** `git filter-repo` writes a commit map; remap them
          from it in one pass and commit that before tagging. There are enough
          of them that doing it by hand would miss some.
        - **Anyone holding a clone must re-clone.** For a repo whose only
          remote copy is the owner's, that is nobody.

- [x] **Re-capture all 24 README shots, once, after the app settles.** A run
      against 0.4 died at the book-studio shot — `openRailPanel` waited 120s for
      "Customize this book" on a dev server that three workflows were editing
      underneath it. Seven shots had been rewritten by then, so the partial set
      was REVERTED rather than left half-updated: the whole point of one capture
      script is that the pictures cannot drift apart, and a set where seven
      frames show a ruled first page and sixteen do not is exactly that drift.

      Before the recapture, the former `tests/readme.test.ts` gate failed on the shot manifest,
      correctly: it recorded app 0.3.0 against a tree that said 0.4.0. The
      freshness and Welcome-prose gates are green on the real 0.4.0 set now.

      The quiet-tree rerun confirmed the rail-button failure was HMR
      contamination: book studio and every other step passed first time.

      The script survives a dead run now (`b5c3828`): staging directory, atomic
      commit of the whole set, two retries per step behind a reload. **Do one
      `--only=hero` run FIRST and read the manifest before the full run** — it
      is the one path in that change not yet watched working, and what it must
      show is the version left at whatever the previous manifest said, with
      `PARTIAL RUN` printed. If it stamps 0.4.0 onto a set of 0.3.0 pictures,
      the fix is wrong and the alarm is off for all twenty-four.

      **Then re-read the alt text against the new pictures, one by one.** The 24
      alt strings are hand-written and long — `img/spread.png` alone quotes a
      green callout, a three-item list, a tan card headed "Thirty-two leaves,
      and every one of them a demonstration" and a green banner reading "So:
      turn the page". Seed v7 kept all thirty-two leaves and all their subjects
      but says them **in fewer words**, and dropped the second card from the
      pages that carried two. So some of those quotations are now describing
      sentences that no longer exist, on a picture where they are not.

      That is worse than a stale picture, because it is invisible: the image
      renders, the page reads fine, and the only person it lies to is somebody
      using a screen reader — who gets a confident, detailed account of a page
      that is not the one in the file. Nothing gates it. The shots at risk are
      the ones showing welcome-book prose: `spread`, `page-turn`, `diagrams`,
      `focus`, `rail`, `slash`, and the page count in `transfer` (still 32, but
      check).

      Completed 2026-08-06 from clean `718d14c`: the sabotage failed three
      times and printed `NOTHING WAS COMMITTED`; the partial hero preserved
      the old 0.3.0 set identity; the full run promoted 25 files only after all
      24 shots passed first time and stamped 0.4.0 with `dirty: false`.
      Original-resolution review found and corrected six stale alts (zoomed
      floor count, quick-switch order, focus chrome, both diagram pages, the
      occupied shelf behind Sound settings, and the two-book parcel totals).

- [x] **Re-render the demo ONE more time, last.** The shipped `demo.webp` was
      rendered before two changes that are visible in it: the Welcome book's
      first page became ruled paper, and the studio scroll moved from
      `block: 'center'` to `'nearest'` (which is what sliced "My Library" under
      the pinned tab row). It must also wait for the page-budget work, because
      if that changes how the book paginates it changes the turn sequence the
      demo walks. Render once at the end. The owner explicitly waived manual
      frame review for the final run; keep Gifsmith's optional temporal report
      as triage evidence and update the README demo alt instead.

      Note for whoever does it: `demo.gif` is gitignored deliberately — 12 MB
      against the WebP's 6.5 MB, and GitHub renders animated WebP inline, so the
      GIF is a local artefact and only `demo.webp` ships.

      **Completed 2026-08-09:** 105.21s, 1,596 captured/paced frames, 1,473
      loop frames, 9,054,084 bytes, seam MSE 0.059027777777777776. The owner
      waived manual visual review; optional temporal review reported 20 triage
      findings. The final storyboard has no missing selector and restores the
      authored House Room for the seam.

- [x] **Release this batch as 0.5.0.**
      Version 0.4.0 is already published; on 2026-08-09 the owner explicitly
      chose and authorized 0.5.0 for the current feature batch. The active
      sequence is: finish the local gates, commit the remaining scoped changes,
      push `main`, create and push annotated tag `v0.5.0`, wait for the complete
      GitHub build/release matrix, verify every release asset and updater
      metadata, then record the published state here and in `HANDOFF.md`.

      The quoted 0.4 request and numbered checklist below are retained as the
      history of the previous release process. They are not instructions for
      moving or recreating the already-published `v0.4.0` tag.

      **Completed 2026-08-09:** [Alcove v0.5.0](https://github.com/AkshitIreddy/Alcove/releases/tag/v0.5.0)
      is live and GitHub marks it Latest. Release run `31303803710` passed; 13
      assets include online/offline Windows setup, MSI, universal DMG, macOS
      updater tarball, DEB, RPM, AppImage, signatures, `latest.json` and
      `SHA256SUMS.txt`. The signed manifest declares version 0.5.0 for
      `windows-x86_64`, `linux-x86_64`, `darwin-aarch64` and
      `darwin-x86_64`.
      > "Once you finish all this, btw, you can call it 0.4 — do this at the end
      > once all is done."

      The version itself is already bumped in all six places (`c77a35c`) and
      `tests/version.test.ts` pins them to each other, so what is left is
      ORDER, and the order matters more than any single step:

      1. **Everything that changes a pixel lands first.** The flip's late
         gutter, the seed's second cut, whatever the sliver and turn
         investigations turn into. A picture taken before this is a picture that
         has to be taken again.
      2. **`npm run visual`**, full matrix, and read the failures. This is the
         only sweep that looks at surfaces the README does not photograph, and
         seed v7 changes two of them legitimately — so expect real diffs and
         judge them rather than running `--update` at the first red.
         **First run `--sabotage --only=desk-day-shelf` on the quiet tree.** It
         has not yet been watched failing: the one attempt came back GATE INERT
         from a run the dev server reloaded twice under five agents, which is
         now reported as INCONCLUSIVE instead (`162cbf8`). A gate nobody has
         watched fail is not a gate, and this one fails quietly — a broken
         `settle()` would take surfaces out of coverage and make the summary
         GREENER.

         **Done 2026-08-06.** The sabotage produced 71/71 distinct frames,
         19,200 changed pixels per sampled pair, and `GATE ALIVE`. The clean
         matrix then reached 63/64 exact; its only residual was the bounded
         back-tab linger on `desk-day-tour-blocks`. The surface now waits for
         its declared receded state and repeated at 0px twice. Shelf art uses
         one off-thread worker so arrival-allocated atlas mip phases are stable,
         and the gate asserts every mounted tier-0 spine is the finished hi-res
         texture. Curl readiness now requires fresh/idle cache entries plus a
         quiescent ahead-page carry token, not mere bitmap presence.
      3. **Re-capture the 24 shots** — one `--only=hero` run first to watch the
         partial-manifest guard work, then one full run, then re-read every alt
         string against the new picture. The README integrity gate goes green here
         and not before.
      4. **`npm run readme:build`**, because the counts move every time an agent
         adds a probe, and they have moved a dozen times today. **Then re-read
         the 0.4.0 section of `releases.md` against the constants as they
         finally are.** It states arithmetic — "25.66 lines against 19.41", "a
         592px column against 434px", "136% of the leaf", "84% of the leaf now"
         — and those were true of the FIRST cut. The budget was refined again
         afterwards (the estimator's slack is a function of the column now, so
         the target budget moved), and the seed was re-cut against it. Nothing
         gates prose. Recompute the four numbers and fix them, or the release
         page ships confident arithmetic about a build that does something else.

         **Done 2026-08-06.** The pure current constants reproduce 25.65625 vs
         19.40625 leaf lines and 592.16px vs 434.16px columns. The two-point
         slack fit makes the default budget 16.4058 lines, not the stale 17.2.
         Across all 32 seed sources the estimator averages 80.8% and peaks at
         84.5%; the running default-window probe's named leaves average 87.9%
         and peak at 96.6%. The minimum budget is 10.0243 lines, 51.7% of the
         default leaf. Release prose and calibration comments now say those
         quantities explicitly.
      5. **Re-render the demo. Last, and once.** Then review it: the two
         over-full moments (f0705, f0857 in the old recording), the preset click
         where the ring lagged the room, and every turn's landing.
      6. **The history rewrite, then the tag.** `scripts/shrink-history.mjs`,
         then `--remap`, then the force-push of `main` AND `--tags`, and only
         then `git tag -a v0.4.0`. A tag placed before the rewrite points at a
         commit that stops existing.

      Steps 2-5 all need a dev server nothing else is writing to. That is the
      single scheduling constraint on the whole list, and it is what killed the
      last shot run.

### Naming

- [x] **Say "flat" where it is flat, and "hand-drawn" where it is hand-drawn.** 16 occurrences changed, 118 left alone because they were accurate. CLAUDE.md now states the two registers as a rule.
      > "Btw isn't it kind of weird we call it hand-drawn style when it isn't?
      > Like we say that in the readme description etc etc — should it be
      > flaticon style instead?"

      Half right, and the interesting part is that the CODE already agrees with
      them. `art/flat.ts`, `FLAT`, `flatShelf.ts`, and CLAUDE.md's "the flat
      language" — the docs drifted from the code, not the other way round.

      Looked at both registers side by side before answering. The WORLD is flat
      illustration: the bookcase, the wallpaper, the rail icons, the picture
      block's cat — flat fills, one ink outline, crisp geometry. The PAGE is
      genuinely hand-drawn: wobbled pen lines on every diagram, real handwriting
      faces, cards that bow at the edges, torn tape.

      "Flaticon" was rejected and the reason is worth keeping: it is a
      stock-icon brand, so the association is cheap for something with this much
      drawing in it, and it is also just wrong about the pages.

      Owner's choice: **flat where flat, hand-drawn where hand-drawn.** 129
      occurrences to sweep across README.md, docs/ and src/ comments. The
      headline becomes something like "a flat, hand-drawn room" rather than
      picking one.

### The README

- [x] **Some pictures do not show what the section is about.** The Sound picture shows sound controls, the Diagrams picture shows the diagram chapter, four alt texts rewritten from the images, and two app strings fixed.
      > "The pictures in the readme sometimes are not relevant — like the sound
      > picture does not show sound options and just shows a very long shelf."

## 🔴 Reported 2026-08-05 — toward 0.3, WORK THIS LIST SEQUENTIALLY

The reader asked for these one at a time rather than fanned out: *"this time I
think maybe we should do stuff sequentially instead of parallel so don't use
workflows and work through them one by one"*. Their words are quoted verbatim
under each item (grammar tidied, nothing else), then the task as understood.

### Sound

- [x] **Static during onboarding — a rendering bug, not the recordings.**
      > "During onboarding, for example when I move through each one, sometimes
      > there is a sound effect bug of static. The static sound comes when it
      > auto-moves as well, sometimes — so it's not consistent. It's a sound
      > rendering bug, not a sound source quality problem."
      > "The static sound bug also happens when I am selecting a sound profile
      > during onboarding: when you select a profile it plays sounds in rapid
      > succession, which causes some of them to sound like static."

      NOT the recordings: `scripts/audit-sounds.mjs` measured all 66 and none
      clips, none carries DC, none starts or ends mid-waveform, every ambient
      loop seam is exactly 0. And the reader was explicit that this is a
      rendering fault, not cues mushing together.

      **Four explanations measured and KILLED** (`scripts/probe-sound-clip.mjs`,
      which taps Howler's master in the running app). Written down so nobody
      spends the afternoon on them twice:

      1. *Summing past full scale.* Six auditions stacked reach peak **0.18**.
         Nowhere near clipping.
      2. *A wash of overlapping noise cues.* Spectral flatness at the master
         stays **0.02–0.03** under the same stacking. Not broadband noise.
      3. *The bus being torn down mid-render.* `applyBusFilter` does
         `master.disconnect()` and rebuilds when the set changes — which is
         exactly when the reader hears it. Rewritten to re-tune a chain wired
         once, then A/B'd with a ScriptProcessor tap recording EVERY rendered
         block: **0 dropouts on the old code as well as the new**. Web Audio
         applies graph edits atomically at a render-quantum boundary, so the gap
         never reaches the audio thread. The change was REVERTED rather than
         shipped as a fix it is not.
      4. *Howler stealing a voice when its pool is exhausted.* `_drain()` only
         recycles ENDED sounds; a busy Howl allocates a new one.

      Also ruled out by reading: the group volume/rate pre-set is deliberate and
      already measured (`presetLevel`'s docblock records a 7% correction it was
      written to avoid).

      **The structural limit on all of the above**, and the reason the next
      attempt should not be another headless probe: headless Chromium has no
      audio device. Anything that manifests at the device boundary — a missed
      callback deadline, a resample to the device rate, a WASAPI glitch — cannot
      occur there at all. The reader hears it in WebView2 on real hardware.

      **Leading remaining explanation:** main-thread stalls starving the audio
      callback. It fits every detail — intermittent ("not consistent"), on step
      advance whether manual or automatic, and while a picker re-renders. It is
      also the same suspect as the FPS-drop item below, which the reader
      reported independently. Do that one first and re-test this.

### First impression


      NOT REPRODUCED, and now demonstrably not the app's rendering. An AudioWorklet recorder behind masterGain plus 39 isolated plays re-rendered offline through the same buffers, rates, gains and biquads: recorded-peak / reference-peak = 1.000 on every one, HF energy differing by at most 0.25% of burst energy. The bus rewire was re-tested under a SOUNDING ambient bed (the gap in the earlier A/B) — disconnect and connect land at the same `ctx.currentTime`, longest run of zeros 0. Whatever is heard is downstream of the graph, at the device, and that boundary does not exist headlessly (`outputLatency === 0`, no `renderCapacity`). One real defect found and fixed on the way: every sound-chip press fired TWO click cues ~0ms apart, because `previewSoundSet()` opens with a click and `uiClicks.ts` could not see it. STILL OPEN as a report: re-test on the installed 0.3 build.
- [x] **The app chose a dark theme without asking.**
      > "For some reason the app chose dark theme for UI without letting me
      > choose. It should default to normal theme — don't take from the user's
      > system settings, if that's what you are doing. Basically I don't want a
      > situation where the user has chosen their themes and it's pretty light,
      > or light with some dark, and then all of a sudden the UI colour themes
      > become dark. Personally I would say night theme should not even be an
      > option during onboarding, but available in settings."

      Stop reading `prefers-color-scheme`. Default to the light/normal theme.
      Take night out of the onboarding choices; it stays in Settings.

### The tutorial


      `resolveInterface` answered a "deep" pitch with `uiTheme = 'night'`. Deep is about the ROOM; the interface no longer follows it. Gated by sweeping every combination of all five questions.
- [x] **Step 10 does not allow dragging — and dragging is broken outside the
      tutorial too.**
      > "Step 10 does not allow dragging stuff. In fact dragging does not work
      > even outside the tutorial."

      The second half is the real bug; the step is just where it was noticed.

      **Not reproducible on the dev server**, and that is worth writing down
      before anyone changes drag code on a hunch. `scripts/probe-drag.mjs`
      hovers a paragraph, finds the handle (visible, 24x28, `pointer-events:
      auto`, `draggable="true"`), and drags it — the paragraph MOVES, by both a
      synthetic mouse drag and a real HTML5 one.

      That probe also records a trap worth keeping: Playwright's
      `mouse.down/move/up` never makes Chromium synthesise a `dragstart`, so a
      hand-rolled drag reports "nothing moved" against an app that works. It
      runs both paths for exactly that reason.

      So the difference is the reader's environment, not the gesture. Two
      candidates, in order: (a) the ~150-300ms main-thread stalls measured under
      the FPS item — a stall mid-gesture drops the pointer stream and the drag
      dies, which would also explain why they met it at step 10, where a panel
      is open; (b) WebView2 on real hardware rather than headless Chromium.
      Re-test on the installed 0.3 build before touching the drag code.


      FIXED, and it explains why every test passed. `tauri.conf.json` never set `dragDropEnabled`, so it took Tauri's default of `true` — whose own doc comment says "Disabling it is required to use HTML5 drag and drop on the frontend on Windows". wry then calls `SetAllowExternalDrop(false)` and takes the page's drop-side events. Works in headless Chromium (no Tauri), fails in the installed build.
- [x] **Step 18 does not move the tutorial card when the panel opens.**
      > "Step 18 doesn't move the UI tutorial window when the user opens the In
      > and Out window. Also we should let the user be able to move the step
      > windows by clicking and dragging."


      The card clears the panel lane and the arrow stands down rather than crossing the sheet. Every step checked, not only 18 — two others were anchored to a rail button the sheet lands on.
- [x] **Say that a step advances on its own.**
      > "We should tell the user that the steps move on their own by using the
      > UI. So let's say they do something correct — then a green timer circle
      > or something in that window. Or again, anything else you think of that
      > would be good in a UI sense, to let the user know it will auto-move to
      > the next step a certain amount of time after they've completed the step."

### Pages and the editor


      A moss dial under the task box drains over exactly the beat the timer waits, read from the same constant rather than a second copy of the number.
- [x] **The page turn flickers the effects in a beat late.** DIAGNOSED, not yet
      fixed — the cause is certain and the repair is a separate, careful job.
      > "When turning pages, after the page turn and we go to the next page,
      > there is a flicker for a second where it then puts all the processing
      > effects we have on it — for example the shadow effect in the middle and
      > so on. It either needs to be there from the start as soon as the page
      > turn begins, or needs to be really, really fast."

      **THE CAUSE.** `PageRasterCache.capture()` rasterises a page by writing to
      it: `element.classList.add(SNAPSHOTTING_CLASS)` then `inlineSvgStyles`,
      restored after an await that is 200ms+ of work. For a MOUNTED page that
      element is the leaf the reader is looking at.

      Measured with `scripts/probe-landing-flicker.mjs`, sampling the DOM every
      animation frame across a real curl:

          leafHidden     75ms -> 1     677ms -> 0      the turn is over at 677ms
          snapOnVisible 952ms -> 1   1136ms -> 2   1206ms -> 0

      and the elements named: `nb-sheet-paper.nb-leaf-paper` at (135,75) and
      (784,75), 649x833 — the two visible leaves. The reader's page is edited
      underneath them for ~250ms, about a second after the turn.

      **A METHOD BUG THAT HID THIS FROM EVERY EARLIER PROBE.** Headless Chromium
      reports `prefers-reduced-motion: reduce`, so `programmaticFlip` takes
      `crossfadeNavigate` and never curls at all. Probes here have been
      measuring a code path the reader never takes. Force
      `page.emulateMedia({ reducedMotion: 'no-preference' })`.

      **THE REPAIR, and why it is not done yet.** `src/flip/offscreenPages.ts`
      already rasterises pages through a read-only editor parked at
      left:-12000px, with the same sheet classes and recipe, because the
      adjacent spread is never mounted. Routing mounted pages through it means
      the visible page is never touched.

      Tried, and REVERTED: making `capture()` prefer `captureUnmounted()` before
      the mounted branch. It changed nothing — `snapOnVisible` still fired,
      `snapOffscreen` never did, and no warning was logged, so
      `captureOffscreen` is returning null silently for a page that IS mounted
      rather than failing. Find out why (start at `createOffscreenPageCapture`'s
      `pageSize()` and `loadPageDoc`) before trying again. An inert change that
      also costs a wasted offscreen attempt per capture is worse than none.

- [x] **A page never seen before turns up blank white.**
      > "There is a bug in the welcome book: let's say I am turning to a page I
      > haven't seen before, then it shows as a blank white page. But after
      > turning it, and then going back and turning to that page again, the
      > content is there as usual during the page turn."

      The raster cache has nothing for a page that has never been mounted, and
      the flip shows the empty snapshot rather than waiting or falling back.


      FIXED. `freeMark.tsx` read `props.editor.view.dom`, which THROWS when the view is not assigned yet — and node views are constructed during the EditorView constructor. The throw took down `withOffscreenPage` and a bare `catch { return null }` swallowed it, so EVERY offscreen capture failed. Offscreen capture is what rasterises the back of the turning sheet and the page revealed beneath the curl; both were textureless on every turn and a null texture draws bare paper. Measured through a new `__flipCache` bridge: back/revealed false on every turn before, true after.
- [x] **Always keep two blank pages ahead.**
      > "Always auto-create the next 2 pages when the user is on the last page,
      > so the user never sees a blank page."


      Two REAL pages stand ready, and the spread is completed as well — an odd page count left the last spread with a page on the left and bare cream on the right, which was the blank being complained about. Bounded by the last page actually written on, so a held arrow key cannot grow the book without end.
- [x] **Page style offers four options; it should offer at least twenty.**
      > "In the sidebar, when inside the app, page style only shows four
      > options: ruled lines, grid squares, blank paper, dot grid. At least 20
      > here."


      4 -> 27 rulings in `src/editor/rulings.ts`, with ONE stylesheet definition per ruling read by both the page and the panel thumbnail, so a thumbnail cannot advertise something the paper will not draw.
- [x] **Handwriting by default, and a way to change the face of a selection.**
      > "I want the default text style in the notebook when I write to be like
      > handwriting. Also I don't see an option, when in the notebook, to change
      > the text font style — for example I might want different pieces of text
      > to have different font styles. So fix that."


      The default already WAS a hand — verified in the running app (`--font-body` = Patrick Hand at 20px, reaching every block, nothing under 13px), so nothing was changed there. The per-selection face is new: a TipTap mark storing a hand ID from the 27-face table, a floor of max(13, spec.floorPx), a toolbar tray whose chips are drawn in the faces they name, and a block-menu submenu.
- [x] **The code block's language dropdown is not our UI and runs off the page.**
      > "I noticed for code blocks the dropdown isn't in our app UI, and it also
      > goes all the way down to the bottom."

### The welcome book


      Replaced with an in-app listbox in the slash menu's register: grouped shelves, type-to-filter, full keyboard, focus returned to the trigger, height capped from the room floating-ui reports. Proven flipping above the tab when a block sits low.
- [x] **Half-empty pages, and it should be much longer.**
      > "I noticed a lot of pages in the welcome book have empty space at the
      > second half, because you didn't fill anything in it. You should put
      > something in it — more examples or something."
      > "I think you can make the welcome book much longer and detailed, so the
      > user can see many examples."

### Settings


      16 pages to 32; median leaf fill 51% -> 82%, worst page 36% -> 71%. The estimator behind it was then recalibrated from containers measured in the running app.
- [x] **A search box in Settings.**
      > "Settings should have a search bar for the user to search things in it."

### Performance


      Matches label, hint, keycap and a `words` list of what a reader would type; reveals collapsed groups; says so when nothing matches; Escape clears before closing.
- [x] **Opening a panel drops the frame rate hard.**
      > "Checking with the FPS overlay I noticed that sometimes if the user, for
      > example, clicks on the sidebar options to open a panel, there is a huge
      > FPS drop before it gets restored again back to 240 FPS. Similarly it may
      > be happening for the studio. We need to make sure FPS drops never
      > happen."

      MOSTLY FIXED, with the remainder measured rather than left vague. Two
      causes, both found by blaming a CPU profile on the nearest frame in
      `src/` instead of the native leaf it bottoms out in. (a) `fitSpread` read
      `--nb-panel-edge` through `getComputedStyle(document.documentElement)` on
      every frame of the panel slide — 227ms per open, because resolving one
      custom property through the cascade recomputes every property on `<html>`
      first. `panelEdge()` now lives in `panelPush.ts` next to the code that
      writes it, and the tour's private correct copy delegates to it. (b) A
      studio design change missed every cached preview tile at once and redrew
      them all in one frame — 1337ms. `tileFor` is unchanged and cache hits are
      still free; only a miss goes through a 6ms-per-frame budget. Studio open
      215ms -> 70ms, design change 124ms -> 0ms of main-thread task, page-style
      and customize-close down to 0ms.

      STILL OPEN, and deliberately: 76-223ms of `(program)` — browser style,
      layout and paint, with essentially no JS in it. Writing any custom
      property on `<html>` invalidates the whole document's style, ~6ms a write,
      and identically so for a property nothing reads (370ms vs 360ms over 60
      writes) — it is the root write, not the dependency. `@property`
      registration makes it worse (523ms). The real fix is to publish the target
      once and let the three consumers transition their own transforms on the
      compositor; collapsing the tween puts the ceiling at 43ms -> 24ms, and it
      would make the tour card and the spread — which read the value every frame
      to travel WITH the sheet — snap instead of slide. Not worth 19ms measured
      under SwiftShader software rasterisation.

### The README and the release page

- [x] **The pictures and the words around them need updating.**
      > "The readme — you will now have to update the pictures and explanation
      > maybe."


      All 19 recaptured against this build, and every alt text read back
      against its own picture rather than assumed. Eight had stopped being
      true: the Welcome book was rewritten for 0.3, so the right-hand page is
      "The shelf" and not "Writing"; the later spread is "A library of your
      own" and "Dressing a book", not folds and spoilers; the script renders
      on the RIGHT leaf, not the left; and the studio card now reads 61 books.
      The shelf itself was re-seeded — see below.
- [x] **Part 1 should be pictures with explanation, not a wall of text.**
      > "I kind of want it to have more of a picture-and-explanation vibe for
      > most of part 1. We already do this, but there is a substantial amount of
      > text between the 2nd and 3rd occurrence of pictures — you know, the
      > parts index, downloads, etc. So maybe add pictures, or reduce text, or
      > actually do both. We want part 1 to have as many pictures as possible,
      > to not intimidate users."


      Part 1 opened with 156 lines of solid text; its first picture is now at
      line 12. Six new ones — the taste questions, the tour card, settings,
      the cheat sheet, "In and out" and focus mode — so thirteen became
      nineteen, and the four sections that described a surface in prose and
      never showed it now show it. The headline shelf picture was also a
      mostly-empty bookcase, because `layout.ts` CENTRES a part-filled row:
      sized from the layout constants instead of by eye, twenty a floor fills
      it. Caught on the way: `TASTE_QUESTIONS` holds five and both the README
      and the settings sheet said four.
- [x] **Put the what-is-what table at the TOP of the release notes.**
      > "In the releases page, the table of what is what should be at top, and
      > then under it what's new — otherwise that table gets buried in the 'read
      > more' of the GitHub UI."


      `release-notes.mjs` composes head + install + body and joins at the end,
      so the download table cannot be pushed below GitHub's fold by a long
      changelog. Found while checking it: the tag argument had never worked on
      Windows — `^` is cmd.exe's escape character, so `v0.2.0^{commit}` arrived
      as `v0.2.0{commit}`, failed, and HEAD was used instead without a word.
- [x] **Make the release document look like the app.**
      > "See if you can spruce up the text and UI in that release document to
      > better align with our app."

### The demo


      Mark, title and tagline centred above the table; the recommended row
      marked rather than merely listed first (five rows with no answer is a
      decision); SmartScreen and Gatekeeper spelled out instead of alluded to.
- [x] **A looping GIF demo, built with the reader's own `gifsmith`.**
      > "Use the gifsmith package — I made it — to create a GIF demo of the app.
      > You may start with showing the bookshelf (pick a fancy, grand-looking
      > preset for wallpaper, books and shelves, and fill up the shelf with some
      > books for this demo), click on studio to show that it has so many
      > options in different areas of customisation — in fact try clicking many
      > different categories to show how it customises in real time, to show how
      > you can change it drastically — then close it and open the welcome book,
      > turn through the pages to show them one by one, occasionally opening a
      > panel in between so that you open all panels, and then finally once you
      > reach all the pages go back by pressing the back button and end, so it
      > will look like it goes to the shelf but it is the beginning of the GIF
      > (as how GIFs usually work), so it becomes forward-looping."
      > "If at any point you feel gifsmith doesn't have what you need, or
      > something in it needs to be changed, I have the repo here — make your
      > changes and push with a version tag and it will auto-publish on the npm
      > page with the new package."

      `C:\Users\akshi\Desktop\Code Palace\gifsmith` ·
      https://www.npmjs.com/package/gifsmith


      DONE — `shots-now/demo-gif.mjs`, 38 seconds, a true forward loop (seam MSE
      0.068, no crossfade): a full bookcase, the studio repainting the room three
      times and then the carpentry, wallpaper and colours on their own axes, the
      first room put back, a book pulled off the shelf and opened, every page
      turned with a different panel opened between them, and the way back to the
      shelf it started on.

      **The loop shaped the script.** A room preset sets colour, carpentry and
      paper together, so the studio tour ENDS on the room it began with — that
      one press undoes the three individual changes above it and is what lets the
      scene come home.

      **Two bugs found in gifsmith, both fixed there and published as 0.2.3.**
      (a) `findAnchorLoop` took the globally-lowest seam MSE, which is wrong for
      the case the strategy exists for: a demo holds still on its neutral pose
      after `loopAnchor()`, so every pair of frames inside that hold matches and
      the search returns the SHORTEST qualifying loop. It handed back 4.29
      seconds of a motionless bookshelf out of a 50-second walkthrough. It now
      prefers the LONGEST span among equally-invisible seams. (b) `minCycleSeconds`
      was threaded all the way to the search and nothing could set it, because
      `RenderConfig.loop` was a bare string; `loop` now also takes
      `{ strategy, minCycleSeconds }`.

      **And one in this app.** The demo is recorded against a production build,
      and it showed two frames of a completely empty window when a book opens.
      `BookView` is `lazy()` and its session is a `createResource` — both suspend
      — and with no boundary Solid hides the entire subtree, including the rail
      and BookView's own "opening the book…" fallback. There is a `<Suspense>`
      there now.
### Shipping 0.3

- [x] **Make the repo public, then release 0.3.**
      > "After all this you can make the repo public, then do a new release that
      > encompasses all these changes as 0.3."

- [x] **Uninstall the app and remove its data — and stop installing it.**
      > "Delete the app you installed for me, with app data of it now. I will go
      > through the experience myself from GitHub. No need for you to install
      > the app for me any more either."

## 🔴 Reported 2026-08-04 (third pass) — toward the 0.2 release


      DONE. The repository is public at
      https://github.com/AkshitIreddy/Alcove — renamed to the capital A on the
      reader's ask, with every URL in the tree following it, a description and
      ten topics. v0.3.0 built from one tag on three runners: seven artefacts
      and a `SHA256SUMS.txt`. The first attempt failed in 48 seconds because
      `npm pkg set` edits package.json and not the lock, so `npm ci` refused the
      whole release.

      The release page was then revised twice from the reader's own reading of
      it: what changed goes above the download table (it had been the other way,
      to beat GitHub's fold), the ✔ column is gone, and the SmartScreen and
      administrator paragraph with it. Both the notes generator and gifsmith's
      now link a written changelog beside the generated commit list.
### Packaging and release


      Done, and silently — the uninstaller ran with `/S` and a hidden window,
      so nothing appeared on screen. Gone: the program folder, the library at
      `%APPDATA%\com.alcove.app`, the WebView2 cache at
      `%LOCALAPPDATA%\com.alcove.app`, the Start Menu shortcut and the
      registry entry. The database was read first — every title in it came
      from the seeded Welcome book and it was created at 23:43 on 4 Aug, when
      I installed it, so nothing written by hand was in it.
- [x] **Ship 0.2, and let CI build every platform from now on.**
      Released at `v0.2.0`: seven artefacts and a `SHA256SUMS.txt`, built from
      one tag on three runners. Windows `-setup.exe` 16,936,253 and the
      `-setup-offline.exe` carrying the whole WebView2 runtime at 227,633,407;
      an `.msi` beside them; a universal `.dmg`; `.deb`, `.rpm` and AppImage.

      It took three tags to get right, and every failure was real:
      1. the shot-source digest was computed over raw bytes, so Windows and
         Linux could never agree — and recapturing re-recorded the wrong one,
         which made it unclearable;
      2. `gen-spec.mjs --check` compared generated LF against a CRLF checkout,
         so the Linux gates job passed the same check the Windows build failed.
         Both were the same cause wearing different faces, and the repo had no
         `.gitattributes` at all — it does now;
      3. the release published ONE asset of six with every job green.
         `upload-artifact` roots an artefact at the least common ancestor of
         its paths, so macOS arrived flat and Windows and Linux arrived as
         directories; `sha256sum *` hashed the one file and `files:
         artefacts/*` uploaded it. `fail_on_unmatched_files` could not see it:
         the glob matched something, just not everything. The publish job now
         flattens and REFUSES to publish unless one artefact matches each of
         the six platform patterns the README's download table promises.

- [x] **WebView2: measure it, and consider bundling.**
      > "i noticed that the pc needs to have microsoft edge web view2 runtime,
      > like check the size with it included and maybe add it if not that big
      > or add another version with it included"

      Tauri offers several `webviewInstallMode`s. Measure the installer with
      each and decide on the numbers — and if the bundled one is heavy, ship
      both and say which is which.

      WebView2 measured byte-exactly (bootstrapper 1,695,448 B embedded; offline +202 MiB, ~850 MB once installed). `embedBootstrapper` kept and pinned by `tests/packaging.test.ts`; numbers and reasoning in `docs/packaging-windows.md`.

- [x] **The uninstaller should offer to remove the library, and say where it is.**
      > "make the uninstall exe has an option to also to delete the all app
      > data and show the user where that app data is in case they want to
      > transfer for it as where"

      Default to KEEPING it — a notes app that eats your notes on uninstall is
      unforgivable. Show the path either way so it can be backed up or moved.

      `UninstPage custom un.AlcoveLibraryPage` in `src-tauri/installer/alcove.nsh` — an nsDialogs checkbox, an open-the-folder button, deletion in `NSIS_HOOK_POSTUNINSTALL`. The default KEEPS the library, proved by a silent `/S` uninstall on this machine leaving `%APPDATA%\com.alcove.app` intact.

- [x] **The installer should look like the app.**
      > "most install and unistall exe look boring make sure ours looks
      > interesting, pretty like our app"

      Header and sidebar drawn from the mark by `build_installer_art()`, with `MUI_BGCOLOR` set to the same cream the bitmaps are grounded on so the art sits in the window rather than on it. Judged by opening the two BMPs, which costs no window.

### The README, as a document

- [x] **Make it pretty, and restructure the wording.**
      > "the on this page section could perhaps be better with a bullet list or
      > something, so i would like if you also spruced up the way the readme is
      > presented to make it look pretty"
      > "make restrucue the wording to make it more understable, maybe bullet
      > points or some emoji(used sparingly or not at all, dont want to make it
      > look like a cookie cutter project)"

      Contents is a bullet list per half with a sentence beside each link; exactly two emoji survive a scan of all four pages and both carry meaning.

- [x] **Developer and technical detail belongs at the BOTTOM, not the top.**
      > "i noticed in general too many warnings and technical info at the
      > start, so i want that kind of info at the bottom for developers, for
      > normal users you can you know keep it only realted to the product, how
      > to get it, how to use it and so on… my criticism is only for stuff like
      > say the two things touch the network, or the libary is one local sqlite
      > file, like that i mean"

      Anything about USING the product stays up top. Implementation facts move
      down.

      Implementation facts moved to Part 2 — the SQLite sentence, the two outbound calls, the telemetry literal, the urlGuard mirror. Part 2 now opens with 'Nothing below this line is needed to use Alcove'.

- [x] **Say clearly that there are two halves — one for readers, one for
      developers or an AI helping them.**
      > "make more of a emphasis that the readme has two sections one for users
      > and one developers or other AI to read to help them contribute"

      The two-halves callout is two labelled entries with jump links, plus an explicit line pointing an AI agent at Part 2 and CLAUDE.md.

- [x] **The platform line says Windows 10 and 11 only.** Change it once CI
      builds mac and Linux.
      > "i noticed at top platofrms says window 10 and 11 only, change it as well"

      The badge reads `Windows · macOS · Linux`, composed in `renderBadges()`, and the download table has a row per platform.

- [x] **Release notes should not open the document — link to them.**
      > "the release notes should not be at the start maybe you can link to it
      > instead"

      `docs/readme/releases.md`, registered in `SIDE_PAGES` so its links are checked, linked twice and inlined nowhere. Now carries a 0.2.0 section.

- [x] **Drop "the first ten minutes".**
      > "probably not need since it is a big blob of text when below there is a
      > nicer picture based explanation, we can probably push to that instead"

      Gone — `grep 'first ten minutes'` finds nothing outside the generator's own docblock example.

- [x] **The top should say more about the AI side.**
      > "i noticed the above of readme doesnt mention the ai part that much but
      > i think it should"

      A third lead paragraph names Notebook Script, *copy the format for your AI* and *paste a script in*; the AI bullet is second in 'What's in the box'; the banner carries a *paste from any AI* chip.

- [x] **The README check should REPORT gaps, not gate them.**
      > "i know how the readme like to change to change as code changes but i
      > would like if it instead basically after running that check basically
      > tells the if sopmething is missing, if it is then it is later added by
      > dev or you the ai, basically the check exists to say that hey something
      > is missing from readme, but final editing of readme is left in the hands
      > of the dev/ai, i dont know if it works like that already"

      Find out whether it already behaves this way. The counted markers do
      recompute; the question is whether a mismatch REPORTS or BLOCKS.

      It already REPORTED, which is what the item asked to find out: `check-readme.mjs` exits 0 without `--strict`, and `checkCoverage()` prints completeness separately under 'in the repo, not on the page'. Drift stays a hard gate; completeness reports.

- [x] **Remove the "no button" warning once import/export have buttons.**
      > "add option for user to import markdown, explort pdf or png so you can
      > remove the warning"

      These were plugged in already — verify, then delete the caveat.

      The three rows are real buttons in `SharePanel.tsx` — *Bring Markdown in*, *Export as PDF*, *This page as a picture* — and the caveat was already deleted.

### The app

- [x] **One sidebar panel for insert / AI spec / export.**
      > "maybe condense insert, copy AI spec, export things into a single
      > setting in side bar, with the above options as well in its panel below"

      `SharePanel.tsx`: one 'In and out' sheet in three groups — insert, markdown, templates, PDF, PNG, parcel, spec, script.

- [x] **Code blocks that are actually for code.**
      > "our notebook should also support being able to hold code of different
      > langauges with inbuilt indenting, colours for the code and what not
      > needed for displaying programming code, and customising how it looks in
      > settings"

      Syntax highlighting across languages, sane indenting, and a look the
      reader can change — in the app's own flat language, not a stock IDE theme.

      `codeLanguages.ts` (one list, shared by parser and highlighter), `codeHighlight.ts`, `codeIndent.ts`, `codeBlock.tsx`, `codeAppearance.ts`, and a settings panel.


## 🔴 Reported 2026-08-04 (second pass, from the installed build)

- [x] **Let the reader pick their colour directly in onboarding.**
      > "also let user then choose colour theme with more options so that
      > picking their fav is possible directly in onboarding then"

      The four "how much colour" buckets are a steer, not a choice. Replace or
      follow them with a real palette pick — enough of the 60 rooms shown as
      drawn cards that a reader can find the one they actually want, rather
      than describing it and hoping. Keep the steer for anyone who does not
      want to browse.
      Context: this came out of finding that `deep` collapsed every room to the
      same grey (see below), which is the symptom of asking about a taste
      rather than offering the thing.

      Shipped in 3545897 and never reconciled here. Question three is a real palette pick over drawn `drawRoomCard` cards, the steer preselects rather than decides, and a pick short-circuits `resolveRoom`. A grid-collapse defect was found and fixed on top of it.

- [x] **The `deep` colour answer flattened every room to one grey.**
      Found by building `shots-now/taste-matrix.mjs` — the room answer against
      the colour answer as a grid. `PITCH_THEME_TAGS.deep` was `['dark']`, one
      word, so all ten dark palettes tied and the tiebreak picked Ebonised
      every time. The question promises "Ink, forest, claret" and the palette
      HAS them; what separates the rich darks from the grey ones is that they
      carry `grand` while Ebonised and Fumed carry `quiet`/`muted`. Now
      `['dark', 'grand']`, which moves two of the four rooms off grey. The
      remaining two are better answered by the direct pick above.

- [x] **The README's screenshots are stale — old name, old icon.**
      > "picture in readme uses old name and pic, also some of the other
      > pictures in it are outdated"

      Recapture every shot in `docs/readme/img/` from the current build, and
      add a check so a stale one is caught rather than noticed by a reader.

      All thirteen recaptured in one pass. Two defects fixed on the way: the dev-only `shelf | book` pill was in every shot (`?dev=0` is now passed, pinned by a test), and a NodeSelection on the far leaf could not be cleared because there is one editor per page.

- [x] **Put the content IN the README rather than behind links.**
      > "also change the readme to instead of links have most info here in
      > readme itself"

      `scripts/gen-readme.mjs` already composes the root file from the two
      halves; the job is making the root file the substantive document rather
      than a signpost.

      1269 of README.md's 1545 lines are lifted from the halves; 'Deeper reading' lists only what the front page does not already carry.

- [x] **Write the README as a shipped product.**
      > "also write the readme like install exe and published version is there"

      Download links, a version badge, release notes — written as though the
      installer is published, because it is about to be.

      The download table names real 0.2.0 artefacts, the version badge is composed from `package.json`, and the 'no tag has ever been pushed' hedge is gone.

- [x] **Mac and Linux builds in CI.**
      > "make it have mac and Linux builds available when we use git workflows"

      A GitHub Actions workflow building the Tauri bundle on all three
      platforms and attaching the artefacts to a release. Note `icon.icns` is
      currently generated by the Tauri CLI and is stale; a macOS build needs it
      regenerated from the current mark.

      `.github/workflows/release.yml` builds windows-x64, a universal macOS `.dmg` and Linux `.deb`/`.rpm`/AppImage from one tag.

- [x] **Extensive review, cleaning, optimisation and continuous visual testing.**
      > "at the end do a extensive code review, cleaning, optimising, visual
      > continuous testing, etc to make sure the app is perfect and ready"

      Five lenses, each adversarially verified.

      **Dead code.** The find that mattered was not dead code at all:
      `transfer::bundle_write_asset` was declared `#[tauri::command]` and never
      registered, so importing a bundle carrying pictures kept none of them and
      logged a per-file warning indistinguishable from a corrupt file.
      `cargo check` had said so all along — a command's only caller is
      `generate_handler!`, so an unregistered one reads as `never used`.
      `tests/ipc-surface.test.ts` holds the seam from both directions now. Two
      Vite scaffold SVGs that had shipped in every installer, deleted.

      **Duplication.** Sixteen facts written down twice, collapsed to one
      definition each — the flip snapshot recipe, the timeline metrics, the
      highlight labels, `PAGE_STYLES`, the ribbon hexes, the script effect
      domains.

      **First paint.** ShelfStudio and SettingsPanel lazy behind latches,
      stickers loaded after render, the ambient bed coalescing every boot-time
      ask into one idle start. Measured rather than guessed, and the measuring
      tools kept (`shots-now/_ab-boot.mjs`, `_weigh.mjs`, `_importgraph.mjs`).
      Recorded and NOT acted on: pixi.js is 746 kB, 43% of the boot chunk,
      including DDS/KTX2 parsers and workers nothing uses.

      **Correctness.** A page could hold a block taller than itself — the drain
      peels TRAILING blocks and was gated on `doc.childCount > 1`, so one long
      paragraph had nothing to peel and it gave up. It splits at a soft-wrap
      boundary now. It was also comparing `getBoundingClientRect` distances
      against layout px, so the fold sat wrong whenever a rail panel was open.

      **Visual regression, which is the "runs repeatedly" half.**
      `npm run visual` — 16 surfaces x 2 sizes x light/dark against committed
      baselines, `--update` the deliberate yes, a report page of triptychs. A
      comparison run no longer writes a baseline (it used to, and a suite that
      accepts its own output agrees with the app by construction), and a
      surface that never settles is a THIRD outcome: not baselined, not failed,
      counted in its own column. See the open item below for what still moves.

- [x] **Six visual surfaces never stop moving.** They were two bugs, and both
      were fixed elsewhere in the tree before this file was pointed at them.
      All three surfaces settle in three frames now and carry baselines.
      `895958d`

      The guess written down at the time — "not CSS, so canvas or WebGL,
      because `getAnimations()` is empty at rest" — was wrong in a way worth
      keeping: the two real causes were both DOM, and both invisible to
      `getAnimations()` because neither is an animation.

        - `f00fc92` — every offscreen page capture was failing silently, so the
          raster cache fell through to its LIVE path and wrote `.snapshotting`
          (which hides the drag handle, the style switcher and the selection
          tint) plus inline SVG paint onto the leaf being looked at, held for
          the 200ms+ of a rasterise. A screenshot landing inside that window is
          a different picture from one landing outside it, and the window opens
          at idle — intermittent, load-dependent, and exactly the shape of the
          symptom.
        - `53174e7` — the pagination drain published its removal too late, so a
          carry re-materialised the block it had just moved. A spread that
          rewrites itself cannot settle by definition.

      Confirmed with a MutationObserver census over the whole document, parked
      twenty seconds on each surface, rather than assumed from the fixes'
      dates. Two things kept so the next one is cheap: a MOVE case writes a
      `.moving.png`, and `--sabotage` paints a patch that changes every 200ms
      and asserts the suite still says MOVE — this gate fails QUIETLY, so a
      broken `settle()` would take six surfaces out of coverage and make the
      summary GREENER.


## 🔴 Reported 2026-08-04, from the INSTALLED build — WORK THIS LIST

The reader's words are quoted verbatim under each item, then the task as I
understand it. Where I think the report and the fix differ, that is said out
loud rather than quietly reinterpreted.

### Packaging

- [x] **No icon in the Start menu.**
      > "the app does not have icon in start menu, probably the same bug for
      > installer"
      Root cause found and it was not the shortcut: NSIS creates it with
      NO IconLocation at all, so the shell falls back to the target
      exe's icon group. The real fault was Pillow's ICO encoder writing
      a container Windows reads but no Windows tool would write.
      gen-icons.py writes and validates the container itself now, and
      docs/packaging-icons.md records the rules.  `9903564`

      The shortcut exists at `%APPDATA%\…\Start Menu\Programs\Alcove.lnk` and
      shows no icon. Their guess is worth taking seriously — the `.ico` is the
      same file the NSIS installer uses, so one malformed multi-frame icon
      would explain both. Check the frames actually present in
      `src-tauri/icons/icon.ico`, that the shortcut points at an icon index the
      file has, and that Windows' icon cache is not just stale (test on a fresh
      shortcut, not by rebuilding the cache).

- [ ] **Pin to Start.** Windows blocks the scripted verb
      (`E_ACCESSDENIED`) and the UI attempt needs an access grant that was
      denied while the reader was away. Retry through the real right-click menu
      when they are at the machine. Do NOT use the `ConfigureStartPins` policy:
      it needs admin and REPLACES their whole pinned layout.

### The icon itself — do this WITH the reader, not in an agent

- [x] **The icon is too detailed and reads pixelated.**
      > "also btw the icon looks very pixelated probably because it has so much
      > detail in it, so help me craft a new icon as well"
      > "the icon thing do it with me dont hand it to a agent, we do together ,
      > if i like then you update it"
      Replaced with the reader's own cute red notebook, drafted together
      over two rounds. Verified by reading frames back OUT of icon.ico
      rather than downscaling the master: a red book at 16px, spiral
      rings by 24, the face from 32. The surround is detected from the
      corners now instead of assumed black, so the next swap cannot ship
      an opaque box behind the mark.  `9903564`

      Their diagnosis is almost certainly right: `alcove-art.png` is a rendered
      illustration downsampled to 16/32/48px, and detail that survives at 256
      turns to mush at 16. Draft options together, iterate on their call, and
      only then regenerate the icon set. **Not delegated.**

### Defaults and first impression

- [x] **The out-of-the-box room looks weird.**
      > "the default bookshelf colour, wallpaper colour and design looks weird,
      > try to hand pick the best one to make it good out of the box when user
      > first opens the app"
      The opening room is hand-picked as one composed choice - scheme,
      carpentry and paper judged together on a first-run screen rather
      than each on its own merits.  `138ef8a`

      Hand-pick the opening scheme + carpentry + wallpaper as one composed
      room, judged by looking at the first-run screen, not by picking each axis
      on its own merits.

- [x] **Presets are weighted bland; the interesting ones should lead.**
      > "i liked the studio preset called the counting house, cardroom, chapter
      > house, minister, snowline, sawmill etc because of interesting it is,
      > presets like that should be first, and possibly take inspiration from it
      > when making the default, also i noticed a lot of presets while they look
      > good physically on the colour side seem to be to be bland, which is not
      > bad but it sohuld be balanced with presets that are vivid too right?"
      69 rooms now, each declaring a tier (34 signature, 28 shelf, 10
      plain) with the order DERIVED from it. Antique leads because three
      of the six rooms the reader named are Antique; Quiet, deliberately
      the plainest, brings up the rear. Vivid rooms added so the set is
      balanced rather than uniformly muted.  `138ef8a`

      Two jobs: re-rank so the characterful presets lead their families, and
      ADD vivid ones so the set is balanced rather than uniformly muted. Bland
      is not wrong — unbalanced is.

- [x] **Onboarding should choose the reader's whole look for them.**
      > "during onboarding ask thee user whether they like bland or vivid, what
      > kind of pattern and style they like(make it sound better) and then auto
      > pick their colour profile, from the preset to how their shelf, wlecome
      > book, wallpapper, etc etc etc, as well as their sound profile , the
      > colour profile on the settings icons and other app ui icons etc"
      Four questions early in the tour, every option a REAL drawing
      rather than an adjective, then it writes the room preset,
      carpentry, wallpaper, welcome binding, sound set and UI colour
      profile. The word "vivid" appears nowhere in the copy - a test
      enforces that, since the reader asked for it to "sound better".  `138ef8a`

      A short taste questionnaire early in the tour that writes: room preset,
      shelf carpentry, wallpaper, welcome-book binding, sound set, and the UI
      icon colour profile. Phrase the questions in the app's own voice, not as
      "bland or vivid".

### Onboarding

- [x] **Step 2 has no guard: dragging before clicking skips the step.**
      > "in onboading step 2 it doesnt tell user to click on the pop up that
      > says write my first one before dragging on shelf, so if user drags on
      > shelf before clicking write my first, it goes to step 3, there should be
      > safety here"
      A first-book gate that only exists when the case is genuinely
      empty, and that a shelf drag cannot satisfy. Steps can now name a
      gesture that will NOT satisfy them plus what to do instead.  `fe1fac7`

- [x] **"Write my first" creates TWO books, and the new one is white.**
      > "when i click on write m y first, it creates two books, basially the
      > welcome book popups along with my new book, also for some reason the new
      > book is white"
      Both halves fixed; the white book was the same unbaked-spine
      family as the welcome book bug, on the create path rather than the
      startup one.  `fe1fac7`

      Two bugs in one action. The white book is the same family as the
      unbaked-welcome-book defect: a spine that never got its bake.

- [x] **Step 6's drop target is too small, and the cursor says no.**
      > "in step 6 the highlighted box is too small to allow for draggin, it
      > works but the user might get confused to move the below the higlighted
      > box especially if it shows stop sign on his cursor when he is donig it"
      The spotlight is the whole editable column with zero padding, so
      every lit pixel is a legal drop and following the tour never
      produces the not-allowed cursor.  `fe1fac7`

- [x] **Steps 10 and 12 do not close the panel the previous step opened.**
      > "step 10 it goes to explainig the next thing without auto closing the
      > customise book thing that was opened in step 9"
      > "same when going to step 12 from 11"
      Fixed generally rather than as two special cases: on entering a
      step, every open surface closes unless one of that step's own
      targets resolves inside it. A step declares what it is about once
      and both the spotlight and the tidy-up read that declaration.  `fe1fac7`

- [x] **The task-complete sound is wrong.**
      > "the sound effects for onboarding when completing a task is very weird,
      > its like a metal tong"
      It was literally a struck metal bell - the same file the hour
      chime uses. Metal is the one material this room does not own. The
      house sets voice it as a wooden tap that settles; the bell files
      are untouched and the cloister set still rings.  `b088004`

- [x] **The tour does not cover the rails.**
      > "the tutorial did not show all the stuff in the sidebar in the notebook
      > and also did not show the option in sidebar when bookshelf is open"
      13 steps to 20, covering the shelf dock and studio and the book's
      page-style, catalogue, finding and rail actions.  `fe1fac7`

- [x] **Offer a short tour and a long one.**
      > "it fine if the onboarding is very big"
      > "in fact at the start of onboarding ask user if they want bare minimum
      > or full the rundown, like that we show them information accordingly"
      Asked at the start. Both derive from ONE tagged list, so the short
      tour is a real subset rather than a second script that can drift.  `fe1fac7`

### Sound

- [x] **MAJOR: cues degrade into "jittery sand paper".**
      > "i have just discovered a major ting, a lot of time i said bad but
      > actually there is a sound bug that turns that sound effects into jitterry
      > sand paper , for example when i click on studio its a nice tap when i
      > click again to close it becomes jittery sand paper(happens like maybe 2
      > times every 3 times)"
      Recorded rather than listened to: an AudioWorklet spliced into
      howler's master bus caught 137 plays and EVERY ONE started at gain
      1.000 and was pulled down afterwards. The level was being set
      after play() returned; howler copies the group volume onto a fresh
      voice one statement before the buffer starts, so two writes at the
      same AudioContext time cancel silently and one quantum apart the
      cue opens 2-4x too loud and steps mid-attack. Also disabled
      autoSuspend, whose resume path deferred the play AND queued
      volume/rate behind it. Three other suspects measured and ruled out
      in writing.  `b088004`

      **This reframes months of "the sound is bad" feedback.** A cue that is
      fine on one play and gritty on the next is not a sourcing problem — it is
      playback: overlapping voices on one Howl, a rate/detune jitter, a sprite
      window cutting into the next take, or the new filter node resonating.
      Reproduce it by TOGGLING the studio repeatedly and capturing the actual
      output, not by listening.

### Customisation — the big one

- [x] **Delete, restore, favourite, and add-your-own, everywhere.**
      > "we should also give the user to delete stuff in the customisation in
      > all possible areas with option to restore it again by right clicking its
      > menu which then opens up the list of deleted ones with checkbox style
      > options to restore what they want, along with option for user to favorite
      > stuff which then puts it in first in its category or sub cateofry
      > depending favorite level the user sets for it, and option for user to add
      > their own customisation options like textures or effects or sound
      > whatever, when uploading for category it will open a popup with upload
      > button information on how to do it along with a custom ai prompt they
      > give to an ai that will tell it the specifications of how to build and
      > package it for the user to upload it here"
      One mechanism (src/data/shelfOfMine.ts) across 33 axes: hide,
      restore from a right-click drawer with checkboxes, and stars where
      one tops a family and two top the axis. Wired into all seven
      library strips and all six book strips. A removed entry leaves the
      roll pool too - and one you are currently WEARING still shows, or
      the strip would read as having forgotten.  `138ef8a`

      Four capabilities across EVERY vocabulary, as one shared mechanism:
      hide/delete an entry; restore from a right-click list with checkboxes;
      favourite with a level; and import your own. The upload dialog carries
      instructions AND a copyable AI prompt describing the exact format, so a
      reader can have a model build a pack for them.

- [x] **Save the current room as a preset, and star it.**
      > "give the user the option to save their current room as preset and also
      > star it simuntaosuly to make sure it stays up top, ( single star to pin
      > it to top of a subcateogyr while double star for it to be at top within
      > the category as a whole , this notation for pretty much anything)"
      Name and stars in one action, joining the same list as the house
      presets and deletable through the same drawer.  `138ef8a`

      The star notation is the same favourite-level mechanism as above and must
      share it, not be a second implementation.

- [x] **Appearance offers 4 themes; handwriting, ink and paper are thin too.**
      > "in appearance i noticed only 4 themes, are there fix it to atleat have
      > 20, same bug for handwriting, you know what though i feel you have
      > already done this thouhg and the option is not showing but anyway might
      > be worth to check the code for stuff that may have been written but not
      > plugged"
      > "btw same issue for ink, paper type , atleast 20 options"
      The reader's instinct was right again. 30 app themes, 34 inks, 24
      papers and 27 handwriting faces now, each tiered and
      family-grouped.  `138ef8a`

      Their instinct is right and this has happened four times already (the
      colour axis, the lettering shelf, the underlines, the wallpaper roll
      gate). Find the written-but-unplugged surfaces and plug them.

- [x] **A standing alarm for written-but-unplugged code.**
      > "perhaps even a safety clever functionality sort of like alarm to every
      > part of the code to basically spit out errors if it isn't plugged in"
      tests/plugged-in.test.ts. It missed six things on its first outing
      - including a component that was imported but never RENDERED - and
      was widened until every one of them would have failed it.  `138ef8a`

      Generalise `tests/roll-gates.test.ts`: a gate that every exported
      vocabulary / pool / gate has a real consumer in `src/`, failing loudly
      when something is authored and reachable by nobody.

### Book, page and editor

- [x] **A click should bring the book forward, not open it.**
      > "the book is auto opening when i click it should isntead just come in
      > foreview and only if user clicks on it does it go inside , with a back
      > button on top left"
      One click brings it forward out of the shelf; a second opens it.
      Back is top-left. Drag-out still works.  `138ef8a`

- [x] **The page changes colour mid-turn.**
      > "i noticed when turining the page the colour of page changes before
      > going back to original colour"
      src/flip/paperTone.ts - the snapshot and the live DOM now agree
      about the paper.  `138ef8a`

- [x] **Stickers and effects should be placeable anywhere.**
      > "give user the option to drag and place stickers or any effects, like i
      > mean click on it and put it anywhere on the page, not caring about where
      > lines are"
      Free placement, dragged with the pointer and persisted with the
      page, with the reflow behaviour decided deliberately rather than
      left to chance.  `138ef8a`

- [x] **Merge the bookmark button into Ribbons.**
      > "there should be an option for user to make their own custom bookmarks,
      > right now it just places a bokomark when i click on bookmark button, i
      > feel you may have written code for this but not plugged in, oh wait never
      > mind you just have it as options in sidebar called ribbon, maybe it might
      > be worth merging those two instead having a seperate button"
      One control: bookmark this page and choose which ribbon does it,
      with a one-press default so it stays fast.  `138ef8a`

- [x] **Focus mode should be a range, not a switch.**
      > "focus mode should allow user to basically zoom in and also even just
      > get into full page mode where the book isnt even visible and it just page
      > and even go as far just making one page visible, so basically it should
      > be controllable by user"
      Four rungs - off, spread, page, single leaf - plus a zoom the
      reader controls and a leaf chooser, on a plate under the top-left
      exit.  `138ef8a`

- [x] **Rework the welcome book to show everything off.**
      > "completely rework the welcome book content to showcase all the
      > different possiblities, also i hope you added math latex options etc"
      > "make the welcome book very detailed and beautofil and playful and fun
      > showing what all can be done like adding images, banenrs, also ithink the
      > code even shows how to add random images based on a search query, so
      > maybe add some cute kittens"
      Rewritten as a real showcase, and yes - there are kittens.  `138ef8a`

- [x] **More shortcuts.**
      > "more shortcuts would be nice"
      Widened across the shelf, the panels, the book and focus mode, all
      through the central map so every one is rebindable and appears in
      the cheat sheet.  `138ef8a`

### Art quality

- [x] **Some spine designs are still too weird for the dice.**
      > "we might need to do a purge or atleast remove the randomise/new book
      > creator some new book designs on spine and perhaps elsewhere because they
      > too weird like look at how weird this is"
      Re-judged on a real dice-rolled SHELF at the zoom the app opens on
      rather than on a specimen board - the reason the first pass
      under-demoted. Nothing deleted; all still pickable.  `138ef8a`

      They attached a shelf shot. Note this is now the SECOND pass on the same
      complaint, so the tiering is not demoting enough — re-judge against what
      they actually see on a shelf, not on a board.

- [x] **An effect renders wrongly.**
      > "fix and verify the effects, for example look at how weird this effect
      > is"
      Found and fixed, then all 472 effect values swept on a real page
      at real size to catch the others.  `138ef8a`

      They attached a page shot: a washi/tape strip sitting across the text
      rather than behind or above it.

- [x] **Custom cursors.**
      > "add custom cursor states and cursor icons wiht customisation options
      > for the user pick"
      Drawn cursor sets the reader picks between, with hotspots verified
      by clicking small targets. `system` stays available and Windows
      High Contrast hands it back on its own.  `138ef8a`

## 🏷️ Rename to **Alcove** — DEFERRED until the running workflows land

Held back on purpose: two workflows are editing this tree, and a rename touching
nineteen files across four languages during that is how work gets clobbered.

The icon is already safe — moved (not copied) out of Downloads to
`assets/brand/incoming/alcove-art.png`. A classical alcove: arch, columns, a
shelf of books, an open book, a quill. It carries the same baked black frame the
last one did, which `scripts/gen-icons.py` flood-fills to alpha already.

**Tooling is in place so this and every future rename is one command:**

- `brand.json` — the name, slug, identifier, repo, welcome-book title, the art
  master, and the strings a rename must NEVER touch.
- `npm run rename Alcove --art assets/brand/incoming/alcove-art.png`
  (`--dry` first; the dry run currently reports 19 files).
- `tests/brand-consistency.test.ts` — 13 checks that every surface agrees with
  `brand.json`. It exists because the last rename left `main.rs` calling
  `notebook_lib::run()` after the crate became `bellanote`: **the Rust binary
  did not compile for several commits** while tsc and 1,480 tests stayed green,
  because neither of them can see Rust.

**Still by hand after the script runs, and the script prints all four:**

1. Seed migration — bump `SEED_VERSION`, extend the retitle. Without it every
   existing reader gets a SECOND welcome book, because the title is also the
   identity check that stops one being seeded.
2. Icons, in this order — the Tauri CLI overwrites the close-cropped small
   sizes, so it must run first:
   `npx @tauri-apps/cli icon <master>` then `python scripts/gen-icons.py`.
3. `gh repo rename alcove` + `git remote set-url origin`.
4. **`cargo check --manifest-path src-tauri/Cargo.toml`** — the toolchain the
   last rename broke and the only one that would have noticed.

## ⏭️ Left over after the 2026-08-03 workflows

Both waves landed and are green (tsc 0, 1660 tests). These are the gaps the
agents reported honestly, plus the seams between them that I closed by hand.

**Still open:**

- [x] `DEFAULT_SHELF_DESIGN` did two jobs — the opening carpentry AND the
      unknown-id fallback for `resolveShelfDesign`/`getBuild`. Split into
      `DEFAULT_SHELF_DESIGN` (scriptorium/guilloche) and
      `FALLBACK_SHELF_DESIGN` (plank/none), like `DEFAULT_WALLPAPER_ID` before
      it. `d8e4bf3`
- [x] Applying a room preset is two independent store writes (colour to the
      bookcase's room blob, design to the studio's settings key), so the world
      reacted twice and re-baked twice on one click. `queueApplyLibrary` folds
      every notification in a task into one application. End-of-task, not a
      microtask — the microtask version still measured two, because each save
      awaits its own store's load() and those resolve a different number of
      ticks apart. `shots-now/preset-bakes.mjs` reads the new bake counter:
      +2 each before, +1 each after. `360a8c1`
- [x] `ROLLABLE_SHAPES` / `ROLLABLE_MATERIALS` / `ROLLABLE_DECORATIONS` are
      exported and gated but have no consumer. **They have one now**: the book
      studio's "bind it yourself" section picks each axis on its own, every
      strip holding the other two still.
      A composed binding is an id — `own:shape/material/decoration/gilt` — so
      it rides the existing `Record<bookId, BookPresetId>` with no migration
      and no new axis for `bookDesignTag` or the spine factory's params key to
      forget. Gilt is its own segment because the preset table says it must be:
      only 134 of 189 rows agree with "gilt iff the decoration is a gilt one",
      so it is a choice, not a derivation.
      `shots-now/own-binding.mjs` drives the real strips and checks the trap
      that matters — picking one axis KEEPS the other three — then reloads.
- [x] ~~No "add your own set" for sound, and no runtime filtering in a set's
      levers (Howler exposes rate and volume per play, not a filter node).~~ —
      **one half was wrong, the other half is half right.** Both delivered
      honestly; `docs/design/sound.md` § *Sets: the two levers that were
      written off* is the long version.
      **Add your own set: built.** `sound/userSoundSets.ts` (pure registry, the
      engine reads it on the play path) + `userSoundSetStore.ts` (dialog,
      bytes, one `settings` row), following `templates/userStickers.ts`
      exactly — `user:` id, bytes through `storeImageBytes` into
      `$APPDATA/assets/images/`, which is the only asset-protocol scope a Web
      Audio fetch inside the app can reach. A reader's set is a shipped BASE
      plus overrides, so one typewriter sample makes a working set instead of
      needing thirteen, and everything unfilled keeps the mastered loudness
      hierarchy. Their file beats the base's substitution AND its silences; the
      swap follows a layer; an unrecognisable file name is reported back rather
      than assigned to whichever role was free.
      **Runtime filtering: real, and per-SET not per-role.** `Howl` has no tone
      control — that part was right. But `Howler.ctx` and `Howler.masterGain`
      are public (both in `@types/howler`), so `sound/filter.ts` cuts the
      `masterGain → destination` hop and splices real `BiquadFilterNode`s into
      howler's own graph. `scripts/probe-sound-bus.mjs` MEASURES it in the
      running app rather than asserting we called `createBiquadFilter`: a tone
      into `masterGain`, an `AnalyserNode` either side, `far-room` −30.6 dB at
      8 kHz and `music-box` −25.2 dB at 120 Hz / +3.1 dB at 3.2 kHz, each
      agreeing with the wired node's own `getFrequencyResponse()` to 0.1 dB.
      **What is still genuinely impossible, and why:** a PER-ROLE filter.
      Everything reaches `masterGain` already mixed, and the only per-sound
      node is `howl._sounds[i]._node` — private, undocumented, re-created per
      play; a lever built on it would break on a howler patch release and break
      silently. Also unavailable with `usingWebAudio === false` (HTML5 mode),
      where `getEngineState().filter` reports `installed: false` with the
      reason instead of pretending. And nothing conditions the reader's own
      files: the warmth fit / lowpass lid / levelling are a `gen-sounds.mjs`
      build step over ffmpeg-decoded float, not a runtime pass — the settings
      panel says so where the buttons are.
      `tests/sound-own.test.ts` (37) + `scripts/probe-own-sounds.mjs`.
- [x] `docs/design/page-flip.md` specified the shadow/lighting model that was
      removed — warm crest highlight, pre-fold darkening, self-shadow. Doc
      corrected; `tests/flip.test.ts` gates their absence. `2cf330e`
- [x] `CLAUDE.md` said "a library theme is a colour scheme" with no mention
      that presets bundle colour + carpentry + paper. Corrected. `2cf330e`
      (`docs/ROADMAP-wave2.md` still unreviewed — see below.)
- [x] `UserStickersSection`'s imported-sticker grid is capped now. `8cba847`
- [x] `tutorial.css`'s `.nbt-card` is its own scroller with the actions and
      progress dots at the bottom — same family as the reported scroll bug,
      inverted. Both pinned with `position: sticky`; `shots-now/tour-footer.mjs`
      measures a 223px scroll at a 400px window and refuses to pass on less
      than 120px of overflow, because at a normal window the worst step
      overflows by 3px and such a run proves nothing. `cab49e7`
- [x] CheatSheet, QuickSwitcher, TemplatesGallery and ExportPdfDialog had NO
      visible way out — Escape or the scrim only. All four have a top-left
      close now, one shared drawn-ring look (`.nb-ins-close` serves the three
      `.nb-ins-card` dialogs). Dropped two duplicate exits while there: the
      gallery's bottom-right "Close" and the PDF sheet's "Cancel", both of
      which were the same action in the wrong corner.
      `shots-now/dialog-exits.mjs` opens all four through their real triggers
      and measures the close is inside the card, left half, top half.
- [x] The settings seal (bottom-left) rendered ABOVE the pulled-book scrim, so
      it stayed lit while the room dimmed. Dropped to just under the scrim,
      with `shots-now/seal-layer.mjs` confirming it is still the topmost thing
      at its own coordinates on a resting shelf. `cab49e7`
- [x] Max zoom on a 2× display is the one soft spot left: 0.80 texels per device
      pixel at zoom 2.5. **Two corrections, one decision unchanged.**
      It is not "on a 2× display": `spineBakeScale` already multiplies by dpr,
      so sampling is `HI_SCALE_BASE / zoom` and the dpr cancels — 0.80 at max
      zoom on every display alike.
      And sharpening it does not cost "6.25× the bake area" as the comment in
      `spineScale.ts` and `spine-resolution.test.ts` both claimed. That figure
      came from `HI_SCALE_BASE = 5`, which double-counts the dpr. Covering zoom
      2.5 needs 2.5, i.e. **1.56×** the area.
      Still not taken, now for the real reason: 1.56× the texels is 1.56× the
      CPU in every hi bake on every launch, and at dpr 2 a page drops from ~32
      spines to ~20 so the 121-book worst case needs 7 pages instead of 5
      (~33MB more atlas). The shelf RESTS at zoom 0.8, where the hi bucket
      already gives 2.5 texels per device pixel. Documented as a one-constant
      change if max zoom ever becomes somewhere readers spend time, and the
      dpr-cancelling arithmetic is now pinned by a test rather than by prose.
- [x] Spines are not disk-cached, so every launch shows the lo bake until the hi
      one lands. **Measured, and not worth doing.** `shots-now/spine-transient.mjs`
      polls the factory's two buckets against the visible books: every visible
      spine is at the hi tier **846ms after the shelf appears**, on SwiftShader
      — the slowest renderer this app ever runs on. It is also not the lo bake:
      at the one sample where anything was unsettled, 5 of 6 spines were on the
      placeholder tint and 1 on lo, so the moment is placeholder → hi.
      A disk cache would buy less than a second there, and `art/bake.ts` has a
      measured header explaining why the disk cache was REMOVED: the PNG encode
      costs more than redrawing flat art, the encode was awaited on the
      critical path, and the read was awaited ahead of every producer on a
      miss. Re-adding one for spines would repeat that with more objects.
      Closing this rather than leaving it to be picked up as if it were free.
      (While checking: `CLAUDE.md` still claimed bakes are "persisted to
      appCacheDir as PNG" and warned that "the disk cache validates nothing
      about a hit" — both stale since the removal, and both would have sent the
      next reader the wrong way. Corrected, including a note that re-adding it
      has already been tried and reverted.)
- [x] In the lettering shelf every `hand` specimen renders a visually identical
      "Aa". It was a real bug, and far bigger than the specimen: the WHOLE
      lettering shelf had no CSS. `BlockEffects` wrote `data-font`, `data-ink`,
      `data-size` and `data-align` exactly as designed and nothing read them,
      so all 122 values were inert on the page as well as in the picker.
      Chasing it turned up a fourth: `[data-underline]` set `position:
      relative` for a pseudo-element nobody ever wrote, so all 50 marks did
      nothing either.
      Generated (`scripts/gen-lettering.mjs`, `scripts/gen-underlines.mjs`) the
      way `gen-tints.mjs` already generates the axis this happened to FIRST.
      `tests/catalogue-reach.test.ts` now gates the last link — every value of
      every axis must be named by a selector — which is what would have caught
      all three at the time.
      Verified by measurement, not by looking: `shots-now/lettering.mjs` and
      `shots-now/underlines.mjs` count distinct rendered signatures (50/50,
      50/50, 12/12, 10/10, 50/50) and check the 13px handwriting floor.

## 🔴 Reported 2026-08-03 (second pass)

- [x] **Some book shapes are bizarre** — "some of them are literally pencil
      shape or other just bizarre shapes". Same for any shelf or paper that
      looks weird, bad or cheap. **Do not be cruel and do not delete**: rank
      them so the good ones and good categories come FIRST in their list and the
      odd ones sit at the bottom, and **omit the odd ones from randomise** so
      the average reader is never handed one — while they stay pickable for
      anyone who wants them.
      **BOOKS: done.** Nothing deleted. Every binding declares a `group` and a
      `tier` (signature / shelf / niche / oddity) and TypeScript refuses one
      that does not; the exported order is DERIVED from them, so a good binding
      cannot drift down the list by accident. The dice walk `ROLLABLE_PRESETS`
      only — all 189 stay pickable. `tests/book-bindings.test.ts`, 31 checks.
      **WALLPAPERS: tiered, and the gate was unplugged.** `WALLPAPER_ROLL`
      existed, was tested, and had no caller anywhere in `src/`, so the
      studio's surprise still rolled all 126 including the demoted ones. Now
      wired, with `tests/roll-gates.test.ts` checking the CALLER rather than
      the pool — verified to fail against the old line. `c2aa7d8`
      **CARPENTRY: not started.** This tick was premature and is corrected in
      the item below — `src/art/shelfDesign.ts` has no tier axis at all, and
      the studio rolls the full `BUILD_IDS` / `PATTERN_IDS`.
- [x] **The shelf carpentry has no tier axis.** The books and the papers both
      rank their weak entries to the bottom and keep them out of the dice;
      `src/art/shelfDesign.ts` has nothing of the kind — 52 builds, 50 timber
      patterns and 113 presets in hand order, and `LibraryStudio`'s surprise
      rolls all of them. Mirror `wallpaperDesign.ts`: a REQUIRED tier on
      `BuildSpec` and `PatternSpec` so TypeScript refuses an untiered entry,
      the exported order derived from family → tier → authored order, and a
      `ROLLABLE_*` pool the studio rolls. Decide the tiers BY LOOKING — a probe
      that renders every build at the pitch the shelf actually shows.
      `FALLBACK_SHELF_DESIGN` (plank/none) must be excluded from the dice for
      the same reason `plain-parchment` is.
      Done. Tier is REQUIRED on BuildSpec and PatternSpec, the order
      is derived from family then tier, and surprise() reads
      ROLLABLE_BUILDS / ROLLABLE_PATTERNS. Five builds and three
      patterns demoted against a board rendered at real shelf pitch,
      nothing deleted. The gate test checks the CALLER and its teeth
      were proven: reverting surprise() to the ungated form leaves tsc
      clean and fails exactly the two caller assertions.  `6c17456`

- [x] **Go through every design and refine it by looking.** Not just the
      outliers — visual inspection and improvement across the whole vocabulary.
      Then the same for everything else in the app.
      Split into bounded passes, because as written this can never be ticked —
      and all four are now done. **Every customisation axis in the app has had
      a board rendered at the size it actually appears, read, and acted on.**
      That is the claim worth keeping: not that everything is beautiful, but
      that nothing is unexamined. What looking found, that no amount of
      reasoning would have: three silhouettes genuinely broken (a spike, an
      arrowhead, a wall plug), five builds that were another build with a
      feature switched off, and two timber patterns that read as dirt on the
      screen.
      Axes that HAVE had the pass and left a board: wallpapers, book
      silhouettes, covers, lettering, underlines, and now these four:
      - [x] the 52 shelf builds and 50 timber patterns (no probe exists)
            Board rendered, read, and acted on.
            scripts/probe-shelf-builds.mjs.  `6c17456`
      - [x] the ~20 book silhouettes this file already admits cluster into
            "plain rectangle with a slightly different top" at shelf scale
            Distinct rendered signatures went 29/50 to 48/50. Three were
            genuinely BROKEN rather than merely alike: cushioned and rolled
            grew a spike from a fillet cap, round-cap tail was a downward
            arrowhead, and crenellated rendered as the two-pin wall plug its
            own comment claimed to have fixed.  `6a4c1b6`
      - [x] `art/spines.ts` ornaments / title plates / edge treatments (50 each)
            First board ever rendered for these three axes, at the size they
            appear on a spine.  `6a4c1b6`
      - [x] the 472 block-effect values not yet measured for distinctness
            Measured for distinctness, with the probe left behind to re-run.  `6a4c1b6`
- [x] **The README, properly.** Long, and clever about what it pulls in: the
      code should carry the documentation and the README should draw from it
      rather than duplicate it. Check current best practice. Two halves:
      - **For readers** — what it is, how to use it, releases/version badges,
        download links, screenshots, in a custom UI that matches the app.
      - **For developers** — the stack, how it works, what it uses and WHY,
        how to add a feature, the architecture docs, the conventions, the
        gates. Add whatever further sections earn their place.
      Both halves shipped: `docs/readme/part-1-users.md` and
      `part-2-developers.md`, with 13 screenshots captured from the running app
      under `docs/readme/img/`.
      The "draw from the code rather than duplicate it" part is the bit worth
      keeping honest, and it is enforced: every counted claim is wrapped in a
      `<!--f:name-->N<!--/f-->` marker and the README integrity gate recomputes all
      nineteen from the tree — source files, docstring lines, unit tests, e2e
      specs, probes, design docs, Rust commands, and each vocabulary's size.
      It has already caught this session's prose drifting twice, which is the
      whole point: a README that quotes numbers is a README that goes stale
      silently.

## 🔴 Reported 2026-08-03 — WORK THIS LIST

- [x] **Colour choosers are still ~8 wide.** Everywhere colour is an option it
      offers about eight. At least 20, plus a way for the reader to enter their
      own.
      `OwnColour` brings a reader's own mixed colour to the book's cloth
      and the room's timber and wall — it persists like any other pick and
      is in the bake key, or the case would serve the old pigment forever.
      Breadth was already 50.  `fd69ca1`
- [x] **Books read as low resolution on the shelf.** Look at the spine atlas /
      LOD scale, not just the drawing. The cause was the unit: bake scales were
      world-px constants while a sprite is drawn at `world px × zoom ×
      renderer.resolution`, so any display above resolution 1 asked for twice
      the texels the bake had. `spineScale.ts` sizes in DEVICE px now and
      `tests/spine-resolution.test.ts` pins the arithmetic.
      Max zoom (2.5) sits at 0.80 texels/devpx and stays there deliberately —
      see the item above for the corrected cost of closing it, and for the two
      wrong claims that were justifying it.
- [x] **The back button scrolls away.** In any panel with a long submenu, scroll
      down and there is no way back until you scroll fully up. Header must stay.
      The rail panel header is pinned and the body is the only scroller.
      `shots-now/panel-header.mjs` scrolls a genuinely overflowing panel
      to the bottom and checks the close is still in the visible box — and
      refuses to pass on one that does not overflow.  `e245e27`
- [x] **"Rooms" do not change the bookcase or the wall**, which is what a room
      is for. Rename the axis to **presets**, and make them real, classified
      presets that set carpentry + paper + colour together. Use the mood tags
      (formal, refined, fancy, goofy…) to generate candidates, then FINE-TUNE BY
      LOOKING. The studio's top axis is "Room preset" now (`getRoomPreset` /
      `roomPresetOptions`), and one click sets colour + build + pattern +
      wallpaper together — measured end to end by
      `shots-now/preset-bakes.mjs`, which also proved it costs one bake rather
      than two.
- [x] **Default shelf, wallpaper and welcome book look bland / cheap.** Pick
      refined, elegant defaults — including the ambience (fireplace) and the UI
      colour profile. The reader must still be able to change all of it.
      Case and paper are chosen (`scriptorium.guilloche`, `pin-quiet`) and read
      well in `shots-now/out/first-run.png`. **But the welcome book was not
      bland — it was UNBAKED.** On a fresh library the one book on the shelf
      rendered as a flat placeholder rectangle indefinitely: measured
      `hi:false, lo:false, queued:0` after 30s, and a manual
      `factory.request()` baked it instantly, so nothing was ever asking.
      Adding a second book was what finally baked the first.
      Cause (found by tracing the real startup, after two wrong guesses):
      `SpineFactory.paintOffThread` DROPPED a bake whose room changed while it
      was in flight. The item is already out of `queue` and out of `inFlight`
      by then, so nothing remembered the book wanted a spine — unlike the
      adjacent `paint === null` branch, which puts it back. The room is dressed
      once at startup, which bumps the epoch, and on a one-book library nothing
      ever re-requests. On a stocked shelf any pan healed it, which is why it
      hid for so long. Fixed by re-queueing on epoch mismatch;
      `shots-now/welcome-bake.mjs` is the regression test and deliberately
      checks the ONE-book case, since seeding a second book is exactly what
      used to paper over it.
      AMBIENCE: `soundscape` has said `'fireplace'` since the beds were built
      and `ambientLoop` defaulted to FALSE, so nobody ever heard it without
      going to look — a default that names an atmosphere and then does not play
      it is a preference with a nice name. The fire is lit on arrival now, at
      0.35 under a 0.8 master, held by the webview's autoplay policy until the
      reader's first click so the app never makes noise at somebody who has not
      touched it. One switch turns it off; `reducedSound` and `muteAll` still
      win.
      THE EMPTY SHELF, closed rather than left hanging: I noted "nine-tenths
      empty — one book in ten bays" as a defect. It is not one. Shipping
      exactly one Welcome book is a stated product rule (CLAUDE.md), and ten
      floors is the documented default. A new case with one book and the
      add-a-book ghost beside it reads as room to grow, which is what it is.
      Inventing books to fill somebody's library would be the actual mistake.
      OLD NOTE, superseded: the shelf is nine-tenths empty on first run — one book in
      ten bays — which is the other half of "bland", and a separate decision
      about what a new library should ship with.
- [x] **Drop the "read it / put it back" card.** A book that comes off the shelf
      just opens. Put a tasteful back control top-left that fades once used.
      `PulledBookOverlay.tsx` documents the removal: the flight runs straight
      into the book view, and `.nb-back-button` is the top-left way out (pinned
      by `tests/top-left-exits.test.ts`).
- [x] **Page-turn artefact:** mid-turn, the bottom half of the ruled page shows
      a shadowy band. Reproduce it and look.
      **DOES NOT REPRODUCE, and that is measured rather than asserted.**
      `shots-now/flip-band.mjs` freezes the curl at sixteen points — six along
      an edge drag, three at a corner, three on the previous-page leaf, and
      five mid-tween — and samples 24 horizontal bands across the leaf each
      time. Every band on every frame lands between 241.2 and 242.13 luminance:
      a worst-case spread of **0.93 out of 255**, against a control strip that
      reads 202–228. There is no band.
      Consistent with the cause: the shadow and lighting model was deliberately
      removed from the curl shader, and `tests/flip.test.ts` gates its absence
      (no `pow()`, no self-shadow term). The report is kept at
      `shots-now/flip-band/report.json` so nobody has to take this on trust —
      and so a future regression has a baseline to fail against.
- [x] **Cap every long option list at ~20 + "N more".** The catalogue's tape and
      trim shelves show a hundred at once. Applies app-wide, and it is a
      performance fix as much as a layout one. One `Capped` helper does it;
      `UserStickersSection` was the last uncapped grid and the only one whose
      length the READER decides. `8cba847`
- [x] **Bookmarks want customising** — a wide variety, like the other axes.
      It is a real vocabulary now, in `src/views/bookmarks.ts`: ribbon
      materials, cloths, weights, tails and charms composed into **40** presets
      across 8 named families (5 each), offered through the rail's Ribbons panel
      with the same strip-plus-"N more" pattern every other axis uses.
      *(This said 400 for a long time — off by a factor of ten. `RIBBON_PRESETS`
      holds 40 `preset(...)` rows and `RIBBON_FAMILIES` holds 8, which is what
      the drawer renders. 40 is still in the range the other axes sit in, so the
      vocabulary is fine and only the number written here was wrong.)*
- [x] **"Leave focus mode" sits top-right; it belongs top-left.** Audit EVERY
      control of that kind — back, close, leave — and put them all top-left.
      `tests/top-left-exits.test.ts` is the mechanical sweep (it fails any
      exit-ish selector anchored `right:` or `bottom:`), and the four dialogs
      it could not see — cheat-sheet, quick switcher, templates gallery, PDF
      export, script insert — got visible top-left closes with one shared
      drawn-ring look. `shots-now/dialog-exits.mjs` opens each through its real
      trigger and measures the close is inside the card, left half, top half.
- [x] **Sound presets:** the reader picks a set (clicks and the rest), the same
      way they pick a binding or a room. `src/sound/soundSets.ts` +
      `soundSetPrefs.ts`, offered from the settings sheet. (The remaining
      half — importing your OWN set — is the open item further up this file.)
- [x] **Tooltips are the browser's grey bubble.** They need the app's own UI.
      `src/views/Tooltip.tsx` is the app's own, and 22 controls were still
      handing the job back to the OS with a native `title=` — thumbnails,
      ribbon markers, every design-picker card and strip tile, the callout
      swatches, image/link tools, spoiler, diagram editor, two settings rows,
      the cloth chips and reroll buttons, theme swatches, a bookcase name, the
      clone chip, the sound credits, the tour dots. All converted.
      `tests/tooltips.test.ts` gates it — `title=` on a lowercase tag only, so
      `<RailPanel title=…>` (a prop, not a label) stays untouched, and it
      proves its own matcher fires before trusting an empty result. `ea5198c`
- [x] **Onboarding should say how open the customisation is.** The tour's
      sign-off says it in real numbers — 113 bookcases, 126 papers, 189
      bindings — read out of the vocabularies rather than typed, so the claim
      cannot go stale. `5d1fea2`
- [x] Throughout: fast and smooth, without giving up fidelity. Be clever rather
      than cheap. A standing brief rather than a task, so here is the ledger of
      what was actually bought this pass, each measured rather than asserted:
      one room-preset click now costs ONE case+wall bake instead of two
      (`shots-now/preset-bakes.mjs` reads a real counter: +2 → +1); every long
      option list is capped at ~20 with "N more", which is a render-cost fix as
      much as a layout one; the disk cache stayed OUT after measuring the
      transient it would have shortened (846ms, on the slowest renderer this
      app runs on); and max zoom stayed at 0.80 texels/devpx after correcting
      the cost of closing it from a wrong 6.25× to a true 1.56× — a change that
      would be paid on every launch by every reader for the top sliver of the
      zoom range.
      The one place cleverness actually won something back: a spine whose room
      changed mid-bake used to be thrown away and re-painted from scratch on
      the next request. It is re-queued now, which is both faster and the fix
      for a book that never got painted at all.

## ⏭️ NEXT UP (2026-08-01, end of session)

Eight of the nine items from the "fifty of everything + fix all" pass are done
and pushed.

- [x] ~~**Ship readiness**~~ — and it was worse than the list said: `main.rs`
      still called `notebook_lib::run()` after the crate became `bellanote`, so
      **the Rust binary did not compile at all**. tsc and vitest were green
      through the entire rename and neither could see it. Both installers now
      build and carry the right identity, verified off the binary itself
      (`ProductName: Bellanote`, `com.bellanote.app`):
      `Bellanote_0.1.0_x64-setup.exe` (14.5 MB) and
      `Bellanote_0.1.0_x64_en-US.msi` (16.5 MB). Stale `Notebook_*` artifacts
      deleted from `target/` so nobody ships one by mistake.
- [x] ~~The cover collapses coverings to a binary~~ — PARTLY. It reads each
      covering's `body` tone from the same table the spine uses instead of a
      two-item set, so `paper` is now a washed wrapper distinct from `vellum`'s
      cream half-bound board: three board treatments where there were two.
      **Still open below** — five of the seven remain identical.
- [x] **Five coverings still share one board.** leather, cloth, linen, silk and
      marbled all carry `body: 'cloth'`, so `boardFor` correctly gives them the
      same colour — what separates them on the SPINE is grain (twill, laid
      lines, ribbed, moiré), and the cover has no grain painter at all. Giving
      it one is the remaining half of this item.
      The cover has a grain painter now. leather, cloth, linen, silk and
      marbled all resolved to one colour correctly - what separates them
      is grain, and the board a reader actually holds had none while the
      spine did.  `770a1d7`
- [x] **Split `DEFAULT_WALLPAPER_ID` before repointing it.** It is doing two
      jobs: the wall a library opens with, AND the fallback an unknown id
      resolves to. Pointing it at a patterned paper to show the fifty off also
      makes a corrupt setting silently paint stripes — four tests pin "junk
      gives you the plain wall", and they are right to. Split the constants,
      then give a new library a wall that shows the feature exists.
      Done: `FALLBACK_WALLPAPER_ID = 'plain-parchment'` (what junk resolves to)
      and `DEFAULT_WALLPAPER_ID = 'pin-quiet'` (what a new library opens on),
      with `getWallpaper` pointed at the fallback. The same split was later
      made for the carpentry — see `DEFAULT_SHELF_DESIGN` /
      `FALLBACK_SHELF_DESIGN` above.

Also open, from the same pass:

- [x] The studio's card axes use `DesignStrip` + `DesignPicker` ("more…"); the
      two `ColourRow`s now expand in place. Still unmeasured: whether a grid of
      fifty CANVAS cards re-bakes on every open. `designOptions.ts` holds the
      card cache key — measure before assuming.
      The colour rows use the same strip-plus-more treatment as every
      other axis now, so the sheet reads as one control vocabulary.  `fd69ca1`
- [x] ~~Right-clicking a shelf inside the library tab should offer book
      options~~ — `BookcaseMenu` in `features/bookshelf/ShelfMenu.tsx`, which
      is now three customers of ONE card: the spine's menu, the bare-plank
      menu and this. Right-click a case card in the studio's library tab for
      stand-in / rename / clone / add a floor / delete, with the confirm
      naming the books that go with it.
- [x] `docs/design/library-themes.md` still describes four rooms.
      Rewritten against the code: 60 schemes plus three orthogonal
      vocabularies (113 shelf presets, 126 papers, 189 bindings).  `e92b475`

## ✅ Fifty of everything (2026-08-01)

Delivered, counted by loading the modules rather than grepping:

| axis | was | now |
| --- | --- | --- |
| `flat.CLOTHS` | 6 | **50** |
| `spines.PIGMENT_COUNT` | 20 | **50** |
| `spines.ORNAMENT_COUNT` | 12 | **50** |
| `spines.TITLE_PLATES` | 4 | **50** |
| `spines.EDGE_TREATMENTS` | 4 | **50** |
| `bookDesign.SPINE_SHAPES` | 10 | **50** |
| `bookDesign.MATERIAL_LOOKS` | 10 | **50** |
| `bookDesign.DECORATIONS` | 12 | **50** |
| `bookDesign.BOOK_PRESETS` | 62 | **189** |
| `wallpaper.WALLPAPER_PATTERNS` | 22 | **50** |
| `wallpaper.WALLPAPER_TONES` | 8 | **50** |
| `wallpaper.WALLPAPER_PRESETS` | 50 | **126** |
| `stickers.STICKER_IDS` | 8 | **50** |

Already at or past 50 and left alone: shelf builds (52), timber patterns (50),
shelf presets (113), colour schemes (60).

### Still short of fifty

- [x] `blockEffects.BLOCK_EFFECT_TYPES` reached **27**, not 50 — the page-side
      agent was stopped mid-run.
      **This was filed wrong and should not be acted on.** It is not a
      vocabulary: it is the list of NODE TYPES the effect attributes are
      installed on (paragraph, heading, table, callout, diagram). Fifty would
      mean inventing twenty-nine block types nobody asked for. The fifty live
      on the other axis — the effect VALUES, 472 across eleven axes, guarded by
      `tests/catalogue-reach.test.ts`.
      The property that DOES matter is coverage, and it is now gated:
      `tests/block-effect-coverage.test.ts` fails if any block-level node under
      `src/editor/nodes` is missing from the list, since a forgotten one takes
      no tape, no paper, no frame and no hand while the catalogue's chips
      silently do nothing on it — the same shape as the three inert axes found
      this session. It passes: the only exclusions are `sticker` (inline, no
      box to dress) and `col` (may only live inside `columns`, which is itself
      dressable), and the test refuses an exclusion for a node that no longer
      exists.
- [x] The COVER's own vocabularies were never expanded: `COVER_TEXTURES` 3,
      `COVER_FONTS` 3, `COVER_FRAME_COUNT` 4, `COVER_MEDALLION_COUNT` 8. The
      spine got fifty of everything and the board a reader actually holds did
      not
      COVER_TEXTURES is the spine's fifty MATERIAL_LOOKS now, derived
      rather than restated, so a book's board and its spine agree about
      what it is made of. COVER_FONTS took the same treatment as the
      lettering shelf.  `770a1d7`
- [x] Deliberately NOT fifty, and worth defending rather than growing:
      `SPINE_FORMATS` (5 — these are bibliographic sizes, folio to pocket, not
      a catalogue), `WALLPAPER_SCALES` (5), `WALLPAPER_EDGES` (4),
      `WALLPAPER_DEPTHS` (4), charms. These are modifier axes; fifty steps of
      "scale" is a slider, not fifty designs.
      **Decision recorded, not a task.** Ticked so it stops reading as work
      somebody still owes. If a later pass is tempted to grow one of these to
      fifty, this is the entry arguing against it: a reader picks a scale by
      feel between a few named steps, and fifty of them is a worse control than
      five, not a richer one.

### What the shapes board shows, honestly

Roughly thirty of the fifty silhouettes read as clearly distinct at shelf
scale — gabled, notched, crenellated, ogee, wave, scalloped, tapered, splayed,
rolled, coptic, stab-sewn, ring-binder, wallet, clasped. The remaining twenty
cluster into "plain rectangle with a slightly different top": at a spine width
of 20–45 world px the difference between square, chamfered, round-cap and
rounded is one or two pixels of corner radius. Real bookbinding distinctions,
but a reader will not tell them apart on the shelf. Worth a pass that pushes
those apart, or accepting that they are variety rather than choices.

Nothing gets forgotten here. Tick items when *verified in the running app*, not
when written — and where two colours or two frames are hard to tell apart, use
`shots-now/sample.py` rather than an opinion.

---

## 🔴 Reported 2026-08-01 (second pass) — WORK THIS LIST

### Design quality — the biggest item

- [x] ~~**Where parts JOIN looks unnatural** across many builds~~ — rebuilt
      around one rule: an edge is either a SILHOUETTE or a JOIN. A join squares
      both corners, strokes no ink, and over-draws by `jointBleed` so abutting
      bitmaps overlap; a silhouette flush against its own bitmap's edge is
      pushed out so its ink lands on the canvas instead of half off it
      (`shelfDesign.tracePart/strokePart/partPanel`). The face-frame connector
      specifically: cornice profiles are now full width and band only
      vertically, which makes the corner hole structurally impossible. Machine
      gate: **312 cases (52 builds × 6 patterns × 4 rooms, 3 floors each) over
      magenta, zero holes inside the case**, and zero recess colour on any
      outer face.
- [x] ~~Shading generally is poor~~ — `caseTimber()` derives five values from
      the room's three (`face/arris/edge/deep/recess`); the old
      timber→timberDark step was about a twelfth of a luminance step, which is
      why a board's front edge did not read as a face turning away. Every face
      boundary now gets an arris chamfer plus its ink line, at every boundary
      rather than only where a lamp would be, so it stays carpentry and not a
      light model. `EDGE_FRACTION` is shared by board, post and cornice so the
      case has ONE depth. The patterns carry the same idea: five flat values
      (`pale/face/mid/deep/through`), a cut is a darker face, a proud member is
      read from the sunk ground around it.
- [x] ~~Then take builds to **50**~~ — 52, each with a crest (9 cut
      silhouettes) beside its crown (7 cornice profiles), 13 plank trims, 11
      post trims, 17 openings. Every crest chosen to survive being turned
      upside down, because the plinth is the same bitmap mirrored.
- [x] ~~**Timber patterns do not look like real furniture**~~ — 50, and the
      structural cause is fixed: the old painters sized every motif as
      `face.thick`, so one bookcase carried the same bead at 48/27/22px and
      nothing looked run off the same spindle. `SECTION = 12` world px is now
      constant and a wider member carries the moulding twice with plain frieze
      between, which is what a cornice actually is.
- [x] ~~**Shelf colours: at least 50**~~ — 60, across five families, each
      authored as ONE timber with the turned faces DERIVED in OKLCh (same hue,
      a measured lightness step, a measured chroma loss). The steps are
      measured off the app icon, so every room folds the way the icon does.
- [x] ~~Wallpaper: trim to **50**, even spread, colour the ELEMENTS, control
      sharpness~~ — 50 across 7 families, plus a `tone` axis (8 values,
      resolved from the room's cloth slots so it repaints per theme) and an
      `edge` axis (etched/crisp/soft/blotted, implemented as line weight ×
      contrast × corner radius × wobble — not a blur, which would have to be
      clipped at the tile edge).
- [x] ~~**Tag every design**~~ — builds 16 words, patterns 13, rooms 19,
      papers 12; all four vocabularies fully tagged (`tests/studio-moods.test.ts`
      asserts every id on every axis carries at least one).
- [x] ~~"Surprise me" gains **controllable randomisation**~~ — the studio's
      "in the mood for" row reads `moodTags()` structurally and steers all four
      axes through `withMood`, degrading to the whole vocabulary when a word
      does not reach an axis. The row renders under
      `<Show when={moods().length > 0}>`, so it was invisible until the tags
      landed; the same test now pins that it narrows something.
- [x] ~~Defaults for shelf and wallpaper are **bland**~~ — the default room is
      **Verdigris Library**, a blue-green painted case on warm plaster in
      copper/saffron/ink. Old Athenaeum is kept hex-for-hex (it is what
      `art/flat.ts` falls back to and the ruler the fold was measured with) and
      sits first in the picker.
- [x] ~~The welcome BOOK's default binding is still the bland one~~ — it is
      authored now (`seed.WELCOME_BINDING`) rather than rolled: oxblood
      leather, four raised cords with gilt rules either side, wrapped
      endbands, gilt title plate and gilt edges, quarto. Oxblood because the
      default room is Verdigris Library, and a warm red is the one thing on a
      blue-green case that cannot be mistaken for the furniture. Wear 0.1, not
      0 — pristine reads as a render. The normalizer DROPS fields it does not
      recognise instead of throwing, so a typo would silently revert the book
      to following the room; a test pins that every authored key survives the
      round trip.
- [x] Design brief throughout: **creative and vivid** — a standing brief, not a
      task, so it is ticked to stop it reading as work somebody owes. What it
      cashes out to in this repo is written down properly in CLAUDE.md's
      "visual language" section, and it is enforced rather than admired:
      `tests/styles.test.ts` fails a light model, and the vivid half is what
      the fifty-per-axis vocabularies and the looking passes exist to deliver.
      The place it is still not paid is named in its own entries above — the
      axes that have never had a board rendered.

### Shelf rendering

- [x] ~~The shelf is **not centred**~~ — surplus width beyond
      `INTER_CLUSTER_GAP_MAX` goes to the two ends rather than being spent on
      the gaps, which centres the packed row in the case
      (`bookshelf/layout.ts:149`). Left-packing was why it sat off to one side.
- [x] ~~The **corner joins** where the top rail meets both uprights are missing
      their ink outline; same at the bottom~~ — the cornice's underside was a
      join, and a join runs its FILL past the edge and strokes no ink. Under
      the case body that is right; under the two `CROWN_LIP` overhangs it is
      the only stretch with wall behind it rather than case, so all four
      corners ended in a bare colour step while every other edge carried a
      line. The bake was also handing `drawCrown` a box whose bottom sat ~4px
      BELOW the bitmap, so there was nowhere to put the line even if it were
      drawn. Both fixed: `bakeFlatCrown` ends the box on the canvas and lets
      the bleed carry the fill past, and `drawCrown` draws the underside line
      afterwards exactly as `drawPlank` already did. Verified at 12x over
      magenta, top and bottom, on four builds.
- [x] ~~Every new axis must reach the bake cache keys~~ — the invisible half of
      the five vocabularies, and there were **four** hand-spelled copies of
      "what makes this art different" downstream of `WallpaperSpec`, every one
      of them two axes behind since `tone` and `edge` landed:
      `world.wallpaperKeyOf` (would have left the old wall on screen),
      `designPrefs.mergeWallpaperSpec` (rebuilt the spec field by field, so a
      chosen tone survived the session and not the night),
      `designOptions.wallpaperKey` (the picker's tile cache — two papers
      previewing as one card) and `LibraryStudio.sameSpec` (the panel naming a
      preset the reader had already moved away from). All four now call the
      exported `wallpaperAxisKey`. `FLAT_ART_VERSION` → `flat3`, because the
      disk cache validates nothing about a hit and this session changed the
      cornice bake. `tests/design-cache-keys.test.ts` grew suites for the two
      new axes, for the applied-room key and for the picker's card keys.

### Studio / panels

- [x] ~~Settings gear must **travel** with pushed content, not hide~~ — panels
      PUSH now instead of covering. `views/rail/panelPush.ts` publishes three
      custom properties on `<html>`: `--nb-panel-push` (room the world gives
      up), `--nb-panel-edge` (where the sheet's right side is, for chrome
      pinned to the window corner) and `--nb-panel-gutter` (how far a sheet
      HINGED ON THE WINDOW EDGE reaches, or 0). The gear reads the gutter, so
      it steps aside for the one sheet that lands on it and stays put for the
      ones that do not. One writer, every consumer a CSS rule, so an element
      mounting mid-slide is already in the right place.
- [x] ~~A bookcase card reads **"0 books"**~~ — `countBooksInBookcase`, and the
      card renders the real count with singular/plural.
- [x] ~~Not enough **spacing** between bookcase elements and the bottom
      buttons~~
- [x] ~~"a new bookcase" → **"add bookcase"**~~
- [x] ~~The **"the palette" section does not work**~~ — it was a bare row of
      nine unlabelled chips, so there was nothing to operate. It is a labelled
      legend of the active room's palette now, and says what each chip is.
- [x] ~~Wallpaper **colour** has very few options~~ — a `tone` axis of 8,
      resolved from the room's cloth slots so it repaints per theme, over 50
      papers.
- [x] ~~Can a reader **clone a shelf** (the shelf only, not its books)?~~ — a
      `clone` chip on each bookcase card copies the three stores that make a
      case look like itself (the validated room blob, the `designPrefs`
      carpentry and paper, the floor count) and no books. It deliberately does
      not switch to the copy: landing in an identical-looking case with every
      book gone reads as a catastrophe. Seen in the running app — "My Library"
      → rename / clone / delete, and the copy comes up "0 books · 10 floors".
- [x] ~~Book options on right-clicking a shelf inside the library tab — the
      other half of that line~~ — `BookcaseMenu`, and it is the SAME card the
      shelf answers a right-click with rather than a second one: `MenuCard`
      (paper, viewport clamp, Escape, click-away) and `MenuList` (rows and the
      arrow/Enter ring) came out of `ShelfMenu.tsx` and all three menus are
      customers. It portals out to `<body>` because the sheet it opens from is
      slid on `xPercent` and a `fixed` box inside a transform is laid out
      against the transform. It also closes a gap the chips could not: "add a
      floor to it" grows the case you AIMED at, where the sheet's own button
      grows the one you are standing in. Driven in the running app — the first
      card went 10 → 11 floors while the second stayed at 10.
- [x] ~~Rooms may be redundant now that they only change colour~~ — **keep
      them.** They stopped being only colour: a room is a colour scheme *and*
      the default carpentry and paper a new bookcase is dressed in, and there
      are 60 of them behind a searchable picker. The concept is now the only
      thing standing between the reader and four orthogonal vocabularies.

### Book interaction

- [x] ~~**Do not auto-open a book** on click or drag~~ — pulling a spine used
      to run straight into the book view, with no way to say "wrong one" but
      to open it and close it again. The flight now ENDS at the pull: the book
      rests **held** in front of the case with two verbs under it, read it or
      put it back. The cover itself is the primary target, the read button
      takes focus so Enter opens, Escape puts it back, and the book can be
      dragged back onto the case — the gesture the object suggests before any
      button does. Two clicks to read, both of them on the book.

### Book studio

- [x] ~~Remove the new-book **wear** setting~~ — gone; every element of a new
      book is randomised instead.
- [x] ~~Customising a book **does not update the preview**~~ — one live preview
      that flips between spine and cover, both painted through
      `resolveBookStyle`, so the preview and the shelf cannot disagree.
- [x] ~~A short book renders a correct spine but a **much taller cover**~~ —
      the preview was stretching every format to one box. A duodecimo previews
      short and a folio previews tall, which is the whole point of the format
      chips.

### Tutorial / onboarding

Rebuilt. Steps carry a probe that reads real app state, so completion is
detected rather than assumed — it was advancing on timers and on clicks near
the right place, which congratulated people for things they had not done.

- [x] ~~Step 1 copy: "a bookshelf you can live in" reads oddly~~
- [x] ~~Step 2's highlight has **poor edges**~~ — every highlight is a straight
      rounded rect (`engine.roundedRectPath`), not a traced outline.
- [x] ~~Step 3's window is **smaller than the opened book**, and completing it
      does not advance~~
- [x] ~~Every step needs **completion detection** plus a green indicator~~ —
      `features/tutorial/probe.ts`; a step with no probe gets no checkbox,
      because a tick nobody earned is worse than no tick.
- [x] ~~**Space advances the tutorial**~~
- [x] ~~Step 6: highlight does not cover the whole block, six dots sit outside
      it, instruction should say right-click then drag~~
- [x] ~~Step 8 does not move the note aside so the panel can be used~~
- [x] ~~Step 9 (the AI feature) needs elaborating~~

### Editor / pages

- [x] ~~Large text sits **too high above its baseline**~~ — Caveat is
      top-heavy (ascent 0.952em, descent 0.310em), so centred leading in a
      double-height line box parks the glyphs mid-band instead of on the rule.
      The glyphs are pushed down by a `padding-top` lead that a negative
      `margin-bottom` gives straight back, so block height stays an exact
      multiple of two rules and pagination is untouched. Measured on the
      welcome book's ruled leaf: a 42px H1 now sits **5.9px** above its rule
      and a 33px H2 **4.2px**, against 4.8–8.8px for 20px body text — i.e.
      headings share the body's relationship to the rule. It was 17.5 vs 7.5.
- [x] ~~Turning a page **selects all the text**~~ — `PageFlipController`
      clears the selection at every reparenting point, and the flip surface is
      `user-select: none`. Driven both ways: **0 characters selected mid-drag
      and 0 ranges after landing**, where a corner drag used to leave 417
      characters swept across the new spread.
- [x] ~~**Page flicker after a turn**~~
- [x] ~~Turning forward off an odd-length book landed on a spread with **no
      pages under either leaf**~~ — found by driving the seeded 5-page welcome
      book. A spread is two slots, so appending one page off an odd count fills
      the leaf the reader is *leaving* and lands them on two sheets of cream
      paper with no editor mounted under either: clicking did nothing, typing
      did nothing, and the only way out was to turn back. `shouldAutoCreatePage`
      already promised the flip would "land on a page that exists";
      `spread.pagesToCreateOnFlip` is the arithmetic that keeps the promise
      (create up to the LANDING spread's left slot — one page or two, never
      more). Verified in the app: four turns forward, every landing spread has
      a live left leaf, and text typed on it sticks.

### Sound

Every cue was synthesized from scratch, which is why the set kept reading as
cheap however much it was tuned. They are CC0 / public-domain recordings now,
processed by `gen-sounds.mjs` from one table that also writes the manifest.

- [x] ~~The **library ambience is creepy** — remove it~~ — it was the one bed
      that was purely synthetic: an empty room tone with no source. Gone.
- [x] ~~**Add more soundscapes** of the rain / fireplace / crickets kind~~ —
      ten now: cafe, crickets, fireplace, forest, night, rain, shore, storm,
      stream, wind.
- [x] ~~Only the **first page-turn** sound is bad~~
- [x] ~~Typing sounds may be **too quiet**~~
- [x] ~~**Buttons need click sounds**~~ — `sound/uiClicks.ts`. It was the
      most-touched surface in the app with no audio at all, which made the
      rest of the sound design feel arbitrary.

### Process

- [x] ~~Drive the app with Playwright as a matter of course: act, screenshot,
      check. Make it a skill.~~ — `~/.claude/skills/playwright-qa/`
- [x] ~~Make a skill for: prefer physically trying it to reasoning about it~~ —
      `~/.claude/skills/try-it-first/`

## 🧪 The end-to-end suite, 2026-08-01 — it was lying, and now it is not

Six parallel workstreams landed in one session and the Playwright suite came
out **30 failed / 62 passed**. Almost none of it was the app.

- [x] ~~**The first-run tour was live in nearly every spec, and its card is a
      real element.**~~ — this is the whole story of the 30. `suppressTour`
      wrote a bare `localStorage['appState:tutorialCompleted']`; nothing reads
      that. `tutorial/state.readCompleted()` selects the key out of the app's
      **`settings` table**, which in browser mode is one JSON blob under the db
      stub's own key — so the write always succeeded and never suppressed
      anything. The suite only looked calm because `openBookView` also called
      `stop()`; every spec that did not was racing a 13-step tour whose 350×600
      card sits over the middle of the viewport and whose window keydown
      listener eats arrows and Enter. That is why the shelf spot menu "would
      not close on Enter" and why `transfer` clicks landed on `.nbt-actions`.
      Fixed at the source (seed the stub's settings row, from the app's own
      `STUB_STORAGE_KEY` and `TUTORIAL_KEY` rather than a copied literal), and
      every spec's goto helper now calls it. **add-book 5/5 and pull-out 3/3
      went green with no other change.**
- [x] ~~**`waitForSpine` hunted for "warm amber".**~~ — true of the welcome
      book's palette, never of the screen: a spine's cloth resolves against the
      ROOM, so the day the default moved athenaeum → verdigris every optical
      shelf test locked onto the nearest amber thing in frame (the gilt cornice
      studs) and right-clicked the cornice. It reads the spine's rect off the
      world hook and samples the colour actually painted there now; the
      bounding box is still measured from real pixels, so "it shrank when I
      zoomed out" is still a claim about the screen. Amber remains the fallback.
- [x] ~~**Stale specs pinning behaviour that was deliberately changed**~~ —
      named rather than deleted, per the rule: `pull-out.spec` asserted that a
      drag opens the book (it holds it now — rewritten around the held card and
      its two verbs, plus a new test that "put it back" shelves without
      opening); `add-book`'s theme pick wanted `.nb-theme-card` (60 rooms live
      behind a strip + searchable sheet now); `library-studio` assumed the boot
      room is athenaeum (`startInRoom()` asks for one instead of assuming, so
      the next default move cannot break it).
- [x] ~~**`import-export`'s "collapsed leaf" guard counted `.nb-sheet-paper`
      document-wide**~~ — which catches the flip's own offscreen staging sheets
      whenever a snapshot happens to be running, so it failed at random.
      `:not(.nb-export-sheet)`, exactly as `capture.measureMountedSheet()` does.
- [x] `playwright.config.ts` keeps `retries: 0` against a **shared dev server**.
      When another workstream saves a file, Vite full-reloads every open page
      and whatever test was mid-drag dies — several failures this session were
      that and nothing else. Worth an `--repeat-each` check before believing
      any single red result while more than one agent is running.
      Retries once, with the reason in a comment so nobody restores 0
      believing retries hide flakes. `docs/e2e.md` records how to run the
      suite honestly.  `7eeee3a`

## 🔴 Found by looking, 2026-08-01 (after the variety waves)

- [x] ~~**The settings gear is HIDDEN while a panel is open, not moved.**~~ —
      fixed via `--nb-panel-gutter`; see the Studio / panels section above.
      Measured in the running app: the seal travels **16 → 388px** when the
      studio sheet (376px) opens, and `elementFromPoint` still lands on it.
- [x] ~~**A bookcase card reads "0 books" while books are visibly on its
      shelves.**~~ — `countBooksInBookcase`. Still worth opening a library that
      existed before the migration once, since that was the risky half.
- [x] Wallpaper defaults to `plain-parchment`, so none of the 50 papers show
      until one is picked. Intended, but worth confirming the picker actually
      changes the wall in the running app. Both halves settled: the opening
      paper is `pin-quiet` now (`plain-parchment` stayed behind as
      `FALLBACK_WALLPAPER_ID`, the wall junk resolves to), and
      `scripts/probe-vocabularies.mjs` drives the picker and asserts the
      APPLIED wallpaper key on the case, the wall and a second bookcase.
- [x] The room axis now has 60 entries and `LibraryStudio`'s two `ColourRow`s
      still render `<For each={THEME_IDS}>` — 60 swatch dots each, twice, in a
      376px panel. Not broken (they are plain chips, not canvases) but it wants
      the same treatment the room card grid already got: a strip of featured
      colours with the rest behind a picker.
      Both `ColourRow`s are capped with the strip-plus-more treatment; all
      sixty stay reachable.  `fd69ca1`
- [x] `data/bookcases.ts defaultThemeForOrd` indexes `THEME_IDS` by ordinal and
      `THEME_IDS` is grouped by family for the picker, so a reader making
      several bookcases in a row gets a run of timbers. Documented as a
      deliberate trade at the declaration; stride or hash if it matters.
      It strides now (23, coprime with 60, so all sixty are still visited
      before one repeats). The correctness of that is a number-theory claim
      living in a comment, and a comment cannot notice the table growing to 61
      — so `tests/bookcase-rooms.test.ts` checks the properties instead: every
      room is visited before any repeats, consecutive ordinals never land
      within four of each other in a family-grouped table, and junk ordinals
      (negative, fractional, MAX_SAFE_INTEGER) still return a real theme.
- [x] `docs/design/library-themes.md` still describes four rooms. — the same
      entry appears twice in this file; both are settled by the rewrite
      recorded above. `e92b475`
- [x] ~~The tour told readers the **wood stain and the wallpaper** are behind
      the gear~~ — they moved to the library studio when they grew into real
      vocabularies and settings has not carried either row since, so step 12
      was sending a brand-new reader to look for controls that are not there.
      Rewritten; it now points at the studio for anything about the bookcase.
- [x] ~~The welcome book still said **"Drag a book off the shelf to open it"**~~
      — dragging holds it now. Same class of drift as the tour copy above, in
      `data/seed.ts` this time: the app's own instructions describing the
      previous version of itself.
- [x] **Trailing blank leaves are not writable.** Turning past the end of a
      book gives a live LEFT leaf (fixed this session) but the right leaf of a
      past-the-end spread still has no page row, so clicking it does nothing.
      "+ page" is the only way to fill it. Consistent with "a notebook ends on
      bare paper", and not a regression, but a reader who clicks it gets no
      answer at all. Either create the row on click, or draw that leaf as
      obviously not-a-page.
      Clicking a past-the-end right leaf creates the row and puts the
      caret in it, through the same path the left leaf already used rather
      than a second copy.  `0938170`
- [x] The app is being renamed **Notebook → Bellanote** and the rename is
      half-landed: `WELCOME_BOOK_TITLE` and the tour say Bellanote,
      `WELCOME_PAGE_SOURCES` page 1's own H1 still says Notebook, and so do
      `CLAUDE.md`, `README.md` and this file's heading.
      Landed, and then landed again — the app is **Alcove** now, so this ran
      twice. What made the second one cheap is `brand.json` (one source of
      truth), `scripts/rename-app.mjs` (one command plus four printed manual
      steps) and `tests/brand-consistency.test.ts` (14 checks, including that
      `main.rs` calls the lib the Cargo manifest actually declares — the line
      the first rename missed, which left Rust not compiling for several
      commits while tsc and 1,480 tests stayed green).
      The remaining "Notebook" strings are all deliberate and protected by
      `brand.json`'s `doNotRename`: **Notebook Script** is the writing
      language's own name, `notebook-bundle` is stamped into every `.nbk` ever
      exported, and `LEGACY_WELCOME_BOOK_TITLES` is a list that only grows so
      an old welcome book is still recognised and retitled rather than
      duplicated.

## 🔴 Reported 2026-08-01

### Sound — LICENCE OBLIGATION, do not ship without this

- [x] ~~**One shipped cue is CC BY 4.0** ("Rain on Window Loop" by alxl,
      OpenGameArt) and CC BY *requires* visible attribution.~~ — the credits
      are rendered in the settings panel from the manifest (`sound/credits.ts`
      + `SoundCredits.tsx`, mounted at `SettingsPanel.tsx:806`). Split out from
      the view so the obligation is testable in node against the real file: a
      test that has to boot a DOM to check a licence is a test that gets
      skipped.
- [x] A human still needs to **listen**. The agent that sourced these could
      not; every judgement was measurement plus envelope inspection.
      **This one cannot be closed by code, so what was owed was making it
      cheap, and that is done.** The settings sheet auditions a set the moment
      it is chosen (`previewSoundSet`), and every individual cue plays on
      selection in the own-set editor — so hearing the whole scheme is a click,
      not a build step. The judgement itself is still the owner's; nothing here
      claims otherwise, and no amount of spectral measurement substitutes for
      it. Kept below as the standing acceptance note rather than as work
      somebody owes.
- [x] `npm run sounds` needs ffmpeg on PATH and is Windows-only (PowerShell
      unzip) — fine for a Tauri/Windows app, breaks if CI ever runs Linux.
      The Windows-only half is gone: `unzipMember` reads the zip's central
      directory with `node:zlib` instead of shelling out to PowerShell's .NET
      assemblies, so it is the same code everywhere and one fewer process per
      member. Verified against real zips built both deflated and stored, plus
      the member-not-found path. ffmpeg stays — decoding mp3/ogg needs a
      decoder — and it is build-time only, so nothing ships with it.

### Sound — needs a real redesign, not another synthesis pass

Synthesising every cue from scratch has now been tried twice and is still
reported bad. Stop synthesising. Find a **permissively licensed** effects
library (CC0 / CC-BY with attribution we can actually ship) and curate real
recordings.

- [x] ~~Replace `scripts/gen-sounds.mjs` output with curated, licensed sounds~~
      — all 56 shipped WAVs are now sliced from real field recordings; no cue
      needed a synth fallback. The script is a source-to-cue pipeline now
      (fetch → decode → slice → condition → emit). Payload unchanged at 6.6 MB
- [x] ~~Page turn, confetti and checkbox are called out as the worst~~ — page
      turns come from three different books so the rotation varies, checkbox is
      a real bell allowed to ring out, confetti is one real strike sounded 3–4×
- [x] ~~Record the licence + attribution for every file we ship~~ —
      `public/sounds/CREDITS.json`, one entry per cue. **Verified split: 34
      public domain, 21 CC0, 1 CC BY 4.0** (counted from the manifest, not from
      the report)
- [x] **The set is 66 cues cut from 15 recordings, and 56 of them from six.**
      Surveyed properly for the first time. The ambience is 1:1 and well
      sourced; every one of the 46 interaction cues comes from six takes, so
      most cues are siblings of each other pitched or sliced differently. That
      is the sourcing problem underneath "it still sounds cheap", and no amount
      of conditioning or listening fixes it.
      DONE: `pop-soft` ×5 were Kenney's SYNTHESISED interface blips — the only
      non-recorded material, contradicting both the doc and this file's header,
      and the exact thing rejected twice. Replaced with five public-domain
      recordings of real objects. `3abc28c`
      STILL OPEN, in order of how much they matter:
      - [x] `click-soft` ×4 — the most-fired cue in the app — are sub-slices of
            a page RIFFLE (`Old_book.ogg`, overlapping the book-pull slices),
            measuring 3.3% and 11.6% max adjacent-sample step, i.e. almost no
            attack. A button press is a contact event; a riffle is friction.
            No conditioning turns one into the other.
            Replaced with a real contact event. Found by reading the build
            report row by row, not by listening.  `3f1353c`
      - [x] `tick-hover` ×5 and `typing-tick` ×6 are the same 60-second pencil
            take interleaved, statistically indistinguishable (1546–1586 Hz vs
            1477–1601 Hz). The only thing telling a hover from a keystroke is
            9 dB of level. `tests/sound.test.ts` cannot see this — its variety
            check only compares takes WITHIN a family.
            They come from different recordings now, so a hover and a
            keystroke are different events rather than the same take 9 dB
            apart.  `3f1353c`
      - [x] `page-flip-5` measures 1075 Hz against 1843–1860 for its five
            siblings: the thud among five sheets of paper. This is the exact
            defect that already got `page-flip-1` replaced.
            Re-sourced back into its family band.  `3f1353c`
      141 vetted CC0/PD candidates were found across freesound, Kenney's
      recorded UI set, OpenGameArt and Wikimedia; the agent integrating them
      died in an API outage before landing more than `pop-soft`.
      Twenty-five recordings now. The remaining reuse is recorded
      honestly in docs/design/sound.md, along with the packs REJECTED
      and why — freesound's robots.txt, archive.org's untrustworthy CC0
      tags, pixabay's bot challenge, and Kenney's UI Audio which was
      downloaded and MEASURED rather than assumed, then rejected for
      being 2-3x longer and 3-4x brighter than the house voice.  `3f1353c`

- [x] **Nobody has listened to any of it.** Every judgement so far is spectral
      measurement plus envelope inspection — the agent that built it could not
      play audio. A human listening pass is the remaining acceptance gate, and
      until it happens this section is sourced, not approved

      Measured all 66 cues (`scripts/audit-sounds.mjs`): nothing clips, no DC offset, no cue starts or ends mid-waveform, every ambient loop seam is exactly 0, and `check-done` measures a 917 Hz centroid with 2% above 5 kHz — the metal tong is gone. `scripts/audition-sounds.mjs` builds one 80s file so a human can judge the half measurement cannot.
- [x] ~~**The one CC BY 4.0 credit is recorded but never shown, so as shipped
      we are out of compliance.**~~ — done, read from the manifest rather than
      hard-coded. Duplicate of the licence-obligation item above.
- [x] `pop-soft` (5 variants) is the one family sourced from an interface pack
      rather than foley, so it is the least papery thing in the set. Kept
      because the alternatives in that duration window were worse; the obvious
      candidate for a second pass
      The only synthesised material in the set, and the exact thing
      rejected twice. Five public-domain recordings of real objects now;
      the >4 kHz share went from exactly 0.00% to 6.8-19.9%.  `3abc28c`

Sources that were **rejected, and why** — worth keeping so the next pass does
not re-tread them: freesound.org is the best CC0 catalogue for this brief but
its robots.txt disallows our agent, so it went unused; archive.org carries
commercial libraries and outright console-game rips re-uploaded with CC0/PD
tags by people who plainly do not own them, so none of it was trusted; pixabay
sits behind a bot challenge; zapsplat needs an account; Sonniss is multi-GB.
One licence ambiguity was resolved conservatively: alxl's file shows a CC0
badge but its structured licence field says CC BY 4.0, so we honour the
stricter reading and ship the credit, which satisfies either.

### Editor — block dragging is finicky

- [x] ~~Hovering text makes the six-dot drag handle **flicker**~~ — the handle
      parented itself *inside* the page, so its own hover repositioning read as
      an edit to FlipSurface's mutation observer → snapshot → `.snapshotting`
      hid the handle → re-anchor → forever. Measured: **21 full page
      rasterizations during 2.5 s of holding the pointer still**. Fix is
      placement, not damping — `hoistHandleLayer()` moves the wrapper to
      `<body>`, and the entry keyframe (which literally animated the box) is
      gone. After: **1 distinct state across 30 frames, 1 rasterization**
- [x] ~~After a failed move the handle **jumps to the centre**~~ — the
      extension never cleared its cached node/pos on an abandoned drag, and
      `dragHandler` left a stale `NodeRangeSelection` that the *next* grab
      dragged instead of the block under the handle
- [x] ~~Moving sections generally: not smooth, not error-free~~ — grab lane
      widened to the full 40px gutter, a real inked drop indicator (the
      dropcursor had no class at all, so it could not be styled), edge
      auto-scroll on one rAF loop, drop-outside is a clean no-op
- [x] ~~Checkbox click effect and the confetti animation are **laggy**~~ —
      the editor hitch was removed, and the remaining decorative cost is now a
      single 28-particle/760ms burst, capped at 1.25× backing resolution. Rapid
      completions replace it rather than stacking; pointer activation reuses
      event coordinates instead of forcing layout.
- [x] ~~Confetti colours are bland~~ — four silhouettes over 14 real tokens
      spanning hue *and* value, independent spin/sway/flip rates, and one
      bounded canvas. The visual effect is deliberately silent.

### Page turn

- [x] ~~Drop the **yellow corner tint** on the turn hotspot~~ — `spread.css`
      was filling the hotspot with `--wash-amber-light`; neutralised
- [x] ~~A **straight line near the bottom-right corner**~~ — `.nb-page-curl`
      carried a stray 1px left border standing beside the dog-ear wedge
- [x] ~~**Click** (not drag) to turn forward is not smooth~~ — the first GL
      draw was queued for the *next* rAF, so every flip began with one frame of
      empty canvas over a hidden leaf; plus the snapshot loop below
- [x] ~~The page reads as **disconnected from the spine**~~ — the fold line
      swept past the gutter to x=−W, putting the leaf's inner edge on the
      cylinder (**measured 101px off the gutter at p=0.85**). The fold is now a
      distance from the spine that sweeps to 0 and never goes negative, with
      the radius going to 0 at both ends so the landing is an exact mirror
- [x] ~~Pages holding a **tree/timeline diagram go dark**~~ — html-to-image
      deep-clones `<svg>` without copying computed styles, so class-styled
      shapes lose their paint and SVG's initial fill is *opaque black*. New
      `svgSnapshot.ts` inlines the resolved paint for the capture. Measured on
      the real Diagrams page: **58,765 dark pixels before, 1,635 after**
- [x] ~~After a drag turn completes, a **half-second flicker**~~ — the p=1
      raster covered the freshly committed spread for two frames, and those
      frames were ~300 ms each because of the snapshot loop. The end-state draw
      and the navigate now happen in one task; clear and reveal in one callback

### Focus mode — completed follow-up

- [x] ~~Entering focus mode does **not close an open side panel**~~ — a rail
      panel also pushes the spread sideways to make room, and focus mode hides
      the rail, so entering with Customize open left a wall of controls beside
      a book shoved off the right edge. `setFocus(true)` clears the panel.
- [x] ~~**No obvious way out.**~~ — superseded the temporary corner chip with a
      focus-only left rail containing all former view/zoom/leaf/centre controls,
      plus Settings and Leave focus. Escape is still checked BEFORE the
      defaultPrevented guard, because the caret normally sits in a page and
      ProseMirror eats its own Escape.

### The "what can I add" catalogue

- [x] ~~"Stickers and effects" is where every insertable thing lives, but the
      name hides it~~ — it is the **catalogue** now
      (`views/rail/CataloguePanel.tsx`), a browsable index of everything that
      can be dropped into a page. "Stickers" was naming the whole drawer after
      a fraction of what was in it.
- [x] ~~Add a **fonts** category alongside it~~
- [x] Many more effects, and more custom element types worth inserting — new
      stationery drawn in the flat language, each reachable from the slash
      menu, carrying the block effects, and round-tripping through Notebook
      Script with its own directive AND its printer, so a page survives the
      trip out to text and back. `3f1353c`

### Spec automation

- [x] ~~The AI-facing Notebook Script spec should **rebuild itself**~~ — it is
      generated from the parser's own vocabulary now, not maintained by hand.
      `src/script/vocab.ts` carries `*_DOCS` records typed over the `as const`
      arrays they describe, so **adding a name without prose is a compile
      error** — `tsc` enforces documentation, not a reviewer's memory.
      `scripts/gen-spec.mjs` renders 12 generated regions into
      `scripts/spec-template.md` and writes both shipped artifacts.
      `npm run spec` writes, `npm run spec:check` verifies (**passes**), and
      `tests/script/spec-generated.test.ts` fails with the stale lines if the
      checked-in copies drift. It also checks the other direction: every
      container, sticker, attr key, fence, page-style key and leaf directive
      must literally appear in the shipped text, so a name no region happens to
      print is caught too. Gate was proved by adding a fake sticker and
      watching it go red

---

## 🎨 Flat restyle

The app icon's style is the whole visual language: flat colour, one dark
outline, rounded corners, wobbling edges, no lighting. See `src/art/flat.ts`.

- [x] ~~Purge the AI art pipeline~~ — every gen/pack/cut script, all generated
      assets, and the 30 GB ComfyUI install with its models
- [x] ~~`flat.ts` + `flatShelf.ts`~~ — palette, primitives, case parts, spines
- [x] ~~Wall is one flat tint~~ — nothing tiles, so nothing can seam.
      **Superseded**: the wall is a tiled `WallpaperSpec` again (see the
      vocabularies section), but only because `art/wallpaperDesign.ts` is
      seamless *by construction* — every mark is emitted through a torus-aware
      emitter and there is a test that abuts two copies and measures the seam
- [x] ~~`specimen.html`~~ — judge the drawing on its own
- [x] ~~Point the shelf at it~~ — case, spines and covers all draw through it
- [x] ~~Delete the painting stack~~ — brush, materials, flora, leaves, props,
      paper, filters, caseArt, wood, the wallpaper renderers
- [x] ~~Delete the lighting stack~~ — sceneLight, lightRig, art/lighting,
      src/render/*, per-theme light rigs, dust motes
- [x] ~~Restyle rails, chrome and studio~~ — tokens.css on the FLAT palette
- [x] ~~Themes → simple colour schemes~~ — four rooms; **verified by pixel
      sample**: recess, wall, plank, crown and post all repaint on a swap
- [x] ~~Restyle the covers and the pulled-book overlay~~ — the cover is the
      icon's own construction; the overlay hinges about the spine

## 🏛️ Three design vocabularies, and the wiring that makes them real

A room used to be a colour scheme and nothing else, so every library was the
same plank bookcase in new hexes. It now has three orthogonal vocabularies,
each with its own module, and — the part that took a second pass — each one
actually reaches the screen.

- [x] ~~Carpentry: `art/shelfDesign.ts`~~ — 12 builds × 12 timber patterns, 60
      named presets. A build is a coherent set of choices across all four baked
      parts (board trim, upright shaft, what fills the opening, cornice
      silhouette), not a recolour
- [x] ~~Wallpaper: `art/wallpaperDesign.ts`~~ — 19 patterns × 5 scales × 4
      reliefs × 6 ink slots, 55 presets, seamless by construction
- [x] ~~Bindings: `art/bookDesign.ts`~~ — 10 spine shapes × 10 materials × 12
      decorations, 62 presets picked deterministically from the book's seed.
      Reads no `flatScheme()`: **a book keeps its own colours in every room**
- [x] ~~The pickers stored and previewed truthfully, and the Pixi world drew a
      plain plank case against a bare wall anyway~~ — the gap is closed:
      `textures.ts` takes `ThemeRequest.design` into all four part bakes,
      `world.ts` bakes the wallpaper tile onto the backdrop, `spines.ts` draws
      through `drawBookSpine`. Verified in the running app, not by unit test:
      `scripts/probe-vocabularies.mjs`, `probe-bindings.mjs` and
      `probe-studio-wiring.mjs`, screenshots in `qa/ui/vocab-*`, `binding-*`,
      `studio-*`
- [x] ~~`wallTileScale` forced one copy of the texture to cover the viewport~~ —
      correct for an authored panel that could not tile, ruinous for a real
      tile: it blew the motif up ~4× so `petite` and `grand` landed on screen
      the same size and the whole scale axis was invisible. Back to
      `max(zoom, 0.35)`
- [x] ~~Mipmaps on the wallpaper tile~~ — off. A wrapped non-power-of-two
      texture bleeds across the wrap when a mip is sampled, and `tileScale < 1`
      is exactly when one is — a soft seam at the zooms that show the most wall
- [x] ~~Every new axis is in every key that stores drawn pixels~~ —
      `shelfDesignTag` in the four case bakes and in `themeKeyOf`, all four
      wallpaper axes in `wallpaperTileKey`, the binding in the spine factory's
      params key. `tests/design-cache-keys.test.ts` pins all three, because a
      missing axis is invisible: the disk cache validates nothing about a hit,
      so it serves the wrong art forever on any machine that drew it once
- [x] ~~`themeKeyOf` sat in `textures.ts`, which imports Pixi~~ — moved to
      `libraryKey.ts`, whose whole reason to exist is being loadable in node.
      The key test could not otherwise run
- [x] ~~A binding pinned in the studio repainted the panel preview and nothing
      else~~ — a binding is persisted outside `cover_meta`, so it never
      travelled the `persistBookStyle` → `invalidate` path the other style
      knobs use. `subscribeBookBindings` now drops the affected books' textures
- [x] ~~`data/designPrefs.ts` lived in `views/rail/`~~ — a persistence store
      keyed by bookcase id and book id, imported by the Pixi world. Moved
      beside `data/bookcases.ts`; `art/spines.ts` never imports it at all, the
      pin arrives as `SpineParams.binding`
- [x] ~~Settings offered a 4-way "wood stain" and a 4-way "wallpaper pattern",
      neither of which had reached the screen since the case went flat~~ —
      both rows removed, both fields dropped from `Settings`, and
      `EnvTextures.setStain`/`setWallpaper` deleted. The axes they gestured at
      are real now, far larger, and belong to the **bookcase** rather than to
      the app. The e2e test that asserted they live-applied is deleted, named
      in place — its own claim ("cherry reddens every wood pixel") had not been
      true for a long time
- [x] ~~The shelf's document-level key handler ate arrows/Home/Enter for every
      open panel~~ — the two studio roots guarded themselves, so the trash, the
      TOC and the sticker tray were still driving the shelf behind them. Now
      keyed off `data-nb-panel="open"`, which covers panels added later
- [x] ~~`CustomizePanel` had the book id and did not forward it~~ — the binding
      key fell back to `seed:<spineSeed>`, stable but a *different* key from
      the one the spine factory reads

### Known, deliberate, and not worth chasing

- The recess sprite sits behind the books, so `barrister`'s sash muntins and
  `apothecary`/`pigeonhole`'s dividers are partly occluded. There is no layer
  between reader and shelf to hang a door on; every build puts its signature
  high in the opening, which is what survives
- A board is 40 world px tall and the next floor starts at its bottom edge, so
  a build cannot change the board's silhouette. Fretwork that really hangs
  lives in the opening as the valance
- `toile` and `bird` are only used at `grand`/`large` in the presets; at
  `petite` they turn to mush. Nothing enforces it — preset curation
- `covers.ts` does **not** need `bookDesignTag` in its memo key. Covers draw
  their own front board and never call `renderSpine`, so the binding is not an
  axis there. Recorded so nobody "fixes" it
- The plinth is the crown bake mirrored. If a dedicated base board is ever
  authored in `art/flatShelf.ts`, swap it in `syncCrown` and drop `scale.y=-1`

## 🐛 Reported bugs

- [x] ~~Page content **blackens** during the turn~~ — the shader sampled `.rgb`
      of a possibly-transparent snapshot and forced alpha to 1
- [x] ~~Turning **backwards inverts the pages**~~ — a 'prev' leaf's spine is its
      RIGHT edge, so every face needed its UVs mirrored
- [x] ~~Stray page-turn effect after the flip~~ — the canvas was hidden before
      `renderer.clear()` presented
- [x] ~~Pull-out animation looks cheap~~ — the ghost never inherited the book's
      lean, so it snapped upright one frame before moving; now four beats
- [x] ~~"waste paper" drawer inside the bookcase~~ — now a left-rail item
- [x] ~~Chrome card overlaps the bookcase top~~
- [x] ~~App logo too small in-app~~
- [x] ~~Sound effects rough~~ — every cue resynthesised: attack ramps, no
      clicks, low-passed partials, tails faded to true zero
- [x] ~~Settings changes are slow~~ — the case re-bake went with the painting
      stack
- [x] ~~Dragging empty shelf space pulls a book~~ — **not a bug.** `classifyDrag`
      routes pull vs pan off a hit test; the test drag had landed on the book.

## 🧹 Last inconsistencies with the flat rule

- [x] ~~Move-mode's drop-target hint still draws an additive blurred glow~~ —
      `updateMove()` now spawns the same nine-sliced flat gilt+ink frame the
      hover state uses, sized a hair proud of the incoming book
- [x] ~~`.pulled-book` carries a blurred `box-shadow: var(--shadow-lg)`~~ —
      the token itself is `0 5px 0` now, a zero-blur offset plate, which fixed
      all ~80 call sites at once
- [x] ~~Spoiler bodies hid behind `filter: blur(5px)`~~ — a live CSS filter in
      an interactive path, *and* a readable spoiler (the glyphs survive a
      squint). Now a flat taped-over strip: `--paper-edge` plate, one ink
      outline, `visibility: hidden` under it so revealing costs no reflow
- [x] ~~Sticky-note corner fold had the last soft `box-shadow` in `src/`~~ —
      `-2px -2px 3px` → zero blur
- [x] ~~Seven `createRadialGradient`/`createLinearGradient` calls in
      `art/charms.ts`~~ — specular highlights, i.e. a light source. All of it
      was dead code from before the restyle (`spines.drawSpineRibbon` and
      `covers.paintCharm` draw charms flat now); `charms.ts` is the charm
      vocabulary and nothing else
- [x] ~~The flat rule was enforced by hand-auditing the tree~~ —
      `tests/styles.test.ts` now gates every file in `src/styles/`: no
      `blur()`, no `backdrop-filter`, no non-zero box-shadow blur radius, no
      blend modes, and the handwriting font floors (13px, 20px for Caveat)
- [x] ~~Smooth two-stop CSS gradients~~ — **not a violation, and the rule was
      wrong.** `flat.ts` said "no gradients"; the icon it was derived from
      carries three `linearGradient`s of its own. A soft wash reading as
      pigment or tinted paper is inside the style — what is banned is a light
      MODEL (a highlight placed to imply a lamp). Rule corrected in `flat.ts`,
      the sweep that had started was reverted, and `tests/styles.test.ts`
      deliberately does not gate gradients

## 🧩 Features still missing

- [x] ~~Import/export only reachable via `Ctrl+Shift+E` / `Ctrl+Shift+I`~~ —
      a "Library files" section in settings, rows calling the same
      `openTransferPanel()` the shortcuts do, each showing its combo
- [x] ~~Settings row to replay the guided tutorial~~ — "Help → replay the
      tour" clears `appState:tutorialCompleted` and restarts it
- [x] ~~Exportable diagnostics log users can hand to their AI~~ — plain-text
      report (build, GPU, library counts, resolved settings, last 30 errors).
      No page content, no titles, no paths outside the app; stacks are never
      collected and error text goes through `redactPaths`
- [x] ~~Motion design system: unified easing, transitions, spring physics~~ —
      `src/styles/motion.ts` mirrors the `--dur-*`/`--ease-*` tokens for GSAP
      (four durations, four easing roles, unscaled `LINGER_MS` reading times).
      One `motionScale()` decides reduced motion for the whole app
- [x] ~~Notebook Script v2 — variables, reusable styles, strict validation~~ —
      `::let` / `{{name}}`, `::style` + `{use=name}`, and ~55 diagnostic codes
      carrying 1-based line/column and an `expected`. `parse()` stays total
- [x] ~~A library is one endless bookcase~~ — it is a collection of them, each
      with its own id, name, room and books, ten floors unless the reader grows
      it. Rust migration v2 + `ensureBookcases()`, three overlapping guards so
      no library can be lost, and the case now ends with a visible plinth
- [x] Notion-depth writing: nested toggles, columns, math, footnotes,
      backlinks, sortable tables, selection toolbar. The four named in the
      later, narrower entry are done: nesting already worked and is pinned
      now, columns were written but never wired, footnotes keep the pagination
      promise by DESIGN (the note is an attribute of the inline marker, so it
      travels inside the paragraph's own JSON and arrives already attached),
      and maths is a hand-rolled total TeX-subset renderer because TipTap's
      Mathematics extension is not installed. `8eec15f`
      Backlinks, sortable tables and a selection toolbar were never part of
      the narrower brief and are not built — split out below rather than left
      hiding inside a ticked line.
- [x] **Backlinks, sortable tables, and a selection toolbar** — the three
      items from the original "Notion-depth" list that the later pass did not
      cover. Sortable tables and a selection toolbar are contained editor
      work; backlinks need a link index across books and are the largest of
      the three.
      All three. Backlinks reuse the existing full-text index rather
      than building a second one; the selection toolbar is a plugin
      view positioned from the selection rect, never a node view, so
      it does not fight ProseMirror for the DOM; sorting goes through
      a transaction so undo works.  `6a4c1b6`
- [x] Rebuild and verify the NSIS installer
      Built at 0.2.0: `Alcove_0.2.0_x64-setup.exe` 16,993,298 bytes (16.2 MiB —
      what Explorer prints as "16.2 MB", so the README's "about 16 MB" is right
      for this build; the previous one was 14.7 MiB and would have made it
      wrong). Installed with `/S`, so no window went near the owner's screen:
      exit 0, `%LOCALAPPDATA%\Alcove` holds the exe and the uninstaller, the
      `HKCU` uninstall key reads 0.2.0, and the Start-menu shortcut targets the
      real path. The two paths that appear to hold it are ONE file seen through
      the Claude container's MSIX redirection, not two installs — identical size
      and mtime, and one uninstall clears both.
      The icon was read back OUT of the installed exe rather than off the
      master, because the report was about the installed build: ten RT_ICON
      frames, 16 through 256, and the red notebook is legible at 16px. So the
      reported "no icon in the start menu" was a stale shell icon cache on a
      path that has since been removed and recreated.

### Bookcases — the edges nobody owns yet

All four are safe (nothing is lost, nothing throws); all four are places where
the app quietly assumes one bookcase.

- [x] **`features/transfer` does not know about bookcases.** The export bundle
      carries books but not their case, and `upsertBookRow` on a revert
      re-inserts historical rows without `bookcase_id`. The start-up orphan
      sweep adopts them into the first case — there is a test — so an imported
      library lands entirely in the default case rather than being lost
      The bundle carries each case's identity and room; import rebuilds or
      matches them. `BUNDLE_FORMAT` keeps its value so older bundles still
      import, landing in the default case — tested, not assumed.  `0fa6535`
- [x] **Quick switch and full-text search are library-wide**, deliberately, so
      books never vanish from search. But opening a hit that lives in another
      bookcase does not switch to it, so the reader lands on a shelf that does
      not contain the book they just picked. Wants `switchBookcase` before
      `appState.openBook`.
      `features/bookshelf/openAnywhere.ts` does exactly that, and both callers
      (the search jump and the quick switcher) go through it. Library-wide
      search is untouched — that part was right.
      The order is the point and is pinned: `switchBookcase` reloads the
      shelf's store, so opening first would have the world resolving the book
      against the old case's floors. `tests/open-anywhere.test.ts` also pins
      the three cases where it must NOT travel (already-open case, a book with
      no case — the start-up orphan sweep owns those — and a failed lookup) and
      that a failed switch still opens the book rather than swallowing it.
- [x] **The trash is one drawer for the whole library.** `listTrashedBooksIn`
      exists if it should be per-case; the panel passes the parameterless
      version straight to `createResource`
      A toggle: 'every bookcase' or 'this one'. Empty follows the toggle,
      which is the part that had to be right — `scripts/probe-trash.mjs`
      drives two cases and checks emptying here leaves there alone.  `ab2b811`
- [x] **Moving a book between cases repaints it** when it has no studio style
      override, because un-overridden spines follow the room. Inherent to the
      existing design rather than new — but a book dragged into a
      differently-themed case changes colour, which is the one thing that stops
      you recognising it.
      **The guard is built and the concern is currently unreachable.**
      `moveBookToBookcase` takes `keepAppearance` and freezes the resolved
      style BEFORE the move — deliberately in that order, so a half-failed move
      cannot leave the book already in the new room wearing the new room's
      colours. It also only freezes when the book has no explicit style, so a
      reader who dressed a book is not overridden.
      What the audit turned up: **the function has no caller outside a test.**
      There is no way in the app to move a book between bookcases at all, so
      the repaint cannot happen yet. That is the real gap, and it is the next
      item rather than this one.
- [x] **There is no way to move a book between bookcases.** `moveBookToBookcase`
      exists, is tested, and carries the `keepAppearance` guard above, but
      nothing in the UI calls it — a reader with two cases cannot reshelve
      anything from one into the other. Wants an action on the book's own
      right-click menu that offers the other cases, passing the resolved style
      as `keepAppearance` so the book keeps its face on arrival.
      On the book's right-click menu, stating the guarantee to the
      reader ("It keeps the colours it has here"). Building the
      verification found two real defects: the moved book changed its
      GRAIN because pinning all 24 fields told the renderer the reader
      had chosen a covering, and the case list ran off the bottom of the
      window at 25 bookcases.  `c3473e8`

## 🔩 Found while making the tree green

- [x] ~~`export-script` and `insert-script` advertised `mod+shift+e/i` — the
      exact combos App.tsx used for the library export/import~~ — the settings
      sheet was naming a shortcut that opened something else. Script pair moved
      to `mod+alt+e/i`; `export-library`/`import-library` are now real entries;
      every handler matches through `data/keybindings.matchesBinding` against
      `settings.keybindings`, so the advertised list *is* the binding
- [x] ~~Settings wrote `--motion-scale` as an inline style, which outranks the
      `prefers-reduced-motion` block in global.css~~ — the OS preference was
      silently overwritten for everyone the moment settings applied (i.e.
      always). `effectiveMotionScale()` folds the two, OS wins, and the
      diagnostics report says so on its own line
- [x] ~~Three private copies of `motionScale()`~~ (RailPanel, PageEditor,
      confetti — plus SettingsPanel and TutorialOverlay, which the motion pass
      did not own) — all now read the shared one
- [x] ~~`parseDiagramSource` returned diagnostics at line 0~~ — it calls the
      mini-language parsers directly, bypassing the `parseDoc` pass that
      locates and sorts, so the diagram popover showed unlocated warnings.
      Both diagnostic surfaces now render `line N:C` plus `expected`
- [x] ~~The drop cursor had no class at all~~ — prosemirror-dropcursor only
      names its element when the `class` option is set, and it wasn't. That
      made `flip.css`'s `.snapshotting .ProseMirror-dropcursor` rule dead, so
      the indicator could bake into a page snapshot. Now passes
      `class: 'ProseMirror-dropcursor nb-dropcursor'`, keeping the ProseMirror
      name so the flip rule works again
- [x] ~~`onTaskToggle` was attached to the page root with no matching
      `removeEventListener`~~ — now cleaned up
- [x] Shortcuts are display-only in settings ("rebinding is on its way").
      The map is now honest and centrally matched, so rebinding is a UI job
      Rebindable, persisted, with Escape cancelling capture and a per-row
      reset. A binding that would shadow typing or Escape is refused WITH
      the reason shown — a silent refusal leaves the reader unable to tell
      whether the app heard them.  `5e50fc1`
- [x] The task list in the harness is stale — several entries describe the
      deleted painting/lighting stack. Not repo state: that list lives in the
      agent harness, not in this tree, and it resets with the session. Every
      entry on it is already marked complete, so it misleads nobody who reads
      it — and nothing in the repository depends on it. Recording that here so
      the next reader does not go hunting for a file to fix.
- [x] **Rasterizing a page is still the largest cost in the editor** — each one
      is a 300–400 ms long task under headless SwiftShader, nearly all of it
      html-to-image's `cloneCSSStyle` copying every computed property of every
      node. It is now correctly triggered only by *actual* edits (it used to
      run forever on an idle book), so this is a cost problem, not a loop
      Reduced and measured in the running app, before and after; anything
      that did not actually help was dropped rather than kept for sounding
      right. Mid-curl fidelity compared frame to frame.  `884aa8c`

## 🔍 Found by audit — resolved in the 2026-08-07 owner-testing batch

The original trigger notes remain below as a record of what was reproduced.
They are historical now; this is the completion ledger and the verification
that replaced “captured, not fixed”:

- [x] **1 — history survives the first post-restart edit.** Hydration precedes
      persistence, concurrent hydration is shared, writes are serialized, and
      a transient DB failure remains retryable (`history-lru.test.ts`).
- [x] **2 — the Playwright helper reaches the book.** The tutorial completion
      flag is installed before navigation and the late overlay is stopped;
      `.nb-book-view` was rechecked and is still applied by `BookView`.
- [x] **3 — replacing a raster closes it.** `LruMap.set` evicts a different old
      value, but does not close an identical object reinserted under its key.
- [x] **4 — rapid A → B → A room changes are last-request-wins.** The world
      tracks the in-flight room independently of the optional fade snapshot,
      aggregates overlapping apply promises, and keeps `libraryBusy` true until
      every superseded generation retires. The focused browser check sabotages
      `generateTexture`, delays B after its generation is assigned, and proves
      A issues a replacement bake and becomes terminal.
- [x] **5 — staged diagrams render before capture.** Offscreen/export hosts
      bypass lazy intersection. The repaired probe uses real corner turns,
      samples both live and staged skeletons over 451 frames (0/0), exits red on
      a finding, and its sabotage produced 31 skeleton frames / `GATE ALIVE`.
- [x] **6 — exported diagrams keep their SVG paint.** Export capture shares
      `inlineSvgStyles`; the real 2× PNG probe measured 0% opaque black and
      4.91% ink over the diagram, while sabotage reached 31.97% black.
- [x] **7 — failed or partial image paste is reported** through the existing
      toast instead of silently consuming the clipboard.
- [x] **8 — dialogs own focus honestly.** The shared focus helper enters,
      traps visible controls and restores for modal cards; the live-control
      tutorial deliberately opts out of trapping. Focused Vitest and Playwright
      checks are green.
- [x] **9 — late art-worker bitmaps are closed** when their timed-out job no
      longer has an owner.
- [x] **10 — small shelf art is keyed by effective DPR.** Carets, plaques,
      pinned stars and continue-reading ribbons bake/reuse/destroy per scale.
- [x] **11 — the art protocol version is enforced.** A mismatched worker is
      retired; dead readiness/font-slot fields were removed.
- [x] **12 — transparent shelf leftovers no longer allocate.** Empty-floor
      doodle plumbing and its shared blank texture are gone. The star and ribbon
      were not deleted: public product promises made them real status marks,
      with pixel/alpha and live shelf checks instead of the old false-positive
      `undefined !== null` assertion.
- [x] **13 — snapshot rules and the flip document agree with the code.** Dead
      hotspot/hairline/drag-handle rules and excludes are gone; all three page
      capture paths share `snapshotStyleProperties`; the 64×16 mesh, endpoint
      tint, tap easing and fallback description are current and gated.
- [x] **14 — diagram colors have one source of truth.** `DIAGRAM_WASHES` is the
      script's `WASH_COLORS` table itself and the unreachable plum CSS is gone.

### Original findings and trigger notes (historical)

The hunt's original #1 — the page-snapshot cache feeding itself forever on an
idle open book — **is already fixed** and is not listed here; it turned out to
be the shared root cause of the drag-handle flicker, the checkbox lag and the
post-flip flicker above.

### High

1. **Page history from previous sessions is destroyed by the first edit.**
   `src/editor/history/pageHistory.ts:117` reads `rings.get(pageId) ?? []` and
   `:128` persists that with `INSERT OR REPLACE`. Hydration from the DB happens
   *only* in `listSnapshots` (`:150`), and the only caller is
   `src/views/rail/HistoryPanel.tsx:45` — i.e. nothing hydrates unless the user
   has already opened the History panel. **Trigger:** restart the app, open a
   book, type, wait for a save flush (`PageEditor.tsx:181`). Up to 10 restore
   points from earlier sessions are replaced by an array of one. The module
   header explicitly promises the persisted tail "survives restarts". This is
   silent user data loss on the happy path — fix it first.
   *Weaker sibling, same file:* `:151` marks `hydrated` **before** the await, so
   one transient DB read failure permanently disables hydration for that page.

2. **The entire Playwright suite is red before any test body runs**, both
   failures inside `tests/e2e/helpers.ts::openBookView` (`:190`).
   (a) `:193` waits on `.nb-book-view`, which **no component applies any more**
   — verified: the class survives only in `src/styles/editor.css` and
   `src/styles/rail.css`. The book view root is `.nb-spread` now.
   (b) The first-run tutorial auto-starts and its `.nbt-scrim` intercepts
   pointer events, so the book click times out.
   **Trigger:** `npx playwright test`, any spec. Until this is fixed we have no
   end-to-end verification at all, which is why so much of this round had to be
   measured with bespoke harnesses instead.

### Medium-high

3. **Every re-capture leaks an ImageBitmap.** `src/flip/math.ts:337` — `set()`
   drops a replaced value without calling `onEvict`, and `onEvict` is the only
   thing that closes bitmaps (`src/flip/rasterCache.ts` LRU wiring). The
   contract at `rasterCache.ts:25` says "evicted/**replaced** bitmaps are
   `close()`d"; only evicted ones are. `delete()` and `clear()` do fire it —
   `set()`-over-existing is the single hole. **Trigger:** any re-capture of an
   already-cached page, i.e. every real edit. At pixelRatio 2 a ~620×875 sheet
   is ≈8.7 MB of native memory per leak. Note `tests/flip.test.ts:610`
   currently *enshrines* the leak (`expect(evicted).toEqual([])`), so that
   assertion has to be inverted as part of the fix.

4. **A cancelled theme swap can pin a frozen full-viewport snapshot over the
   shelf forever.** `src/features/bookshelf/world.ts:1309` — `applyLibrary`
   calls `beginThemeFade()` (grabs the viewport into a sprite at alpha 1),
   awaits the case bakes, then bails on the generation guard **before**
   `endThemeFade()`. **Trigger:** with room A on screen pick room B, then pick
   A again before B's four bakes land (cold disk cache). The second call sees
   `roomChanged === false` and returns early; the first returns at the guard.
   Nothing ever fades or destroys the snapshot, so the shelf is a still image
   until an actual room *change* replaces it. Clicks still land, which makes it
   read as a render freeze. Reduced-motion users are immune.
   ⚠️ `world.ts` is being edited by another workflow — **re-confirm the control
   flow survives their change before acting.** The bug is in the guard's
   placement, not in the scheme composition they are reworking.

### Medium

5. **Diagrams bake as an empty skeleton into adjacent-page snapshots and into
   whole-book exports.** `src/editor/nodes/diagram.tsx:96` lazy-mounts each
   diagram behind an `IntersectionObserver`; the offscreen staging host sits at
   `left:-12000px`, so it never intersects and the dashed
   `.nb-diagram-skeleton` (`:146`) is what gets captured. **Trigger:** turn to a
   page whose neighbour holds a diagram; also every PDF/PNG whole-book export.
   Distinct from the "diagrams go dark" defect fixed above — empty frame, not
   black. Fix is to treat a node inside `.nb-export-sheet` as immediately
   visible.

6. **Script/PDF export still has the black-SVG bug** that the page flip just
   fixed. `src/editor/script/exporters/capture.ts:93` uses the same
   html-to-image `toCanvas` recipe and does **not** import `inlineSvgStyles`
   (verified). **Trigger:** export any page containing a diagram. One import
   from `src/flip/svgSnapshot.ts` and the same wrap.

7. **Pasting an image that fails to store does nothing at all, silently.**
   `src/editor/media/pastePlugin.ts:89` returns on an empty source list; the
   per-file `catch` at `:81` maps every failure to `null`, and `handlePaste`
   has already called `preventDefault()` and returned `true`, so ProseMirror's
   default paste is suppressed too. **Trigger:** paste an image when
   `save_image_asset` rejects (unwritable app-data dir, disk full, refused
   format) or the asset-row DB write fails. Clipboard consumed, no block, no
   toast, no console line. A `notify()` helper already exists in
   `src/editor/script/exporters/toast.ts`.

8. **Modal dialogs with no focus management.** Four carry `aria-modal="true"` —
   `src/features/templates/ExportPdfDialog.tsx:53`,
   `src/features/templates/TemplatesGallery.tsx:149`,
   `src/features/transfer/TransferPanel.tsx:990`,
   `src/features/tutorial/TutorialOverlay.tsx:513` — and none moves focus in on
   open, traps Tab, or restores focus on close (0 `focus()` calls in each).
   `src/views/CheatSheet.tsx:55` is the milder case: `role="dialog"` without
   `aria-modal`, same absence of focus handling. **Trigger:** open Export PDF
   from the rail with the keyboard — focus stays on the rail button behind
   while `aria-modal` tells assistive tech the rest of the page is inert, so a
   screen-reader user is focused on something their AT has been told does not
   exist. `src/features/settings/SettingsPanel.tsx:519` already does this
   properly and is the pattern to copy.

### Low

9. **A timed-out art job leaks its transferred ImageBitmap.**
   `src/features/bookshelf/artOffload.ts:251` returns when the pending entry is
   already gone, dropping the transferred bitmap without `close()`. `inFlight`
   accounting is fine. **Trigger:** a spine taking >30 s (6 s has been measured
   on a software renderer, so reachable but rare).

10. **dpr is a parameter of two texture caches but not of their keys.**
    `src/features/bookshelf/textures.ts:555` (`getPlaque` keys on `label` only)
    and `:525` (`getSelectCaret` keys on nothing). **Trigger:** move the window
    between monitors of different DPI — the first scale is kept forever.
    Colours are fixed, so there is no room-tag hole here.

11. **Dead protocol plumbing in the art worker bridge.**
    `artOffload.ts:245` writes `slot.ready = true`, which `pickSlot()` (`:236`)
    never reads. `ART_PROTOCOL_VERSION` (`artJobs.ts:23`, documented as "bump
    when a job's meaning changes so a stale worker bundle is obvious") is
    posted by the worker and **never compared by the host** — bumping it does
    nothing. Harmless today, actively misleading the day someone relies on it.

12. **Purge leftovers that still allocate.** `floorView.ts:317`, `:323`, `:813`
    build sprites from `getStarCharm`/`getRibbon`/`getEmptyDoodle`, all of which
    now return the shared 1×1 transparent texture. Dead work, not a failure —
    destroy paths were checked and the shared texture is not at risk.

13. **Dead rules and doc drift left by this round's fixes** (each is a deletion
    someone with ownership should make): the two `spread.css` declarations that
    caused the yellow tint and the stray hairline are now overridden from
    `flip.css` and can go at source; `src/styles/flip.css:135`'s
    `.snapshotting .nb-drag-handle { display: none }` is the rule that *caused*
    the handle flicker and is now unreachable; `.nb-drag-handle` still appears
    in the exclude lists of `rasterCache.ts`, `offscreenPages.ts` and
    `exporters/capture.ts` as no-ops; and `docs/design/page-flip.md:26` still
    documents the fold sweeping to x=−W, which is precisely the geometry that
    detached the page from the spine.

14. **`{color=plum}` on a diagram node is unreachable from script** —
    `DIAGRAM_WASHES` includes `plum`, `WASH_COLORS` does not. Either wire it up
    or drop it.

### Chased and cleared — do not re-investigate

`bakeFlatPart` (`textures.ts:230`) looks like the classic set-scheme-then-await
race, but the `setFlatScheme`/draw/restore sits inside the producer closure,
which `bakeCached` runs synchronously. Every `bakeCached` key traced does carry
the scheme axis, so the stale-art-forever class is genuinely closed.
`PageRasterCache.dispose()`/`capture()` re-check `disposed` after every await.
`PageFlipController.land()`'s `landToken` guard and the context-lost
`committed` check are both correct. `ThumbStrip.tsx:34` never prunes its
canvases, but they are bounded by page count and hold detached 104×132
canvases — too small to call a bug.

## 📈 Measured

| | at the reset | now |
|---|---|---|
| first paint | 4,977 ms | **2,180 ms** |
| max main-thread block | 15,314 ms | not reproduced since |
| idle | 0.1 fps | settles to 1 fps (render-on-demand) |

---

## ✅ Done

- Tauri 2 + SolidJS scaffold, SQLite data layer, design system
- Infinite bookshelf world: virtualised floors, semantic zoom, drag-to-pull
- Block editor: slash menu, drag handles, right-click menu, tables, callouts,
  toggles, stickers, effects, pagination without scrollbars
- Two-page spread with WebGL page-curl flip
- Deliberate blank pages, bounded at four trailing
- Notebook Script: tolerant parser, canonical printer, AI-facing spec dialog
- Hand-drawn diagram renderers (tree, mindmap, flowchart, timeline)
- Media: image paste/drop, link-preview cards, Openverse fetch
- Full-text search + Ctrl+K quick switcher
- Settings panel, guided tutorial, export/import bundles, backups, tray
- Custom icon + NSIS installer; GitHub Actions release on version tags
- README that describes the actual app
