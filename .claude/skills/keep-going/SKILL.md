---
name: keep-going
description: Finish the whole list before reporting. Use whenever there is a TODO file, a multi-item request, a backlog, or several delegated agents in flight — and especially when you notice yourself about to write a summary while work remains.
---

# Keep going

The owner's standing instruction on this project: **"keep going until all is done"**, "don't stop till everything is done", "so dont keep stopping until all todo is done keep running". They have said it more than five separate times, which means the default behaviour keeps reasserting itself and has to be actively suppressed.

## The failure mode, precisely

It is not laziness and it is not confusion about the goal. It is this:

> A batch of work completes. It produced something genuinely interesting — a
> measurement, a surprising root cause, a fix that held. The pull to write it up
> is enormous, because it *is* worth saying. So a summary gets written, the turn
> ends, and four open items sit untouched while the owner reads prose they did
> not ask for.

The owner named it exactly: *"I haven't been reading what you said."* The summaries were not the deliverable. The list was.

## The rule

**Ending a turn is a decision that requires a reason.** There are exactly three:

1. The list is empty.
2. Every remaining item is blocked on a human decision you have already asked for.
3. Every remaining item is blocked on something running that you cannot usefully overlap.

"I finished a meaningful chunk" is not on that list. Neither is "this deserves explaining".

## What to do instead of stopping

When a batch lands:

- **Record it where it belongs** — a commit message, a TODO entry, a comment beside the code. Those are permanent and searchable. A chat summary is neither.
- **Start the next item in the same turn.** Not "next I will" — actually call the tool.
- If several agents are in flight, do not idle waiting for them. Pick up something that touches different files and work on it.

## When you do report

Some turns genuinely end. Then:

- Lead with **what is left**, as a list. That is what gets read.
- Keep findings to the ones that change a decision — a bug the owner should know about, a trade-off that is theirs to make, something you got wrong.
- If they asked "what's left" or "how's it going", answer in bullets and stop. Do not narrate the journey.

## Checks before writing any closing paragraph

Ask, and answer honestly:

- Is there an unticked item I could start right now? → start it.
- Am I about to explain something already written into a commit or TODO? → delete the explanation.
- Have I said "still to come" or "next up"? → that is a plan, not a report. Do the thing.

## Not an excuse to skip verification

Speed is not the point; the point is not stopping. Everything else in `CLAUDE.md` still binds — look at the screenshots, run the suite, watch a gate fail before trusting it, prove non-use before deleting. Finishing the list means finishing it *properly*, and a fix reported without evidence has to be redone, which is slower than doing it once.

## Not an excuse to skip a real question

If a decision is genuinely the owner's — an irreversible action, a design call, a trade-off with no right answer — ask it, then **carry on with everything that does not depend on the answer**. Blocking the whole list on one question is its own way of stopping early.
