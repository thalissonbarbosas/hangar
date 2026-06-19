---
name: aiwf-sync
description: "Check whether docs/ai-workflow.md is in sync with the AI Workflow implementation — routes, phase/skill table, config shape, card format, and 'Where it lives' file inventory. Use after any change to the AIWF connection, or to audit before a release. Reports concrete drift findings; optionally fixes them."
---

Audit **`docs/ai-workflow.md`** against the live AIWF implementation and report (or fix) drift.

The rule in `CLAUDE.md`: _whenever you change the AI Workflow connection — its routes, board model,
phases/skills, config shape, install flow, or card format — update `docs/ai-workflow.md` in the same
change._ This skill makes that rule checkable.

## Steps

### 1. Read the doc

Read `docs/ai-workflow.md` in full.

### 2. Check: phase/skill table

Read `server/src/aiwf.ts`. Find `SKILL_GROUPS` (the phase → skills mapping) and `DEFAULT_COLUMNS`.

Compare against the phase/skill table in the doc (`## What aiwf is` section). Check:

- Every phase in `SKILL_GROUPS` appears in the table
- Every skill listed under each phase matches
- `DEFAULT_COLUMNS` matches the board column sequence shown in the doc

### 3. Check: API route table

Read `server/src/index.ts`. Find every route registered under `/api/aiwf/` (lines with
`app.get`, `app.post`, `app.patch`, `app.delete` where the path starts with `/api/aiwf`).

Compare against the API table in the doc (`## API` section). Check:

- Every route in the code appears in the table
- No routes in the table are absent from the code
- HTTP methods match

### 4. Check: config shape example

Read `server/src/config.ts`. Find the `validateConfig` block that handles `aiWorkflow` and
the `cleanAiwfProjects` function.

Read `server/src/types.ts`. Find `AiwfProject`.

Compare against the JSON example under `## Configuration` in the doc:

- Every field of `AiwfProject` that is required/meaningful is shown in the example
- The validation rules described in the doc (id/name/repoPath required, columns optional) match the code

### 5. Check: card file format

Read `server/src/aiwf.ts`. Find the card create/read logic (look for frontmatter field names like
`key`, `title`, `status`, `kind`, `skill`, `pr`, `archived`). Also find the `HANGAR_HISTORY`
comment block pattern.

Compare against `### Card file format` in the doc:

- Every frontmatter field mentioned in the doc exists in the code
- The HANGAR_HISTORY block syntax matches

### 6. Check: "Where it lives" inventory

The `## Where it lives` section lists source files for Server and Web. Check that each listed
file still exists at the stated path:

- `server/src/aiwf.ts`
- `server/src/index.ts`
- `server/src/sessions.ts`
- `server/src/config.ts`
- `server/src/types.ts`
- `web/src/components/AiWorkflow.tsx`
- `web/src/App.tsx`
- `web/src/api.ts`, `web/src/types.ts`
- `server/src/__tests__/aiwf.test.ts`
- `server/src/__tests__/index.aiwf.test.ts`

Flag any that are missing or have moved.

### 7. Check: install/uninstall flow

Read the install/uninstall section in `server/src/aiwf.ts` (`detectAiwf`, `installAiwf`,
`uninstallAiwf`). Confirm the detection logic (bin path and/or skills presence) and the
install/uninstall commands match what the doc says under `## Install / detect / uninstall`.

### 8. Report findings

For each section, report:

- **In sync** — no drift found
- **Drift** — describe the specific mismatch (e.g. "Route `PATCH /api/aiwf/projects/:id` is in the code but missing from the API table")

If no drift is found anywhere, report "docs/ai-workflow.md is in sync with the implementation."

If drift is found, ask: **"Fix these now?"**

- Yes → update `docs/ai-workflow.md` to match the code (code is the source of truth), then run `npm run typecheck` to confirm no accidental edits broke anything.
- No → leave the doc as-is and just report the findings.
