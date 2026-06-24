# Phase 003 — Column Status Borders

## Context

Adds a semantic top-border to Kanban columns based on their status type, so the board can be
read at a glance without inspecting column labels. Depends on Phase 001 (accent tokens) and
Phase 002 (card borders) being done, since all three share the same token set and the same two
files.

## Trunk Alignment

Ships user-visible on merge. No feature flags.

## Tasks

### Task 1: Semantic column top-border

- **Type:** feat
- **Files:** `web/src/styles.css`, `web/src/components/Board.tsx`
- **Dependencies:** Phase 001, Phase 002
- **Verification:** Columns named "In Progress" get a blue top border; "In Review" amber; "Done" / "Complete" green; others use the default border color
- **Feature flag:** none
- **Estimated complexity:** Low

**CSS** (`styles.css` — add after `.column` base rule, ~line 327):

```css
.column.status-in-progress { border-top-color: var(--accent); }
.column.status-in-review   { border-top-color: var(--warning); }
.column.status-done        { border-top-color: var(--success); }
/* default: var(--border) — already set on .column */
```

**Board.tsx — helper + column className** (Column sub-component, ~line 642):

```tsx
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (/progress|develop|active|doing/.test(s)) return "status-in-progress";
  if (/review|testing|qa/.test(s)) return "status-in-review";
  if (/done|complete|deliver|shipped|closed/.test(s)) return "status-done";
  return "";
}

// in the Column component:
className={`column${over ? " drop-over" : ""} ${statusClass(column.status)}`.trim()}
```

The regex patterns are heuristic — they cover the most common Jira/aiwf status names without
requiring a config change. Boards with unusual status names simply get no semantic highlight,
which is the safe default.

## Phase Checklist

- [ ] Three `.column.status-*` CSS rules added
- [ ] `statusClass()` helper added to `Board.tsx`
- [ ] Column component applies the result as a class name
- [ ] Visual check: standard Jira board columns (Backlog / In Progress / In Review / Done) each show the correct top-border color
- [ ] Columns with unmapped status names show no extra highlight
- [ ] `npm run typecheck` passes
