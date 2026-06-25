# Slice 001 — Remove Frontend Modal Code

## Trunk Metadata
- **Type:** chore
- **Flag:** `none`
- **Complexity:** high
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `chore/<issue-number>-remove-frontend-modal`

## Slicing

This slice is marked `high` because the diff exceeds 200 lines (~385 deletions across `AiWorkflow.tsx` and `api.ts`). However, it cannot be split smaller without leaving the codebase in a broken intermediate state:

- Removing only the trigger button while keeping the component leaves a dead `docsOpen` state and an imported but unreachable function — TypeScript won't error on this (`noUnusedLocals` is not set in `web/tsconfig.json`), but it is misleading.
- Removing only the `AiwfDocsModal` component while keeping the trigger button causes a compile error because `<AiwfDocsModal>` would reference a non-existent identifier.
- Removing only the `docPicker` state while keeping the `PhaseSkillModal` it feeds also causes a reference error.

The entire set of removals is atomic by necessity. Since every line in this PR is a deletion (zero added logic), the risk profile is identical to a low-complexity slice.

## Problem

`web/src/components/AiWorkflow.tsx` contains:
- `AiwfDocsModal` — a 320-line React component rendered from the `AiWorkflowView` component
- Supporting state: `docsOpen`, `docPicker`, `specCards`
- A "Documents & specs" `<button>` that sets `docsOpen = true`
- A `docPicker`-driven `<PhaseSkillModal>` for creating a card from a doc
- `DOCS_TAB_COLORS` constant used only by the modal

`web/src/api.ts` contains 4 client functions that call the modal's backing routes:
- `aiwfDocs()` → `GET /api/aiwf/docs`
- `aiwfDoc(slug)` → `GET /api/aiwf/docs/:slug`
- `aiwfProjectDocs(id)` → `GET /api/aiwf/projects/:id/docs`
- `aiwfProjectDoc(id, slug)` → `GET /api/aiwf/projects/:id/docs/:slug`

None of these are called from anywhere other than `AiwfDocsModal`.

## Solution

Delete all of the above. The sidebar (`DocTreeSidebar`, spec 017) already provides equivalent doc-browsing. After this slice the server routes become dead code — slice 003 removes them.

## Technical Design

### Files Changed

**`web/src/components/AiWorkflow.tsx`**

| What | Where | Action |
|------|-------|--------|
| `BookOpen` import | line 26 | Keep — used on lines 169 and 1939 for other buttons |
| `docsOpen` state | line 543 | Delete |
| `docPicker` state | line 544 | Delete |
| `specCards` derived variable | line 626 | Delete |
| "Documents & specs" button | lines 779–781 | Delete |
| `{docsOpen && <AiwfDocsModal …/>}` JSX | lines 985–999 | Delete |
| `{docPicker && <PhaseSkillModal …/>}` JSX | lines 1001–1028 | Delete |
| `DOCS_TAB_COLORS` constant | line 2103 | Delete |
| `AiwfDocsModal` function | lines 2107–2427 | Delete |

After removing `specCards` (line 626), verify that nothing else in `AiWorkflowView` references `specCards` — the `DocTreeSidebar` does not use it (it fetches from the server directly).

**`web/src/api.ts`**

| What | Lines | Action |
|------|-------|--------|
| `aiwfDocs` | 161 | Delete |
| `aiwfDoc` | 162 | Delete |
| `aiwfProjectDocs` | 163–164 | Delete |
| `aiwfProjectDoc` | 165–168 | Delete |
| `AiwfDoc` type import | line 3 | Delete only if no other usage remains in `api.ts` |

Verify that `AiwfDocTreeNode` import (used by `aiwfProjectDocTree` on line 169) is left intact.

### API Changes

None added. Four GET routes become dead after this slice (removed in slice 003):
- `GET /api/aiwf/docs`
- `GET /api/aiwf/docs/:slug`
- `GET /api/aiwf/projects/:id/docs`
- `GET /api/aiwf/projects/:id/docs/:slug`

The sidebar routes (`/docs/tree`, `/docs/content`) are **not** touched.

### Data Model

No changes.

### Architecture

`AiwfDocsModal` is a self-contained modal component rendered via `createPortal`. It has no context, no shared state with the sidebar, and no side effects beyond closing itself. Its removal is clean.

The `docPicker` flow creates a card then opens a skill runner — this path is not needed since doc-related actions can be triggered from the sidebar's active-thread section.

## Security Considerations

None — removing client code only. The server routes that served this data remain alive until slice 003 and continue to require no auth (they read only from the local filesystem under the registered project's `repoPath`, which is already the app's security boundary).

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Build
- [ ] `cd web && npm run build` passes with no TypeScript errors
- [ ] No references to `AiwfDocsModal`, `docsOpen`, `docPicker`, `specCards`, `DOCS_TAB_COLORS`, `aiwfDocs`, `aiwfDoc`, `aiwfProjectDocs`, `aiwfProjectDoc` remain in `web/src/`

### Manual
- [ ] Open an AIWF project board — the 📖 "Documents & specs" button is gone from the sub-bar
- [ ] Sidebar toggle (panel icon) still opens the `DocTreeSidebar` with the full doc tree
- [ ] No console errors on board load

## Out of Scope

- CSS cleanup (slice 002)
- Server route / backend function removal (slice 003)
- Any changes to `DocTreeSidebar`, `DocPanel`, or the sidebar toggle button
