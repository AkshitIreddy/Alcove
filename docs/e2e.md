# Running the end-to-end suite

`npm run e2e` — Playwright, `tests/e2e/*.spec.ts`, config in
`playwright.config.ts`. `npm run e2e:ui` opens the same suite in Playwright's UI
mode.

It runs headless Chromium against the **Vite dev server on :1420**, not against
a build and not against Tauri. The app falls back to the in-memory SQLite stub
in `src/data/db.ts` outside Tauri, which is what makes a browser run meaningful
at all. `webServer.reuseExistingServer` is true, so if a dev server is already
up the suite attaches to it and does not start its own.

Two things every spec has to respect, both because of the headless environment:

- **`?fx=force`.** Headless WebGL is SwiftShader, the app's software-renderer
  probe sees it and drops the shelf into degrade mode, and you get lo-res
  untitled spines and no `__shelfWorld` hook. The override lives in
  `src/features/bookshelf/env.ts`.
- **Poll, never fixed-wait.** SwiftShader can throttle `requestAnimationFrame`
  to ~10fps. `expect.poll` everywhere; a `waitForTimeout` that passes on your
  machine will fail on a loaded one. `tests/e2e/helpers.ts` is written this way
  throughout and is the model to copy.

## A red run is not automatically a product failure

The suite shares its dev server with whoever else is working in the repo, and
this repo is regularly worked by several agents and windows at once. **When any
of them saves a module Vite cannot hot-swap, the HMR client full-reloads every
open page** — including the page Playwright is mid-drag on. What you get is a
destroyed execution context, or a locator whose element vanished, or a boot poll
that times out, and the error message describes none of the actual cause.
Several of the failures in the 2026-08-01 session were this and nothing else.

So the config carries `retries: 1`, and the reasoning is spelled out at the
setting itself so nobody quietly reverts it:

- **A retry does not hide a flake here — it labels one.** Playwright buckets a
  test that failed and then passed as *flaky*, prints it in the list reporter
  and counts it in the run summary. `retries: 0` surfaces no extra information;
  it only turns a known environmental class into a red run that reads like a
  regression.
- **One, not two.** One absorbs a single reload or a starved boot. A genuine
  race generally loses twice and stays red.

Playwright has no *conditional* retry — there is no "retry only if the page
navigated under us" hook, so the retry is necessarily blanket. What the config
does instead is keep the evidence.

## Telling the two kinds of red apart

`trace: 'retain-on-first-failure'` records the attempt that **failed** and
throws the trace away when it passes. (`on-first-retry` is the cheaper mode and
the wrong one: it traces the attempt that usually passes.) Open it:

```bash
npx playwright show-report        # click the failed test, then the trace
# or, straight from the artifact:
npx playwright show-trace tests/e2e/.artifacts/<test-dir>/trace.zip
```

A Vite full-reload is unmistakable once you are looking at it:

- a **navigation the spec never issued**, immediately before the error;
- `[vite] page reload …` in the console tab, or `[vite] server connection lost.
  Polling for restart…` if the dev server itself restarted;
- the actions after it operate on a freshly booted app — the shelf is back at
  its start camera, any book you pulled is shelved again.

A real product failure has none of that: the last navigation is the spec's own
`goto`, and the app state going into the error is the state the spec built.

`tests/e2e/.artifacts` and `playwright-report/` are both gitignored.

## When more than one agent is running

Do not believe a single red result. In order of cost:

1. Re-run just that spec — `npx playwright test tests/e2e/pull-out.spec.ts`.
2. Check the trace for the reload signature above.
3. When the repo is quiet, ask for the honest determinism check explicitly:
   `npx playwright test --retries=0`, or `--repeat-each=3` to see whether it
   fails on its own account. The CLI flag overrides the config, so proving
   determinism never requires editing `playwright.config.ts`.

## Why not just remove the hazard

The cure is to run against something without HMR — `vite preview` on a built
`dist/`. It is deliberately not what happens, for two reasons: it puts a full
`vite build` in front of every e2e run, and it points the suite at a different
server from the one every probe script, specimen board and manual QA pass
already uses. A one-retry allowance and a readable trace cost less than a second
serving path that can drift from the first.

## Related

- `scripts/probe-*.mjs` — the same Playwright driving, but for **applied** state
  through the `?fx=force` bridges rather than pass/fail specs. `probe-*.mjs`
  scripts do not use this config; they drive the running app directly.
- `docs/readme/part-2-developers.md` — the four checks, and where e2e sits among
  them.
