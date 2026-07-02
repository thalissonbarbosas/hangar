# Feature: "Same session" when moving an AIWF card between columns

## Trunk Metadata

- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-han-55-same-session`

## Problem

When you drag an AI Workflow card into a new phase column, Hangar pops that phase's skill
picker (`PhaseSkillModal`, titled "Start a {phase} session"). Its "Start session" button always
calls `runCard` → `POST /api/aiwf/projects/:id/cards/:key/run` → `startRun(...)`, which spins up a
**brand-new Claude session every time**. The new skill has no memory of the card's prior work in
earlier phases — the operator loses the accumulated conversation context on every phase move, even
though the card is one continuous work thread.

Affected: anyone moving a card across phases and running the next phase's skill (HAN-55).

## Solution

Give the move picker two run modes and make **continuing the existing session the default**:

- **Same session** (primary, default) — resume the card's most-recent run via the existing SDK
  `resume` path (`sendMessage`/`resumeRun`), sending the chosen skill as a follow-up message into
  that conversation. Full conversation memory carries over and the run's worktree/branch is reused.
- **New session** (secondary) — the current behavior: `startRun(...)` for a fresh Claude session.
- **Just move, no session** (ghost) — unchanged.

The card's most-recent run is already known to the frontend via `runByTicket.get(card.key)`, so the
UI passes that run id to the run route. The server validates resumability and falls back cleanly.

**Fallback (decided):** when the card has **no prior run**, "Same session" is hidden and the picker
shows only the single "Start session" button (byte-for-byte today's behavior) — nothing exists to
resume, so it silently does the only valid thing. No other change to the "Just move" or spec-promote
paths.

## Technical Design

### API Changes

Extend the existing run route only — no new endpoint:

`POST /api/aiwf/projects/:id/cards/:key/run`
- **New optional body field:** `resumeRunId?: string` — the id of the run to continue.
- **Behavior when `resumeRunId` is present and valid** (run exists, belongs to this card's
  `ticketKey`, has a `sessionId` **or** is active, and its `cwd` still exists):
  - Update that run's `aiwfPhase` to the card's current column so the history entry is tagged with
    the **new** phase (the run's `aiwfPhase` was stamped at its original start and is now stale).
  - Call `sendMessage(run, <skill-invocation text>)` — this resumes a finished run (SDK `resume`)
    or steers a still-active one, both of which keep the same session.
  - Respond `{ runId: run.id, mode: "resume" }`.
- **Behavior when `resumeRunId` is absent or invalid** — the current `startRun(...)` path,
  responding `{ runId, mode: "new" }` (existing `{ runId }` shape stays a superset). An
  invalid/gone `resumeRunId` **falls back to a new session** rather than erroring, so a pruned
  worktree never blocks the move.

**Skill-invocation text for resume** — a compact instruction mirroring `buildPrompt`'s skill line so
the resumed agent invokes the new skill with the card as context, e.g.:

```
Use the "<skill>" skill to continue on this card.
Card: <KEY> — <title>
Phase: <target column>
<optional operator note>
```

Add a small exported helper in `server/src/sessions.ts` (e.g. `resumeCardRun(run, skill, phase,
note)`) that stamps `run.aiwfPhase`, builds this text, and delegates to `sendMessage`, returning its
mode. Keeps the route thin and unit-testable.

### Data Model

No schema changes. Resumed runs already log to the card's history on turn completion
(`streamTurn` → `appendCardHistory`, gated on `run.aiwfProjectId && run.ticketKey`); stamping the
fresh `aiwfPhase` before resume is the only adjustment so the appended entry carries the new phase.

### Architecture

- **`server/src/sessions.ts`** — add `resumeCardRun(...)` (thin wrapper over the existing
  `sendMessage`/`resumeRun`). No change to `startRun` or the resume machinery itself.
- **`server/src/routes/aiwf.ts`** — in the `cards/:key/run` handler, read `resumeRunId`; when
  present and the resolved run is valid for this card, take the resume branch; else keep the
  existing `startRun` path. Reuse `getRun` for lookup and validate `run.ticketKey === card.key`.
- **`web/src/api.ts`** — `aiwfRunCard(id, key, skill, note?, resumeRunId?)` adds `resumeRunId` to
  the POST body.
- **`web/src/components/AiWorkflow.tsx`**
  - `runCard(key, skill, note?, resumeRunId?)` forwards `resumeRunId`.
  - `PhaseSkillModal` gains an `existingRun?: RunSummary` prop and an `onRun(skill, note?, mode)`
    signature. Render **Same session** (primary, default) + **New session** (secondary) when
    `existingRun` is present; render only the single **Start session** button (byte-for-byte today's
    behavior) when it is absent. Keep "Just move, no session" (`onCancel`).
  - At the picker render site (`{picker && …}`), pass `existingRun={runByTicket.get(picker.key)}`
    and route the callback: `mode === "same"` → `runCard(key, skill, note, existingRun.id)`;
    `mode === "new"` → `runCard(key, skill, note)`. Preserve the existing `SPEC-*` →
    `promoteSpecAndRun` branch (spec cards have no continuing session; always "New session").
- **`docs/AI_WORKFLOW.md`** — update the "Move" bullet under **The phase board** to describe the
  Same session / New session choice.

Non-goals reuse note: this deliberately uses **SDK resume** (same conversation), not the
`parentRunId` handoff path, per the design decision — memory must carry across the phase move.

## Security Considerations

No new attack surface. No new endpoint; the one new field (`resumeRunId`) is a run id validated
server-side (`getRun` + ownership check `run.ticketKey === card.key`) before use — a caller cannot
resume another card's or an unrelated session's run. The resume text is server-composed from the
already-validated skill name, card fields, and the operator note (same trust level as today's
`note`). No change to trust boundaries in `docs/THREAT_MODEL.md`.

## Feature Flag

None — user-ready on merge. Behavior only differs when the operator explicitly picks "Same
session"; "New session" and "Just move" remain byte-for-byte the current flows, and a card with no
prior run behaves exactly as today.

## Verification Criteria

### Unit Tests (`server/src/__tests__/sessions.test.ts` or `aiwf.test.ts`)

- [ ] `resumeCardRun(run, skill, phase, note)` on a finished run with a `sessionId` → returns
      `"resume"` and stamps `run.aiwfPhase = phase`.
- [ ] The composed resume text contains `Use the "<skill>" skill`, the card key, and the note when
      provided.
- [ ] `resumeCardRun` on a run whose `cwd` is gone → does not throw; surfaces the existing
      "working directory is gone" error path (no fresh work performed).

### Integration Tests (`server/src/__tests__/index.aiwf.test.ts`)

- [ ] `POST /cards/:key/run` with a valid `resumeRunId` for that card → `200 { mode: "resume" }`
      and the run's `aiwfPhase` equals the card's current status.
- [ ] `POST /cards/:key/run` with a `resumeRunId` belonging to a **different** card → falls back to
      a new session (`{ mode: "new" }`), never resuming the foreign run.
- [ ] `POST /cards/:key/run` with no `resumeRunId` → `{ mode: "new" }` (regression: existing
      `startRun` path and `{ runId }` shape preserved).
- [ ] `POST /cards/:key/run` with a stale/unknown `resumeRunId` → falls back to a new session,
      status `200`.

### E2E / Manual

- [ ] Drag a card that has a finished prior run into a new column → picker shows **Same session**
      (default) + **New session**; choosing Same session opens the same run in the panel and the
      agent references earlier context; a new history entry is tagged with the new phase.
- [ ] Drag a card with **no** prior run → picker shows only the single **Start session** button and
      behaves as today.
- [ ] `npm run typecheck`, `npm run lint -- --max-warnings=2`, `npm --prefix server test`,
      `npm run format:check`, and `/smoke` all pass.

## Out of Scope

- The `parentRunId` **handoff** semantics (fresh conversation) — explicitly rejected in favor of
  SDK resume for this feature.
- "Same session" for **spec cards** (`SPEC-*`) — they promote to a fresh board task per run and
  have no single continuing session; they always start a new session.
- Moves into **Complete** (no picker today) and the "Just move, no session" path — unchanged.
- Any config field, new column behavior, or change to how runs are isolated/worktreed.
