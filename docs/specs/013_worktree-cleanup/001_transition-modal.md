# Slice 001 — Complete transition modal + server worktree endpoints

## Trunk Metadata

- **Type:** feat
- **Flag:** none — user-ready on merge
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-worktree-cleanup-server`

---

## Problem

When an AIWF card is moved to Complete, its task worktree stays on disk. The user has no
in-product way to remove it. This slice adds:

1. A two-option modal when moving a card to Complete that has an active worktree — "Move" (keep
   worktree) or "Move + clean up" (remove worktree from disk and clear card state).
2. Server endpoints to list and delete worktrees, used by this modal and by the manager (slice 002).

Jira boards: no change to transition behavior. The endpoints are added for Jira too (needed by the
manager in slice 002) but no UI is wired here.

---

## Solution

### `hasWorktree` on card data

Enrich the AIWF card listing response with a `hasWorktree: boolean` field. The frontend uses this
to decide whether to show the cleanup modal on a Complete transition — no extra round trip needed.

`GET /api/aiwf/projects/:id/cards` — for each card returned, add:
```typescript
hasWorktree: getCardState(`aiwf-${p.id}`, card.key) !== null
```

### New server function

```typescript
// aiwf.ts
export function listCardStates(contextId: string): Array<{ key: string } & CardState> {
  // reads card-state/<contextId>/*.json, returns [] if dir missing
}
```

### New API endpoints

#### AIWF worktrees

```
GET    /api/aiwf/projects/:id/worktrees
  → { worktrees: Array<{ key: string; taskBranch: string; worktreePath: string }> }

DELETE /api/aiwf/projects/:id/worktrees/:key
  → { ok: true }
  Removes worktree from disk (removeWorktree) + clears card state.
  repoRoot derived from project.repoPath.

DELETE /api/aiwf/projects/:id/worktrees
  → { ok: true; removed: number }
  Removes all worktrees for the project. Best-effort: continues on individual failures.
```

#### Jira worktrees (used by slice 002 manager)

```
GET    /api/jira/boards/:boardKey/worktrees
  → { worktrees: Array<{ key: string; taskBranch: string; worktreePath: string }> }

DELETE /api/jira/boards/:boardKey/worktrees/:cardKey
  → { ok: true }

DELETE /api/jira/boards/:boardKey/worktrees
  → { ok: true; removed: number }
```

For Jira, `repoRoot` = first entry in `board.repoPaths`. If the board has no `repoPaths` or the
path doesn't exist, skip the `removeWorktree` call (best-effort) and still clear card state.

### AIWF Complete transition modal

In `AiWorkflow.tsx`, `moveCard(key, target)` currently calls `transitionAiwfCard` directly.
Change: when `target === lastColumn` (Complete) AND `card.hasWorktree`, show a
`CompleteWorktreeModal` before calling the API.

```
┌─ Move to Complete ──────────────────────────────┐
│  Card HAN-8 has an active task worktree on       │
│  branch feat/han-8.                              │
│                                                  │
│  [ Move only ]   [ Move + clean up worktree ]    │
└──────────────────────────────────────────────────┘
```

- **Move only**: calls `transitionAiwfCard` as before. Worktree and card state stay intact.
  (For SPEC-* cards, the server handler clears card state regardless — worktree stays on disk.)
- **Move + clean up**: calls `DELETE /api/aiwf/projects/:id/worktrees/:key`, then
  `transitionAiwfCard`. On delete failure, shows an error toast and does NOT transition.

The modal only appears when `card.hasWorktree === true`. If the card has no worktree (ran with
`isolateRuns: false` or only non-delivery skills), the transition is immediate, no modal.

### Spec card Complete transition

SPEC-* cards also get the choice modal — no silent auto-cleanup. The flow is identical to regular
AIWF cards:

- Add `hasWorktree` to spec-card entries returned by `getSpecCards` (same `getCardState` check).
- Frontend intercepts the SPEC-* Complete transition the same way it intercepts regular cards.
- "Move + clean up": calls `DELETE /api/aiwf/projects/:id/worktrees/:key`, then transitions.
- "Move only": calls transition directly. The server's existing SPEC-* Complete handler already
  calls `clearSpecState` — card state is cleared, worktree stays on disk (orphaned but accessible
  by branch name for inspection).

No change to the SPEC-* transition handler on the server.

---

## Technical Design

### Files changed

| File | Change |
|---|---|
| `server/src/aiwf.ts` | Add `listCardStates(contextId)` |
| `server/src/index.ts` | Add 6 new routes (AIWF + Jira worktree list/delete/delete-all); extend SPEC-* Complete handler to remove worktree; add `hasWorktree` to AIWF card list response |
| `web/src/api.ts` | Add typed wrappers for 6 new endpoints |
| `web/src/components/AiWorkflow.tsx` | Intercept `moveCard` for Complete transition; add `CompleteWorktreeModal` component |

### `Ticket` type (shared)

Add `hasWorktree?: boolean` to the `Ticket` interface in `server/src/types.ts` and
`web/src/types.ts`. Applied to both board cards and SPEC-* cards in the AIWF card listing.

---

## Security Considerations

- `worktreePath` stored in card state comes from `os.tmpdir()` — operator-controlled, no
  user-supplied path.
- DELETE endpoints verify the project/board exists before acting. A missing card state is a no-op
  (returns `{ ok: true }`), not a 404, to avoid leaking whether a worktree existed.
- `boardKey` in Jira worktree routes is validated against the configured boards list; unknown keys
  return 404.

---

## Feature Flag

None — user-ready on merge.

---

## Verification Criteria

### Unit Tests

- [ ] `listCardStates("aiwf-p1")`: dir missing → returns `[]`
- [ ] `listCardStates("aiwf-p1")`: 2 state files present → returns 2 entries with correct shape
- [ ] `listCardStates("jira-PP")`: returns entries for Jira context

### Integration Tests

- [ ] `GET /api/aiwf/projects/:id/worktrees` → returns list of card states for that project
- [ ] `GET /api/aiwf/projects/:id/worktrees` → unknown project → 404
- [ ] `DELETE /api/aiwf/projects/:id/worktrees/:key` → calls `removeWorktree` + `clearCardState`; subsequent GET no longer includes that key
- [ ] `DELETE /api/aiwf/projects/:id/worktrees/:key` → key with no state → `{ ok: true }` (no-op)
- [ ] `DELETE /api/aiwf/projects/:id/worktrees` → removes all; GET returns `[]`
- [ ] `GET /api/jira/boards/:boardKey/worktrees` → returns entries; unknown boardKey → 404
- [ ] `DELETE /api/jira/boards/:boardKey/worktrees/:cardKey` → clears state
- [ ] `GET /api/aiwf/projects/:id/cards` → each card with active card state has `hasWorktree: true`
- [ ] `GET /api/aiwf/projects/:id/cards` → cards without card state have `hasWorktree: false` or absent
- [ ] SPEC-* card listing includes `hasWorktree: true` when card state exists

### E2E / Manual

- [ ] Move AIWF card with active worktree to Complete → modal appears with two buttons
- [ ] Choose "Move only" → card moves to Complete; worktree still on disk; card state cleared (SPEC-*) or kept (regular)
- [ ] Choose "Move + clean up" → card moves to Complete; worktree removed from disk; card state cleared
- [ ] Move AIWF card without active worktree to Complete → no modal, immediate transition
- [ ] Move SPEC-* card with active worktree to Complete → same modal appears

---

## Out of Scope

- Jira board transition cleanup (no modal on Jira Done column)
- Worktree manager modal UI (slice 002)
- Deleting the git branch after removing the worktree
