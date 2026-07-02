# Feature: Session panel shows a live activity status, not raw tool output

## Trunk Metadata

- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Ticket:** HAN-34 — Remove token-by-token session output
- **Branch (post-/issues):** `feat/<issue-number>-session-activity-status`

## Problem

The session panel (`RunPanel`) narrates every tool the agent runs by dumping its raw input into the
transcript: each `tool_use` event renders `<wrench> <tool-name> <raw-input>`, where the raw input is
the full bash command (up to 400 chars) or the JSON of the tool arguments (`previewInput` in
`server/src/sessions.ts`). The operator watches a growing wall of bash commands and file paths — noise,
not signal.

HAN-8 (spec 003) already stopped literal token-by-token *text* streaming (whole `assistant_text`
messages are emitted, `includePartialMessages` is off). HAN-34 finishes the job on the **tool** side:
the operator wants the panel to show **only useful messages** (the agent's own text + the final
result), and while the agent is busy running tools, show a single lightweight status — a rotating
funny "working" message with a spinner, the way Claude Code does — instead of echoing every command.

## Solution

Stop rendering per-tool lines in the transcript. Assistant messages, the result, permission prompts,
and questions still render exactly as before. While the run is active and not waiting on the operator,
a single **live activity line** sits at the bottom of the transcript showing a spinner and a funny
gerund that rotates on a timer (e.g. "Percolating…", "Herding…"). When the run finishes, the line
disappears and the transcript is just the useful messages + result.

Server-side, the raw tool input is no longer sent to the client at all: the `tool_use` event keeps its
tool name (still used by the test and harmless) but drops the `input` payload, so raw bash commands are
neither streamed nor persisted in the transcript.

This is a display refinement — no API surface, data-model, or config changes.

## Technical Design

### API Changes

None. The SSE event stream is unchanged in shape except that the `tool_use` event no longer carries an
`input` field. No new events, routes, or config.

### Data Model

None. (`store.ts` persists events as-is; persisted `tool_use` events simply no longer contain the raw
command string.)

### Architecture

Touches only the session-stream render path (`RunPanel`) and the one `tool_use` emit in `sessions.ts`.
See `CLAUDE.md` → "Run model" and "Web".

**Server — `server/src/sessions.ts`**

- The single `tool_use` emit (~line 812) drops the raw input:
  `emit(run, "tool_use", { tool: block.name })` — remove the `input: previewInput(...)` argument.
- Keep `previewInput` — it is still used by the `permission_request` emit (~line 626), where the
  operator genuinely needs to see what they're approving.

**Web — `web/src/components/RunPanel.tsx`**

- Remove the `case "tool_use"` block in `renderOther` so tool events produce no transcript line.
- Remove the now-unused `Wrench` import.
- Add a module-level array of funny gerunds, e.g.
  `["Percolating", "Herding", "Noodling", "Conjuring", "Simmering", "Ruminating", "Tinkering", "Whirring", "Cogitating", "Puttering", "Marinating", "Vibing"]`.
- Add an `ActivityStatus` component: a `useEffect` `setInterval` (~2.5s) advances an index into the
  gerund list; renders `<Loader2 className="spin" /> <word>…` inside `<div className="run-activity">`.
  The interval is cleared on unmount. To avoid re-rendering the whole transcript on each tick, keep the
  ticking state inside `ActivityStatus` (mirrors the existing `Composer` isolation pattern).
- Render `<ActivityStatus />` at the end of `.run-body` (after `renderEvents(...)`) when the run is
  actively working and not blocked on the operator:
  `isActive(state) && !pendingQuestion && !<pending permission>`. Reuse the existing `pendingQuestion`
  memo; derive a `pendingPermission` the same way (a `permission_request` with no matching
  `permission_resolved`). While a permission or question is open the state is `awaiting_input` (not
  active), so in practice the `isActive(state)` guard already covers it — the extra guards are belt-and-suspenders.
- Keep the `events.length === 0` "Connecting…" placeholder unchanged.

**Web — `web/src/styles.css`**

- Add a `.run-activity` rule: a muted, slightly italic flex row with a small gap and the faint text
  color (visually a sibling of `.run-line.muted`).
- Remove the now-dead tool rules: `.run-line.tool`, `.run-line.tool .tool-name`, `.run-line .tool-input`
  (classic), and the terminal-theme tool rules (`html[data-session-theme="terminal"] .run-line.tool`
  and its `> svg`, `::before`, `.tool-name` children). Add a terminal-theme variant of `.run-activity`
  if it looks out of place against the console surface (optional, keep minimal).

## Security Considerations

Net positive: raw bash commands and tool arguments are no longer emitted over SSE or written to the
persisted transcript, shrinking the surface where a command line could leak a secret into stored run
JSON. No auth or validation changes. See `docs/THREAT_MODEL.md` if present.

## Feature Flag

None — the change is user-ready on merge.

## Verification Criteria

### Unit Tests (`server/src/__tests__/sessions.test.ts`)

- [ ] Existing assertion still passes: a `tool_use` event with `tool === "TodoWrite"` is emitted for a
      completed assistant message that contains a tool-use block.
- [ ] New assertion: the emitted `tool_use` event carries **no** `input` field
      (`event.input === undefined`).
- [ ] Unchanged: an `assistant_text` event with the message text is emitted, and no `assistant_delta`
      event is emitted.

### Manual / UI Verification (`HANGAR_DEMO=1 npm run dev`)

- [ ] Open a running session: the transcript shows the agent's text messages and the result, with **no**
      per-tool lines and **no** raw bash commands.
- [ ] While the session is active, a single status line shows a spinner and a funny word that changes
      every couple seconds.
- [ ] When the run reaches `done` / `error` / `stopped`, the activity line disappears.
- [ ] While a permission prompt or question is open, the activity line is hidden (the prompt/question
      card is shown instead) and the tool being approved still displays its input in the permission card.
- [ ] Behavior is correct in both the **Classic** and **Terminal** session themes.

### Gate

- [ ] `npm run typecheck` passes (server + web).
- [ ] `npm run lint -- --max-warnings=2` passes.
- [ ] `npm --prefix server test` passes.
- [ ] `npm run format:check` passes.

## Docs

- `CLAUDE.md` — the "Run model" note already says whole messages are emitted (not token-by-token); add
  that individual tool calls are no longer rendered as transcript lines — a live activity status is
  shown while the agent works, and `tool_use` events no longer carry raw input.
- `CHANGELOG.md` — one entry under `[Unreleased] → Changed`: the session panel no longer echoes raw
  tool commands; it shows only the agent's messages plus a live "working" status while tools run (HAN-34).
- **No `package.json` version bump** — per `CLAUDE.md`, version changes belong only to `release/*`
  branches.

## Out of Scope

- Any change to the token-by-token *text* streaming (already handled by HAN-8 / spec 003).
- Bringing back a per-tool history view or a collapsible "tool log".
- Changing permission prompts, questions, results, the phase indicator, or cost display.
- Server-side removal of the `tool_use` event entirely (kept for the test and possible future use).
