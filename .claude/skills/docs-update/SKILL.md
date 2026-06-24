---
name: docs-update
description: "Audit all Hangar docs (README, ai-workflow, ARCHITECTURE, THREAT_MODEL) for missing features, stale content, and prose quality issues. Reports findings and, on approval, applies fixes. Use before a release, after a significant feature, or whenever docs feel out of date."
---

Audit all Hangar documentation for gaps, staleness, and prose quality issues.
Propose updates; apply them only on approval.

## Inputs to read (in parallel)

1. `README.md` — full
2. `docs/ai-workflow.md` — full
3. `docs/ARCHITECTURE.md` — full
4. `docs/THREAT_MODEL.md` — full
5. `CLAUDE.md` — conventions that docs must reflect
6. `CHANGELOG.md` — recently shipped features/fixes
7. `hangar.config.example.json` — source of truth for config fields
8. Recent git log: `git log --oneline -40` — catch anything shipped after the last CHANGELOG entry

## What to look for

### A. Missing or undocumented features

Compare CHANGELOG entries and recent commits against what each doc describes. Flag any
user-visible feature or behaviour that shipped but isn't mentioned.

For each gap, note:

- Which doc it belongs in
- A proposed one-line addition or the section it should go under

**Docs most likely to fall behind:**

- `README.md` — config table, feature highlights, screenshots callouts
- `docs/ai-workflow.md` — new AIWF phases, skills, or routes
- `docs/ARCHITECTURE.md` — new components, changed data flows, updated tech stack versions,
  new known-debt items, resolved debt that should be removed

### B. Stale or inaccurate content

Look for descriptions that no longer match the current product — renamed UI elements, removed
options, changed defaults, moved files.

**Key cross-checks:**

- `README.md` config table vs `hangar.config.example.json` field names and defaults
- `docs/ARCHITECTURE.md` component list vs `server/src/` file listing
- `docs/ARCHITECTURE.md` tech stack table vs root/server/web `package.json` dependency versions
- `docs/THREAT_MODEL.md` attack surface table vs the routes defined in `server/src/index.ts`
- `docs/THREAT_MODEL.md` security controls vs current implementation (check `server/src/index.ts`
  CORS config, rate limiter, and `server/src/aiwf.ts` exec calls)

### C. Prose quality: leaked implementation details

Scan **prose sections** (not API tables, "Where it lives", or developer-reference sections — those
are intentional) for internal names that would confuse a user who hasn't read the source:

- TypeScript field names in backticks used as explanation (e.g. ``(`skipWorktree`)``)
- Internal constant or function names mid-sentence
- Source file paths in plain-English paragraphs
- Internal type shape mappings

The test: would a reader who hasn't seen the code find this helpful or confusing? If confusing,
rewrite in terms of observable behaviour.

Note: **API tables**, **"Where it lives"**, **"Card file format"**, and **developer-reference**
sections intentionally use implementation names — leave those alone.

### D. CLAUDE.md convention drift

Check that no doc contradicts a rule in `CLAUDE.md`:

- Naming: product is **Hangar**, data dir is `.hangar/`, env prefix is `HANGAR_*`
- Never mention the old name "FleetView"
- Docs live in `docs/` — no standalone doc files in the repo root

### E. Threat model drift (THREAT_MODEL.md only)

For each row in the **Attack Surface** table, verify the route still exists in
`server/src/index.ts`. Flag routes that were added or removed.

Check the **Security Controls — Required** list: have any been implemented since the last model
update? Move them to **Implemented** if so.

## Report

Group findings under the five categories above. For each finding state:

- **File + section** where the issue lives
- **What's wrong** (one sentence)
- **Proposed fix** (exact text to add/change/remove, or a clear description)

If no issues are found in a category, say so in one line.
Report findings for all four docs before asking to apply.

After the report, ask: **"Apply these fixes?"**

- **Yes** → make all edits, then commit with `docs: <short summary>`. Do not run typecheck
  (docs-only change).
- **No** → stop; leave the files as-is.
- **Selective** → the user may name specific findings to apply; apply only those.

When editing, preserve the existing style: sentence case, terse, no trailing summaries.
Prefer removing noise over adding words.

## Note on screenshots

`docs/screenshots/` is managed by `npm run screenshots` (the Playwright script), not by this
skill. If screenshots appear obviously outdated (UI elements renamed, layout changed), note it
as a finding but do not attempt to update them here — direct the user to run
`npm run screenshots` instead.
