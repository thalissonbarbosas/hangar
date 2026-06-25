# Slice 002: Client — Doc Tree Sidebar

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** high
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-sidebar-component`
- **Depends on:** 001 merged (tree + content endpoints live)

## Slicing justification

Server, types, API client, and sidebar UI form a single vertical slice; none is useful without
the others. The sidebar is ~250 lines of new JSX + styles. `DocPanel` is ~60 lines and
required for the sidebar's click-to-open flow — separating them would leave the sidebar
non-functional.

## Problem

The server now returns a structured doc tree (Slice 001), but nothing in the UI consumes it.
The `AiWorkflowView` shows a kanban board with no persistent way to navigate the project's docs.

## Solution

Add a collapsible `DocTreeSidebar` component to the left of the kanban board in
`AiWorkflowView`. Clicking any leaf node opens a `DocPanel` that renders the doc's markdown
in the right-hand panel (the same slot used by `RunPanel`).

The sidebar is **220px wide** and visible by default. A toggle button (`‹` / `›`) in the
AIWF sub-bar collapses it to zero width (CSS `width: 0; overflow: hidden` so the board reflows
naturally). The toggle state persists in `localStorage` under the key
`hangar.aiwf.sidebarOpen`.

## Technical Design

### Layout change in `AiWorkflowView` (`web/src/components/AiWorkflow.tsx`)

Current layout:
```
<div class="aiwf-view">
  <AiWorkflowBar />
  <div class="aiwf-board"> … columns … </div>
</div>
```

New layout:
```
<div class="aiwf-view">
  <AiWorkflowBar sidebarOpen={sidebarOpen} onToggleSidebar={…} />
  <div class="aiwf-content">          ← new flex-row container
    <DocTreeSidebar … />               ← new
    <div class="aiwf-board"> … </div>
  </div>
</div>
```

CSS additions to `styles.css`:

```css
.aiwf-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.doc-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  transition: width 140ms cubic-bezier(0.4, 0, 0.2, 1);
}

.doc-sidebar.collapsed {
  width: 0;
  overflow: hidden;
}
```

**Do not transition `display` — use `width: 0` so the board reflows smoothly.**

### State in `AiWorkflowView`

```ts
const [sidebarOpen, setSidebarOpen] = React.useState<boolean>(() => {
  try { return localStorage.getItem("hangar.aiwf.sidebarOpen") !== "false"; }
  catch { return true; }
});

const toggleSidebar = () =>
  setSidebarOpen((v) => {
    const next = !v;
    try { localStorage.setItem("hangar.aiwf.sidebarOpen", String(next)); } catch {}
    return next;
  });
```

### Toggle button in `AiWorkflowBar`

Add a small icon-btn immediately before the project chip in the AIWF sub-bar:

```tsx
<button
  className="icon-btn has-tip"
  data-tip={sidebarOpen ? "Hide docs" : "Show docs"}
  onClick={onToggleSidebar}
  aria-label={sidebarOpen ? "Hide doc sidebar" : "Show doc sidebar"}
>
  {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
</button>
```

`PanelLeftClose` and `PanelLeftOpen` are lucide-react icons (available in lucide-react ≥ 0.400).
If not available, use `ChevronLeft` / `ChevronRight` as fallbacks.

### `DocTreeSidebar` component (new, in `AiWorkflow.tsx`)

```ts
interface DocTreeSidebarProps {
  projectId: string;
  activeThreads: Ticket[];           // cards with a running or awaiting run
  onOpenDoc: (node: AiwfDocTreeNode) => void;
}
```

**State:**
- `nodes: AiwfDocTreeNode[]` — fetched from `api.aiwfProjectDocTree(projectId)` on mount and on `projectId` change.
- `loading: boolean`
- `expanded: Set<string>` — paths of expanded folder nodes (default: `new Set(["docs/specs"])` — specs expanded by default)
- `selectedPath: string | null` — currently open doc (highlights the row)

**Render structure:**

```
.doc-sidebar
  .doc-sidebar-section              ← "DOCUMENTS"
    .doc-tree
      for each node in nodes:
        <DocTreeRow node={node} ... />
        if node is folder and expanded:
          for each child:
            <DocTreeRow node={child} indent={true} ... />
            if child is spec-dir and expanded:
              for each grandchild (child.children):
                <DocTreeRow node={grandchild} indent={2} ... />
  .doc-sidebar-divider
  .doc-sidebar-section              ← "ACTIVE · N"
    for each activeThread in activeThreads (max 5):
      <ActiveThreadRow thread={activeThread} />
```

**`DocTreeRow` render:**

```
[chevron or spacer] [icon] [title] [badge?]
```

| Part | Detail |
|------|--------|
| Chevron | `ChevronRight` (collapsed) or `ChevronDown` (expanded) for `folder`/`spec-dir`; 8px spacer for leaf nodes |
| Icon | `📋` PRD, `🏗` ARCHITECTURE, `🛡` THREAT_MODEL, `🎨` DESIGN_SYSTEM, `📁` folder, `📝` spec |
| Title | `node.title`, max 1 line, `text-overflow: ellipsis` |
| Badge | `✓` in success-soft when `node.exists`, else empty (no "missing" badge — just dimmed row) |

Rows with `node.exists === false` render at 45% opacity. Clicking a non-existent doc row is a no-op (cursor: default).

**Folder click** → toggle `expanded`. **Leaf click** → `onOpenDoc(node)`, set `selectedPath`.

Selected row: `background: var(--accent-soft)`.

Hover row: `background: var(--surface-3)`.

**Active threads section:**

```
.doc-sidebar-section
  label: "ACTIVE · {n}"
  for each thread:
    <div class="sidebar-thread-row">
      <span class="run-dot" />   ← accent (running) or warning (awaiting)
      <span class="card-key">DC-12</span>
      <span class="thread-title ellipsis">Unified worktrees</span>
    </div>
```

Clicking a thread row opens the run panel for that run (call the existing `onSelectRun`
prop if available, or expose it via a new prop `onOpenThread: (runId: string) => void`).
If no `runId` is available on the thread, clicking does nothing.

Active threads list is derived from `activeThreads` prop (already computed in
`AiWorkflowView` to drive card state indicators).

### `DocPanel` component (new file `web/src/components/DocPanel.tsx`)

```ts
interface DocPanelProps {
  projectId: string;
  node: AiwfDocTreeNode;
  onClose: () => void;
}
```

**Behaviour:**

- On mount: `api.aiwfProjectDocContent(projectId, node.path)`.
- While loading: spinner inside `.run-panel-body`.
- On error: error message with retry button.
- On success: `<Markdown>{content}</Markdown>` inside `.run-panel-body`.

**Reuse RunPanel CSS shell** — no new layout classes needed:

```tsx
<div className="run-panel">
  <div className="run-panel-head">
    <span className="run-title">{node.title}</span>
    <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
  </div>
  <div className="run-panel-body doc-panel-body">
    {/* content */}
  </div>
</div>
```

Add one CSS rule to prevent code blocks overflowing:

```css
.doc-panel-body pre { overflow-x: auto; }
```

Escape key closes the panel (same `useEffect` pattern as used by modals in `AiWorkflow.tsx`).

### Wiring in `AiWorkflowView`

Add state:
```ts
const [activeDoc, setActiveDoc] = React.useState<AiwfDocTreeNode | null>(null);
```

Pass `onOpenDoc` to `DocTreeSidebar`:
```ts
onOpenDoc={(node) => {
  setActiveDoc(node);
  setActiveRun(null);   // clear run panel so DocPanel has room
}}
```

Render `DocPanel` in place of `RunPanel` when `activeDoc` is set:
```tsx
{activeDoc ? (
  <DocPanel
    projectId={project.id}
    node={activeDoc}
    onClose={() => setActiveDoc(null)}
  />
) : activeRun ? (
  <RunPanel … />
) : null}
```

### CSS additions (in `styles.css`)

```css
/* Section label in sidebar */
.doc-sidebar-section-label {
  font-size: 9.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  padding: 10px 12px 6px;
}

/* Tree row */
.doc-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11.5px;
  color: var(--text);
  transition: background 140ms cubic-bezier(0.4, 0, 0.2, 1);
}
.doc-tree-row:hover { background: var(--surface-3); }
.doc-tree-row.selected { background: var(--accent-soft); }
.doc-tree-row.absent { opacity: 0.45; cursor: default; }

/* Indent levels */
.doc-tree-row.indent-1 { padding-left: 24px; }
.doc-tree-row.indent-2 { padding-left: 36px; }

/* Sidebar thread row */
.sidebar-thread-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 10.5px;
}
.sidebar-thread-row:hover { background: var(--surface-3); }

.run-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.run-dot.running { background: var(--accent); }
.run-dot.awaiting { background: var(--warning); }

/* Doc panel body */
.doc-panel-body pre { overflow-x: auto; }
```

### Demo mode

In demo mode (`HANGAR_DEMO=1`), `aiwfProjectDocTree` returns a static stub tree (a subset of
the Hangar repo's own doc tree). Add the stub to `server/src/demo.ts` alongside the existing
demo seeds. The real filesystem is never read in demo mode.

## Security Considerations

- `DocPanel` fetches content via `api.aiwfProjectDocContent`, which calls the validated
  `getProjectDocByPath` on the server. The `node.path` value used as the query parameter
  originates from the server's own `listProjectDocTree` response — it is not user-editable
  text. Still, the server-side `starts-with-docs/` and `no-..` checks are the definitive guard.
- Rendered markdown goes through `react-markdown` + `remark-gfm` — the same pipeline used
  for agent output. No raw HTML injection.

## Feature Flag

`None` — ships user-ready on merge.

## Verification Criteria

### Unit tests
- N/A (no web test suite yet; verify via typecheck + visual inspection).

### E2E

- `npm run typecheck` passes.
- `npm run lint -- --max-warnings=2` passes.
- `npm --prefix server test` passes.
- `npm run dev` → open AI Workflow view → sidebar renders to the left of the board.
- Sidebar shows all standard doc entries; docs that exist on disk have `✓`; absent ones are dimmed.
- Folder chevron toggles expand/collapse; `docs/specs` is expanded by default.
- Clicking an existing doc opens `DocPanel` in the right panel; `RunPanel` is cleared.
- `DocPanel` renders the doc's markdown; Escape key closes it.
- Toggle button in AIWF sub-bar collapses sidebar to 0; board reflows to fill available width. Expanding restores the sidebar.
- Toggle state persists across page reload (`localStorage`).
- Active threads section shows threads with run dots (accent for running, warning for awaiting).
- Demo mode: sidebar shows the stub tree.
- `npm run /smoke` passes (server smoke test exercises the new endpoints).

## Out of Scope

- Editing docs from the sidebar (read-only).
- Creating new docs from the sidebar (use the skills for that).
- A "run skill on this doc" button in the sidebar (toolbar in `DocPanel` is a follow-on).
- Per-folder lazy loading (all nodes fetched in one call on sidebar open).
- Drag-and-drop from the sidebar tree onto board columns.
