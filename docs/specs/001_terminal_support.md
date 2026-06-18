# Spec 001 — Terminal support for the sessions sidebar

## Trunk Metadata

- **Type:** feat
- **Issue:** (none — ran before /issues)
- **Ticket:** HAN-1 — Add terminal support
- **Slug:** terminal-support

## Problem

A Hangar session runs in the browser, but sometimes you want to drop into the **same Claude
session in your own terminal** — to drive it interactively, inspect the worktree, or keep going
outside the UI. Today there's no way to do that. The operator wants an **"Open in terminal"**
action on each row of the Sessions sidebar that resumes the session in their preferred terminal,
plus a Settings field to choose that terminal. If no terminal is configured, the action should
**warn** (point the user at Settings) rather than silently do nothing.

## Approach

A finished/active run already carries everything needed to resume: its `cwd` (the worktree or repo
path) and its Claude `sessionId`. "Open in terminal" launches the configured terminal at that
`cwd` running `claude --resume <sessionId>`.

The terminal is configured as a **command template** (`config.terminal`) — a shell command with two
placeholders the server substitutes:

- `{{dir}}` → the run's working directory
- `{{command}}` → the resume command (`claude --resume <sessionId>`)

The rendered command is run through the operator's shell (`$SHELL -c`, falling back to `/bin/sh`),
detached. A template is flexible enough to support any terminal (Terminal.app, iTerm2, Ghostty,
Warp, …); the Settings UI offers one-click presets for the common macOS terminals plus a free-form
field. This mirrors the trust model the app already uses (operator-authored commands run on the
host); the only interpolated values are the server-generated `dir` and a validated `sessionId`.

### Server

- `types.ts` — add `terminal?: string` to `HangarConfig`.
- `config.ts` — persist `terminal` in `saveConfig` (preserve-on-absent; empty string clears, like
  the other optional fields).
- `terminal.ts` (new) — `resumeCommand(sessionId)`, `renderTerminalCommand(template, dir, command)`,
  and `openInTerminal(run)` which validates (terminal configured, run has a `sessionId` + valid id +
  existing `cwd`), renders, and spawns detached. Pure render/validation logic is unit-tested; the
  spawn is guarded in demo mode.
- `index.ts` — `POST /api/runs/:id/terminal`: 404 unknown run, 400 when no terminal configured / run
  has no session / cwd missing, 200 on launch.

### Web

- `types.ts` — add `terminal?: string` to `FullConfig`.
- `api.ts` — `openInTerminal(runId)` wrapper.
- `Settings.tsx` — new **Terminal** section + nav entry: preset picker that fills the template, a
  template field, save (preserve-merge like the other sections).
- `SessionsView.tsx` — per-row **Open in terminal** button (shown when the run has a `sessionId`);
  `onOpenInTerminal(runId)` + `terminalConfigured` props; a one-time inline warning when clicked with
  no terminal configured.
- `App.tsx` — track `terminalConfigured` from config, wire `onOpenInTerminal`, surface API errors.

### Docs

- `README.md` — add `terminal` to the configuration table and the Settings tour.
- `hangar.config.example.json` — add a commented-style `terminal` example value.
- `CHANGELOG.md` + `package.json` version bump (MINOR).

## Verification Criteria

1. `saveConfig` persists `terminal`, trims it, clears it on empty string, and preserves it when a
   later save omits it.
2. `renderTerminalCommand` substitutes both `{{dir}}` and `{{command}}` (and repeated placeholders).
3. `resumeCommand` produces `claude --resume <sessionId>`.
4. `openInTerminal` (or the route) rejects: unknown run (404), no terminal configured (400), run
   with no `sessionId` (400) — and does **not** spawn in those cases.
5. `POST /api/runs/:id/terminal` returns 200 and the command is built for a valid run with a
   configured terminal (spawn stubbed/guarded in tests).
6. UI: the Sessions row shows **Open in terminal** for runs with a session; clicking with no
   terminal configured shows the warning and makes no API call.
7. `npm run typecheck` and `npm test` pass.
</content>
</invoke>
