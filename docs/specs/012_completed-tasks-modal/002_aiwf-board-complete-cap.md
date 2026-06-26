# Slice 002 — AI Workflow board: cap the Complete column + complete cards modal

## Trunk Metadata

- **Type:** feat
- **Flag:** `none`
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-aiwf-board-complete-cap`

## Problem

The AIWF phase board's "Complete" column suffers the same noise problem: it grows
unbounded over a project's lifetime, pushing active-work columns off screen. There is
no way to search through completed work cards.

## Solution

In `AiWorkflow.tsx`:
1. Identify the **complete column** as the last entry in `allColumns` (same logic the
   board already uses for `COLUMN_COLORS` cycling; the column is named "Complete" by
   convention but the cap applies to whichever is last).
2. Sort complete-column cards by `card.summary` **descending** before rendering.
3. Show only the first **5** cards; when more exist render a `"See N more ▾"` ghost
   button at the bottom of the column body.
4. Clicking the button opens a new `CompleteCardsModal` that lists **all** complete
   cards (same sort), a live name filter, and — for each card — a full `AiwfCard`
   component (⋯ options menu with See data / Archive / Delete, plus Run skill /
   run-tag button), so all options are available.

## Technical Design

### Architecture

Changes are isolated to `web/src/components/AiWorkflow.tsx` (logic + new modal
component) and `web/src/styles.css` (may reuse `.col-done-*` classes from slice 001;
add only AIWF-specific overrides if needed). No server changes. No new files.

### AiwfColumn changes

Add `isComplete?: boolean` prop. When true:

```tsx
const sorted = isComplete
  ? [...cards].sort((a, b) => b.summary.localeCompare(a.summary))
  : cards;
const visible = isComplete ? sorted.slice(0, 5) : sorted;
const hidden  = isComplete ? sorted.length - 5 : 0;
```

Column body renders `visible` cards. When `hidden > 0`:

```tsx
{hidden > 0 && (
  <button className="btn-ghost sm col-see-more" onClick={() => setCompleteModalOpen(true)}>
    See {hidden} more ▾
  </button>
)}
```

`completeModalOpen` state in `AiwfColumn`. When true, `CompleteCardsModal` rendered
via `createPortal(…, document.body)`.

The `AiWorkflowView` caller sets `isComplete` for the last column:

```tsx
allColumns.map((phase, i) => (
  <AiwfColumn
    key={phase}
    isComplete={i === allColumns.length - 1}
    ...
  />
))
```

Column header count stays `cards.length` (true total).

### CompleteCardsModal

New component in `AiWorkflow.tsx`:

```tsx
function CompleteCardsModal({
  cards,          // already sorted by summary desc
  hasSkills,      // passed from the column (phaseSkills for "Complete")
  runByTicket,
  onRunPhase,
  onOpenRun,
  onSeeData,
  onArchive,
  onDelete,
  onClose,
}: { ... })
```

- Uses `.modal-overlay` / `.modal modal-lg` markup (same as other modals in the file).
- Header: `"Complete (N)"` + `×` close button.
- Name filter input (`.col-done-filter`): filters `cards` by `card.summary`
  case-insensitively.
- List (`.col-done-list`): filtered cards each rendered as a full `<AiwfCard>` —
  identical to the board column, so See data / Archive / Delete / Run skill all work.
- Empty state: `"No complete cards match '<filter>'"`.
- Footer: single `Close` button.

The modal receives all the callbacks it needs from `AiwfColumn`, which already holds
`onSeeData`, `onArchive`, `onDelete`, `onRunPhase`, `onOpenRun`. Pass them through
unchanged.

### CSS additions

Reuse `.col-see-more`, `.col-done-filter`, `.col-done-list`, and `.col-done-empty`
from slice 001 (shared class names). No new classes needed unless slice 001 isn't
merged first — in that case copy the same rules (they're small enough to duplicate
without penalty; consolidate in a follow-up chore if desired).

## Security Considerations

Pure client-side filtering of already-fetched card data. No new inputs reach the
server. Archive / Delete callbacks go through the existing `api.archiveAiwfCard` /
`api.deleteAiwfCard` paths, which are unchanged.

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Component checks

- [ ] `AiwfColumn` with `isComplete=true`: renders at most 5 cards; "See N more" button
      appears when `cards.length > 5`; label shows correct hidden count.
- [ ] `AiwfColumn` with `isComplete=true` and ≤5 cards: no "See more" button.
- [ ] `AiwfColumn` with `isComplete=false`: all cards rendered, no cap.
- [ ] Sort: complete-column cards appear in `summary` descending order (Z→A).
- [ ] `CompleteCardsModal`: filter narrows the list in real time; case-insensitive.
- [ ] Each card row in the modal has the full `⋯` options menu (See data / Archive /
      Delete) and the Run skill / run-tag button where applicable.
- [ ] Overlay click or `Close` button closes the modal.

### E2E (manual, `npm run dev`)

- [ ] Open an AIWF project whose Complete column has >5 cards; column shows exactly 5
      and a "See N more" button.
- [ ] Click button; modal lists all complete cards sorted Z→A.
- [ ] Filter input narrows in real time.
- [ ] "See data" and "Archive" inside the modal work (card is moved out of the column
      after archive).
- [ ] `npm run typecheck` passes with no errors.

## Out of Scope

- Configurable cap size.
- Sorting controls in the modal.
- Pagination inside the modal.
- Applying the cap to non-final columns.
