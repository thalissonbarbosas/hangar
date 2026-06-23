# Slice 002 — Worktree manager modal

## Trunk Metadata

- **Type:** feat
- **Flag:** none — user-ready on merge
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Depends on:** 001 (server endpoints must be merged first)
- **Branch (post-/issues):** `feat/<issue-number>-worktree-manager-ui`

---

## Problem

After slice 001 adds the server endpoints, users still have no way to browse and clean up
worktrees manually across a whole project or board — the Complete transition modal only helps
at transition time. Users need an on-demand manager to:

- See which cards have active task worktrees
- Remove individual worktrees (e.g. after a branch was already merged but the card wasn't moved)
- Remove all at once (project-level housekeeping)

Scope:
- **AIWF**: one "Manage worktrees" button per project in the AIWF project view header
- **Jira**: one "Manage worktrees" button per board in the board column header

---

## Solution

### Worktree manager modal

A shared `WorktreeManagerModal` component used by both AIWF and Jira surfaces:

```
┌─ Worktrees — Demo Project ──────────────────────────────┐
│                                                           │
│  Card       Branch            Path                  [×]  │
│  ─────────────────────────────────────────────────────  │
│  HAN-8      feat/han-8        /tmp/hangar-…/han-8   [×]  │
│  HAN-12     feat/han-12       /tmp/hangar-…/han-12  [×]  │
│                                                           │
│  No more worktrees.                 [ Remove all ]        │
└───────────────────────────────────────────────────────────┘
```

- Empty state: "No active task worktrees for this project."
- Each row has a `[×]` (remove) button. On click: `DELETE /api/aiwf/projects/:id/worktrees/:key`
  (or Jira equivalent), then re-fetches the list.
- "Remove all" button: `DELETE /api/aiwf/projects/:id/worktrees`, then re-fetches.
- Removing refreshes only the modal list, not the full board.
- The modal is read-only about the board — it does NOT transition cards to Complete. Cleanup is
  purely a disk/state operation.

### AIWF placement

Add a small "Worktrees" button (wrench icon, `lucide-react`) to the AIWF project view header row
(next to the existing project name and controls). Clicking it opens `WorktreeManagerModal` with
`context = "aiwf-<projectId>"` and the project name as the title.

The button is always visible but the modal shows an empty state when there are no active
worktrees — no need to pre-check.

### Jira board placement

Add a "Worktrees" button inline with the board name in `Board.tsx`. The board name is rendered as
a section heading above each board's columns — the button sits immediately to the right of the
name text (same row, right-aligned or flush after the name).

Since Hangar supports multiple boards (configured in settings), each board gets its own button
keyed by `boardKey`. Clicking it opens `WorktreeManagerModal` with `context = "jira-<boardKey>"`
and the board name as the title.

---

## Technical Design

### Files changed

| File | Change |
|---|---|
| `web/src/components/AiWorkflow.tsx` | Add "Worktrees" button in project header; pass project context to `WorktreeManagerModal` |
| `web/src/components/Board.tsx` | Add "Worktrees" button in board header per board; pass board context to `WorktreeManagerModal` |
| `web/src/components/WorktreeManagerModal.tsx` | New component — fetches list, renders table, handles remove/remove-all |

`WorktreeManagerModal` props:
```typescript
interface Props {
  contextId: string;        // "aiwf-<projectId>" or "jira-<boardKey>"
  title: string;            // e.g. "Demo Project" or "PracticePal (PP)"
  onClose: () => void;
}
```

Internally it calls:
- `GET /api/aiwf/projects/:id/worktrees` or `GET /api/jira/boards/:boardKey/worktrees` (via
  existing api.ts wrappers from slice 001)
- `DELETE` endpoints for individual and bulk removal

Context routing inside the component:
```typescript
const isAiwf = contextId.startsWith("aiwf-");
const id = contextId.slice(isAiwf ? 5 : 5); // "aiwf-" or "jira-" = 5 chars
const listFn  = isAiwf ? api.listAiwfWorktrees(id)       : api.listJiraWorktrees(id);
const delFn   = isAiwf ? api.deleteAiwfWorktree(id, key) : api.deleteJiraWorktree(id, key);
const delAll  = isAiwf ? api.deleteAllAiwfWorktrees(id)  : api.deleteAllJiraWorktrees(id);
```

---

## Security Considerations

Same as slice 001 — all endpoints validate project/board against the config before acting.

---

## Feature Flag

None — user-ready on merge.

---

## Verification Criteria

### Unit Tests

No new server logic — covered by slice 001 server tests.

### Integration / Component Tests

- [ ] `WorktreeManagerModal` with empty list → renders "No active task worktrees" empty state
- [ ] `WorktreeManagerModal` with entries → renders one row per worktree with card key, branch, path, remove button
- [ ] "Remove" on a row → calls DELETE endpoint; row disappears from list
- [ ] "Remove all" → calls bulk DELETE; list becomes empty state

### E2E / Manual

- [ ] AIWF: click "Worktrees" button on a project with active worktrees → modal opens with list
- [ ] AIWF: click "Worktrees" button on a project with no active worktrees → empty state
- [ ] AIWF: remove one worktree → row removed; other worktrees unaffected; worktree no longer on disk
- [ ] AIWF: "Remove all" → all rows gone; worktrees removed from disk
- [ ] Jira: click "Worktrees" button for a board → modal opens showing that board's worktrees
- [ ] Jira: remove one → only that board's card state cleared; other board unaffected
- [ ] Multiple Jira boards configured → each board has its own button and independent worktree list

---

## Out of Scope

- Deleting the git branch after removing the worktree
- Per-card worktree status indicator on the board (cards don't show a "has worktree" badge)
- Automatic cleanup on a schedule or on server restart
