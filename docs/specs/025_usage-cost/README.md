# Feature: Usage Cost (HAN-20)

## Problem

Hangar users have no visibility into their Claude Code token spend without leaving the app. The `ccusage` CLI provides rich usage data — daily totals, monthly summaries, 5-hour billing blocks, and per-session breakdowns — but requires switching to a terminal. A usage cost panel built into the Hangar menu surfaces this data at a glance, keeping context in one place.

**Per-project breakdown**: `ccusage` aggregates usage globally across all Claude Code sessions on the machine; it has no `--project` flag and its JSON output contains no project-path field. Per-project breakdown is therefore **out of scope** for this feature and cannot be added with the current version of `ccusage` without upstream changes.

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [backend-api](001_backend-api.md) | feat | `none` | — | low | — | Not started |
| 002 | [frontend-ui](002_frontend-ui.md) | feat | `none` | 001 | med | — | Not started |

## Rollout

Both slices are user-ready on merge (no feature flag). Slice 001 lands first and is safe to deploy alone — the new `/api/usage/*` routes are unreachable until the frontend is wired up in Slice 002.
