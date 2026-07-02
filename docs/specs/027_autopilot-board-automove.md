# Feature: Automove hangar tasks when created/finished by /autopilot

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-autopilot-board-automove`

## Problem

When you run `/autopilot` on a Hangar AI Workflow (aiwf) board card, the orchestrator
executes a whole roadmap — phase by phase — dispatching one worktree subagent per task and
opening a PR for each. But the Hangar board never reflects that work: no cards are created for
the roadmap tasks, and nothing moves as tasks finish. The operator has to hand-create and
hand-drag every card to mirror what autopilot already did. The board and the orchestrator drift
apart exactly when the orchestrator is doing the most work.

Affected: anyone running `/autopilot` from an aiwf board card (HAN-28).

## Solution

Follow the existing `roadmapSeedNote` precedent: Hangar injects a skill-specific **run note** into
autopilot sessions started from an aiwf card. The note instructs the orchestrator to keep the
Hangar board in sync as a side effect of its normal work by writing/updating card markdown files
directly in the project's board directory:

- **When a roadmap task is created/started** → autopilot writes one board card file per task
  (`status: Implementation`, `kind: thread`), with an incrementing key continuing from the
  highest existing card.
- **When that task finishes** (its PR is opened) → autopilot rewrites that card's
  `status:` frontmatter to `Delivery`.

This reuses the established mechanism (Hangar already tells the `roadmap` skill to seed cards the
same way), needs no new API surface, and works whether or not the HTTP server is reachable from
the agent — the agent writes files in the board dir whose absolute path Hangar hands it.

Scope: `autopilot` only (matching the ticket). `factory` is intentionally left out.

## Technical Design

### API Changes

None. No new routes, request/response shapes, or status codes. The card files autopilot writes are
picked up by the existing `listCards()` read path and `GET /api/aiwf/projects/:id/cards`.

### Data Model

No schema changes. Autopilot writes standard aiwf card files (the same format `createCard` /
`roadmapSeedNote` produce): YAML frontmatter `{ key, title, status, kind }` + markdown body, under
`<DATA_DIR>/aiwf/<projectId>/board/<KEY>.md`. Cards created start at `status: Implementation` and
are moved to `status: Delivery` on task finish — both are existing columns in `DEFAULT_COLUMNS`.

### Architecture

All changes are in `server/src/aiwf.ts` (referenced by `docs/ARCHITECTURE.md` as the aiwf card
store) plus its doc and tests:

1. **New note builder `autopilotSeedNote(project)`** — sibling to `roadmapSeedNote`. Returns an
   instruction string that includes:
   - the absolute board directory (`boardDir(project)`), and
   - the project's card-key prefix (`projectPrefix(project)`) so the agent doesn't have to guess
     it,
   and tells the orchestrator to (a) scan the board dir for the highest existing `<prefix>-<n>` and
   create new cards continuing that numbering — one per roadmap task, `status: Implementation`,
   `kind: thread` — and (b) set a card's `status: Delivery` once its task's PR is opened. It must
   only touch cards it created.

2. **Wire into `projectRunNote(skill, project, userNote)`** — add
   `if (skill === "autopilot") parts.push(autopilotSeedNote(project));` alongside the existing
   `roadmap` branch. The route (`routes/aiwf.ts` card `run` handler) already passes every skill run
   through `projectRunNote`, so no route change is needed.

Autopilot already runs **in place** in the real project repo (it is not a `DELIVERY_SKILLS` /
`WORKTREE_SKILLS` skill), so it has direct filesystem access to write the board files. The board dir
lives in Hangar's data dir, not the repo, so seeded cards never dirty the project working tree.

## Security Considerations

- **No new attack surface.** No new endpoints; nothing new is parsed from user input. The note is a
  server-composed string; the only interpolated values are the server-derived board path and the
  project prefix (derived from the already-validated project name), not user input.
- The agent writes only under the project's own board dir (an absolute path Hangar supplies).
  This is the same trust level `roadmapSeedNote` already grants the `roadmap` skill — see
  `docs/THREAT_MODEL.md`; no boundary changes.

## Feature Flag

None — slice is user-ready on merge. The behavior only activates for `autopilot` runs started from
an aiwf card; every other skill and flow is byte-for-byte unchanged (`projectRunNote` still returns
`undefined` for non-roadmap/non-autopilot skills with no user note).

## Verification Criteria

### Unit Tests (`server/src/__tests__/aiwf.test.ts`, `projectRunNote` describe block)

- [ ] `projectRunNote("autopilot", project)` → returns a string containing `boardDir(project)`.
- [ ] `projectRunNote("autopilot", project)` → contains the project's key prefix
      (e.g. matches `projectPrefix`), the word `Implementation`, and the word `Delivery`.
- [ ] `projectRunNote("autopilot", project, "scope it")` → contains both the user note (`scope it`)
      and the seed instruction (board path), in that order.
- [ ] `projectRunNote("feature", project)` → still `undefined` (no regression to other skills).
- [ ] `projectRunNote("roadmap", project)` → still contains the roadmap seed note (no regression).

### Integration / Manual

- [ ] `npm run typecheck` exits 0.
- [ ] `npm run lint -- --max-warnings=2` exits 0.
- [ ] `npm --prefix server test` exits 0.
- [ ] `npm run format:check` exits 0.
- [ ] `/smoke` (demo-mode API smoke) passes.
- [ ] Manual: run `/autopilot` on an aiwf card against a repo with a roadmap; confirm the injected
      note appears in the session prompt and (with a cooperating agent) task cards appear in
      Implementation and move to Delivery as PRs open.

## Out of Scope

- A server-side run-lifecycle hook that moves cards on run start/finish (rejected in favor of the
  agent-cooperation note, consistent with `roadmapSeedNote`).
- `/factory` and other orchestrators (autopilot only).
- Moving the *launched* card itself, auto-merging PRs, or moving cards to `Complete` — finish
  target is `Delivery`, leaving the merge/complete decision to the operator.
- Any new API route or config field.
