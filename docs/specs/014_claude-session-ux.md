# Feature: Claude Session UX Improvements (HAN-4)

## Trunk Metadata
- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch:** `feat/han-4`

## Problem

Spec 009 added a `ClaudeSessionButton` to each AIWF project pill and Jira board header, but the
initial implementation had three usability gaps:

1. **Button placement in AIWF**: The Claude session button, Edit, and Remove buttons cluttered
   each project pill in the subbar, making the pill row noisy. These controls belong to the
   currently selected project, not to the selector itself.
2. **Dropdown interaction**: The session button opened a fixed-position popup anchored to the
   button's bounding rect — a dropdown pattern that can clip at viewport edges and doesn't have
   the visual weight of a task-starting action.
3. **No session continuity**: Every click started a fresh session. Users had no way to reopen a
   recently started session from the same project without hunting through the Sessions overlay.

## Solution

Three targeted improvements shipped together on `feat/han-4`:

1. **Board header controls** — Move the Edit, Remove, and Claude session actions from each AIWF
   project pill to the `AiWorkflowView` board header, contextual to the selected project. Edit and
   Remove collapse into a `MoreVertical` three-dots dropdown; the Claude session button stands
   alongside the Worktree Manager (Wrench) button.

2. **Modal popup** — Replace the `claude-session-pop` fixed-position dropdown with a centered
   `.modal-overlay` dialog. The modal has a proper header (title + close button), model picker,
   note textarea, and Cancel / Start actions row.

3. **Last session tracking** — When a session is started, store its `runId` in
   `localStorage["hangar-chat:<cwd>"]`. When the modal opens, look up that `runId` in the live
   `runs` list and show a "Last session" row with a state dot if found. Clicking the row opens
   that run's panel. Chat runs skip worktree creation (`skipWorktree: true`) — they run directly
   in the project root.

## Technical Design

### API Changes

**`POST /api/runs`** — no new fields. When `kind === "chat"`, `skipWorktree: true` is now
passed to `startRun` unconditionally, so chat sessions never create a git branch.

```ts
// server/src/index.ts
startRun({ kind, name: resolvedName, note, cwd, title, modelOverride: model, skillSource,
  skipWorktree: kind === "chat" ? true : undefined })
```

### Data Model

No server-side schema changes. The `runs: RunSummary[]` list already flows from App through
`AiWorkflowView` and `Board` to `ClaudeSessionButton`; adding `runs` and `onOpenRun` props to
`Board` is the only prop-chain addition.

Client-side persistence is `localStorage` only — no server storage:

```
Key:   "hangar-chat:<cwd>"      (one entry per repo path)
Value: "<runId>"                 (latest chat run started from this path)
```

The stored `runId` is validated against the live `runs` list on each modal open; stale IDs
(cleared runs) are silently ignored.

### Architecture

```
server/src/index.ts               ← add skipWorktree: true for kind:"chat" runs
web/src/App.tsx                   ← openClaudeSession returns Promise<string>; pass runs to Board
web/src/components/Board.tsx      ← ClaudeSessionButton: modal + localStorage; Board: add runs prop
web/src/components/AiWorkflow.tsx ← move controls to board header; pass runs/onOpenRun to button
web/src/styles.css                ← .claude-session-last, .run-dot, .modal (reused)
```

#### `ClaudeSessionButton` changes

- Props added: `runs: RunSummary[]`, `onOpenRun: (run: RunSummary) => void`
- `onStart` return type changed from `void` to `Promise<string>` to propagate the `runId`
- `useMemo` derives `lastRun` from `localStorage` + `runs` on each modal open
- `start()` calls `onStart(...).then(runId => localStorage.setItem(LS_KEY(cwd), runId))`
- Portal renders `.modal-overlay` → `.modal` instead of `.claude-session-pop`

#### `AiWorkflowView` additions

- `editing`, `busy`, `projMenuOpen`, `projMenuRef` state moved from `AiWorkflowBar`
- `removeProject()` and `EditProjectModal` render moved here
- Board header gains: `ClaudeSessionButton` + Wrench + `MoreVertical` (three-dots) dropdown
- `AiWorkflowBar` loses: per-pill `ClaudeSessionButton`, Pencil, and X buttons; `onStartClaude` prop

## Security Considerations

- `skipWorktree: true` removes one isolation layer for chat runs, which is intentional — chat
  sessions are interactive and the user expects to be in their actual repo, not a throwaway branch.
  All other permission gates (`bypassPermissions`, tool allow-lists) remain active.
- `localStorage` stores only a `runId` (a `randomUUID`), never credentials or file paths.
- No new API endpoints or input surfaces.

## Feature Flag

None — user-ready on merge.

## Verification Criteria

### Manual Tests — AIWF project controls

- [ ] Each project pill in the subbar shows only the project name (no icons on the pill)
- [ ] Selected project's board header shows: project name · MessageSquare · Wrench · MoreVertical
- [ ] Clicking MoreVertical opens dropdown with "Edit project" and "Remove project"
- [ ] Edit project → `EditProjectModal` opens pre-filled with current values
- [ ] Remove project → confirm dialog → project removed; bar reloads

### Manual Tests — Session modal

- [ ] Clicking `MessageSquare` opens a centered `.modal-overlay` (not a positioned popup)
- [ ] Modal shows: title with icon, cwd path, model picker (Sonnet pre-selected), note textarea, Cancel / Start
- [ ] Pressing Escape or clicking the overlay backdrop closes without starting a session
- [ ] Clicking Cancel closes the modal
- [ ] Clicking Start starts a `kind: "chat"` run; modal closes; RunPanel opens

### Manual Tests — Last session tracking

- [ ] First open of modal for a project: no "Last session" row shown
- [ ] Start a session → close RunPanel → reopen modal: "Last session" row appears with a state dot
- [ ] Clicking the row opens the RunPanel for that run
- [ ] State dot color reflects run state: accent for active, green for done, red for error
- [ ] Clear all sessions → reopen modal: "Last session" row is absent (stale id ignored)

### Manual Tests — No worktree for chat runs

- [ ] Start a chat session → check server logs / run info event: no "worktree" event emitted
- [ ] Chat run's working directory is the project's repo root, not a `hangar/<label>-<id>` branch path
- [ ] Starting an agent/skill run still creates a worktree (regression check)

### Typecheck

- [ ] `npm run typecheck` passes with no errors

## Out of Scope

- Persisting the last session choice server-side (localStorage is sufficient for single-user use)
- Showing multiple past sessions (only the most recent)
- Resume via SDK `resumeFrom` (the "Last session" row re-opens the panel, not a new conversation thread)
- AIWF spec cards or archived cards in the board header controls
