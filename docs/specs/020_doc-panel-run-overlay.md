# Feature: DocPanel run-overlay (HAN-16)

## Trunk Metadata
- **Type:** fix
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `fix/<issue-number>-doc-panel-run-overlay`

## Problem

`DocPanel` (the markdown viewer opened when a doc is clicked in the left sidebar) was shipped
with spec 017 using a bare `<div className="run-panel">` — the CSS shell — but without the
`run-overlay` wrapper that `RunPanel` uses. The result is that the doc viewer appears inline
inside the `.aiwf-content` flex container rather than sliding in as a fixed modal sidebar over
the full viewport, which is the expected UX (consistent with every other panel in the app).

The left doc tree sidebar also remains visible while the panel is open, reducing the effective
reading area. With the `run-overlay` structure the panel covers the full viewport (dimmed
background + right-side panel), matching `RunPanel` exactly.

## Solution

Wrap `DocPanel`'s rendered output in a `run-overlay` div and convert the inner container from
`<div>` to `<aside className="run-panel">`. No new CSS, no new props, no component moves — the
`run-overlay` class already uses `position: fixed; inset: 0` so it breaks out of any stacking
context and covers the full viewport regardless of where it sits in the React tree.

## Technical Design

### `web/src/components/DocPanel.tsx`

**Current render output:**

```tsx
<div className="run-panel">
  <div className="run-head">
    <div className="run-head-main">
      <span className="run-title">{node.title}</span>
    </div>
    <button className="icon-btn" onClick={onClose} aria-label="Close">
      <X size={14} />
    </button>
  </div>
  <div className="run-body doc-panel-body">
    {/* content */}
  </div>
</div>
```

**New render output (matches `RunPanel`'s structure):**

```tsx
<div className="run-overlay" onClick={onClose}>
  <aside className="run-panel" onClick={(e) => e.stopPropagation()}>
    <div className="run-head">
      <div className="run-head-main">
        <span className="run-title">{node.title}</span>
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        <X size={14} />
      </button>
    </div>
    <div className="run-body doc-panel-body">
      {/* content */}
    </div>
  </aside>
</div>
```

Two mechanical changes only:
1. Add outer `<div className="run-overlay" onClick={onClose}>` wrapper.
2. Change inner root `<div className="run-panel">` → `<aside className="run-panel">` with
   `onClick={(e) => e.stopPropagation()}` to prevent overlay clicks from bubbling to the
   dismiss handler.

### No CSS changes needed

`.run-overlay` (`position: fixed; inset: 0; background: dimmed; display: flex;
justify-content: flex-end; z-index: 50`) and `.run-panel` (`width: max(360px, 50vw);
height: 100%; …`) already produce the correct modal sidebar layout.

### No component-location changes needed

`DocPanel` stays rendered inside `AiWorkflowView`. `position: fixed` breaks out of
`overflow: hidden` stacking contexts, so the fixed overlay covers the full viewport correctly.

### Interaction with RunPanel

`AiWorkflowView` already calls `onClearRun?.()` when a doc is opened (clears `App.activeRun`,
hiding `RunPanel`). No changes needed there. The mutual-exclusion logic is unchanged.

## Security Considerations

None. This is a pure layout change — no new network calls, no new data paths.

## Feature Flag

None — ships user-ready on merge.

## Verification Criteria

### Manual E2E

- [ ] `npm run typecheck` passes.
- [ ] `npm run lint -- --max-warnings=2` passes.
- [ ] Start dev server (`npm run dev`); open AI Workflow view with a project that has docs.
- [ ] Click any existing doc in the left sidebar — `DocPanel` slides in from the right as a
      fixed modal sidebar with a dimmed backdrop covering the full viewport (same as `RunPanel`).
- [ ] Clicking the dimmed overlay area (outside the panel) closes `DocPanel`.
- [ ] Pressing Escape closes `DocPanel`.
- [ ] Clicking inside the panel body does **not** close it.
- [ ] Close button (`×`) in the panel header closes `DocPanel`.
- [ ] Opening a run (via card "Run skill") while a doc is open: `DocPanel` closes (RunPanel
      clears `activeDoc` via `onClearRun`); `RunPanel` opens normally.
- [ ] Opening a doc while `RunPanel` is open: `RunPanel` closes (via `onClearRun`);
      `DocPanel` opens as the modal sidebar.

## Out of Scope

- Editing docs in the panel.
- Making `DocPanel` a global singleton lifted to `App` level (not needed; `position: fixed`
  achieves the same visual result).
- Resizing or pinning the panel (follow-on work).
