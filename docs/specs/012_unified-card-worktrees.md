# Feature: Unified task-scoped worktrees for all board cards

## Trunk Metadata

- **Type:** fix
- **Flag:** none — user-ready on merge
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `fix/<issue-number>-unified-card-worktrees`

---

## Problem

Spec 010 introduced task-scoped worktrees for SPEC-* cards on the AIWF board. Two related gaps
remain:

**1. Jira board cards are not covered.**
The `POST /api/runs` handler has no task-worktree logic. Every skill run creates a fresh
`hangar/<label>-<runId>` worktree via `isolateRuns`. A `/spec` run lands in one worktree, a
`/feature` handoff creates a different worktree from HEAD, and a `/commit` run gets yet another.
Skills in a delivery chain cannot share state across a card's lifecycle.

**2. The planning-skill exclusion breaks the spec → feature handoff.**
`TASK_WORKTREE_SKILLS` (code + delivery skills) excludes planning skills like `spec`. Per spec 010,
planning skills run in the real repo so their output lands in the tracked source tree. In practice:
- `/spec` writes the spec file to the real repo's working tree (uncommitted).
- `/feature` creates a task worktree from `main` — the spec file is not committed to `main`, so
  the worktree doesn't have it.
- The user must manually commit the spec to `main` before handing off. This gate is invisible.

**3. Non-SPEC AIWF board cards are not covered.**
The AIWF card route only applies task worktrees when `card.kind === "spec"`. Regular thread/task
cards skip the worktree logic and fall back to `isolateRuns`, same as the Jira board.

The concrete failure: user assigned `/spec` to HAN-8, the spec was written but not committed, then
handed off to `/feature`, which created a new branch from HEAD (missing the spec). `/commit` ran in
yet another fresh `hangar/commit-<id>` worktree, not the task branch.

---

## Solution

Introduce `DELIVERY_SKILLS` — the set of skills that form the implementation-and-ship chain. Only
these get persistent task worktrees. All other skills and agents keep the existing `isolateRuns`
behavior so Docker environments, test runners, and analysis agents are unaffected.

```typescript
export const DELIVERY_SKILLS = new Set([
  "spec",                      // planning: writes the spec into the task branch
  "feature", "fix",            // code: implements in isolation
  "review", "sec-review",      // review: inspects the actual implementation
  "commit", "pr",              // delivery: ships from the task branch
]);
```

Apply this uniformly to **all card types** — Jira tickets and AIWF cards (spec, thread, task):

```
Card HAN-8, /spec    → task worktree feat/han-8 (spec written there, stays uncommitted)
Card HAN-8, /feature → SAME worktree (spec file visible, no commit required before handoff)
Card HAN-8, /commit  → SAME worktree (commits spec + code on feat/han-8)
Card HAN-8, /pr      → SAME worktree (PR includes spec + code)

Card HAN-8, /debug-agent  → isolateRuns path (per-run worktree from HEAD, or real repo)
Card HAN-8, /roadmap      → isolateRuns path (writes to real repo if isolateRuns: false)
```

### `isolateRuns` remains the gate

Task worktrees are only created when `isolateRuns: true` (the global default). When
`isolateRuns: false`, delivery skills also run in the real repo — consistent with the board's
explicit "no isolation" intent. This is the correct behavior for Docker-heavy projects that
already set `isolateRuns: false` to give agents access to the real repo path and environment.

| Run type | `isolateRuns: true` (default) | `isolateRuns: false` |
|---|---|---|
| Delivery skill (`DELIVERY_SKILLS`) | Persistent task worktree from `main` | Real repo — no worktree |
| Other skill | Per-run worktree from HEAD — unchanged | Real repo — unchanged |
| Agent | Per-run worktree from HEAD — unchanged | Real repo — unchanged |

---

## Technical Design

### Branch Name Derivation

For non-SPEC-* cards (Jira tickets and AIWF thread/task cards):

1. Sanitize the card key to lowercase with hyphens: `HAN-8` → `han-8`, `PP-1234` → `pp-1234`.
2. Prefix from the **first delivery skill** assigned:
   - `fix` or `sec-review` → `fix/`
   - everything else → `feat/`
3. Result: `feat/han-8`, `fix/han-8`.

For SPEC-* cards: preserve the existing `branchFromSpec()` logic (spec slug + Trunk Metadata type).

### Card State Storage

Unify state storage under a single directory, keyed by `<contextId>/<sanitized-key>`:

```
<DATA_DIR>/card-state/<contextId>/<sanitized-key>.json
{ "taskBranch": "feat/han-8", "worktreePath": "/tmp/hangar-worktrees/han-8-abc" }
```

- **AIWF cards**: `contextId = aiwf-<projectId>`
- **Jira cards**: `contextId = jira-<boardKey>`

Backward compatibility: on read, fall back to `spec-state/<key>.json` when
`card-state/<contextId>/<key>.json` is missing. No migration needed.

### Unified `resolveCardWorktree`

Replace `resolveTaskWorktree` (SPEC-*-only, code+delivery skills only) with:

```typescript
export async function resolveCardWorktree(
  stateContextId: string,       // "aiwf-<projectId>" or "jira-<boardKey>"
  cardKey: string,
  skill: string,
  repoRoot: string,
  specPath: string | null = null,  // non-null only for SPEC-* cards
): Promise<{ cwd: string; branch: string } | null>
```

- Only called when `isolateRuns: true` AND `DELIVERY_SKILLS.has(skill)`.
- Branch derivation: `specPath` present → `branchFromSpec(specPath)`; otherwise
  `<prefix>/<sanitize(cardKey)>` as above.
- Lifecycle unchanged from spec 010: first run creates the worktree from `main`; subsequent runs
  reuse it; stale path triggers `git worktree add <newPath> <branch>` to re-attach.

### Route Changes

#### AIWF card route (`POST /api/aiwf/projects/:id/cards/:key/run`)

Replace:
```typescript
if (card.kind === "spec") {
  const taskWt = await resolveTaskWorktree(p, card.key, skill);
  ...
}
```
With:
```typescript
const cfg = getConfig();
if ((cfg.isolateRuns ?? true) && DELIVERY_SKILLS.has(skill)) {
  const specPath = card.kind === "spec" ? findSpecPath(p, card.key) : null;
  const taskWt = await resolveCardWorktree(`aiwf-${p.id}`, card.key, skill, repoRoot(p), specPath);
  if (taskWt) {
    cwdOverride = taskWt.cwd;
    skipWorktree = true;
    taskBranch = taskWt.branch;
  } else {
    return res.status(503).json({
      error: "Could not create task worktree — branch may already be checked out.",
    });
  }
}
```
When `isolateRuns: false` or skill is not in `DELIVERY_SKILLS`, the block is skipped and
`startRun` runs in the real repo as before.

#### Jira runs route (`POST /api/runs`)

When `hasTicket && kind === "skill"`:

```typescript
const cfg = getConfig();
if ((cfg.isolateRuns ?? true) && DELIVERY_SKILLS.has(name)) {
  const board = cfg.boards.find((b) => b.key === ticket.boardKey);
  const repoRoot = boardPaths(board)[0];
  if (repoRoot) {
    const taskWt = await resolveCardWorktree(
      `jira-${ticket.boardKey}`, ticket.key, name, repoRoot,
    );
    if (taskWt) {
      cwdOverride = taskWt.cwd;
      skipWorktree = true;
      taskBranch = taskWt.branch;
    }
    // If resolveCardWorktree returns null (git error), fall through to normal isolateRuns path.
  }
}
const run = startRun({ kind, name, note, ticket, skillSource, cwdOverride, skipWorktree,
                       ...(taskBranch ? { branch: taskBranch } : {}) });
```

Agent runs (`kind === "agent"`) and non-delivery skills skip the block entirely and hit the
existing `isolateRuns` path in `drive()`.

### Files Changed

| File | Change |
|---|---|
| `server/src/aiwf.ts` | Add `DELIVERY_SKILLS`; rename `resolveTaskWorktree` → `resolveCardWorktree`; add unified `cardStateDir` helper with `aiwf-`/`jira-` prefix; backward-compat fallback to `spec-state/` |
| `server/src/index.ts` | AIWF route: replace `card.kind === "spec"` guard with `DELIVERY_SKILLS` + `isolateRuns` check; Jira route: add task-worktree resolution block for delivery skill runs |
| `server/src/sessions.ts` | No changes needed — `skipWorktree: true` already suppresses the `isolateRuns` worktree in `drive()` |

No changes to `types.ts`, `worktree.ts`, or the web layer.

---

## Security Considerations

- Branch names derive from card keys (`HAN-8` → `han-8`). Card keys come from Jira API or the
  AIWF board (operator-controlled). Sanitized via existing `sanitize()` before git operations.
- `card-state/*.json` stores only `{ taskBranch, worktreePath }` — no credentials, tokens, or PHI.
- Worktrees are created in `os.tmpdir()/hangar-worktrees/` with sanitized paths; no traversal risk.
- `repoRoot` for Jira cards comes from the operator-registered board config — no user-supplied path.

---

## Feature Flag

None — user-ready on merge.

---

## Verification Criteria

### Unit Tests

- [ ] `resolveCardWorktree`: no state file → derives `feat/han-8` for first delivery skill on `HAN-8`
- [ ] `resolveCardWorktree`: existing state file → returns stored `{ cwd, branch }` without git ops
- [ ] `resolveCardWorktree`: stale worktree path → re-creates worktree on existing branch
- [ ] `resolveCardWorktree` with `specPath` → delegates branch name to `branchFromSpec`
- [ ] Branch prefix: first skill `fix` → `fix/han-8`; first skill `feature` → `feat/han-8`; first skill `spec` → `feat/han-8`
- [ ] Branch sanitization: `HAN-8` → `han-8`; `PP-1234` → `pp-1234`
- [ ] Backward-compat: missing `card-state/` file, present `spec-state/<key>.json` → returns spec-state data
- [ ] `DELIVERY_SKILLS` does not include `autopilot`, `factory`, `new-project`, `roadmap`, `prd`

### Integration Tests

- [ ] `POST /api/runs` with `{ ticket: { key: "HAN-8", boardKey: "HAN" }, name: "spec", kind: "skill" }` and `isolateRuns: true`:
  → task worktree created on `feat/han-8`; `run.cwd` = worktree path
- [ ] Second `POST /api/runs` same card `{ name: "feature" }`:
  → reuses same worktree; no new branch
- [ ] Third `POST /api/runs` same card `{ name: "commit" }`:
  → reuses same worktree; commits land on `feat/han-8`
- [ ] `POST /api/runs` with `{ name: "roadmap", kind: "skill" }` on same card:
  → `run.cwd` = real repo path (not a delivery skill); worktree created by `isolateRuns` path
- [ ] `POST /api/runs` with `{ kind: "agent" }` on same card:
  → `run.cwd` = per-run worktree from HEAD (existing `isolateRuns` path, unchanged)
- [ ] All of the above with `isolateRuns: false`:
  → `run.cwd` = real repo path for all runs (no worktrees created at all)
- [ ] `POST /api/aiwf/.../cards/TASK-001/run` (non-SPEC AIWF card, skill: "spec") with `isolateRuns: true`:
  → task worktree created; subsequent feature run reuses it
- [ ] Same AIWF card, `isolateRuns: false`:
  → runs in real repo; no task worktree

### E2E / Manual

- [ ] Assign `/spec` then `/feature` to `HAN-8` (Jira board, `isolateRuns: true`) → both run in `feat/han-8`; spec file visible to feature
- [ ] Assign `/commit` to `HAN-8` → commits land on `feat/han-8`, not `hangar/<label>-<id>`
- [ ] Assign a debugging agent to `HAN-8` → runs in a fresh per-run worktree from HEAD (isolateRuns path)
- [ ] Board with `isolateRuns: false`: assign `/feature` to any card → runs in real repo
- [ ] `npm run typecheck` passes

---

## Out of Scope

- Surfacing the task branch name in the board UI
- Automatic worktree cleanup on PR merge
- Per-board `isolateRuns` override (today it is global)
- Multi-repo cards
- Deleting `spec-state/` files after migration (backward-compat fallback handles them in-place)
