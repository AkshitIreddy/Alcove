# In-book AI Agent

Status: unreleased implementation authority, 2026-08-12. The linked v0.6.6
installers do not contain this feature.

The AI Agent is an Alcove book tool, not a generic chat window. It lives on
the open book's left rail, works against an explicit notebook/source scope,
builds drafts in an isolated copy of the real editor, and asks the reader to
approve one polished preview before any live page changes.

The icon is the app-styled sparkle/agent glyph in the same panel group as Book
customisation, Page style and Catalogue. It is not a floating assistant, top
bar, onboarding gate or separate application. The existing external Notebook
Script workflow remains available without a key.

## Product contract

- The agent may autonomously plan, inspect, search, retrieve, draft, validate,
  render and revise inside the selected book and attached sources.
- It owns its workflow. Alcove exposes typed capabilities and useful skills;
  UI code does not decide a fixed sequence on the model's behalf.
- The activity stream shows goals, plan changes, tool activity, grounded
  observations, coverage, diagnostics and concise reasoning summaries. Raw
  hidden chain-of-thought is neither requested nor exposed.
- The agent is the first visual reviewer. A draft cannot be proposed until the
  current generation parses, paginates and has been rendered and inspected
  page by page. Repair rounds stay autonomous and visible rather than becoming
  approval chores.
- The reader is interrupted only for materially missing intent, a blocker the
  agent cannot safely resolve, and the final preview/insertion decision.
- The model never receives arbitrary SQL, filesystem or editor mutation. It
  proposes a typed Notebook Script or patch. Alcove validates, previews,
  checks the target revision, applies atomically and records one complete Undo.
- Images and PDFs are first-class task sources. An image mentioned or attached
  with the task is not merely chat decoration; the agent may inspect and use it
  when it is relevant to the reader's goal.
- Highlighted-text requests enter the same runtime and preview gate as page
  generation. The selection toolbar cannot mutate prose on the model's behalf.

## Architecture

```text
selection toolbar ----+
                      +--> AiAgentPanel (controlled Solid view)
AI Agent rail panel --+       |
                              v
                 panel controller adapter
                 (display projection + intents)
                              |
                              v
                  core AiAgentController
                              |
                              v
               provider-neutral AgentRuntime
                  | LangGraph StateGraph
                  | durable state/events/interrupts
                  |
          +-------+--------+------------------+
          |                |                  |
          v                v                  v
 read-only notebook   source repository   draft sandbox
 and selection        + coverage/index    real PageEditor render
 adapters             + retrieval         + exact receipt
          |                |                  |
          +------- typed capability tools ----+
                              |
                              v
                    deterministic policy gate
                              |
                     immutable preview/proposal
                              |
                 explicit reader approval only
                              |
                              v
                 BookView approved-apply seam
                 revision + journal + Undo

AgentRuntime -> provider-neutral messages/events -> Cohere V2 adapter
                                                    |
                                                    v
                                              Rust AI gateway
                                          key vault · HTTPS · Stop
```

LangGraph owns resumability and control flow. Alcove uses Cohere's native V2
request shape because the current LangChain Cohere JavaScript integration does
not expose the image-input parity needed for rendered page self-review. The
provider boundary remains replaceable.

The production Cohere adapter uses Command A+ for the tool-and-image loop,
Embed v4 for semantic retrieval and Rerank v4 where reranking is useful. The
browser never receives a general fetch primitive or arbitrary provider URL.
`src-tauri/src/ai.rs` normalizes and validates the request vocabulary, enforces
size and time limits, owns cancellation and maps provider errors into bounded
application errors.

Semantic search does not introduce a remote or second local database. Pinned
sqlite-vec 0.1.9 is statically registered into the same SQLite ABI used by
SQLx/plugin-sql before its pool opens. Versioned FTS5 and `vec0 float[512]`
tables are disposable mirrors; `ai_agent_sources` and `ai_agent_chunks` remain
canonical. The local layer fuses lexical and cosine ranks with reciprocal-rank
fusion before any optional Cohere rerank.

### Dependency direction

The dependency arrows are one-way on purpose:

- `AiAgentPanel.tsx` depends on a display contract, not graph, provider or data
  modules. It cannot turn a message into a valid proposal itself.
- `aiAgentControllerAdapter.ts` translates core snapshots/events to cards and
  UI actions. It may ask core to approve, but the only writer callback is
  injected by the composition root and accepts an immutable approved proposal.
- `features/aiAgent/` depends on adapter interfaces and provider-neutral domain
  types. It has no Solid component, saved credential, SQL string, Tauri command
  or live TipTap editor handle in checkpoint state.
- `BookView.tsx` composes production implementations and owns
  `applyApprovedAiProposal`; no model tool imports a page mutation function.
- `src-tauri/src/ai.rs` owns secrets, attachment bytes and outbound HTTP. It
  cannot execute a model tool or mutate a notebook page.

Memory/deterministic implementations may replace provider, persistence, source
or sandbox adapters in tests. The filmed `?fx=force` demo is narrower: it feeds
a frozen Cohere-authored fixture through the panel's display contract and the
real disposable renderer, never pretending to execute the production graph or
provider; its Insert beat uses a deliberately reversible BookView demo seam.

### Task and proposal lifecycles

The task lifecycle is `idle -> running -> waiting_for_user |
waiting_for_preview_decision -> completed | cancelled | failed`. Phases refine
the activity label (`intake`, source reading, planning, drafting, checking,
rendering, reviewing, repairing, preview construction, waits, finished) but do
not grant permission. A phase string never substitutes for a policy check.

A proposal has its own lifecycle because reader approval and live application
happen outside the graph. It is prepared as `waiting_for_approval`, paused in a
durable final-preview interrupt, becomes `approved_pending_apply` only after the
reader approves that exact preview, then settles as `applied` or `apply_failed`.
Restore chooses the newer/dominant domain state when that out-of-graph status is
ahead of a LangGraph checkpoint. A repeated approval reuses the proposal and
idempotency key; it does not ask the model to recreate them.

## Reader-facing workflow

1. The reader opens the Agent glyph in an already-open book. On first use only,
   the panel offers a Cohere trial/evaluation or production/enterprise key,
   session-only or OS-vault storage, Settings, and Skip for now.
2. The reader states an outcome and may attach images, PDFs, UTF-8 text/code/data,
   HTML, DOCX, XLSX or PPTX sources. A paste of at least 500 characters becomes a
   managed `Pasted text.txt` source rather than an oversized message. Current
   page, nearby pages and whole-book scope are visible choices; Creative
   Direction is an atmosphere/quality brief rather than a fixed layout recipe.
3. The panel becomes an activity view. It may show planning, source reading,
   coverage, retrieval, drafting, parser/layout checks, native rendering,
   visual findings and repairs. Stop remains available while work is running.
4. The agent resolves ordinary uncertainty itself. It interrupts only for a
   materially missing choice or a blocker it cannot safely resolve.
5. The agent renders and inspects all current-generation pages. Intermediate
   images remain its work product; a final preview card appears only after the
   deterministic gate and visual review pass.
6. The reader may open the exact render full-size, zoom, move between pages,
   request changes, choose placement or approve.
7. Approval revalidates the immutable preview against the live book, then the
   mutation seam applies it as one user-visible operation with one Undo.

Setup is deliberately deferred until first Agent use. Onboarding may point out
the tool but must not demand a key. The connected key can later be replaced or
removed under *Settings -> AI & integrations*.

## Runtime and activity model

All checkpointed domain state in `src/features/aiAgent/types.ts` is serialisable
plain data. It cannot contain an API key, attachment bytes, database or editor
handles, `AbortSignal`, object URLs or rendered image data. LangGraph checkpoints
and pending writes are persisted in SQLite so a task can resume without
smuggling process objects into state.

The graph is autonomous inside bounded capabilities, not inside unlimited host
access. Typed tools expose notebook/source reads, retrieval, coverage, script
checking, sandbox rendering and proposal construction. Only the root composition
layer owns the approved apply callback. Tool results carry stable source anchors
and rendered-image references; provider-specific stream events are normalized
before they enter runtime state.

The visible activity stream is an audit surface, not chain-of-thought theatre.
It contains user-legible goals, plan steps, action names, observations,
citations, coverage progress, checks, visual findings and concise summaries.
Prompts never request hidden reasoning, and checkpoint contracts have no field
in which to store it.

### Graph topology and turn continuity

The compiled `StateGraph` has three nodes: `model`, `tools` and `human`.
`START` enters `model`; a successful assistant turn with calls enters `tools`;
the tool node drains all non-interrupt siblings from that assistant turn before
returning to the model. Terminal task lifecycles enter `END`. `human` is a
static `interruptBefore` checkpoint because dynamic LangGraph interrupts depend
on Node `AsyncLocalStorage`, which is not available in Alcove's WebView.

Before a provider call the runtime consumes queued follow-ups, checks run
generation plus provider/tool/repair budgets, builds a compact state prompt and
saves any newly discovered privacy substitutions. The streamed assistant turn
is checkpointed with its public prose, provider-authored `toolPlan`, exact call
ids/names/arguments and pending call queue **before** the first tool runs. Tool
results retain the originating `toolCallId`.

Parallel tool calls belong to that one assistant turn. Cohere must see a result
for every retained call as one contiguous group before the next model turn. An
interrupting call is different: its siblings were authored without the future
reader answer, so the runtime discards them and trims the stored assistant call
list at the interrupt. Resume supplies exactly one result to exactly that call
and then returns to the model. This prevents both an invalid partial result set
and stale work executing after a human decision.

### Tool schemas and capabilities

Each capability in `tools.ts` owns one `.strict()` Zod schema. That schema is
converted to Cohere's supported strict-tool JSON-Schema subset; optional
properties become required-but-nullable for transport. Returned null sentinels
are stripped and the original Zod schema parses the arguments again, including
defaults, discriminated unions and unknown-key rejection. Schema conversion is
wire compatibility, not authority.

Tools are grouped as `read`, `draft`, `interrupt` and `propose`, but execution
also checks lifecycle, budgets, source manifest capability, current book/page,
generation ownership and policy. The catalog exposes:

- notebook, page-range and immutable selection inspection;
- manifest/retrieval planning, bounded/full source reads, local search, optional
  rerank and coverage inspection;
- plan, placement and Notebook Script draft construction;
- parsing, deterministic validation, native render, render-manifest/page-image
  reads and visual-review recording;
- one high-value question/blocker interrupt, conversation-only completion, and
  final proposal/preview submission.

There is no arbitrary HTTP request, shell, filesystem path, SQL statement or
editor transaction. Source reads receive a task/manifest-digest capability from
trusted state; render reads require current generation and page ids; proposal
and idempotency identities are derived locally from current hashes.

### Provider protocol

`provider.ts` normalizes model I/O into public-text deltas, tool-plan deltas,
complete typed tool calls, citation ids, usage and finish. It deliberately has
no credential or hidden-thinking event. `cohereProvider.ts` maps that boundary
to Cohere V2 while preserving assistant tool plans and exact call continuity.

Images are observations for one turn, not durable repeated history. The adapter
reattaches pixels only from the trailing unanswered tool-result group, after the
complete assistant -> tool-results sequence, in one synthetic user turn. Older
history keeps immutable digests/exposure records. Source and draft images are
locally decoded, metadata-stripped, bounded by purpose, re-encoded and capped at
twenty per provider turn; failure to prepare a safe derivative never falls back
to the original bytes.

The adapter rejects malformed stream ordering, incomplete/duplicate calls,
invalid argument JSON, mismatched finish reasons and completion without a valid
message end. Rust independently fixes the outbound origin to Cohere, validates
the request vocabulary and JSON/tool/image/stream bounds, verifies SSE content
type, retries only bounded retryable failures and returns public error codes.

### Persistence and cancellation

`SqliteAgentCheckpointSaver` implements LangGraph's saver contract over
`tauri-plugin-sql`: checkpoint tuples, parentage and pending writes are stored
alongside the latest domain task state, task-list metadata and ordered activity
events. Sources/chunks, exact reviewed-generation receipts and the apply journal
are separate authorities with separate lifetimes. Task deletion first writes a
tombstone under the persistence mutation mutex; a late checkpoint save therefore
cannot resurrect deleted private work.

Stop installs a fresh abort generation and durably marks cancellation before an
older invocation can save again. The signal propagates to the provider adapter
and Rust HTTP future. Rust also retains a bounded cancellation intent when Stop
arrives before native request registration. Retry creates a fresh abort/run
generation and resumes the safe checkpoint; a follow-up sent after Stop is
queued durably before resume so it cannot be spliced between an assistant tool
call and its mandatory result.

## Source policy

The reader chooses scope, not an implementation technique. The agent decides
whether a source belongs directly in context, needs local search plus rerank,
or needs complete traversal. An explicit instruction such as “do not lose any
information” requires a source-unit coverage ledger; top-k retrieval cannot
silently stand in for reading the whole source.

PDFs are extracted locally with stable page anchors. Alcove can expose only
byte-valid embedded JPEG figures as managed supporting evidence; those objects
are not a raster of the composed page. It does not yet rasterise PDF pages or
run OCR. Until verified full-page rastering exists, **every page of every PDF**
remains unresolved for a preserve-everything task, even if text extraction is
complete and embedded JPEG figures are available. Ordinary non-preservation
tasks may use extracted text and those figures with the limitation recorded.
Attachments are untrusted data: instructions inside them cannot change the
reader's goal, tool permissions or approval requirements.

The default is the smallest relevant scope, not the smallest possible source
sample. `selection_and_page`, `current_page`, `nearby_pages`, `whole_book` and
`explicit_only` are product policies. Within that policy the agent may:

- place short, high-value units directly in context;
- use local lexical search and optional Embed/Rerank calls for a large source;
- traverse every source unit when completeness or preservation was requested;
- inspect extracted JPEG figures visually, and fail every PDF page closed for
  preserve-all work until full-page rastering exists rather than pretending
  text extraction or figure objects covered the composed page;
- cite the stable page/unit anchors used to make a claim.

Every source descriptor records a digest, unit ledger, extraction quality and
prompt-injection warnings. A complete-reading task cannot reach the proposal
gate while required units are uncovered. Retrieval scores are evidence for
ordering work, never proof that unread material was unimportant.

### Local retrieval index and recovery protocol

[`src/data/aiAgentRetrievalIndex.ts`](../../src/data/aiAgentRetrievalIndex.ts)
owns the derived schema `cohere-embed-v4.0-f32-512+fts5-rrf-v1`. Its vector table
stores exactly 512 finite floats with cosine distance and partitions by task;
its FTS5 mirror stores lexical text plus source/chunk/digest identity. Queries
are always task- and source-scoped, and every candidate joins to current
canonical rows on chunk id, source id, task id and digest. A stale mirror can
therefore order nothing authoritative.

[`src/data/aiAgent.ts`](../../src/data/aiAgent.ts) also owns the durable
`ai_agent_embedding_cache`. Its primary key is the retrieval `INDEX_VERSION`
plus the exact chunk-content digest, so identical unchanged units reuse their
document vector across turns, process restarts and different tasks. Indexing
hydrates canonical chunks from those exact matches, deduplicates missing
digests, and sends only genuinely changed/missing content to Embed. The cache
stores no task/source authority or source text: the current capability and the
canonical task + source + chunk + digest join remain mandatory before a hit is
usable.

Ordinary SQLite triggers maintain a durable dirty revision per source for
writes from every connection. Reconciliation reads revision A, snapshots the
canonical chunks, invalidates the published source-state row before changing
either mirror, rebuilds, and reads revision B. It publishes B only when A and B
match; one mismatch retries from a fresh snapshot. An exception or repeatedly
moving source leaves state invalidated and makes the caller use the existing
TypeScript lexical/cosine path. This also makes legacy backfill lazy and scoped:
only sources involved in a retrieval are reconciled, never the whole library at
startup.

Document/query embeddings still come from Cohere Embed v4 only when the current
privacy gate permits that outbound text. Rerank v4 remains an optional final
ordering pass. Text veil sets `local_only`: exact local cache/chunk vectors may
still be reused, but no new document/query Embed or Rerank call is made, and
FTS5 plus the TypeScript fallback remain available. Source replacement/deletion
prunes cache entries no longer referenced by a canonical chunk. If Stop races a
provider result or its durable publication, the prior task chunks are restored
and vectors produced by the interrupted run are removed. Neither a cache or
derived-index failure nor a missing native extension is allowed to fail
canonical source ingestion.

Source capabilities are also turn-scoped. `readerRequiresSourceEvidence`
derives intent from the current reader budget window—including clarification
replies and explicit grounded follow-ups—and gates advertisement of manifest,
direct-read, index-search, rerank and coverage tools. Merely retaining an old
attachment does not expose those tools on an unrelated conversational turn, so
ordinary chat does not inspect, embed, search or rerank stale context by
accident. Completion/proposal policy uses the same predicate rather than a
second, looser definition of grounded work.

### Intake and format matrix

The WebView allow-lists known source extensions, but Rust determines the stored
kind from bytes rather than trusting filename or MIME. Managed ids are generated
from SHA-256 and resolve only under the library's `ai/attachments` root. Input,
archive-entry/expanded-output and extracted-text caps are enforced before a file
becomes a source. Composer-only uploads are garbage-collected if cleared; a task
source reference becomes the durable owner after ingestion.

| Family | Extraction contract |
|---|---|
| PNG/JPEG/WebP | Managed visual source with digest and dimensions. Provider transport uses a metadata-free bounded derivative, not original bytes. |
| PDF | Local per-page text and embedded byte-valid JPEG evidence with page anchors. No OCR/full page raster; preserve-all therefore fails closed for every unresolved page. |
| UTF-8 text/code/data | Markdown, text/RTF/TeX, HTML/XML/SVG/CSS, CSV/TSV, JSON/JSONL, YAML/TOML, notebooks, common programming/shell/query/config/log sources. Content is bounded UTF-8 evidence only; it is never executed or rendered as active HTML/SVG. |
| DOCX | Local Open XML document body, footnote and endnote text. Macro packages, unsafe paths, oversized expansion and DTDs are rejected; media/layout/comments/revisions are absent. |
| XLSX | Local worksheet cell text, formulas and cached values. Formulas are never evaluated; macros/external links are rejected; formatting/charts/drawings/comments/hidden state are absent. |
| PPTX | Local slide and speaker-note text in authored order. Macros/external relationships are rejected; images, charts, drawings, animations, layout and theme styling are absent. |

A pasted body of 500 or more characters enters the same managed-source path as
`Pasted text.txt`. This keeps the user turn small and makes its contents
digest-addressed, chunkable, retrievable and coverable like a file.

Every source is split into bounded units with stable ids, digests, labels and
ordinal/character/page/figure anchors. Conservative prompt-injection detectors
annotate suspicious text, but the security property does not depend on matching
a phrase: every non-canonical attachment is always `untrusted_evidence` with
`instructionPolicy: never_execute`. The generated Notebook Script specification
is the only `canonical_authority` source.

Lexical search is local. Embed v4 and Rerank v4 are optional provider-derived
ordering aids and are re-authorized immediately before each call; a veiled task
forces `local_only`. Coverage records the provider-call count at which each unit
was read or each page image exposed. Completion requires a later model turn to
have observed that evidence, preventing a read and answer/proposal from being
accepted in one unobserved tool batch.

## Credential and privacy contract

- Keys are submitted to Rust, cleared from reactive UI state and never returned
  to JavaScript after saving.
- Keys never enter SQLite settings, localStorage, IndexedDB, graph state,
  exports, backups, URLs, logs, telemetry or error bodies.
- Saved credentials use the OS vault. A platform without an available secure
  vault offers session-only use, never a plaintext fallback.
- Trial-key setup includes Cohere's current privacy warning and requires an
  acknowledgement before notebook/source content is sent.
- Default context is the current selection/page plus explicitly attached
  sources. Whole-book context is visible and deliberate.

The trial notice links to Cohere's current [Privacy
Policy](https://cohere.com/privacy) and states that Cohere may use trial inputs
and outputs for research and development, trial environments should not contain
personal information, and its Products are not intended for personal or
household use. Production keys are labelled as organisation-approved
accounts/contracts, not as an automatic private path. Alcove does not proxy or
subsidize inference; the reader owns the key and provider relationship.

Connecting is distinct from running a task. Key testing sends only a
credential-validation request to Cohere; it sends no task, notebook page,
attachment or draft render. After a task starts, Cohere may receive the task
instructions, the current-book pages the agent chooses to inspect, explicitly
attached sources and current-generation draft renders needed for self-review.
Other books and ordinary notebook content remain local.

Managed AI attachments are content-addressed, type-sniffed and size-capped by
Rust. The WebView refers to opaque ids. PDF extraction happens locally; image
bytes are included only in an intentional source-analysis or draft-review turn.

### Text veil implementation

Text veil is opt-in per task and off by default. Its purpose is exposure
reduction, not anonymisation. The receipt stores a task namespace plus stable
opaque-token -> exact-literal entries locally. Detection covers common
labelled/contextual names; emails, phones and addresses; dates; UUID, IP and MAC
values; payment, IBAN, SSN, government/account/medical/policy identifiers;
usernames, long ids, JWTs and labelled or query-string secrets. Matches are
resolved deterministically, repeated literals reuse a token and existing tokens
are never recursively remasked.

The transform covers the task brief, provider message history, source excerpts,
tool JSON arguments/results and integrated target-page documents. Known private
JSON keys force masking even when a free-text detector would miss the shape;
capability keys—ids, hashes, digests, revisions, anchors, ordinals, dimensions,
media types—remain byte-stable. Sensitive query values inside a structural URL
are masked without destroying the URL. Image refs remain opaque ids; pixels are
outside this text-only transform.

New substitutions are persisted before the request that first uses them. The
provider is instructed to preserve tokens exactly, and model output is rejected
if any receipt-owned token is altered or an unknown Alcove-private token appears.
Provider history remains masked; local conversation rendering restores the
literal values with a chunk-safe stream restorer.

For notebook output the visual review runs on masked page pixels. Before the
reader sees a final preview, Alcove restores the script and integrated page
locally, assigns a new draft hash, reruns deterministic validation and the real
fixed-page renderer, and stores a second exact application receipt. The restored
generation must remain parser/layout-valid and current; otherwise the proposal
fails closed. The final user preview and apply seam refer to those restored
hashes/documents, while the provider's findings remain tied to the masked
generation. Embedding/reranking is disabled for a veiled task to avoid another
provider text path.

Limitations must remain visible in UI and docs: recognizers can miss novel or
context-only details; dates/identifiers may be semantically necessary; and text
inside screenshots, source images or scanned PDF pixels is never transformed.

## Preview and mutation invariants

Each draft has a run id, generation, content hash, layout hash and render
manifest. Provider events and screenshots from an older generation are ignored.
A proposal is valid only when every page in its current manifest has a visual
review result and no unresolved parser/layout failure.

The sandbox is not an approximate line counter. It resolves fetch directives,
maps Notebook Script through the production TipTap schema, mounts real
`PageEditor` instances with persistence and active-editor registration disabled,
lets the normal fixed-page overflow contract settle, and captures the resulting
pages at their native proportions. It diagnoses blank pages, clipped blocks,
unloaded images and unfinished diagrams before model review begins.

Every repair creates a new draft generation. The render manifest, review and
preview must all name that same generation and draft hash; late events from an
older provider stream or screenshot cannot bless newer content. This is why a
text-only statement such as “looks good” can never unlock the preview.

Approval records the target book content revision, exact inspected page-id
order, placement and proposal hash. Apply re-reads the content revision and
requires the inspected ids to remain an exact prefix: BookView may safely append
its empty ready-spread stock, but it cannot reorder/remove an existing blank
anchor or change authored content without staling the preview. The separate
full structural revision remains the durable whole-book/Undo authority, so a
later reader-created blank page still invalidates an older restore receipt.
Apply then runs under one whole-book checkpoint, verifies the resulting page
ids/content, and stores an idempotency key plus Undo receipt. Stop aborts the
provider request and makes the apply node unreachable.

“Atomic” here is the reader-visible contract across a multi-page editor change:
media and schema preparation happen before mutation; the live book revision is
checked again; a durable idempotency claim prevents double application; the
existing whole-book import checkpoint surrounds all page writes; any failure
restores that exact checkpoint; success arms one whole-operation Undo receipt.
The model never controls the idempotency key, expected revision or receipt.

### Sandbox identity and deterministic diagnostics

The sandbox's render key includes renderer version, draft hash, live book
revision, insertion target, integrated target document digest and the current
page-environment fingerprint. A cached generation is reusable only when that
identity, its digest receipt and every content-addressed render asset still
match. Theme/page/font/viewport changes invalidate it rather than serving pixels
from a visually different environment.

Before mount, it caps script characters, authored pages, blocks and explicit
image fetches; maps tolerant-parser diagnostics back to authored page ranges;
checks empty page boundaries, media/fetch receipts and duplicate content; and
converts through the production TipTap schema. The hidden host uses the real
leaf dimensions. It waits for fonts/media and three stable animation frames,
with a bounded timeout, while normal overflow callbacks enqueue continuation
pages. Post-mount diagnostics include blank/meaningless pages, residual
overflow, clipping, missing images, unfinished diagrams, unstable layout and
rendered duplication.

The generation manifest contains page ids/numbers/dimensions, content-addressed
image refs, per-page layout digests, pagination-spill/overflow flags, a global
layout hash, renderer version and book revision. The exact render receipt stores
the post-pagination `PageDoc`s and sources, protected-start flags, any fetched
asset receipts, and an application plan:

- `structural_pages` inserts already-reviewed page docs before/after a page or
  at book start/end;
- `integrated_target` replaces the reviewed caret/selection target page with
  receipt page 0 and inserts only its already-paginated continuation docs.

The receipt digest is checked on rehydration and before apply. It is outside
checkpointed `AgentState` because page JSON and display assets are larger,
separately disposable work products rather than provider-neutral control state.

### Visual exposure and review

Loading a render manifest is not visual inspection. The model must call
`read_draft_preview_pages` for the current generation in useful batches; the
tool attaches those exact images and records image digest, page id and provider
call count in the visual ledger. `record_visual_review` may cite only pages from
that generation and can record only observable summaries/evidence. All required
pages must have image exposure and a later provider observation before the
review can be complete.

A blocking finding is immutable evidence about those pixels. The reporting turn
cannot mark it repaired. Repair means submit a new script, which invalidates
validation, image-prompt handoff, preview generation and visual ledger; the new
generation must traverse the entire gate again. Late events or images from an
older run/generation cannot satisfy it.

### Exact apply and recovery

Approval first revalidates proposal/preview identity in core, then passes the
immutable proposal to `BookView`. The live mutation lane becomes read-only and
drains pending page producers before the revision check. The seam verifies the
book/target, reviewed receipt and exact application plan, prepares media and
schema work, rechecks revision, captures the full pre-apply book and claims the
idempotency key in `ai_agent_patch_journal` **before** the first page mutation.

Integrated targets additionally re-read target revision/document digest and, for
selection replacement, recompute the immutable selection digest. They install
the exact reviewed target document; there is no post-approval merge that could
repaginate into unseen pages. Structural targets insert the receipt docs in the
reviewed order.

After mutation the seam lets editor carry/pagination settle, hashes every live
reviewed page document against the receipt, verifies contiguous unique page
order and stores the resulting book revision. Only then does the journal become
`applied` and one whole-operation Undo become active. Failure restores the exact
pre-apply snapshot and releases only the unfinished claim. Undo first moves the
journal to `undoing`, restores the snapshot idempotently and then deletes the
row. On book open, rows stranded in `applying` or `undoing` are restored before
normal editing, covering process termination in either direction.

## Selected-text requests

The selection toolbar's AI action captures book id, page id, immutable `from`
and `to` positions, selected text and a page revision before focus moves to its
small prompt field. Submission opens the AI Agent panel and starts a normal
agent task with a `replace_selection` target. The toolbar exposes no direct
replacement function or inline-diff approval. The sandbox integrates the draft
into the captured target-page document and renders the real surrounding page;
apply installs that exact reviewed document. If the page changes, the normal
stale-revision path requires a refreshed integrated preview rather than guessing
where the old selection went.

## Explicit external-image handoff

The Agent has no image-generation tool, so it must never imply that it generated
pixels. Portable picture slots and generation prompts are also not a default
page-decoration policy. `imageIntent.ts` inspects only reader-authored
conversation, never model prose or source text. The latest unambiguous request
for images/pictures/photos/illustrations or portable slots enables the
capability; a later explicit “no images” disables it.

Without permission, the system prompt forbids portable image slots and
`assertPortableImagesRequested` independently rejects both a slot-bearing draft
and the prompt-preparation tool. Native diagrams, charts, stickers, tape and
other rendered notebook vocabulary remain available because they do not depend
on an external image service.

With permission, the draft may contain deterministic portable upload cards.
`prepare_image_generation_prompts` must provide exactly one prompt per slot id
in the **current draft**: self-contained subject/composition/style constraints,
teaching/page role, an allowed aspect enum, useful pixel dimensions and optional
negative constraints. Handoff construction rejects missing, duplicate, extra or
stale slots; a repaired draft invalidates the old handoff. The final preview
pairs each prompt with its exact slot and the applied proposal retains the
handoff so the reader can generate elsewhere and click/drop the result later.

The prompt string, not only its metadata card, contains the selected exact
pixel width x height and aspect ratio. Handoff matching rejects older prompts
that omit or disagree with those dimensions.

## Supplied-material composition and bounded enrichment

Pasted text and attached documents are valid notebook-authoring requests even
when the reader does not say “insert” or “make notes” verbatim. Prompt policy
distinguishes conversational questions from an instruction to format supplied
material, then treats that material as evidence rather than executable
instructions. The Agent may choose native catalogue elements that improve
hierarchy and recall, but it must preserve the source's claims and never invent
a citation or fact merely to occupy paper.

Composition has two passes. The first produces faithful natural pagination and
must be rendered before the second is considered. On the rendered pages, an
awkward gap is repaired first by layout—removing a premature page boundary or
pulling a coherent block backward. If that would break a meaningful semantic
boundary, exactly one compact relevant enrichment may be added to that gap,
followed by full parse, native render and visual review again. Deliberate
whitespace is acceptable; blanket “fill every page” behavior, generic filler,
repetition and unsupported source claims are forbidden.

An original managed image can be placed directly only through the exact opaque
portable asset path returned by its visual-source read, using its intrinsic
dimensions to preserve aspect. Rendered PDF evidence is never portable. Using
an attached image does not imply permission to create additional empty picture
slots; those still follow the explicit external-image intent gate above.

## External Notebook Script remains supported

The provider-free route is a permanent sibling, not a migration shim. Readers
may copy or download the generated Notebook Script specification with a Creative
Direction, ask any external assistant for an attached `.md`, preview it in the
plain Insert Script dialog and insert it. That path does not open the agent,
request a Cohere key or send notebook text to Cohere. A script containing an
explicit `fetch:` image directive may use Alcove's guarded open-image search
during preview/insertion, so this provider-free route is not network-free when
the script explicitly requests a fetched picture.

## Implementation map

- `src/features/aiAgent/` — provider-neutral state, graph, policy, tools,
  retrieval, source adapters, attachment intake/image intent/text veil, Cohere
  adapter and disposable render sandbox.
- `src/views/rail/AiAgentPanel.tsx` — first-use setup, task activity, source
  chips, final native preview, placement and approval UI.
- `src/views/rail/aiAgentControllerAdapter.ts` — translation from core runtime
  snapshots/events to panel view data and intents.
- `src/editor/toolbar/aiRewrite.ts` — immutable selection handoff.
- `src/views/BookView.tsx` — composition root and sole approved proposal apply.
- `src/data/aiAgentPersistence.ts`, `aiAgentApply.ts`, `aiCredentials.ts` and
  `aiGateway.ts`, plus `aiAgentRetrievalIndex.ts` — checkpoints/pending writes/
  task history, idempotency/recovery, secret boundary, normalized WebView calls
  and the fail-open FTS5/vec0 retrieval mirror.
- `src-tauri/src/ai.rs` — key vault/session lifecycle, Cohere HTTPS, cancellation,
  Embed/Rerank, managed attachments and local PDF/DOCX/XLSX/PPTX/text extraction.
- `src-tauri/src/vector_index.rs` — process-wide static sqlite-vec registration
  before plugin-sql creates its connection pool.

## Verification map

The everyday Agent regression set is intentionally split by authority rather
than one mocked end-to-end assertion:

- `ai-agent-runtime.test.ts` and `ai-agent-persistence.test.ts` cover graph
  resume/Stop/retry, interrupts, checkpoints, pending writes, tombstones and
  durable state dominance.
- `ai-agent-cohere-provider.test.ts` and `ai-agent-gateway-cancel.test.ts` cover
  V2 message/tool/image continuity, malformed SSE rejection and cancellation
  races. Rust unit tests in `ai.rs` independently exercise request validation,
  credential status, attachment sniffing, Open XML extraction and PDF limits.
- `ai-agent-production-adapters.test.ts`, `ai-agent-attachment-intake.test.ts`,
  `ai-agent-retrieval-index.test.ts`, `ai-agent-source-formatting-intent.test.ts`
  and `ai-agent-store.test.ts` cover notebook/source capabilities, file/paste
  classification, ownership, revision-safe FTS/vector reconciliation, RRF,
  supplied-material composition, units, retrieval and injection quarantine.
- `ai-agent-draft-sandbox.test.ts`, `ai-agent-conversation-image-handoff.test.ts`
  and `ai-agent-text-privacy.test.ts` cover native generation identity,
  deterministic/visual gates, explicit-only image handoff, placeholder
  integrity, local restoration and fail-closed layout.
- `ai-agent-apply.test.ts`, `ai-agent-insertion-contract.test.ts` and
  `ai-selection-rewrite.test.ts` cover exact receipts, revision/idempotency,
  integrated target application, rollback/recovery and one-operation Undo.
- `ai-agent-panel-contract.test.ts`, `ai-agent-settings.test.ts` and
  `ai-agent-demo-fixture.test.ts` keep the UI/controller/setup/demo seams from
  quietly bypassing those authorities.

Visible panel, preview and selection changes still require running-app review;
unit tests cannot establish that a congested rail, clipped page render or wrong
notification timing looks right.

## Current primary references

- Cohere Command A+, image input, tool use, Embed v4, Rerank v4 and rate-limit
  documentation.
- LangGraph persistence, interrupts, streaming and functional API guidance.
- OWASP Agentic Top 10 and prompt-injection guidance.
- Alcove's canonical `block-editor.md`, `script-language.md` and page-flip
  architecture.
