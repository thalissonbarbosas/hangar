# Feature: Terminal session theme + picker

## Trunk Metadata

- **Type:** feat
- **Flag:** `none` — user-ready on merge (Terminal becomes the default look; Classic stays one click away)
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-terminal-theme-and-picker`
- **Ticket:** HAN-30 — Terminal-like session

## Problem

The RunPanel session stream renders as a chat-style feed (Inter body text, rounded tool chips,
card surfaces). HAN-30 wants a **terminal-like** rendering as the new default, plus a way to
switch back. This slice delivers the whole feature end-to-end: a persisted **session theme**
preference (`classic` | `terminal`, default `terminal`), the CSS that restyles the session
stream as a console, and a **Session theme** section in Settings with a functional two-option
picker. Preview images for that picker are slice 002.

## Solution

Follow the existing light/dark pattern in `web/src/useTheme.ts`: a small hook owns the
preference, persists it to `localStorage`, and reflects it onto `document.documentElement` as a
`data-session-theme` attribute. CSS keyed on `html[data-session-theme="terminal"]` restyles the
session stream (`.run-panel` / `.run-body` and its line types) into a terminal look. The
attribute is orthogonal to `data-theme`, so light/dark keeps working; **Classic** is simply the
absence of terminal overrides.

The picker lives in a new Settings section. Because the preference must apply globally, `App`
owns it via the hook and passes `sessionTheme` + `onSessionThemeChange` into `<Settings>`, which
forwards them to the new section (no server round-trip — this section does not call
`api.config`).

## Technical Design

### New file — `web/src/useSessionTheme.ts`

Mirror `useTheme.ts`:

```ts
export type SessionTheme = "classic" | "terminal";

function getInitial(): SessionTheme {
  try {
    const saved = localStorage.getItem("hangar-session-theme");
    if (saved === "classic" || saved === "terminal") return saved;
  } catch { /* ignore */ }
  return "terminal"; // new default
}

export function useSessionTheme() {
  const [sessionTheme, setSessionTheme] = useState<SessionTheme>(getInitial);
  useEffect(() => {
    document.documentElement.dataset.sessionTheme = sessionTheme;
    try { localStorage.setItem("hangar-session-theme", sessionTheme); } catch { /* ignore */ }
  }, [sessionTheme]);
  return { sessionTheme, setSessionTheme };
}
```

### `web/src/App.tsx`

- Import and call `useSessionTheme()` next to `useTheme()`.
- Pass the two values to `<Settings>`: `<Settings onSaved={loadMeta} sessionTheme={sessionTheme} onSessionThemeChange={setSessionTheme} />`.
- No change to the RunPanel mount — the attribute on `<html>` is enough for CSS to target it.

### `web/src/components/Settings.tsx`

- Add `"appearance"` to `SectionKey` and a nav entry `{ key: "appearance", label: "Session theme", icon: Palette }` (import `Palette` from lucide-react). Place it near the top of `SECTIONS` (after `jira` or at the end — operator-visible, does not need config).
- Widen the component props: `Settings({ onSaved, sessionTheme, onSessionThemeChange })`.
- Render `<AppearanceSection sessionTheme={...} onChange={...} />` when `section === "appearance"`.
- New `AppearanceSection` — a `card-panel` with two selectable option cards (Classic / Terminal).
  Each card is a `button` with `aria-pressed`, an `.on` class when selected, a title, and a
  one-line description. Clicking calls `onChange(key)` (applies instantly via the hook — no Save
  button, matching the light/dark toggle's instant behavior). Slice 002 fills each card with a
  preview thumbnail; this slice ships text-only cards with a placeholder area
  (`.session-theme-preview`) reserved so 002 is a drop-in.

Card copy:
- **Terminal** — "Monospace console. Prompt-prefixed lines, echoed tool calls, flat dark surface."
- **Classic** — "Chat-style feed. Proportional text, soft cards and tool chips."

### `web/src/styles.css`

Add a `data-session-theme="terminal"` block that restyles only the session stream. Keep the
Classic look as-is (no terminal attribute = current styles). **Decided direction:
console-authentic** — commit fully to the terminal aesthetic (flat near-black surface, monospace
throughout, prompt glyphs, echoed tool commands, phosphor/accent tint), not a subtle variant.
Terminal overrides (scoped under `html[data-session-theme="terminal"] .run-panel`):

- Console surface: dark, flat background for `.run-body` (e.g. `#0a0c10`), no card gaps — tighten
  `gap` and use full-width line rows.
- Monospace everywhere in the stream: `.run-body`, `.run-line.text`, `.run-result-body`,
  `.run-user-text` use `var(--mono)` at ~12–13px, line-height ~1.45.
- Prompt affordance: prefix assistant/user/tool lines with a console glyph via `::before`
  (assistant `▸`/`»`, user `$`, tool `$`), tinted with `--accent` / phosphor green.
- Tool lines (`.run-line.tool`) render as an echoed command: `$ <tool> <input>` on one monospace
  row, no chip background/border.
- Result blocks (`.run-result`) drop the rounded card; render as a plain framed block or a
  ruled separator, keeping the success/error color as a left-border accent.
- Keep permission/question cards legible (they are interactive) — restyle borders to match the
  console frame but do **not** remove the buttons.
- Also add the picker card styles: `.session-theme-picker`, `.session-theme-card`,
  `.session-theme-card.on`, `.session-theme-preview` (placeholder box for 002).

Exact colors follow `docs/design/DESIGN_SYSTEM.md` tokens where possible; the terminal surface
may introduce a couple of local hex values (documented in the DESIGN_SYSTEM update below).

### Docs

- `docs/design/DESIGN_SYSTEM.md` — add a short "Session themes" subsection (Classic vs Terminal,
  the `data-session-theme` mechanism, the terminal surface color).
- `README.md` — mention Session theme in the Settings tour; note Terminal is the default.
- `CHANGELOG.md` — add the feature under `## [Unreleased]`. Do **not** bump `package.json`: this
  repo bumps the version only in a dedicated `release/x.y.z` PR (`chore(release): vX.Y.Z`), never
  in feature PRs — features accrue under `[Unreleased]` until a release cuts.

## Security Considerations

None. Client-side visual preference only; no new API surface, no server config, no user input
that reaches the server. `localStorage` access is wrapped in try/catch (matches `useTheme`).

## Feature Flag

None — slice is user-ready on merge. Terminal becomes the default; Classic is one click away in
Settings → Session theme.

## Verification Criteria

### Unit / type checks
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint -- --max-warnings=2` passes.
- [ ] `getInitial()` returns `"terminal"` when `localStorage` is empty or throws, and returns the
      stored value when it is `"classic"` or `"terminal"`.

### UI behaviour
- [ ] On first load (empty `localStorage`), `<html>` has `data-session-theme="terminal"` and an
      open session renders in the terminal look (monospace, prompt-prefixed lines).
- [ ] Settings → **Session theme** shows two cards; the current theme's card has the `.on`
      state; clicking **Classic** switches `<html>` to `data-session-theme="classic"` instantly
      and the RunPanel reverts to the chat-style look with no reload.
- [ ] The choice survives a page reload (persisted in `localStorage`).
- [ ] The app-wide light/dark toggle still works and is independent of the session theme (all
      four combinations render legibly).
- [ ] Interactive elements in the terminal look still function: permission Allow/Deny, the
      question card options, the composer, Resume/Terminal/Hand off buttons.

## Out of Scope

- Preview images in the picker cards (slice 002 — placeholder area is reserved here).
- Restyling the Sessions **list** (`SessionsView`) rows — this slice targets the session stream
  (RunPanel) only.
- Persisting the preference to server config or syncing it across devices.
- A third theme or per-board theme overrides.
