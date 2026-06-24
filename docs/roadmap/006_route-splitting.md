# Phase 006 — Architecture: Route Splitting

## Context

`server/src/index.ts` is a single 1,044-line file holding all HTTP routes. This is acknowledged
technical debt in `docs/ARCHITECTURE.md`. Splitting it into domain-scoped route modules makes
the file navigable, makes routes easier to test in isolation, and is the natural prerequisite
for any future per-domain middleware.

**Depends on Phases 004 and 005 being merged.** Both phases patch `index.ts`; splitting after
ensures the security fixes are already in the base and don't need to be re-applied to the new
route files.

All tasks touch `server/src/index.ts` (as the shrinking source) — they must be sequential.
Order: smallest surface first so each PR is reviewable on its own without needing to understand
the whole file.

## Trunk Alignment

Pure refactor — no behavior change. Each task ships directly on merge. The server must pass
`npm run typecheck` and the smoke test after every PR before the next slice starts.

## Tasks

### Task 1: Extract `routes/config.ts`

- **Type:** refactor
- **Files:** `server/src/index.ts` (remove routes), `server/src/routes/config.ts` (new)
- **Dependencies:** Phase 005 merged
- **Verification:** `npm run typecheck`; `GET /api/health`, `GET /api/config`, `PUT /api/config`, `GET /api/settings/jira`, `PUT /api/settings/jira` all respond correctly; `/smoke`
- **Feature flag:** none
- **Estimated complexity:** Low

Move: `GET /api/health`, `GET /api/config`, `PUT /api/config`, `GET /api/settings/jira`,
`PUT /api/settings/jira` into `server/src/routes/config.ts`. Export an Express `Router`.
Mount in `index.ts` with `app.use(configRouter)`.

---

### Task 2: Extract `routes/jira.ts`

- **Type:** refactor
- **Files:** `server/src/index.ts`, `server/src/routes/jira.ts` (new)
- **Dependencies:** Task 1 merged
- **Verification:** `npm run typecheck`; ticket fetch, column filter, and status transition still work; `/smoke`
- **Feature flag:** none
- **Estimated complexity:** Low

Move: `GET /api/tickets`, `POST /api/tickets/:key/transition`, `GET /api/agents`,
`GET /api/skills`, `GET /api/jira/*` (boards worktree management) into `routes/jira.ts`.

---

### Task 3: Extract `routes/runs.ts`

- **Type:** refactor
- **Files:** `server/src/index.ts`, `server/src/routes/runs.ts` (new)
- **Dependencies:** Task 2 merged
- **Verification:** `npm run typecheck`; run creation, SSE stream, message, permissions, stop, delete all work; `/smoke`
- **Feature flag:** none
- **Estimated complexity:** Medium

Move: `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/stream`
(SSE), `POST /api/runs/:id/message`, `POST /api/runs/:id/permissions/:requestId`,
`POST /api/runs/:id/stop`, `DELETE /api/runs/:id`, `POST /api/runs/:id/terminal` into
`routes/runs.ts`. The SSE handler is stateful (uses `run.listeners`) — verify the listener
teardown on `req.on("close")` survives the move.

---

### Task 4: Extract `routes/workflows.ts`

- **Type:** refactor
- **Files:** `server/src/index.ts`, `server/src/routes/workflows.ts` (new)
- **Dependencies:** Task 3 merged
- **Verification:** `npm run typecheck`; workflow runs still start and stream; `/smoke`
- **Feature flag:** none
- **Estimated complexity:** Low

Move: `POST /api/workflows/runs` and any workflow-related GET routes into `routes/workflows.ts`.

---

### Task 5: Extract `routes/aiwf.ts`

- **Type:** refactor
- **Files:** `server/src/index.ts`, `server/src/routes/aiwf.ts` (new)
- **Dependencies:** Task 4 merged
- **Verification:** `npm run typecheck`; full AI Workflow board — cards, checkout, worktrees, docs, install/uninstall — all work; `/smoke`
- **Feature flag:** none
- **Estimated complexity:** Medium

Move all `/api/aiwf/*` routes into `routes/aiwf.ts`. This is the largest surface (most routes
added in v0.5.0/v0.6.0). After this task, `index.ts` should contain only: middleware setup
(CORS, rate limit, body parser), router mounts, startup logic, and the `app.listen` call.

## Execution Order

Sequential only — all tasks shrink the same file:
1 → 2 → 3 → 4 → 5

Run `/smoke` after each merge before starting the next task.

## Phase Checklist

- [ ] `server/src/routes/` directory created with 5 route files
- [ ] `index.ts` reduced to middleware setup + router mounts + startup (~100 lines)
- [ ] All routes verified via `/smoke` after each extraction
- [ ] `npm run typecheck` passes after each task
- [ ] `docs/ARCHITECTURE.md` — update `index.ts` component description to reflect the new structure and remove the "Route splitting (priority)" debt item
