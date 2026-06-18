# Spec 003 — Session modal: show whole messages, not token-by-token

## Trunk Metadata

- **Type:** feat
- **Issue:** (none — single ticket)
- **Ticket:** HAN-8 — Update the session modal to not show token by token
- **Slug:** session-modal-no-token-streaming

## Problem

When a ticket is assigned an agent/skill, the session modal (`RunPanel`) streams the agent's
output **token-by-token**: the server passes `includePartialMessages: true` to the SDK `query()`,
receives `stream_event` / `content_block_delta` / `text_delta` chunks, and re-emits each chunk as an
`assistant_delta` event over SSE. The modal coalesces those chunks live, so the operator watches
text type in character-by-character. The operator wants the modal to **show each assistant message
as a complete block the moment it finishes**, not stream it token-by-token.

## Approach

Stop streaming partial tokens and instead emit each completed assistant **text** message as one
event. The full `assistant` message already arrives over the SDK stream (it's where `tool_use`
blocks are read today); we read its `text` blocks too and emit them whole. Tool-use and permission
events stay interleaved exactly as before, so live progress (which tool ran, when input is needed)
is preserved — only the character-by-character typing goes away.

- **Server** drops `includePartialMessages`, stops emitting `assistant_delta`, and emits a new
  `assistant_text` event (full text) for each text block of every completed `assistant` message,
  in content order alongside the existing `tool_use` emission.
- **Frontend** renders each `assistant_text` event as one complete Markdown block (no live buffer /
  coalescing), and falls back to `assistant_text` (not `assistant_delta`) when building the
  hand-off result text.

This is the "whole message as it lands" behavior chosen for the ticket (not "final result only").

## Affected Files

### Server

- `server/src/sessions.ts`
  - Remove `includePartialMessages: true` from the `base` query options (~line 686).
  - Remove the `else if (msg.type === "stream_event")` branch that emits `assistant_delta`
    (~lines 750–754).
  - In the `else if (msg.type === "assistant")` branch (~lines 755–761), iterate the message
    content **in order** and, in addition to the existing `tool_use` handling, emit a complete
    `assistant_text` event for each `block.type === "text"` with non-empty `block.text`:
    `emit(run, "assistant_text", { text: block.text })`.
  - The `if (msg.type !== "stream_event")` guard on the `detectPr` line (~746) becomes always-true
    once partial messages are off; leave it (harmless) or simplify to `detectPr(...)` directly —
    implementer's choice, keep the diff minimal.

### Web

- `web/src/components/RunPanel.tsx`
  - `resultText` fallback (~lines 129–132): filter/join `assistant_text` events instead of
    `assistant_delta`.
  - `renderEvents` (~lines 334–367): remove the `assistant_delta` buffer/coalescing and the `live`
    flush. Render each `assistant_text` event as a complete block — a
    `<div className="run-line text"><Markdown>{text}</Markdown></div>` — handled inline in the event
    loop or via `renderOther`. No remaining references to `assistant_delta`.
  - Drop now-unused helpers/state tied to the live buffer (e.g. the `flush`/`buf` machinery) if they
    have no other use. Keep the existing `run-line text` styling so message blocks look unchanged.

### Tests

- `server/src/__tests__/sessions.test.ts`
  - Update `successScript` (~lines 124–145): remove the `stream_event` token chunk and add a `text`
    block (e.g. `{ type: "text", text: "hi" }`) to the `assistant` message `content` (alongside the
    existing `TodoWrite` tool_use), so a completed message carries text.
  - Update assertion (~line 198–199): assert an `assistant_text` event with `text === "hi"` is
    emitted, and assert **no** `assistant_delta` event is emitted.
  - Optionally assert `lastQueryOptions` does not set `includePartialMessages`.

### Docs

- `CLAUDE.md` — update the "Run model" note (~lines 85–86) that says runs are "streamed
  token-by-token (`includePartialMessages`)": now whole assistant messages are emitted as
  `assistant_text` events over SSE (no partial-token streaming).
- `CHANGELOG.md` — add one entry under `[Unreleased] → Changed`: the session modal now shows each
  assistant message as a complete block instead of streaming token-by-token.
- root `package.json` — bump `version` `0.7.1 → 0.7.2` (PATCH — small behavior change).

## Verification Criteria

1. The server no longer passes `includePartialMessages` to `query()` and never emits an
   `assistant_delta` event.
2. For a completed `assistant` message containing a text block, the server emits a single
   `assistant_text` event carrying the full text, interleaved in content order with `tool_use`
   events.
3. The session modal renders each assistant message as one complete Markdown block (no
   character-by-character typing), with tool-use / permission / question events still interleaved.
4. Hand-off result text still populates (from the `result` event, falling back to joined
   `assistant_text`).
5. `npm run typecheck` passes (server + web).
6. `npm test` passes, including the updated `sessions.test.ts` assertions.
