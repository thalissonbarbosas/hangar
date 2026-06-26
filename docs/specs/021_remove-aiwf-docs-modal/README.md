# Feature: Remove AIWF Documentation Modal (HAN-15)

## Problem

The AIWF boards contain a "Documents & Specs" button (📖 icon in the project sub-bar) that opens `AiwfDocsModal` — a three-tab modal for browsing project docs, specs, and AIWF toolkit docs. Now that spec 017 has shipped the persistent `DocTreeSidebar`, this modal is fully superseded. It exposes the same content through a worse UX (modal vs. always-accessible sidebar) and adds dead weight: ~385 lines of frontend code, ~109 lines of CSS, and 4 server routes + 4 backend functions that serve only the modal.

The goal is to remove every trace of the modal and its backing API surface, leaving the sidebar as the sole docs interface.

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [remove-frontend-modal](001_remove-frontend-modal.md) | chore | `none` | — | high | — | Not started |
| 002 | [remove-modal-css](002_remove-modal-css.md) | chore | `none` | — | low | — | Not started |
| 003 | [remove-server-routes](003_remove-server-routes.md) | chore | `none` | 001 | low | — | Not started |

> Slice 002 (CSS) is independent of 001 — removing CSS for a component that's still rendered causes no visible regression because style rules are inert by themselves. However, logically it is best merged after 001 so CI doesn't flag unused styles.
>
> Slice 003 must wait for 001 to merge so the server routes it removes are truly dead (no frontend callers remain).

## Rollout

No feature flag needed — all slices remove existing code. Each slice leaves `main` deployable. No migration, no data change, no backward-compat concern.
