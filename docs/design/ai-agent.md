# In-book AI Agent

Status: implementation authority for the Agent shipped in 0.7.0, updated
2026-08-17.

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

Checkpoint history and provider context are deliberately different views.
`AgentState.modelHistory` remains a complete durable forensic/restart record;
no compaction mutates it. `modelHistoryToProviderProjection` creates an
ephemeral transport view. Completed conversation boundaries are normalized
there: a successful `finish_conversation` answer becomes an ordinary assistant
message, while an answered `ask_user` pair becomes an ordinary assistant
question followed by the reader's exact reply. The raw calls and receipts stay
unchanged in durable history. This gives deictic follow-ups such as “add that to
my book” the same visible transcript the reader saw instead of hiding the
antecedent inside tool arguments.

Draft-pipeline compaction begins only after the projector can find a successful
`submit_notebook_script` receipt matching the current durable draft. It retains
all reader/assistant conversation, notebook/source reads, exact tool pairing
and one byte-for-byte complete current script. Superseded and unchanged draft
arguments become schema-shaped hash/length receipts, and obsolete
draft-validation/render/review results become bounded scalar/digest receipts.
Without a matching receipt it sends the full history. This fail-open rule is
what keeps context reduction from becoming a new source of draft authority.
Legacy history is sanitized separately: canonical Notebook Script authority is
discovered from both the current manifest and historical manifest results, and
old canonical list/read payloads become paired redaction receipts before
transport. A legacy manifest that still contains that authority must be
refreshed before any other source tool is advertised.

`inspect_notebook` is compact at creation rather than repaired later in
history. The durable state receives the complete snapshot with ordered page ids
and page revisions. The provider receives a routing manifest containing title,
page count, book revision, capture time and page id/ordinal/optional title/token
estimate rows—never the duplicate snapshot and per-page revision fields. Exact
page content remains an explicit `inspect_page`/`inspect_page_range` read.

Parallel tool calls belong to that one assistant turn. Cohere must see a result
for every retained call as one contiguous group before the next model turn. An
interrupting call is different: its siblings were authored without the future
reader answer, so the runtime discards them and trims the stored assistant call
list at the interrupt. Resume supplies exactly one result to exactly that call
and then returns to the model. This prevents both an invalid partial result set
and stale work executing after a human decision.

The tool node also owns a reader-turn no-progress watchdog. Starting after the
current `budgetWindow.readerMessageId`, it compares semantic call signatures
against blocked calls across intervening no-op/error calls while a material
state fingerprint remains unchanged. Notebook submission signatures normalize
line endings, trailing horizontal whitespace and blank-line runs in ordinary
Notebook Script markup as well as sorted unique citations, and ignore
explanatory `reason` wording. Fenced code/diagram regions remain byte-opaque so
a real verbatim-body repair cannot be mistaken for whitespace churn; multiline
`$$` LaTeX regions have the same byte-opaque rule. This is a watchdog-only
normalization: the byte-exact Script stored, hashed, rendered and reviewed
remains unchanged.
The material fingerprint advances for real notebook/source observations,
source coverage, draft/validation/render state and exact preview-image exposure.
A first replay becomes a checkpointed, paired `no_progress_warning` result and
does not execute. Repeating it after that warning clears pending calls and
fails with `agent_stalled` instead of circling through the 24-call budget.
Different tool names or syntactically varied invalid arguments cannot evade the
guard: three consecutive results with the same material fingerprint produce a
phase-level warning, and one more unchanged phase stalls safely.
Changed material, a materially changed script/citation set, or the same action
in a later reader turn fails open to normal execution.

### Tool schemas and capabilities

Each capability in `tools.ts` owns one `.strict()` Zod schema. That schema is
converted to a conservative Cohere tool-use JSON-Schema subset; optional
properties become required-but-nullable for transport. Returned null sentinels
are stripped and the original Zod schema parses the arguments again, including
defaults, discriminated unions and unknown-key rejection. Schema conversion is
wire compatibility, not authority. Alcove uses Cohere's optional
`strict_tools` hint only on compact authoring envelopes proven compatible with
the live endpoint; local parsing is always the authority.

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

That list is the superset, not the request sent on every turn. One durable
per-turn objective begins as `undecided`. At that boundary the model sees safe
entry points for conversation and notebook work plus `set_task_mode`; the local
reader-language detector is an advisory hint, not semantic authority. The first
successful mode-specific action latches the objective. A conflicting action is
returned as a structured `intent_conflict`, and the model can accept or
explicitly override the hint with a reason. After settlement,
`availableAgentToolNames` is again a deterministic phase gate over durable
state. Conversation excludes notebook drafting/proposal; notebook work excludes
`finish_conversation`; stale/missing grounded sources open only the relevant
source capabilities; and the draft pipeline narrows from
inspect/placement to submit, validate, render, pixel read, visual review,
proposal and final preview submission. Repair submission reappears only for a
changed source manifest, invalid validation, unresolved blocking visual finding
or pending explicit reader feedback. A fully inspected generation that still
has an invalid parser/layout receipt also returns to script repair even if its
human-style visual findings are empty. Image-slot permission revocation and a
failed local private-text restore are durable repair phases; citation-only
resubmission cannot clear a private-layout failure.

Relevant-only intake also cannot report a vacuous success. Before any source
selection/read, `inspect_source_coverage` is absent; a direct retrieval plan
marks the selected source units required, making the ledger incomplete until a
real read records them. Once notebook mode is settled, source tools are
exclusive until that read occurs, so drafting cannot race ahead of attached
evidence.

Preserve-all tasks finish required source reads before drafting. If extracted
PDF text is available but the required composed-page pixels are not, each unit
is recorded as attempted and the phase narrows to one reader blocker question;
re-reading the same impossible unit cannot spend the call budget. Every
grounded draft stamps the exact reader-evidence
unit set available at authorship; if coverage later advances, both catalogue and
hard proposal policy require a materially revised or re-cited submission. The
same old script/citations cannot merely stamp the newer read set. The system
prompt names the derived
`nextRequiredAction`, while `descriptorsForState` sends only the phase-valid
schemas. Most importantly, `AgentToolCatalog.execute` derives the set
again against current state before parsing/executing a call, so stale queued
calls and provider-invented transitions fail even if they once appeared in a
prompt.

Every tool failure is a model-visible recovery receipt: `errorCode`,
`failedTool`, `stateChanged`, `availableTools`, `suggestedTools` and
`nextAction`, beside the human-readable error. The next model turn must change
arguments, call a prerequisite or repair task mode rather than repeating the
same failed call. Transport/auth/protocol/budget failures remain local because
they occur before any model tool result exists; source/revision/preview/Insert
authority is never model-overridable.

Fresh settled reader turns clear the previous notebook snapshot, disposable
draft pipeline and prior-turn citations. Cached source read receipts may remain
for a genuine grounded follow-up, but an unrelated chat/edit does not call
manifest, Embed, Search or Rerank merely because an older attachment exists.
The next notebook edit inspects the live book once before drafting, while an
explicit current-page/default insertion target supplied by the UI is retained.
Newly registered reader attachments carry a `sourceIntentTurnId` into the
matching reader turn. The attachment is therefore the implicit object of a
request such as “add to my book”; Alcove reads it instead of asking what the
reader meant. The receipt is turn-scoped, so an old attachment still cannot
force an unrelated later message through retrieval.

There is no arbitrary HTTP request, shell, filesystem path, SQL statement or
editor transaction. Source reads receive a task/manifest-digest capability from
trusted state; render reads require current generation and page ids; proposal
and idempotency identities are derived locally from current hashes.

The healthy Cohere production path now spends provider calls only on semantic
judgment. With a UI-supplied placement, a single attached image reaches preview
in exactly two provider calls:

1. Command A+ authors the grounded draft after Alcove locally inspects the
   notebook and reads the one bounded source;
2. Command A+ judges the exact rendered pixels after Alcove locally validates,
   renders and exposes them.

Proposal construction and the final-preview interrupt are local deterministic
steps. The complete audit trail still contains nine ordinary tool receipts—
inspect, read, draft, validate, render, expose, review, propose and present—so
local policy and Retry retain the same observable boundaries. The reader's
Insert decision and revision-checked apply remain outside those model turns.
Multiple/large sources, explicit target choice and genuine semantic repairs may
add provider decisions; mechanical workflow routing does not.

### Provider protocol

`provider.ts` normalizes model I/O into public-text deltas, tool-plan deltas,
complete typed tool calls, citation ids, usage and finish. It deliberately has
no credential or hidden-thinking event. `cohereProvider.ts` maps that boundary
to Cohere V2 while preserving assistant tool plans and exact call continuity.

The Cohere graph locally executes singleton deterministic routing tools,
including preview-page exposure, without making a provider request. Composition,
source choice, conversation and page-image judgment retain enabled thinking
with an 8,000-token budget and the normal output allowance. Local assistant
tool-call history deliberately omits `tool_plan`: live Command A+ rejects that
field for synthetic history even though it accepts the complete call/result
pair. The provider-neutral protocol and durable state expose no hidden reasoning
channel.

The Cohere wire request deliberately omits `tool_choice`, including for
notebook mutation and current-source grounding. The generic V2 contract lists
`REQUIRED`, but live Command A+ trial and production compatibility probes
rejected that field with Alcove's production catalogue. Alcove instead keeps
mandatory call selection as a local graph invariant. Compact authoring turns
send `strict_tools: true` with sanitized required/nullable schemas; source/RAG
catalogues and multimodal image turns omit that optional flag because the live
endpoint rejected those envelope combinations. The complete local Zod parse
still rejects malformed or invented arguments before execution.
An ordinary source-free conversation may answer naturally and Alcove wraps a
complete prose `STOP` into the local `finish_conversation` boundary. If that
optional-tool envelope itself is unusable, the graph counts it and makes one
bounded tool-free prose request; a second failure pauses.

A malformed source-routing stream has the same observability limitation: no
tool result exists for the model to analyse. When the gateway gives no
non-retryable HTTP status, the graph makes exactly one counted corrective turn
with the same source capability boundary and an explicit instruction to plan
or read rather than repeat a no-op coverage check. A second failure pauses; an
HTTP 4xx is never blindly resent.

The source-to-draft handoff has one additional bounded recovery. If
`submit_notebook_script` is the only available capability and Cohere corrupts
that tool envelope, Alcove makes one plain, tool-less request to the same model
for raw Notebook Script. The supervisor converts that model-authored text into
the missing draft call and attaches the already-read unit receipts; it does not
invent page content. Normal local validation, native rendering, visual review
and reader approval still follow. A provider error that cannot recover retains
its bounded protocol detail in Copy Logs while reader-facing copy stays calm.

Reader-supplied image use has two local invariants that the model cannot
override. Once an image source read exposes a `portableAssetPath`, every
initial/repair draft for that current request must retain the exact path on a
real parsed image block; mentioning it in prose/code, replacing it with an
upload placeholder, or dropping it after a render failure is corrected locally.
An attachment path mistakenly written in the Markdown URL slot is canonicalised
to `asset=...`, and a missing block is inserted with an aspect-aware width. Before
proposal, policy rechecks the same invariant independently. Visual findings are
also severity-normalised locally: empty/receipt-only pages, missing media,
unreadable output, clipping, overflow, collision and duplication are blocking
even when the model reports them as `info` or `other`.
For the bounded vague command “add to my book” with one dense image, Alcove
uses a one-page image-led default: the model's accurate title, the complete
managed picture and its caption. Detailed transcription remains model-owned
only when the reader asks for extraction, conversion, notes or a study guide.

Alcove still treats every provider stream as untrusted. If a well-formed empty
completion or malformed tool stream occurs in one of the four singleton,
argument-free phases above, the graph records that provider attempt and safely
routes the only locally authorized transition. Any other judgment-bearing or
multi-tool work phase still pauses rather than guessing the model's intent.
The panel represents a final failure once: the persistent recovery card owns
the detail and Retry action, while `run.failed` remains diagnostic history and
does not become a duplicate transcript activity.

A native `render_draft_preview` exception creates a durable, draft-hash-bound
render-recovery receipt. The exact failed renderer message is returned to the
model and the phase exposes only `submit_notebook_script`; a materially changed
draft clears the receipt and re-enters validation. The deterministic renderer
is never repeated unchanged after its own failure. Copy Logs retains the last
five bounded structured tool failures (`errorCode`, exact safe message,
available tools and next action) while continuing to exclude credentials and
attachment bytes.

Images are observations for one turn, not durable repeated history. The adapter
reattaches pixels only from the trailing unanswered tool-result group, after the
complete assistant -> tool-results sequence, in one synthetic user turn. Older
history keeps immutable digests/exposure records. Source and draft images are
locally decoded, metadata-stripped, bounded by purpose, re-encoded and capped at
twenty per provider turn; failure to prepare a safe derivative never falls back
to the original bytes.

The adapter rejects malformed stream ordering, incomplete/duplicate calls,
invalid argument JSON, mismatched finish reasons and completion without a valid
message end. Known frames may derive a missing SSE header from the matching
validated payload; exact `[DONE]`, heartbeat and self-identifying extension
frames are non-authoritative and ignored, while a real `message-end` remains
mandatory. Rust independently fixes the outbound origin to Cohere, validates
the request vocabulary and JSON/tool/image/stream bounds, verifies SSE content
type and returns typed public errors. The graph is the single chat-retry owner:
one counted provider call is one Cohere `/v2/chat` HTTP attempt, including on
desktop. Native Embed, Rerank and key-check requests retain their own bounded
retry loops because they do not pass through the Agent graph.

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
call and its mandatory result. A checkpoint with a real pending node resumes
that exact cursor. A provider failure has already routed to LangGraph `END`, so
Retry seeds the saved domain state through `START`; merely updating the terminal
checkpoint and invoking `null` would perform no work. Failed provider attempts
are included in usage and budget accounting even when no valid turn is emitted.

## Source policy

The reader chooses scope, not an implementation technique. The agent decides
whether a source belongs directly in context, needs local search plus rerank,
or needs complete traversal. An explicit instruction such as “do not lose any
information” requires a source-unit coverage ledger; top-k retrieval cannot
silently stand in for reading the whole source. Preserve-all source work is an
exclusive pre-draft phase, and the draft's read-set receipt prevents pages
authored from partial evidence from becoming approvable merely because later
reads completed the ledger.

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
is retained locally as `canonical_authority`, but is deliberately filtered from
the provider-facing task manifest and manifest capability. It is not an
attachment, cannot enter the normal direct-read/search/embed/rerank path, never
satisfies or expands reader-source coverage, and is rejected as a citation.
Coverage creation/read/refresh sanitizes spec units from legacy ledgers, while
complete coverage still requires every unit of an attached PDF or other reader
source. Notebook Script syntax reaches the model through the compact authoring
contract in the system prompt and is enforced by the parser/validator, not by
pretending the specification is reader evidence.

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

Managed Agent attachments resolve from their bounded native bytes into
same-process blob URLs before hidden capture in both browser development and
Tauri. A normal Tauri asset-protocol URL displays in the live editor, but
WebView2/html-to-image may reload a cloned descendant during capture and emit a
bare DOM error event. Blob materialisation makes that clone path deterministic;
capture readiness and any remaining capture exception now name the affected
managed media instead of collapsing to `{"isTrusted":true}`.

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
The receipt body is JSON-canonicalised before both hashing and storage. Fresh
PageDoc objects may contain optional `undefined` properties that JSON persistence
omits; hashing that transient object but verifying the parsed value made a new
receipt reject itself. Canonicalising only this handoff preserves every other
notebook/source/cache hash identity while making persisted bytes authoritative.

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

Ordinary multi-page authoring also crosses a deterministic semantic-craft gate
in `draftCraft.ts`. Headings plus paragraphs/bullets are insufficient unless the
reader explicitly requests plain/minimal/verbatim output. Two rendered pages
need a meaning-bearing native structure; three or more need several structures
serving at least two roles. The post-render check uses the real native page count,
not only authored `::page` boundaries, so pagination spills cannot bypass it.
Negated restraint (“do not leave it plain”) is composed intent, and empty image
slots never count because external-image handoff remains reader-opt-in only.

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

Freshness failures discovered while preparing or approving the terminal
proposal are recoverable phases, not permission to repeat the same terminal
call. Notebook revision/order drift disposes owned generations, clears the old
snapshot and exposes only `inspect_notebook`; grounded source drift marks the
reader sources stale and exposes only `list_source_manifest`. Source freshness
is checked only when the current turn/draft actually uses source authority, so
an unused old attachment cannot invalidate an unrelated edit. A Text Veil
restore whose exact private values fail parser/layout safety records a durable
`proposalRecovery` receipt and exposes only a materially changed Script repair;
the marker survives the provider checkpoint that clears transient errors.

An approved apply failure has a separate bounded recovery lane. **Refresh
preview** retains the failed proposal's exact script and placement, inspects the
current notebook once, validates and renders locally, and compares every new
page's image/text/layout digest, geometry and spill flags with the immutable
failed preview. It makes zero provider or model-tool calls. Only an identical
render receives a new proposal/idempotency identity plus durable
`applyRecovery`; pixel or target drift fails closed and disposes the attempted
generation. Restart reconstructs the refreshed final-preview interrupt from the
receipt instead of resuming the stale LangGraph interrupt. For Text Veil, exact
restored pages remain the reader/apply generation while the unchanged visual
ledger continues to name the masked generation Cohere actually inspected.

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

## Research basis for the turn/outbox redesign (2026-08-18)

The Agent's state model was re-audited against a broad current evidence set,
not one vendor quickstart. The useful convergence is stronger than any one
framework choice:

1. **Session, run and working context are different objects.** The session is
   the append-only public/audit log; each reader message starts a distinct run
   with its own objective and budget; model context is a reversible projection
   of those durable objects. A paused approval remains an outbox item rather
   than becoming the next run's objective.
2. **Semantic work is an observe → decide → act → verify loop.** The model owns
   uncertain routing and repair after receiving structured observations. Local
   code owns credentials, capabilities, state legality, idempotency, budgets,
   deterministic transformations and final approval.
3. **Evidence is explicit, not adjacent.** A provider request gets a typed
   evidence bundle keyed by source/unit/modality/digest. Its receipt records
   what pixels/text were actually serialized. An intervening local tool can no
   longer make required evidence disappear or let a call-count approximation
   claim that unseen pixels were observed.
4. **Approval is durable user-owned work.** A reviewed preview survives side
   questions, provider failure, restore and conversation completion. Only an
   explicit Insert, revise, reject or delete action consumes it.
5. **Evaluation checks repeatability and end state.** Exact multi-turn traces,
   adversarial tool errors, multimodal grounding, persisted/restarted state and
   deliberate failing controls matter more than a single successful transcript.

### Evidence ledger

Primary vendor/runtime guidance:

- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
  — lean prompts, relevant tools, explicit autonomy/stopping boundaries and
  representative quality/cost evaluation.
- [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
  — durable conversations and per-response continuation are separate concerns.
- [Cohere Command A+](https://docs.cohere.com/docs/command-a-plus) — the active
  model supports text, images, reasoning and tool use.
- [Cohere tool-use patterns](https://docs.cohere.com/docs/tool-use-usage-patterns)
  — direct answers, sequential tool loops and exact assistant/tool continuity.
- [Cohere streaming tool use](https://docs.cohere.com/docs/tool-use-streaming)
  — streamed tool calls are protocol items that must be assembled and retained.
- [Cohere image inputs](https://docs.cohere.com/v2/docs/image-inputs) — image
  bytes must be explicitly present in the request; high detail matters for
  small text and diagrams.
- [Cohere streaming responses](https://docs.cohere.com/v2/docs/streaming) —
  bounded typed stream events and terminal usage/finish data.
- [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
  — composable workflows for predictable stages, agents for uncertain stages,
  ground-truth observations, stopping conditions and carefully designed tools.
- [Anthropic, Trustworthy agents in practice](https://www.anthropic.com/research/trustworthy-agents)
  — plan/act/observe/adjust loops, human control, transparent harnesses and
  calibrated clarification.
- [Anthropic, Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents)
  — decouple brain, hands and append-only session; context is a projection, not
  the durable session itself.
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
  — thread checkpoints, stores, fault tolerance and human-in-the-loop state.
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
  — a paused run is a durable cursor and side effects before resume must be
  idempotent.
- [LangGraph thinking model](https://docs.langchain.com/oss/python/langgraph/thinking-in-langgraph)
  — typed shared state, discrete nodes, errors as flow and first-class human
  input.
- [LangGraph subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs)
  — per-invocation state isolation is the safe default for independent work.
- [Google ADK conversational context](https://adk.dev/sessions/) — session
  events, current state and searchable cross-session memory have distinct
  lifecycles.
- [LlamaIndex agent memory](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)
  — short-term chat history and durable memory require explicit token/retention
  policies.
- [AutoGen state contracts](https://microsoft.github.io/autogen/stable/reference/python/autogen_agentchat.state.html)
  — saveable agent, message-thread, turn and stall state are explicit schemas.
- [CrewAI flows](https://docs.crewai.com/en/concepts/flows) — structured state,
  event-driven branching and persisted workflow checkpoints.

Research and evaluation evidence:

- [ReAct](https://arxiv.org/abs/2210.03629) — interleaved reasoning, action and
  observation improves exception handling and reduces ungrounded reasoning.
- [Reflexion](https://arxiv.org/abs/2303.11366) — linguistic feedback and
  episodic repair memory improve later decisions without changing model weights.
- [Toolformer](https://arxiv.org/abs/2302.04761) — useful tool use requires
  deciding whether, when and how to call, then incorporating the result.
- [AgentBench](https://arxiv.org/abs/2308.03688) — long-term reasoning,
  decision-making and instruction following remain common agent failures.
- [GAIA](https://arxiv.org/abs/2311.12983) — realistic assistants require
  reasoning, tools and multimodal evidence with unambiguous end evaluation.
- [tau-bench](https://arxiv.org/abs/2406.12045) — database end state and
  pass-to-the-k reveal inconsistency hidden by a single successful trial.
- [OSWorld](https://github.com/xlang-ai/OSWorld) and
  [WebArena](https://webarena.dev/) — realistic stateful environments and
  programmatic end-state validators expose long-horizon failures.
- [Image-Grounded Conversations](https://www.microsoft.com/en-us/research/publication/image-grounded-conversations-multimodal-context-natural-question-response-generation/)
  — later dialogue must remain constrained by the shared image, not text
  history alone.
- [MemexQA](https://research.google/pubs/focal-visual-text-attention-for-memex-question-answering/)
  — answers should identify the grounding photo that justifies them.
- [DART](https://arxiv.org/abs/2605.23311) — locally legal recovery can still be
  semantically invalid without an explicit admissibility check.
- [DecisionBench](https://arxiv.org/abs/2605.19099) — orchestration quality,
  cost, latency and routing fidelity must be measured separately.
- [Petri](https://www.anthropic.com/research/petri-open-source-auditing) — broad
  multi-turn simulation plus independent judging finds failures one-off tests
  miss.
- [Graph-based long-running workflow recipes](https://arxiv.org/abs/2607.19297)
  and [ExecuGraph](https://arxiv.org/abs/2607.20499) — typed transitions,
  evidence gates, bounded retries, execution-grounded evaluation and ablations
  make added complexity measurable rather than ceremonial.

These sources disagree on how much autonomy or framework machinery to use, but
agree that adding abstraction does not make a model smarter. Alcove therefore
keeps its small provider-neutral loop, strengthens the session/run/evidence
interfaces around it, and uses deterministic workflows only where the outcome
is already mechanically defined.
