---
name: docs-update
description: "Audit README.md and docs/ai-workflow.md for missing features, stale content, and prose quality issues (internal field names, misleading references). Reads CLAUDE.md and CHANGELOG.md for context. Reports findings and, on approval, applies fixes."
---

Audit **`README.md`** and **`docs/ai-workflow.md`** for gaps, staleness, and prose quality issues.
Propose updates; apply them only on approval.

## Inputs to read (in parallel)

1. `README.md` — full
2. `docs/ai-workflow.md` — full
3. `CLAUDE.md` — for conventions and rules that should be reflected in the docs
4. `CHANGELOG.md` — for recently shipped features/fixes that may not be documented yet
5. Recent git log: `git log --oneline -30` — to catch anything shipped after the last CHANGELOG entry

## What to look for

### A. Missing or undocumented features

Compare CHANGELOG entries and recent commits against what the docs describe. Flag any user-visible
feature or behaviour that shipped but isn't mentioned in either doc.

For each gap, note:

- Which doc it belongs in (README for high-level features, ai-workflow.md for AIWF-specific detail)
- A proposed one-line addition or the section it would go under

### B. Stale or inaccurate content

Look for descriptions that no longer match the current product — renamed UI elements, removed
options, changed defaults. Cross-check config field tables against `hangar.config.example.json`
and the names used in the UI sections.

### C. Prose quality: leaked implementation details

Scan the **prose sections** (not the API table or "Where it lives" developer reference — those are
intentional) for internal names used where plain English would serve better:

- Internal TypeScript field names in backticks used as explanatory parentheticals
  (e.g. ``(`skipWorktree`)``, ``(`aiwfProjectId`)``)
- Internal constant names (e.g. `SKILL_GROUPS`, `DEFAULT_COLUMNS`, `COLUMN_SKILLS`)
- Internal function names used mid-sentence (e.g. `` via `appendCardHistory` ``)
- Source file references in plain-English paragraphs (e.g. ``(`server/src/skills.ts`)``)
- Internal type shape mappings (e.g. ``Ticket shape (`summary`=title, `boardKey`=project id)``)

The test: would a reader who hasn't read the source code find this parenthetical helpful or
confusing? If confusing, it should be rewritten in terms of observable behaviour.

Note: the **API table**, **"Where it lives"**, and **"Card file format"** sections are developer
references — implementation names there are appropriate and should be left alone.

### D. CLAUDE.md convention drift

Check whether any convention or rule stated in `CLAUDE.md` is contradicted or ignored by the docs
(e.g. naming conventions, data-dir location, env variable names).

## Report

Group findings under the four categories above. For each finding state:

- **File + section** where the issue lives
- **What's wrong** (one sentence)
- **Proposed fix** (the exact text to add/change/remove, or a clear description)

If no issues are found in a category, say so in one line.

After the report, ask: **"Apply these fixes?"**

- **Yes** → make all edits to `README.md` and/or `docs/ai-workflow.md`, then commit with message
  `docs: <short summary of what changed>`. Do not run typecheck (docs-only change).
- **No** → stop; leave the files as-is.

When editing, preserve the existing style: sentence case, no trailing summaries, prose quality over
exhaustiveness. Prefer removing noise over adding words.
