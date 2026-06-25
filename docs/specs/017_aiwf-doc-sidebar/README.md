# Feature: AIWF Doc Tree Sidebar

## Problem

AIWF projects produce living documents — PRD, architecture, design system, roadmap entries,
spec files — but the current board shows none of them. To read `docs/ARCHITECTURE.md` you have
to leave Hangar and open the repo in a file browser. There is no visual signal that these docs
exist, which phase they belong to, or whether they are stale.

The fix is a **persistent left sidebar** in the AI Workflow view: a doc tree scanned from the
project's repo that exposes those documents as first-class navigation targets alongside the
kanban board.

## Relationship to spec 016

| Spec 016 slice | Status |
|---|---|
| `001_remove-spec-section` | **Prerequisite** — remove the existing Specs section from below the board before the sidebar ships. Merge this first. |
| `002_docs-modal-ui` | **Superseded** — the sidebar covers the project-docs-browsing concern from a better entry point (persistent vs. on-demand modal). The aiwf-toolkit-docs concern (REFERENCE.md, WORKFLOW.md) from spec 016 is out of scope here and may be addressed separately. |

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [server-doc-tree-api](001_server-doc-tree-api.md) | feat | `none` | SPEC-016/001 merged | medium | — | Not started |
| 002 | [sidebar-component](002_sidebar-component.md) | feat | `none` | 001 | high | — | Not started |

## Rollout

Both slices ship to `main` with the feature flag set to `none` (user-ready on merge).
Slice 001 adds the new endpoint without touching the UI. Slice 002 adds the sidebar and
`DocPanel`. Neither slice requires a migration or a feature flag.

## Doc coverage

The sidebar surfaces the following standard AIWF paths (always shown; greyed when absent):

| Path | Title | Phase |
|------|-------|-------|
| `docs/PRD.md` | Product Requirements | Planning |
| `docs/ARCHITECTURE.md` | Architecture | Planning |
| `docs/THREAT_MODEL.md` | Threat Model | Planning |
| `docs/design/DESIGN_SYSTEM.md` | Design System | Design |
| `docs/roadmap/` | Roadmap | Planning |
| `docs/specs/` | Specs | Implementation |

Additional `.md` files found at `docs/*.md` are appended after the standard entries.
