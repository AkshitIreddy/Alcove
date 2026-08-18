# Authored GitHub release notes

The GitHub release message is written from the completed work, not generated
from commit subjects.

During release preparation:

1. Write `release-notes/vX.Y.Z.md` with the reader-facing explanation for that
   exact version. Begin at `##`; the assembler adds the Alcove title.
2. Describe what changed, why it matters, important recovery or compatibility
   behavior, and anything readers should know. Use at least two meaningful
   sections. Do not paste a commit list.
3. Run `node scripts/release-notes.mjs vX.Y.Z --check`.
4. Read the complete rendered source with
   `node scripts/release-notes.mjs vX.Y.Z` before creating the tag.

While the version is not chosen yet, keep the custom prose in `unreleased.md`
and preview it with
`node scripts/release-notes.mjs vX.Y.Z --source=release-notes/unreleased.md`.

The release workflow refuses a missing, tiny, placeholder-filled, or
version-mismatched note. Stable branding, history links and the platform
download table remain centralized in the assembler so they stay accurate.
