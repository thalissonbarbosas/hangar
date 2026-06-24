# Slice 001: Remove Spec Section

## Trunk Metadata
- **Type:** refactor
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `refactor/<issue-number>-remove-spec-section`

## Problem

The `SpecCardsSection` and `SpecSidebar` components in `AiWorkflow.tsx` show a collapsible
list of spec cards (`kind === "spec"`) from the project's `docs/specs/` directory. Removing
it is the prerequisite for a clean AIWF docs browser in Slice 002, and also reduces the
board's vertical clutter.

## Solution

Remove the `SpecCardsSection` component (and its supporting `SpecSidebar` component) from
`AiWorkflow.tsx`, along with the state and JSX that wire them into `AiWorkflowView`. No new
UI is added — the board simply no longer shows the spec section.

## Technical Design

### Component changes (`web/src/components/AiWorkflow.tsx`)

**Remove from `AiWorkflowView` state:**
- `specCardsOpen` state (line ~289)
- `specSidebar` state (line ~287)

**Remove from `AiWorkflowView` derived values:**
- `specCards` variable (`cards.filter((c) => c.kind === "spec")`, line ~377)

**Remove from `AiWorkflowView` JSX:**
- The `{specCards.length > 0 && (<SpecCardsSection .../>)}` block (~lines 597–605)
- The `{specSidebar && (<SpecSidebar .../>)}` block (~lines 704–716)

**Remove function definitions (keep file compilable):**
- `SpecCardsSection` function (~lines 1076–1182, ~106 lines)
- `SpecSidebar` function (~lines 1184–1271, ~88 lines)

**Remove unused imports** (if any icons/components become unused after the above).

### No API or type changes

The server still creates and serves spec cards — they are just no longer displayed.
No backend changes in this slice.

## Security Considerations

None — pure UI removal.

## Feature Flag

`None` — the change is immediately visible on merge.

## Verification Criteria

### Unit Tests
- N/A (no test suite exists; verify via typecheck + visual inspection).

### Integration Tests
- N/A.

### E2E Tests
- [ ] After merge: `npm run typecheck` passes with no errors.
- [ ] Run `npm run dev`, open the AI Workflow view for any project — confirm the Specs
  section is no longer rendered below the board.
- [ ] Board columns, archived cards, and all card interactions (move, run, archive, delete)
  still work correctly.

## Out of Scope

- Removing spec card creation logic from the server or board card API.
- Removing the drag-from-spec-to-column drop handler in `AiwfColumn` (drag of a spec card
  key could still arrive via direct state manipulation; leaving the guard is harmless).
- Any new UI — that's Slice 002.
