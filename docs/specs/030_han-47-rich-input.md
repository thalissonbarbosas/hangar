# Feature: Auto-growing (rich) text input

## Problem

Every place where an operator composes free text — the session **note** (`NoteModal`),
the **terminal-like resume message** (`SessionsView`), and the **prompt to the session**
(`RunPanel` `Composer`) — uses a plain `<textarea>` with a fixed height. The note and
resume inputs render a static number of rows (`5` / `4`) with manual `resize: vertical`;
the composer is locked to `rows={1}` and simply scrolls internally past its
`max-height`. As a result the operator can't see more than a few lines of what they're
typing without dragging a resize handle or scrolling. Longer notes and multi-line
prompts are awkward to author and review before sending.

## Solution

Introduce a small, reusable **auto-growing textarea** that expands its height to fit the
content as the operator types or presses Enter, and shrinks back when text is removed
(e.g. after a prompt is sent and the draft clears). It caps at a per-context
`max-height` and scrolls beyond that, so it never grows without bound.

Make this the **default** input for the three places the operator note names — session
note, terminal-like message, and prompt-to-session — replacing their plain textareas.
Behavior is otherwise identical (same value/onChange, same keyboard handlers, same
placeholders); only the height becomes content-driven.

This is the input-side counterpart to the rich/raw **output** toggle added in
`029_han-42-rich-text-toggle.md`. "Rich" here means auto-sizing only — no formatting
toolbar, no Markdown preview, no WYSIWYG editor, and no new dependency.

## Technical Design

### API Changes

None. Client-only, no server or `hangar.config.json` changes.

### Data Model

None. No new state or persistence — height is derived from the current value on each
render.

### Architecture

- **`web/src/components/AutoGrowTextarea.tsx`** (new) — a thin wrapper over the native
  `<textarea>`:
  - Accepts all standard `TextareaHTMLAttributes<HTMLTextAreaElement>` (so `value`,
    `onChange`, `onKeyDown`, `placeholder`, `autoFocus`, `className`, `rows`, etc. pass
    straight through). It stays a **controlled** component driven by the caller's
    `value`.
  - Holds an internal `ref` to the element. In a `useLayoutEffect` keyed on `value`, it
    resets `el.style.height = "auto"` then sets `el.style.height = ${el.scrollHeight}px`,
    so the element always fits its content. `rows` provides the minimum height; CSS
    `max-height` provides the cap (with `overflow-y: auto` for scroll beyond it).
  - Adds an `autogrow` class alongside any caller-supplied `className` so shared
    resize/overflow rules apply without each call site repeating them.
- **`web/src/components/NoteModal.tsx`** — replace the `.note-input` `<textarea>` with
  `<AutoGrowTextarea>` (keep `rows={5}` as the min, keep the Cmd/Ctrl+Enter handler).
- **`web/src/components/SessionsView.tsx`** — replace the resume `.note-input`
  `<textarea>` (line ~322) with `<AutoGrowTextarea>` (keep `rows={4}`, keep the
  Cmd/Ctrl+Enter handler).
- **`web/src/components/RunPanel.tsx`** — in `Composer`, replace the `<textarea>` with
  `<AutoGrowTextarea>` (keep `rows={1}`, keep Enter-to-send / Shift+Enter-newline). The
  existing `.run-composer textarea { max-height: 140px }` becomes the grow cap.
- **`web/src/styles.css`** — add a `.autogrow` rule: `resize: none; overflow-y: auto;`
  (auto-grow supersedes the manual `resize: vertical` on `.note-input`). Give the
  note/resume contexts a sensible `max-height` (e.g. `40vh`) so a very long note scrolls
  instead of pushing the modal actions off-screen. The composer keeps its existing
  `max-height: 140px`.

## Security Considerations

None. No new inputs of data, endpoints, or rendering paths — text is still typed into a
`<textarea>` and handled by the same callbacks. No `dangerouslySetInnerHTML`. Reference
`THREAT_MODEL.md`; this change does not alter any trust boundary.

## Feature Flag

None — slice is user-ready on merge. Auto-grow is the default and only behavior for the
three inputs; there is no toggle. It is purely additive UX (same data in/out).

## Verification Criteria

*Per `CLAUDE.md`, the `web/` side has no test runner; it is gated by `typecheck` +
`lint` + `format:check`. Verification is those gates plus explicit manual UI checks. No
web test infrastructure is introduced by this slice.*

### Type / Lint / Format Gates
- [ ] `npm run typecheck` exits 0 with `AutoGrowTextarea` typed as
      `TextareaHTMLAttributes<HTMLTextAreaElement>` and used in all three call sites.
- [ ] `npm run lint` exits 0.
- [ ] `npm run format:check` exits 0.
- [ ] `npm --prefix server test` exits 0 (server untouched — no regressions).

### Manual UI Verification
- [ ] **Session note** (run an agent/skill on a card → NoteModal): typing multiple lines
      grows the textarea to fit; deleting lines shrinks it; past its `max-height` it
      scrolls and the modal's Cancel/Run buttons stay visible.
- [ ] **Terminal-like resume message** (SessionsView → Resume): same grow/shrink
      behavior; Cmd/Ctrl+Enter still resumes.
- [ ] **Prompt to session** (RunPanel Composer): starts one row; Shift+Enter adds a line
      and the box grows; Enter sends; after sending, the box shrinks back to one row.
      Beyond `max-height: 140px` it scrolls rather than growing further.
- [ ] Behavior is correct in **both** terminal and classic session themes.

## Out of Scope

- Any formatting toolbar, Markdown preview, keyboard formatting shortcuts, or WYSIWYG
  editing — "rich" here is strictly auto-grow height.
- The other compose textareas (`HandoffModal`, `SkillRunner`, `Board`, `AiWorkflow`).
  The shared `AutoGrowTextarea` can be dropped into them later; this slice covers only
  the three inputs the operator note names.
- Changing how any message/output is *rendered* (that is `029_han-42-rich-text-toggle`).
- Persisting a per-input height or any new preference.

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-han-47-rich-input`
