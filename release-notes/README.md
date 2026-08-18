# Authored GitHub release notes

The GitHub release message is written from the completed work, not generated
from commit subjects. It is a quick orientation for readers, not an engineering
report.

During release preparation:

1. Draft in `release-notes/unreleased.md`, then move it to
   `release-notes/vX.Y.Z.md` when the version is chosen. Begin at `##`; the
   assembler adds the Alcove title.
2. Aim for **80–180 words** in **one to three short sections**. State what a
   reader will notice and, where useful, why it matters.
3. Group related fixes. Prefer one or two sentences per item. Name a provider or
   platform only when the distinction helps the reader.
4. Leave out implementation architecture, internal tool names, file names,
   test counts, exhaustive edge cases and commit-by-commit history. Those belong
   in the repository, not the release message.
5. Use this small shape; omit a section when it has nothing useful to say:

   ```markdown
   ## What changed

   Brief reader-visible outcome and its practical benefit.

   ## Also fixed

   One grouped sentence about the remaining noticeable fixes.
   ```
6. Run `node scripts/release-notes.mjs vX.Y.Z --check`.
7. Read the complete rendered source with
   `node scripts/release-notes.mjs vX.Y.Z` before creating the tag.

While the version is not chosen yet, keep the custom prose in `unreleased.md`
and preview it with
`node scripts/release-notes.mjs vX.Y.Z --source=release-notes/unreleased.md`.

The release workflow refuses a missing, tiny, overly long, placeholder-filled,
or version-mismatched note. Stable branding, history links and the platform
download table remain centralized in the assembler so they stay accurate.
