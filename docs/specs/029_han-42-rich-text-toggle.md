# Feature: Rich-text / raw-text toggle for the session panel

## Problem

The `RunPanel` always renders assistant messages and results through the `Markdown`
component (react-markdown + GFM). There is no way to see the raw, unrendered text the
agent produced — useful when copying exact output, debugging Markdown that renders
oddly, or preferring a plain console feel. Operators need a way to switch the session
stream between rich text (the current behavior) and raw plain text, with rich text
staying the default so nothing changes for existing users.

## Solution

Add a per-browser **rich text** preference, mirroring the existing session-theme
pattern (`useSessionTheme`):

- A `useRichText` hook backed by `localStorage` key `hangar-rich-text`, defaulting to
  `true` (rich text on).
- A toggle in **Settings → Appearance**, rendered alongside the existing session-theme
  picker in `AppearanceSection`.
- `RunPanel` receives a `richText` prop. When `true` (default) it renders assistant
  text and success results through `Markdown` exactly as today. When `false` it renders
  the same text as raw plain text (preserving whitespace/newlines, no Markdown parsing).

The preference is orthogonal to the session theme, so it applies to **both** the
terminal and classic themes.

## Technical Design

### API Changes

None. This is a client-only, per-browser preference (no server or config changes),
consistent with how `hangar-session-theme` is stored.

### Data Model

None. New `localStorage` key: `hangar-rich-text` (`"true"` / `"false"`).

### Architecture

- **`web/src/useRichText.ts`** (new) — hook modeled on `useSessionTheme.ts`. Reads the
  initial value from `localStorage` (default `true` when unset/invalid), persists on
  change via `useEffect`, and returns `{ richText, setRichText }`. It does **not** set a
  `document.documentElement.dataset` attribute (unlike the theme, which is CSS-driven),
  because the behavior is controlled in React, not CSS.
- **`web/src/App.tsx`** — call `useRichText()` next to `useSessionTheme()`. Pass
  `richText`/`onRichTextChange` into `<Settings>` and `richText` into `<RunPanel>`.
- **`web/src/components/RunPanel.tsx`** — add a `richText: boolean` prop. Thread it into
  `renderEvents` so the `assistant_text` branch and the `result` (`success`) branch
  choose between `<Markdown>{text}</Markdown>` and a raw renderer. Raw text renders in a
  `<div className="run-raw">` with `white-space: pre-wrap` so newlines and spacing are
  preserved. Fall back to rich text if the prop is omitted (default `true`).
- **`web/src/components/Settings.tsx`** — extend `AppearanceSection` (and the `Settings`
  prop type) with `richText` + `onRichTextChange`. Render a labeled toggle control below
  the session-theme picker.
- **`web/src/styles.css`** — add a `.run-raw` rule (`white-space: pre-wrap`, wrap long
  lines, inherit font) plus a small toggle style if the existing controls don't cover it.

## Security Considerations

None. No new inputs, endpoints, or data exposure. Raw text is rendered as a text node
(not `dangerouslySetInnerHTML`), so disabling Markdown does not introduce an injection
path — it is strictly safer than the rich-text path.

## Feature Flag

None — slice is user-ready on merge. Default (`richText = true`) preserves current
behavior exactly; the toggle is additive.

## Verification Criteria

*The project has a Jest suite in `server/` only; the `web/` side is gated by
`npm run typecheck` + `npm run lint` + `npm run format:check` (per `CLAUDE.md`, there is
no web test runner). Verification is therefore typecheck/lint plus explicit manual UI
checks — no new web unit-test infrastructure is introduced by this slice.*

### Unit Tests
- [ ] N/A for `web/` (no web test runner exists; do not scaffold one for this slice).

### Type / Lint / Format Gates
- [ ] `npm run typecheck` exits 0 with the new `richText` prop threaded through
      `App → Settings/AppearanceSection` and `App → RunPanel`.
- [ ] `npm run lint -- --max-warnings=2` exits 0.
- [ ] `npm run format:check` exits 0.
- [ ] `npm --prefix server test` exits 0 (no regressions; server untouched).

### Manual UI Verification
- [ ] Fresh browser (no `hangar-rich-text` key) → session output renders as rich text
      (Markdown) — unchanged default behavior.
- [ ] Settings → Appearance shows a rich-text toggle; turning it **off** makes an open
      session's assistant text and result render as raw plain text (visible `#`, `*`,
      `-` markers; preserved newlines) in **both** terminal and classic themes.
- [ ] Turning it back **on** restores Markdown rendering without a reload.
- [ ] The preference survives a page reload (persisted in `localStorage`).

## Out of Scope

- Per-session (as opposed to per-browser) override of the setting.
- Server-side or `hangar.config.json` persistence / syncing across browsers.
- Changing how user messages, system/info lines, permission cards, or questions render.
- Any change to the terminal theme's monospace styling of rich text.
- Adding a web test runner.

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-han-42-rich-text-toggle`
