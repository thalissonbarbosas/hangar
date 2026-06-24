# Feature: Docs & Specs Browser

## Problem

The AI Workflow project view has a **Specs section** below the board (a collapsible list of
`docs/specs/*.md` cards from the project repo). Over time this section has grown redundant: spec
cards can still be promoted to the board via the existing `/api/aiwf/projects/:id/cards` flow,
and the section adds visual clutter without giving quick access to the AIWF _toolkit_ guides
(WORKFLOW, REFERENCE, TRUNK_BASED_WORKFLOW, etc.).

What's missing is a focused, discoverable way to read the AI Workflow methodology docs without
leaving Hangar — currently you'd have to find `~/.local/share/ai-workflow/docs/` manually.

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [remove-spec-section](001_remove-spec-section.md) | refactor | `none` | — | low | — | Not started |
| 002 | [docs-modal-ui](002_docs-modal-ui.md) | feat | `none` | 001 | high | — | Not started |

## Rollout

Both slices ship to `main` with the feature flag set to `none` (user-ready on merge).
Slice 001 removes visible UI; Slice 002 adds the replacement. Neither slice requires a
migration or a feature flag — the UI either shows or it doesn't.

Slice 002 degrades gracefully when AIWF is not installed: the Docs button stays visible but
the modal body shows an "Install AI Workflow to browse docs" message.
