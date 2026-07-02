# Feature: Terminal-like light mode

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-terminal-light-mode`

## Problem

The **Terminal** session theme is the default look for the live session stream. Its console
palette (`--term-bg: #0a0c10`, `--term-fg: #d3dae6`, phosphor-green prompt) is hard-coded and
applies in **both** app themes — so a user running Hangar in light mode still gets a jarring
near-black terminal window docked in the middle of an otherwise light UI.

The two theme axes are already designed to be orthogonal (`data-theme` = light/dark,
`data-session-theme` = terminal/classic), and the Classic session theme already tracks the app
theme because it inherits the neutral scale. Terminal is the only combination that ignores the
app theme. HAN-43 closes that gap: a **terminal-like light mode** — a light console palette that
still reads as a terminal — for the `light + terminal` combination.

## Solution

Split the terminal console tokens into an app-theme-aware pair instead of one hard-coded dark set:

- **Dark app theme (and default):** keep today's dark console exactly as-is.
- **Light app theme:** override the `--term-*` tokens (and the terminal-scoped `--surface-3` /
  `--border-strong`) with a light "paper console" palette — light flat surface, dark ink, a
  deeper prompt green that reads on light (reusing the light-mode `--success` green).

The prompt markers (`▸`, `$`), monospace layout, ruled result blocks, and centered-modal framing
are unchanged — only the color tokens flip. Because everything downstream already consumes the
`--term-*` / neutral tokens, no per-element CSS needs to change beyond the token block.

The Settings **Session theme** picker preview and its copy are updated to match: the terminal
preview SVG is driven by CSS variables so it reflects the current app theme, and the description
no longer claims a "dark surface".

## Technical Design

### Architecture

All changes are in the `web/` UI layer. No server, API, config, or data-model changes.

**1. `web/src/styles.css` — terminal token block (~line 4117).**

Today a single selector defines the dark console tokens:

```css
html[data-session-theme="terminal"] .run-panel { --term-bg: #0a0c10; /* …dark set… */ }
```

Keep that selector as the **dark / default** palette (it already wins under `data-theme="dark"`
and when no app theme is set). Add a **light** override immediately after, scoped one specificity
level higher so it only applies in light mode:

```css
html[data-theme="light"][data-session-theme="terminal"] .run-panel {
  --term-bg: #f6f7f9;      /* flat light console surface */
  --term-fg: #1f2430;      /* dark ink */
  --term-dim: #6b7280;     /* muted / secondary */
  --term-prompt: #0f9d63;  /* deeper green — reads on light; matches light --success */
  --term-panel: #ffffff;   /* window chrome / cards, lifts off --term-bg */
  --term-border: #dfe3ea;
  --surface-3: #eceff4;
  --border-strong: #ccd2dd;
}
```

The existing block keeps setting the neutral-scale remaps (`--bg`, `--surface`, `--text`, …) from
the `--term-*` tokens; those references resolve to whichever palette is active, so the remap logic
is written once and not duplicated in the light block.

**2. `web/src/components/SessionThemePreviews.tsx` — `TerminalPreview`.**

Replace the hard-coded hex fills (`#0a0c10`, `#d3dae6`, `#6b7488`, `#5ef2a0`) with CSS custom
properties (`var(--tp-bg)`, `var(--tp-fg)`, `var(--tp-dim)`, `var(--tp-prompt)`) so the swatch
tracks the app theme like the Classic preview already does.

**3. `web/src/styles.css` — `.session-theme-preview[data-preview="terminal"]`.**

Currently `background: #0a0c10`. Define the `--tp-*` variables here for dark, and add a
`html[data-theme="light"] .session-theme-preview[data-preview="terminal"]` override for light,
mirroring the two console palettes. The `background` becomes `var(--tp-bg)`.

**4. `web/src/components/Settings.tsx` — `SESSION_THEMES` copy.**

Change the terminal `desc` from "…flat dark surface." to a theme-neutral phrasing, e.g.
"…flat console surface that follows the app theme."

**5. `docs/design/DESIGN_SYSTEM.md` — "Session themes" section.**

Add the light terminal token values alongside the existing dark ones and note that the terminal
surface now follows the app light/dark theme (previously documented as "true terminal regardless
of the app theme").

### API Changes

None.

### Data Model

None. The existing per-browser `hangar-session-theme` (localStorage) and `data-session-theme`
attribute are unchanged; light/dark continues to come from the existing `hangar-theme` /
`data-theme` mechanism. The new behavior is purely the intersection of the two existing toggles.

## Security Considerations

None. CSS-only presentational change; no new inputs, endpoints, or data exposure. No entry in
`THREAT_MODEL.md` is affected.

## Feature Flag

None — slice is user-ready on merge. It only alters the appearance of the already-shipping
`light + terminal` combination; dark terminal and both classic combinations are visually
unchanged.

## Verification Criteria

No automated test suite exists for CSS (`npm run typecheck` is the gate for the `.tsx` edit).
Verification is manual in the running app plus the standard checks.

### Static / build
- [ ] `npm run typecheck` exits 0 (covers the `SessionThemePreviews.tsx` / `Settings.tsx` edits).
- [ ] `npm run lint -- --max-warnings=2` exits 0.
- [ ] `npm run format:check` exits 0.

### Manual (run `HANGAR_DEMO=1 npm run dev`, open a seeded session)
- [ ] App **dark** + session **terminal** → console is the original near-black palette (no visual regression).
- [ ] App **light** + session **terminal** → console renders light: light surface, dark text, green prompt markers legible; result-block left borders (success/danger) still read.
- [ ] Toggle the app light/dark switch with a terminal session open → console repaints between the two palettes without reload.
- [ ] App **light** + session **classic** and **dark** + **classic** → unchanged.
- [ ] Settings → Session theme: the Terminal preview swatch is dark in dark mode and light in light mode; description no longer says "dark surface".

## Out of Scope

- Adding a third session theme or any new user-facing toggle (light terminal is derived, not selected).
- Restyling the Classic session theme.
- Changing the phosphor-green dark prompt color or any dark-mode terminal value.
- A dedicated persisted preference for terminal brightness independent of the app theme.
