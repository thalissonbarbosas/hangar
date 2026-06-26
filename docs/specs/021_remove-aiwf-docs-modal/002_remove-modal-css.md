# Slice 002 — Remove Modal CSS

## Trunk Metadata
- **Type:** chore
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `chore/<issue-number>-remove-modal-css`

## Problem

`web/src/styles.css` contains ~109 lines of CSS scoped exclusively to `AiwfDocsModal` and its children. After slice 001 removes the component, these rules are dead weight.

## Solution

Delete the CSS block. Removing style rules for absent DOM elements has no visual or functional effect, so this slice can merge independently of 001. Logically it should follow 001 to avoid a state where live DOM elements temporarily lose styling, but in practice the CSS only targets `AiwfDocsModal`-specific class names that don't appear anywhere else.

## Technical Design

### File Changed

**`web/src/styles.css`**

Delete the following contiguous block (approximately lines 3912–4019):

```
.aiwf-docs-modal { … }
.aiwf-docs-modal.has-preview { … }
.aiwf-docs-body { … }
.aiwf-docs-list-pane { … }
.aiwf-docs-modal.has-preview .aiwf-docs-list-pane { … }
.aiwf-docs-list { … }
.aiwf-docs-row { … }
.aiwf-docs-row:last-child { … }
.aiwf-docs-row:nth-child(even) { … }
.aiwf-docs-row:hover { … }
.aiwf-docs-row.selected { … }
.aiwf-docs-row-title { … }
.aiwf-spec-child-row { … }
.aiwf-docs-preview { … }
.aiwf-docs-preview-head { … }
.aiwf-docs-preview-title { … }
.aiwf-docs-preview-body { … }
```

Leave the `/* ---- Session transcript sidebar ---- */` section immediately after intact.

## Security Considerations

None.

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Build
- [ ] `cd web && npm run build` passes
- [ ] `grep -n "aiwf-docs-" web/src/styles.css` returns no results
- [ ] `grep -n "aiwf-spec-child-row" web/src/styles.css` returns no results

### Manual
- [ ] App loads without visual regressions on the AIWF board page
- [ ] Sidebar and DocPanel still styled correctly

## Out of Scope

- Frontend component removal (slice 001)
- Server route removal (slice 003)
- Any sidebar CSS (`.doc-sidebar`, `.doc-tree-row`, etc.) — those belong to spec 017 and are kept
