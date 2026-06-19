# Spec 008 — Terminal button in the RunPanel sidebar

## Trunk Metadata

- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-terminal-in-run-panel`
- **Ticket:** HAN-3 — Add terminal function to the session sidebar menu

## Problem

HAN-1 (spec 001) shipped a **Terminal** button in each row of the Sessions list (`SessionsView`).
When the operator opens the **RunPanel** (the `<aside>` that slides in on "Open"), that button
is gone — they must close the panel, scroll to the row, and click it there. The RunPanel is
the natural place to act on a session, and it already hosts Resume / Hand off / Stop. Terminal
should be there too.

## Solution

Add a **Terminal** button to `run-head-actions` in `RunPanel`, using the same guard
(`!isActive(state) && sessionId`) and the same no-terminal-configured warning pattern
(local banner state) that `SessionsView` already uses.

## Technical Design

### Components changed

**`web/src/components/RunPanel.tsx`**

- Add two optional props:
  ```ts
  onOpenInTerminal?: () => void;
  terminalConfigured?: boolean;
  ```
  Both are optional so existing `RunPanel` call-sites with no terminal wiring continue to
  compile and render without the button.
- Add a `terminalWarning` boolean state (default `false`).
- In `run-head-actions`, after the Resume button and before Hand off, insert:
  ```jsx
  {!isActive(state) && sessionId && onOpenInTerminal && (
    <button
      className="btn-ghost sm"
      onClick={() => {
        if (!terminalConfigured) { setTerminalWarning(true); return; }
        onOpenInTerminal();
      }}
      title="Resume this session in your terminal"
    >
      <Terminal size={13} /> Terminal
    </button>
  )}
  ```
- Render a warning banner just below `<header>` (same copy and icon as `SessionsView`):
  ```jsx
  {terminalWarning && (
    <div className="banner warn">
      <AlertCircle size={14} /> No terminal configured. Set your default terminal in{" "}
      <b>Settings → Terminal</b> to use "Open in terminal".
    </div>
  )}
  ```
- Import `Terminal` (already imported as a lucide icon for the `system` event render — no
  new import needed) and `AlertCircle` (already imported).

**`web/src/App.tsx`**

- Pass the two new props to `<RunPanel>`:
  ```jsx
  onOpenInTerminal={() => openInTerminal(activeRun.runId)}
  terminalConfigured={terminalConfigured}
  ```
  Both values already exist in App state (`openInTerminal` function, `terminalConfigured` boolean).

### No server changes

The `POST /api/runs/:id/terminal` endpoint (HAN-1) already handles any valid run id; the
RunPanel button calls the same `api.openInTerminal(runId)` wrapper through the App callback.

### Architecture

No new files. Two touch-points only:
- `RunPanel.tsx` — new props + conditional button + banner
- `App.tsx` — pass the props

## Security Considerations

No new surface. The button calls the existing `openInTerminal` API route, which validates the
run id and checks `config.terminal` server-side. The RunPanel does not interpolate the session
id itself.

## Verification Criteria

### Unit / type checks

- [ ] `npm run typecheck` passes with no errors.
- [ ] `RunPanel` renders without `onOpenInTerminal` / `terminalConfigured` props (backward
  compatible — no button shown, no crash).

### UI behaviour

- [ ] With a terminal configured and a finished session open in RunPanel: a **Terminal** button
  appears between Resume and Hand off; clicking it calls `onOpenInTerminal` (no warning shown).
- [ ] With no terminal configured and a finished session open in RunPanel: clicking Terminal
  shows the `banner warn` warning inside the panel and does **not** call `onOpenInTerminal`.
- [ ] The Terminal button is **absent** while the session is active (same guard as Resume).
- [ ] The Terminal button is **absent** when the run has no `sessionId` (just started or failed
  before the session was established).
- [ ] The Sessions list Terminal button (HAN-1) is unaffected.

## Out of Scope

- Changing the terminal launch logic, configuration, or server-side route (HAN-1).
- Collapsing the RunPanel action buttons into a dropdown/kebab menu.
- Adding a Terminal button to the Board card view.
