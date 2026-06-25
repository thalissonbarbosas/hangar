# Slice 001: Server — Doc Tree API

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** medium
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-server-doc-tree-api`
- **Depends on:** SPEC-016/001 merged (spec section removed from UI)

## Problem

The existing `GET /api/aiwf/projects/:id/docs` endpoint returns a flat list of `docs/*.md`
files (root-level only, no subdirectories). It has no knowledge of `docs/design/`,
`docs/roadmap/`, or `docs/specs/`. It also can only read docs by slug, not by relative path,
so files in subdirectories are unreachable.

The sidebar (Slice 002) needs:
1. A **tree** endpoint — returns a structured hierarchy of known AIWF doc paths, always showing
   the standard entries regardless of whether they exist on disk (so the sidebar can render them
   dimmed when absent).
2. A **content** endpoint — reads any file under `docs/` by relative path so the sidebar can
   open design docs, roadmap entries, and spec slices, not just root-level slugs.

## Solution

Add two new endpoints to `routes/aiwf.ts` backed by two new functions in `aiwf.ts`:

- `GET /api/aiwf/projects/:id/docs/tree` — returns `{ nodes: AiwfDocTreeNode[] }`.
- `GET /api/aiwf/projects/:id/docs/content?path=<encoded>` — returns `{ content, title }`.

The existing flat endpoints (`GET /api/aiwf/projects/:id/docs` and
`GET /api/aiwf/projects/:id/docs/:slug`) are **unchanged** — they are still used by the
`AiwfDocsModal` (spec 016/002 when/if it ships for toolkit docs).

## Technical Design

### New type: `AiwfDocTreeNode` (`server/src/types.ts` + `web/src/types.ts`)

```ts
export interface AiwfDocTreeNode {
  /** Relative path from the project root — e.g. "docs/ARCHITECTURE.md" */
  path: string;
  /** Display title: first `# ` heading if file exists, otherwise formatSpecName fallback */
  title: string;
  /** doc = single .md file | folder = directory | spec = single-file spec card | spec-dir = sliced spec */
  type: "doc" | "folder" | "spec" | "spec-dir";
  /** Whether the file/directory exists on disk right now */
  exists: boolean;
  /** AIWF phase this doc is associated with (Planning, Design, Implementation, etc.) */
  phase?: string;
  /** Populated for folders and spec-dirs */
  children?: AiwfDocTreeNode[];
}
```

### New function: `listProjectDocTree` (`server/src/aiwf.ts`)

```ts
export function listProjectDocTree(repoPath: string): AiwfDocTreeNode[]
```

Returns the fixed set of standard AIWF doc paths, always present, `exists` reflecting disk
state. Standard entries in order:

1. `docs/PRD.md` — "Product Requirements" — phase: Planning
2. `docs/ARCHITECTURE.md` — "Architecture" — phase: Planning
3. `docs/THREAT_MODEL.md` — "Threat Model" — phase: Planning
4. `docs/design/DESIGN_SYSTEM.md` — "Design System" — phase: Design
5. `docs/roadmap/` — folder, phase: Planning — children: all `*.md` files inside, sorted by filename
6. `docs/specs/` — folder, phase: Implementation — children: existing spec card data reused from `listSpecCards(project)` (type `spec` or `spec-dir` with `specChildren` mapped to `children`)
7. Any additional root-level `docs/*.md` files not already listed above, appended at the end

For children of folder nodes, derive title the same way as today: first `# ` heading or
`formatSpecName(filename)` fallback.

**Do not scan `docs/design/` as a full folder** — only the single entry
`docs/design/DESIGN_SYSTEM.md` is exposed. If the project has other design docs, they appear
under the "additional" tail. This keeps the tree shallow and predictable.

### New function: `getProjectDocByPath` (`server/src/aiwf.ts`)

```ts
export function getProjectDocByPath(
  repoPath: string,
  relPath: string,
): { content: string; title: string } | null
```

`relPath` is the relative path as returned in `AiwfDocTreeNode.path` (e.g.
`"docs/design/DESIGN_SYSTEM.md"`).

**Path validation (traversal guard):**
- Reject if `relPath` does not start with `docs/`.
- Reject if `relPath` contains `..` after `path.normalize`.
- Reject if the resolved absolute path does not start with `path.join(expandHome(repoPath), "docs")`.

Returns `null` if validation fails or file does not exist. The route returns `400` on null
validation and `404` on null existence.

Title is derived from the first `# ` heading in the file; falls back to
`formatSpecName(path.basename(relPath))`.

### New routes (`server/src/routes/aiwf.ts`)

```ts
// Sidebar doc tree
aiwfRouter.get("/api/aiwf/projects/:id/docs/tree", (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  res.json({ nodes: listProjectDocTree(project.repoPath) });
});

// Doc content by relative path (for sidebar and DocPanel)
aiwfRouter.get("/api/aiwf/projects/:id/docs/content", (req, res) => {
  const project = requireProject(req, res);
  if (!project) return;
  const relPath = String(req.query.path ?? "");
  const result = getProjectDocByPath(project.repoPath, relPath);
  if (result === null) {
    if (!relPath.startsWith("docs/") || relPath.includes("..")) {
      return res.status(400).json({ error: "Invalid path" });
    }
    return res.status(404).json({ error: "Not found" });
  }
  res.json(result);
});
```

**Route ordering note:** Both new routes must be registered before the existing
`/api/aiwf/projects/:id/docs/:slug` catch-all to avoid `"tree"` and `"content"` being
interpreted as slugs. In `routes/aiwf.ts`, insert them immediately above the existing slug
route.

### API client (`web/src/api.ts`)

```ts
aiwfProjectDocTree: (id: string) =>
  getJson<{ nodes: AiwfDocTreeNode[] }>(`/api/aiwf/projects/${id}/docs/tree`),

aiwfProjectDocContent: (id: string, path: string) =>
  getJson<{ content: string; title: string }>(
    `/api/aiwf/projects/${id}/docs/content?path=${encodeURIComponent(path)}`,
  ),
```

### Types mirror (`web/src/types.ts`)

Add `AiwfDocTreeNode` — exact mirror of the server type above.

## Security Considerations

- `getProjectDocByPath` applies three layers of path validation before any `fs.readFileSync`:
  starts-with-`docs/`, no `..` segments, resolved absolute path under the project's `docs/`
  directory. All three checks must pass.
- The `path` query parameter is URL-decoded by Express before reaching the function; the
  validation runs on the decoded value.
- No user-controlled input reaches `listProjectDocTree` — it uses fixed strings and
  `fs.readdirSync` on known subdirectories.

## Feature Flag

`None` — new endpoints with no UI yet. Safe to merge independently of Slice 002.

## Verification Criteria

### Unit tests (`server/src/__tests__/aiwf.test.ts`)

- `listProjectDocTree` — returns all six standard entries with correct `type`, `phase`, and
  `exists: false` when the repo has no `docs/` directory.
- `listProjectDocTree` — `docs/PRD.md` has `exists: true` when the file is present; `false`
  when absent.
- `listProjectDocTree` — roadmap folder children sorted by filename ascending.
- `listProjectDocTree` — specs children use the existing `listSpecCards` shape (`spec` /
  `spec-dir` with `children`).
- `getProjectDocByPath` — returns `null` for `../etc/passwd`.
- `getProjectDocByPath` — returns `null` for `docs/../../server/src/config.ts`.
- `getProjectDocByPath` — returns `null` for `notdocs/README.md`.
- `getProjectDocByPath` — returns content + title for a valid path.

### Integration tests (`server/src/__tests__/index.aiwf.test.ts`)

- `GET /api/aiwf/projects/:id/docs/tree` → 200 `{ nodes: [...] }`.
- `GET /api/aiwf/projects/:id/docs/content?path=docs/PRD.md` → 200 when file exists.
- `GET /api/aiwf/projects/:id/docs/content?path=docs/PRD.md` → 404 when file absent.
- `GET /api/aiwf/projects/:id/docs/content?path=../server/src/config.ts` → 400.
- `GET /api/aiwf/projects/:id/docs/tree` does not conflict with existing
  `GET /api/aiwf/projects/:id/docs` (flat list still works).

### E2E

- `npm run typecheck` passes.
- `npm --prefix server test` passes.

## Out of Scope

- Watching the filesystem for doc changes (tree is fetched on sidebar open).
- Returning doc word count, last-modified time, or commit history.
- Serving binary files or non-markdown formats.
- The sidebar UI — that is Slice 002.
