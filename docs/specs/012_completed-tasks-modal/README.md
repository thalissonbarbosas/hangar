# Feature: Completed Tasks Modal (HAN-8)

## Problem

Both the Jira board and the AI Workflow phase board can accumulate many cards in their
final column ("Done" / "Complete"). Scrolling past a long done column adds noise to the
active work area. There is also no way to search for a specific completed task without
scanning every card manually.

## Solution

Cap the final column on both boards to **5 cards** (sorted by title desc) and add a
**"See N more"** button. Clicking it opens a full-list modal with a live name filter and
all the same per-card options the board card already exposes.

- **Jira board** (`Board.tsx`) — last status in `board.statuses` is the done column.
  Each `TicketCard` in the modal is the full existing component (Assign menu + run-tag).
- **AI Workflow board** (`AiWorkflow.tsx`) — "Complete" column (last in `allColumns`).
  Each `AiwfCard` in the modal keeps the full options menu (See data / Archive / Delete)
  and the Run skill / run-tag button.

No API changes: tickets are already fetched; the cap and modal are pure UI.

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [jira-board-done-cap](001_jira-board-done-cap.md) | feat | `none` | — | med | — | Not started |
| 002 | [aiwf-board-complete-cap](002_aiwf-board-complete-cap.md) | feat | `none` | — | med | — | Not started |

The slices are independent — slice 002 does not depend on 001 merging first.

## Rollout

Both slices are user-ready on merge. No feature flag needed. Verify with
`npm run typecheck` and a manual run (`npm run dev`).
