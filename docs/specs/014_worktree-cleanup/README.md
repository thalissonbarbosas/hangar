# Feature: Worktree lifecycle cleanup

## Problem

Task-scoped worktrees (spec 012) persist on disk indefinitely. There is no way to clean them up
short of manually running `git worktree remove` in a terminal. Two scenarios accumulate stale
worktrees:

1. **Card completed** — the delivery chain finished and the PR is merged, but `feat/<key>` still
   lives as a worktree on disk.
2. **Abandoned cards** — the user dragged a card to Complete without going through the full
   delivery chain; the worktree was never used again.

For Jira boards, automatic cleanup on column transition is out of scope — Jira's "Done" column is
not terminal in the same way, and transition semantics vary by workflow. Manual management via a
worktree manager is sufficient.

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [Complete transition modal + server endpoints](001_transition-modal.md) | feat | `none` | — | med | — | Not started |
| 002 | [Worktree manager modal](002_worktree-manager.md) | feat | `none` | 001 | med | — | Not started |

## Rollout

Both slices ship user-ready. No flags. Slice 001 lands first; slice 002 adds the manager UI on
top of the server endpoints introduced in slice 001.
