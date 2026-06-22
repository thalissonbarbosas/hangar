# Slice 001 — Jira board: cap the done column + completed tasks modal

## Trunk Metadata

- **Type:** feat
- **Flag:** `none`
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-jira-board-done-cap`

## Problem

The last Jira board column (the "Done" status) can grow unbounded. Active columns
stay compact while the done column adds visual clutter. There is no way to search
through completed tickets.

## Solution

In `Board.tsx`:
1. Identify the **done column** as the last entry in `board.statuses`.
2. Sort done-column tickets by `ticket.summary` **descending** before rendering.
3. Show only the first **5** tickets; when more exist render a `"See N more ▾"` ghost
   button at the bottom of the column body.
4. Clicking the button opens a new `CompletedTicketsModal` that lists **all** done
   tickets (same sort), a live name filter input, and — for each ticket — the full
   `TicketCard` component (Assign menu + run-tag button), so all options are available.

## Technical Design

### Architecture

Changes are isolated to `web/src/components/Board.tsx` (logic + new modal component)
and `web/src/styles.css` (new modal styles). No server changes. No new files — the
modal lives inside `Board.tsx` alongside the other local components.

### Column component changes

```tsx
// inside Column, when status === doneStatus (passed via prop):
const sorted = isDone
  ? [...tickets].sort((a, b) => b.summary.localeCompare(a.summary))
  : tickets;
const visible = isDone ? sorted.slice(0, 5) : sorted;
const hidden  = isDone ? sorted.length - 5 : 0;
```

The `Column` component receives a new `isDone?: boolean` prop set by the `Board`
caller for the last status only.

The column header count stays `tickets.length` (the true total, not the capped view).

```tsx
{hidden > 0 && (
  <button className="btn-ghost sm col-see-more" onClick={() => setDoneModalOpen(true)}>
    See {hidden} more ▾
  </button>
)}
```

`doneModalOpen` state lives in `Column`; when true, `CompletedTicketsModal` is rendered
via `createPortal(…, document.body)`.

### CompletedTicketsModal

New component in `Board.tsx`, rendered from `Column` (passed the sorted ticket list
and `ctx`):

```tsx
function CompletedTicketsModal({
  tickets,   // already sorted by summary desc
  ctx,
  onClose,
}: { tickets: Ticket[]; ctx: CardCtx; onClose: () => void })
```

- Modal uses existing `.modal-overlay` / `.modal modal-lg` CSS classes.
- Header: `"Done (N)"` with a close `×` button (same pattern as `NoteModal`).
- Below header: a text input (`<input className="col-done-filter" placeholder="Filter by name…">`)
  controlling local `filter` state; filters `tickets` by `ticket.summary` case-insensitively.
- List: filtered tickets rendered as `<TicketCard ticket={t} ctx={ctx} />` — full component,
  identical to the board column. Cards are not draggable inside the modal (dragging still works
  but has nowhere to drop; acceptable).
- Empty state when filter matches nothing: `"No completed tickets match '<filter>'"`.
- Footer: single `Close` button.

### CSS additions (`web/src/styles.css`)

```css
/* "See N more" button at column bottom */
.col-see-more {
  width: 100%;
  margin-top: 4px;
  justify-content: center;
}

/* Done modal: name filter input */
.col-done-filter {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg2);
  color: var(--fg);
  font-size: 13px;
  margin-bottom: 10px;
}
.col-done-filter:focus { outline: none; border-color: var(--accent); }

/* Done modal: scrollable card list */
.col-done-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 2px;
}

/* Done modal: empty-state message */
.col-done-empty {
  color: var(--fg3);
  font-size: 13px;
  text-align: center;
  padding: 16px 0;
}
```

## Security Considerations

Pure client-side filtering of already-fetched data. No new inputs reach the server.
No auth changes.

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Unit / Component checks

- [ ] `Column` with `isDone=true`: renders at most 5 cards; "See N more" button appears
      when `tickets.length > 5`; button label shows the correct hidden count.
- [ ] `Column` with `isDone=true` and ≤5 tickets: no "See more" button rendered.
- [ ] `Column` with `isDone=false`: all tickets rendered, no button, no cap.
- [ ] Sort: done-column tickets appear in `summary` descending order (Z→A).
- [ ] `CompletedTicketsModal`: filter input narrows the list; clearing the filter restores
      all tickets; filter is case-insensitive.
- [ ] Each ticket row in the modal renders a full `TicketCard` (Assign menu present for
      tickets with no active run; run-tag button present for tickets with an active run).
- [ ] Clicking the overlay or the `Close` button closes the modal.

### E2E (manual, `npm run dev`)

- [ ] Open a board whose last status has >5 tickets; column shows exactly 5 and the
      "See N more" button at the bottom.
- [ ] Click "See N more"; modal opens listing all done tickets sorted Z→A.
- [ ] Type in the filter; list narrows in real time.
- [ ] Assign menu inside the modal opens and is fully functional.
- [ ] `npm run typecheck` passes with no errors.

## Out of Scope

- Configurable cap size or configurable "done status" name — always the last status.
- Sorting controls in the modal — always `summary` desc.
- Pagination inside the modal — scrollable list is sufficient.
