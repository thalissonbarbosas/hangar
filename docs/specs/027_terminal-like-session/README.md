# Feature: Terminal-like session

## Problem

The session stream in the RunPanel renders the agent's turn as a chat-style feed — soft cards,
Inter body text, rounded tool chips. Some operators want the session to read like a real
**terminal**: monospace throughout, prompt-prefixed lines, a flat dark console surface, tool
calls shown as echoed commands. HAN-30 introduces a **terminal-like session look** as the new
default, and a **Session theme** picker in Settings so an operator can switch between the new
**Terminal** look and the existing **Classic** look — each shown with a preview image.

The choice is a per-operator visual preference (like the existing light/dark toggle), not board
or server behavior, so it lives client-side in `localStorage` and applies via a
`data-session-theme` attribute on `<html>`, exactly mirroring the `data-theme` pattern in
`useTheme.ts`. The Terminal look only restyles the **session stream** (the RunPanel body); it is
orthogonal to the app-wide light/dark theme, which continues to work unchanged.

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [terminal-theme-and-picker](001_terminal-theme-and-picker.md) | feat | `none` | — | med | — | Not started |
| 002 | [theme-preview-images](002_theme-preview-images.md) | feat | `none` | 001 | low | — | Not started |

## Rollout

Both slices ship user-ready on merge — no feature flags.

- **001** flips the default session look to **Terminal** for everyone (operators with no stored
  preference get Terminal; anyone can switch back to **Classic** in Settings → Session theme).
  The picker in 001 is functional but text-only.
- **002** adds the preview thumbnails to the picker cards. It is pure enhancement of the 001
  picker, so it must merge after 001. Nothing else depends on it.

No server config, migration, or API surface changes in either slice.
