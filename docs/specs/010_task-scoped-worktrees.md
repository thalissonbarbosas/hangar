# Feature: Task-scoped worktrees for AIWF spec card runs (HAN-7)

## Trunk Metadata

- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-task-scoped-worktrees`

---

## Problem

When a spec card (`SPEC-*`) is assigned to a skill on the AIWF board, Hangar currently:

1. **Opaque branch names.** Code-producing runs (`feature`, `fix`) create a worktree with an
   internal `hangar/<label>-<runId>` branch — not recognizable as the task's branch and
   inconsistent with trunk-based naming (`feat/<slug>`).

2. **Wrong base branch.** The worktree branches from HEAD of the main checkout. If the main
   checkout is on a feature branch (the "Hangar manages Hangar" case), the new task branch
   inherits from that branch instead of `main`.

3. **Delivery skills ignore the task branch.** `commit` and `pr` are not in `WORKTREE_SKILLS`,
   so they run in the real repo. Every uncommitted change in the checkout — from every other
   spec being worked on simultaneously — is visible to the commit skill. This is how mixed
   commits happen.

4. **No task-branch persistence.** If a second skill is assigned to the same card (rather than
   via handoff), the new run creates a fresh worktree on a new opaque branch instead of
   reusing the card's existing branch. There is no shared state between runs on the same task.

---

## Solution

Give each spec card a **task-scoped worktree**: a git worktree on a semantic branch
(`feat/<spec-slug>` or `fix/<spec-slug>`) derived from the spec file's Trunk Metadata type
and filename, always based on `main`. The task branch is stored in the board's data dir
(`spec-state/`) so all subsequent skill runs on that card reuse the same worktree and branch
— regardless of whether they come from handoff or a new direct assignment. Planning and doc
skills (spec, prd, roadmap, etc.) continue to run in the real repo so their output lands in
the tracked source tree.

---

## Technical Design

### Branch Name Derivation

Given `docs/specs/007_standardize-agent-skill-selects.md`:

1. Strip the `NNN_` prefix: `standardize-agent-skill-selects`
2. Read the spec file's `## Trunk Metadata` section: `Type: feat` → prefix `feat`
3. Result: `feat/standardize-agent-skill-selects`

Rules:
- If the Trunk Metadata block is missing or the type is unrecognized, fall back to `feat/<slug>`.
- For sliced specs (`docs/specs/010_task-scoped-worktrees/001_core.md`), use the **directory**
  slug: `feat/task-scoped-worktrees`.
- Branch slug characters outside `[A-Za-z0-9._-]` are replaced with `-` (same `sanitize()`
  already in `worktree.ts`).

### Task Branch Persistence

Spec cards are read-only — there is no writable board file. Task branch state lives in the
board data dir:

```
<DATA_DIR>/aiwf/<projectId>/spec-state/<spec-key>.json
```

Schema: `{ "taskBranch": "feat/standardize-agent-skill-selects", "worktreePath": "/tmp/..." }`

`worktreePath` is best-effort: a server restart or `git worktree prune` may invalidate it.
The run handler verifies the path exists before reusing; if not, it re-creates the worktree
on the existing branch (`git worktree add <newPath> <branch>` — no `-b`).

### Worktree Lifecycle

**First code run on a card** (skill in `TASK_WORKTREE_SKILLS`):
1. No `spec-state/<key>.json` → derive branch name from spec slug + Trunk Metadata type.
2. `git worktree add -b <branch> <wtPath> main` — always base from `main`.
3. Write `{ taskBranch, worktreePath }` to `spec-state/<key>.json`.
4. Call `startRun({ cwdOverride: wtPath, skipWorktree: true, branch: taskBranch, … })`.

**Subsequent runs on the same card**:
1. Read `taskBranch` + `worktreePath` from `spec-state/<key>.json`.
2. If `worktreePath` exists on disk → reuse as-is.
3. Else → re-create with `git worktree add <newPath> <taskBranch>` (checkout existing branch).
4. Same `cwdOverride + skipWorktree: true` pattern.

**Cleanup**: When a run on the card ends and the card transitions to `Complete`, clear the
spec-state file. The worktree directory is cleaned by the run's existing `worktrees` cleanup
path or `git worktree prune` at startup.

### Skills That Use the Task Worktree

```typescript
// Runs in the task worktree — create it if it doesn't exist, reuse if it does.
export const TASK_WORKTREE_SKILLS = new Set([
  "feature", "fix",        // code-producing: mutate source in isolation
  "review", "sec-review",  // review the actual implementation, not the real repo
  "commit", "pr",          // deliver from the task branch, not the real repo
]);

// All other skills run in the real repo so their output lands in the tracked source tree:
//   Planning: spec, prd, architecture, tdd, security, adr, rfc, roadmap, issues
//   Design:   design, verify-design
//   Orchestrators: autopilot, factory (they create their own worktrees internally)
//   Bootstrap: new-project
```

The existing `WORKTREE_SKILLS = new Set(["feature", "fix"])` is superseded by
`TASK_WORKTREE_SKILLS` for spec card runs. Non-spec card runs (`/api/runs`) continue to use
the current `isolateRuns` path unchanged.

### API Changes

No new endpoints. The existing
`POST /api/aiwf/projects/:id/cards/:key/run` handler is extended to:

1. Check if the skill is in `TASK_WORKTREE_SKILLS`.
2. Look up or create the task worktree (returns `{ cwd, branch }`).
3. Pass `cwdOverride: cwd, skipWorktree: true, branch` to `startRun`.
4. For skills not in `TASK_WORKTREE_SKILLS`: unchanged (`skipWorktree: true`, real repo cwd).

### Files Changed

| File | Change |
|---|---|
| `server/src/worktree.ts` | Add `opts.baseBranch` and `opts.existingBranch` to `createWorktree`; add `findWorktreePath(root, branch)` helper |
| `server/src/aiwf.ts` | Add `TASK_WORKTREE_SKILLS`, `branchFromSpec(specPath, repoRoot)`, `getSpecState(boardDir, key)`, `setSpecState(boardDir, key, state)`, `clearSpecState(boardDir, key)`, `resolveTaskWorktree(project, card, skill)` |
| `server/src/index.ts` | Modify card run handler to call `resolveTaskWorktree` and pass `cwdOverride`/`skipWorktree`/`branch` |

No changes to `types.ts` or the web layer — task branch is an implementation detail invisible
to the UI in this slice.

---

## Security Considerations

- Branch names come from filenames in `docs/specs/`. They are sanitized with the existing
  `sanitize()` in `worktree.ts` before being passed to `git`.
- Worktrees are created under `os.tmpdir()/hangar-worktrees/`. The path includes a run ID and
  sanitized slug — no traversal risk.
- `spec-state/<key>.json` stores only `{ taskBranch, worktreePath }`. No credentials, tokens,
  or user data.

---

## Feature Flag

None — user-ready on merge.

---

## Verification Criteria

### Unit Tests

- [ ] `branchFromSpec`: `007_standardize-agent-skill-selects.md` + `Type: feat` in frontmatter
  → `feat/standardize-agent-skill-selects`
- [ ] `branchFromSpec`: spec file with no Trunk Metadata block → `feat/<slug>` fallback
- [ ] `branchFromSpec`: sliced spec path `010_task-scoped-worktrees/001_core.md`
  → `feat/task-scoped-worktrees` (uses directory slug)
- [ ] `getSpecState`: missing file → `null` (no throw)
- [ ] `setSpecState` / `getSpecState`: round-trips `{ taskBranch, worktreePath }` through the
  data dir file
- [ ] `clearSpecState`: removes the file; no throw if already missing
- [ ] `createWorktree` with `opts.existingBranch`: omits `-b` flag, checks out branch
- [ ] `createWorktree` with `opts.baseBranch: "main"`: passes `"main"` as the base ref to git

### Integration Tests

- [ ] `POST /api/.../cards/SPEC-007/run` body `{ skill: "feature" }`:
  → worktree created on `feat/standardize-agent-skill-selects`, spec-state file written,
  `run.cwd` equals the worktree path
- [ ] Second `POST` same card body `{ skill: "commit" }`:
  → spec-state already present, `run.cwd` reuses the first worktree path
- [ ] `POST` with a planning skill (`spec`):
  → `run.cwd` is the real repo path, no spec-state file written
- [ ] `POST` with worktree path gone (simulate stale state):
  → re-creates worktree on the existing branch, run proceeds normally
- [ ] After task completion (`Complete` transition): spec-state file is removed

### E2E

- [ ] Assign a spec card to `/feature` on the AIWF board → `git branch` in the main checkout
  is unchanged; a new branch `feat/<slug>` appears in `git branch -a`
- [ ] Assign the same card to `/commit` (new run, no handoff) → commit is made on
  `feat/<slug>`, not on the main checkout's branch

---

## Out of Scope

- Surfacing the task branch name on the card in the UI (future enhancement)
- Applying the same pattern to regular (non-spec) board cards
- Automatic worktree cleanup when the PR for the task branch is merged
- Multi-repo tasks (cross-repo spec cards with multiple worktrees)
