# Handoff — pick up here

Written 2026-08-06, for whoever (human or agent) continues this session's work.
Everything below is current as of commit `02136e7` on `main`, public repo
`AkshitIreddy/Alcove`. **Read `CLAUDE.md` first — it is binding**, and read
`TODO.md`'s `## 🎯 OPEN` section at the top for the actual work list; this file
is orientation, not a duplicate of it.

## What this session did, and why it stopped here

A long session (compacted at least once) drove Alcove from a working 0.3.0
toward a 0.4.0 release: fixed the page-turn recording, the welcome book's
pagination, a Rust test nobody was running, a real late-shadow bug, an
arrow-key removal the owner ruled on, and — the most important structural
finding — nine unit tests that were proven, by mutation, unable to fail
(`1ea6835`). It stopped because the owner is low on weekly usage (was told
directly, mid-session) and asked for three things: clean up ~20k lines of
untracked scratch JSON (done, `.gitignore` now excludes `qa/**/*.json`),
reorganize `TODO.md` (done — see its new top section), and this document.

**No more multi-agent workflows should be launched without the user asking for
them again.** That was explicit. Work directly, verify directly, keep changes
small and commit often.

## The one thing to check FIRST

There is **uncommitted, unverified work already sitting in the tree**:
`src/flip/offscreenPages.ts`, `src/flip/FlipSurface.tsx`, `src/views/BookView.tsx`
and `scripts/probe-turn-face.mjs` carry unstaged changes (run `git status` /
`git diff --stat` to see the current shape — it may have grown further if a
background agent from before this handoff is still running). They appear to
make offscreen flip-face captures **drain** a staged page before photographing
it, which would plausibly explain the "wrong spread briefly shown" finding
recorded in `TODO.md`'s open-items index. Nobody has run the test suite or
`tsc` against this specific diff and called it good. **Read it, verify it
(`npx tsc --noEmit`, the flip-related tests, ideally `probe-turn-face.mjs`
against the running app), and either finish + commit it or `git checkout --`
it.** Do not leave it sitting uncommitted for a third session.

## Where things stand

- `npx tsc --noEmit` — clean (as of the uncommitted diff above; re-check after
  touching it).
- `npx vitest run` — 2 known-red, both pre-existing and understood, neither a
  regression: `tests/readme.test.ts` fails because the README screenshots are
  still stamped 0.3.0 while `package.json` says 0.4.0 (fixed by the real shot
  re-capture, step 3 of the release sequence below), and a couple of README
  fact-count markers (`rustLines`, `docstringLines`, `probeScripts`) that drift
  every time a probe script is added — `npm run readme:build` fixes them, do
  that right before the shot re-capture, not before.
- `npx playwright test` — mostly green; `tests/e2e/tutorial.spec.ts`'s "opens
  on step one with all thirteen beats" is a **pre-existing** failure (expects a
  short-tour count of 13, gets 11 or 21), verified today to fail identically on
  clean `HEAD` with a full session's work stashed out — not caused by anything
  in this session, not yet investigated further.
- Rust: `cargo check` AND `cargo test` — both clean, 29/29. (This line in
  CLAUDE.md's Verify section used to say only `check`; a real test had been
  silently failing. Fixed today, see the log.)
- Version is bumped everywhere (`c77a35c`) to 0.4.0 but **not tagged yet** —
  the tag is the last step of the release sequence, after the history rewrite.

## The release sequence (also in `TODO.md`'s index, in more detail)

In order, and the order matters: (1) finish/verify the in-flight flip diff
above, or revert it, (2) `npm run visual` full matrix — watch the sabotage gate
pass on a QUIET tree first, (3) re-capture the 23 README shots, (4)
`npm run readme:build` + re-check the release-notes arithmetic, (5) re-render
the demo once, last, (6) run `scripts/shrink-history.mjs --yes` (already
rehearsed safe on a throwaway clone — 1.4GB → 318MB, GO), `--remap`, force-push
`main` **and `--tags`**, then `git tag v0.4.0`. Every step from (2) onward needs
a dev server nothing else is writing to — that constraint, not any individual
step, is what has made this hard to finish in a session full of parallel
agents.

## Things that will bite you if you don't know them

- **This machine is the owner's actual desktop.** No GUI windows, no
  installing/uninstalling the app on it, no visible automation loops. Read
  `CLAUDE.md`'s "Never install..." line and the memory file
  `no-gui-automation-on-desktop.md` if you have access to it.
- **Headless Chromium probes need `page.emulateMedia({ reducedMotion:
  'no-preference' })`** or a page turn crossfades instead of curling — a
  different code path from what a reader sees. Every flip probe in this repo
  got this wrong once before learning it.
- **A probe's own dynamic `import('/src/data/...')` can resolve to a second
  module copy** on a dev server that has served HMR updates. Use the QA
  bridges `world.ts` hands out (`__shelfSaveDesign`, etc.), not a fresh import.
- **A gate nobody has watched fail is not a gate.** This project's own rule,
  earned the hard way twice today (a visual-suite sabotage gate, a footnote
  probe). If you write or trust a check, break the thing on purpose first.
- **`shots-now/visual-suite.mjs --sabotage`** can itself report a false
  "GATE INERT" if the dev server reloads mid-run from a concurrent agent's
  edit — it now detects that and reports INCONCLUSIVE instead (`162cbf8`), but
  only run it on a quiet tree regardless.
- **Multiple agents editing the same dev server in parallel causes HMR
  reloads that look exactly like app bugs.** Confirmed today (the tutorial e2e
  failures I initially suspected were contamination — checked by stashing and
  re-running against clean `HEAD`, and they were pre-existing, not
  contamination; but the pattern itself is real and has fooled probes before).
  When something fails on a busy tree, re-check on a quiet one before trusting
  the failure OR the pass.

## Where the history is

`git log --oneline -20` tells the real story better than this document will
stay accurate for. The commit messages in this repo are written as the actual
documentation — long, specific, with measured numbers — read them rather than
skimming subjects.
