# Workspace cleanup

This repository can grow from local QA captures and browser traces. These are
generated files, not application source, and are already ignored by Git.

## When the folder gets large

From the repository root, inspect the largest top-level directories first:

```bash
du -sh -- * .[^.]* 2>/dev/null | sort -h | tail -20
```

The usual safe cleanup targets are:

- `qa/` — retired or local QA captures
- `shots-now/out/`, `shots-now/bookfit/`, and other ignored `shots-now/` output folders
- `shots-now` image/video files and `shots-now/runlogs/`
- `tmp-turn-*` — throwaway probe scripts, screenshots, logs, and traces
- `playwright-report/`
- `dist/` and `dist-release/` — rebuildable frontend bundles

Do not remove `src/`, `public/`, `assets/`, `docs/`, `tests/`, or user data. Keep
`node_modules/` unless you specifically want to reinstall dependencies, and keep
`.git/` because it contains repository history.

Before deleting anything, confirm it is ignored and generated:

```bash
git status --short --ignored
```

If a capture may be useful, archive it outside the repository first. After
cleanup, rerun the size command and run the normal checks (`npm test` and
`npx tsc --noEmit`) when source files were involved. Do not commit generated
captures or traces.
