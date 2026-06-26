# Slice 003 — Remove Dead Server Routes and Backend Functions

## Trunk Metadata
- **Type:** chore
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `chore/<issue-number>-remove-server-routes`

## Problem

Four Express routes and four backend helper functions exist solely to back the removed `AiwfDocsModal`. After slice 001 ships, they have no callers.

**Routes (server/src/routes/aiwf.ts):**
- `GET /api/aiwf/docs` → `listAiwfDocs()`
- `GET /api/aiwf/docs/:slug` → `getAiwfDoc(slug)`
- `GET /api/aiwf/projects/:id/docs` → `listProjectDocs(repoPath)`
- `GET /api/aiwf/projects/:id/docs/:slug` → `getProjectDoc(repoPath, slug)`

**Backend helpers (server/src/aiwf.ts, lines 836–889):**
- `listAiwfDocs()` — lists `.md` files from `~/.local/share/ai-workflow/docs/`
- `getAiwfDoc(slug)` — reads a single AIWF toolkit doc by slug
- `listProjectDocs(repoPath)` — lists root-level `docs/*.md` files (excludes `docs/specs/`)
- `getProjectDoc(repoPath, slug)` — reads a single project doc by slug

The sidebar-backing routes and functions (`/docs/tree`, `/docs/content`, `listProjectDocTree`, `getProjectDocByPath`) are **not** removed.

## Solution

Delete the four routes and four backend functions. Update the import in `routes/aiwf.ts` to drop the four no-longer-imported names.

## Technical Design

### Files Changed

**`server/src/routes/aiwf.ts`**

Delete these four route handlers (approximately lines 74–92 and 132–140):

```typescript
// DELETE — AIWF toolkit docs list + fetch
aiwfRouter.get("/api/aiwf/docs", …);
aiwfRouter.get("/api/aiwf/docs/:slug", …);

// DELETE — Project docs list (flat slug-based)
aiwfRouter.get("/api/aiwf/projects/:id/docs", …);

// DELETE — Project doc by slug (flat)
aiwfRouter.get("/api/aiwf/projects/:id/docs/:slug", …);
```

Keep lines 94–130 (`/docs/tree` and `/docs/content`) intact — these are the sidebar routes.

After deletion, remove `listAiwfDocs`, `getAiwfDoc`, `listProjectDocs`, `getProjectDoc` from the import that pulls from `../aiwf`.

**`server/src/aiwf.ts`**

Delete lines 836–889 (the four exported functions). The function `listProjectDocTree` at line 895 immediately follows and is kept.

Verify that no other file imports the four removed names (a project-wide `grep` for each name is sufficient).

### API Changes

Four GET routes removed:
- `GET /api/aiwf/docs`
- `GET /api/aiwf/docs/:slug`
- `GET /api/aiwf/projects/:id/docs`
- `GET /api/aiwf/projects/:id/docs/:slug`

These become 404s after removal — no client code calls them after slice 001.

### Architecture

The route ordering in `routes/aiwf.ts` uses a comment noting that `/docs/tree` and `/docs/content` must be registered **before** `/:slug` to avoid shadowing. After removing the flat slug route (`/docs/:slug`), this ordering constraint is relaxed, but the remaining routes can stay in place.

## Security Considerations

Removing these routes reduces the server's public surface. No auth change needed — these routes were already read-only and sandboxed to the registered project's `repoPath`.

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Build
- [ ] `cd server && npm run build` (or `tsc --noEmit`) passes with no errors
- [ ] `grep -rn "listAiwfDocs\|getAiwfDoc\|listProjectDocs\|getProjectDoc" server/src/` returns no results

### Runtime
- [ ] Server starts without errors
- [ ] `curl localhost:<port>/api/aiwf/docs` → 404 (route gone)
- [ ] `curl localhost:<port>/api/aiwf/projects/<id>/docs/tree` → 200 with doc tree (sidebar route intact)

### Manual
- [ ] AIWF board loads; sidebar doc tree still populates
- [ ] No server-side errors in console

## Out of Scope

- Frontend modal removal (slice 001)
- CSS removal (slice 002)
- Any change to `listProjectDocTree`, `getProjectDocByPath`, or the sidebar/content routes
