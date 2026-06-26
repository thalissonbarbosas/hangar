# Feature: Sidebar — Number Prefix & Paginated "See More" (Specs + Roadmap)

## Trunk Metadata
- **Type:** feat
- **Flag:** none
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-spec-sidebar-number-pagination`

## Problem

The spec and roadmap sidebar trees show clean human-readable titles with no numeric prefix,
making it hard to cross-reference an item by its `NNN` number (Jira card, PR, or aiwf key).
Additionally, both sections dump all items at once — projects with 20+ specs flood the sidebar
and users must scroll past the entire list to reach active threads below.

Affected users: everyone using the AI Workflow doc sidebar in Hangar.

## Solution

Three UI-only changes to `DocTreeSidebar` / `DocTreeRow` in
`web/src/components/AiWorkflow.tsx` — no server changes required because the numeric
prefix is already embedded in every item `path`
(e.g. `docs/specs/019_foo.md`, `docs/roadmap/001_token-refinement.md`).

1. **Number prefix badge** — for `spec`, `spec-dir` nodes, and roadmap `doc` children
   (path starts with `docs/roadmap/`), extract the three-digit number from `node.path` and
   render it as a muted chip before the title: `019  Spec Sidebar Number Pagination`.

2. **Paginated "See more" for specs** — `specsLimit` state (default 10) in `DocTreeSidebar`.
   When the `docs/specs` folder is expanded, only the first `specsLimit` children are rendered;
   a "See N more…" button increments by 10.

3. **Paginated "See more" for roadmap** — same pattern with a separate `roadmapLimit` state.

## Technical Design

### Architecture
Pure frontend change. No API or data-model changes.

```
web/src/components/AiWorkflow.tsx
  extractItemNumber()  ← new module-level helper
  DocTreeRow           ← render number badge inline (no new props needed)
  DocTreeSidebar       ← specsLimit + roadmapLimit states, paginated child rendering
web/src/styles.css
  .doc-tree-num        ← muted number chip style
  .doc-tree-see-more   ← indent + spacing for the "See more" button
```

### Number extraction helper (module-level)
```ts
function extractItemNumber(path: string): string | null {
  const m = path.match(/\/(\d{3})[_.]/);
  return m ? m[1] : null;
}
```
Matches single-file specs (`019_foo.md`), sliced spec dirs (`019_foo`), and roadmap files
(`001_token-refinement.md`). Returns `null` for folder roots (`docs/specs`, `docs/roadmap`).

### DocTreeRow badge
Derived from the existing `node` already in scope — no new props needed.
After the icon span and before the title span:

```tsx
{(node.type === "spec" ||
  node.type === "spec-dir" ||
  node.path.startsWith("docs/roadmap/")) &&
  extractItemNumber(node.path) && (
  <span className="doc-tree-num">{extractItemNumber(node.path)}</span>
)}
```

### DocTreeSidebar pagination
Add two limit states (reset when `projectId` changes):

```tsx
const [specsLimit, setSpecsLimit] = useState(10);
const [roadmapLimit, setRoadmapLimit] = useState(10);
useEffect(() => { setSpecsLimit(10); setRoadmapLimit(10); }, [projectId]);
```

Replace the inner `node.children?.map(...)` with a block that slices to the limit and
appends a "See N more…" button when items remain:

```tsx
nodes.map((node) => {
  const allChildren = node.children ?? [];
  const limit =
    node.path === "docs/specs" ? specsLimit
    : node.path === "docs/roadmap" ? roadmapLimit
    : allChildren.length;
  const visibleChildren = allChildren.slice(0, limit);
  const hiddenCount = allChildren.length - visibleChildren.length;
  const isPaginated = node.path === "docs/specs" || node.path === "docs/roadmap";
  return (
    <div key={node.path}>
      <DocTreeRow ... />
      {(node.type === "folder" || node.type === "spec-dir") && expanded.has(node.path) && (
        <>
          {visibleChildren.map((child) => ( /* same child rendering as before */ ))}
          {isPaginated && hiddenCount > 0 && (
            <button className="btn-ghost sm doc-tree-see-more" onClick={() => {
              if (node.path === "docs/specs") setSpecsLimit((l) => l + 10);
              else setRoadmapLimit((l) => l + 10);
            }}>
              See {Math.min(hiddenCount, 10)} more…
            </button>
          )}
        </>
      )}
    </div>
  );
})
```

### CSS (styles.css, after `.doc-tree-row.indent-2`)
```css
.doc-tree-num { color: var(--text-faint); font-size: 10px; flex-shrink: 0; }
.doc-tree-see-more { margin: 2px 8px 4px 24px; font-size: 11px; }
```

## Security Considerations
Purely presentational — no data written, no new endpoints. Paths come from the existing
trusted API response; regex extraction is safe against arbitrary strings.

## Feature Flag
None — slice is user-ready on merge.

## Verification Criteria

### Unit Tests
- [ ] `extractItemNumber("docs/specs/019_foo.md")` → `"019"`
- [ ] `extractItemNumber("docs/specs/019_foo")` → `"019"` (sliced dir)
- [ ] `extractItemNumber("docs/specs")` → `null` (folder root)
- [ ] `extractItemNumber("docs/roadmap/001_phase.md")` → `"001"`

### Integration / E2E Tests
- [ ] Spec row shows `019` badge for `docs/specs/019_spec-sidebar-number-pagination.md`.
- [ ] Roadmap row shows `001` badge for `docs/roadmap/001_token-refinement.md`.
- [ ] Non-numbered rows (PRD, Architecture, folder roots) show no badge.
- [ ] Sidebar with ≤10 specs: all shown, no "See more" button.
- [ ] Sidebar with 11 specs: first 10 shown + "See 1 more…"; clicking reveals all 11.
- [ ] Sidebar with 25 specs: three clicks needed to see all; each click adds 10.
- [ ] Same pagination behaviour for roadmap items.
- [ ] `specsLimit` and `roadmapLimit` both reset to 10 when `projectId` changes.
- [ ] Sliced spec-dir children (grandchildren) are unaffected by the parent limit.

## Out of Scope
- Sorting order (specs already sorted descending server-side; roadmap sorted ascending by filename).
- Number badges on Kanban board cards.
- Pagination for other folder types (design, etc.).
- Filtering / search within the lists.
