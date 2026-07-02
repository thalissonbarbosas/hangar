# Feature: Doctor section in Settings

## Problem

Hangar sessions live in-memory (`runs: Map<string, Run>` in the Node process). When the server
restarts — the operator updates the app, edits config, or the process is killed — every
mid-flight run is marked **stopped** by `loadPersistedRuns()` with the note _"Session ended when
the server restarted."_ The operator experiences this as **losing all their sessions** and
re-assigns each ticket from scratch, one board card at a time.

The reality is better than it looks: those stopped runs keep their Claude `sessionId`, `cwd`
(worktree path), and `runtimeDirs`, and `sendMessage()` already resumes any run that has a
`sessionId` via the SDK's `resume`. But that recovery is **buried and undiscoverable** — it only
happens per-run, by opening a specific session and typing a message, and it fails silently when
the worktree directory is gone. There is no single place that tells the operator "here are the
sessions you can bring back" or "here is what's wrong with your environment."

A **Doctor** section in Settings gives that place: a diagnostics-and-repair panel that surfaces
recoverable sessions with a one-click resume, and runs a handful of read-only environment health
checks so the operator can see the app's state at a glance.

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [doctor-section-health-checks](001_doctor-section-health-checks.md) | feat | `none` | — | med | — | Not started |
| 002 | [recoverable-session-restore](002_recoverable-session-restore.md) | feat | `none` | 001 | med | — | Not started |

Vertical split: **001** ships the Doctor surface (new Settings section) plus read-only
environment checks — usable on its own. **002** adds the flagship capability the operator asked
for (recover sessions lost to a restart) on top of that surface. 002 extends the report shape and
the Doctor UI from 001, so it must merge after 001.

## Rollout

Both slices are additive and user-ready on merge — no feature flags. The Doctor is a new,
opt-in-by-navigation Settings section; nothing else in the app changes behavior. After 001 the
operator has a diagnostics panel; after 002 the panel can bring back restart-lost sessions. No
staged rollout needed; ship each slice as soon as it passes the gates.
