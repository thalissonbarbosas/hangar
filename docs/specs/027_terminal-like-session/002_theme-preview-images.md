# Feature: Session theme preview images

## Trunk Metadata

- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** low
- **Depends on:** 001 (the Session theme picker and its reserved `.session-theme-preview` area)
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-theme-preview-images`
- **Ticket:** HAN-30 — Terminal-like session

## Problem

Slice 001 ships the **Session theme** picker with text-only cards and a reserved
`.session-theme-preview` placeholder. The operator asked for the two themes to be shown **with
images** so the difference is obvious before selecting. This slice fills each card with a
preview thumbnail.

## Solution

Add two lightweight **inline SVG React components** — one per theme — rendered into the picker
cards' reserved preview area. **Decided:** inline SVG components (not static files or PNG
screenshots) because they are token-aware, version-control cleanly, scale crisply, and need no
binary regeneration. Each thumbnail is a small mock of the session stream: a titlebar plus a few
representative lines.

- **Classic preview** — soft rounded cards, a proportional-text line, a rounded tool chip; light
  surface tokens.
- **Terminal preview** — flat dark console, monospace-styled prompt-prefixed rows (`▸`, `$`),
  no card chrome; terminal surface color.

## Technical Design

### Assets

Add the two previews as inline React components (keeps them token-aware and avoids a `public/`
fetch), in a new file `web/src/components/SessionThemePreviews.tsx`:

```tsx
export function ClassicPreview() { return (<svg viewBox="0 0 160 96" …>…</svg>); }
export function TerminalPreview() { return (<svg viewBox="0 0 160 96" …>…</svg>); }
```

Each is a ~160×96 `viewBox` SVG using `currentColor` / CSS-variable-driven fills so it reads
correctly in both light and dark app themes. Keep each under ~30 lines of markup.

> Alternative (if inline SVG grows awkward): commit `web/public/session-theme-classic.svg` and
> `session-theme-terminal.svg` and reference via `<img src="/session-theme-terminal.svg">`. Inline
> components are preferred for token-awareness; the static-file route is the documented fallback.

### `web/src/components/Settings.tsx`

- Import `ClassicPreview` / `TerminalPreview`.
- In `AppearanceSection`, render the matching preview inside each card's `.session-theme-preview`
  area (Terminal card → `<TerminalPreview />`, Classic card → `<ClassicPreview />`), above the
  title and description added in 001.
- The previews are decorative (`aria-hidden`), so the card `button` keeps its accessible label
  from the title text.

### `web/src/styles.css`

- Size the `.session-theme-preview` box (fixed aspect, e.g. 160×96, rounded corners, `--border`
  frame) and make the SVG fill it (`width: 100%; height: auto; display: block`).
- Minor spacing so preview + title + description stack cleanly inside the card.

### Docs

- `docs/screenshots/` — no new screenshot required, but if the Settings tour screenshot is
  refreshed, capture the picker with previews.
- `CHANGELOG.md` — note the preview thumbnails under `## [Unreleased]` (fold into the HAN-30
  entry). Do **not** bump `package.json` — versioning happens in a dedicated `release/x.y.z` PR,
  not in feature PRs.

## Security Considerations

None. Static, decorative SVG markup with no user input and no script.

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Unit / type checks
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint -- --max-warnings=2` passes.

### UI behaviour
- [ ] Settings → **Session theme** shows both cards each with a distinct preview thumbnail
      (Terminal = dark console mock; Classic = light chat-card mock).
- [ ] Previews render correctly in both light and dark app themes (no invisible/low-contrast
      elements).
- [ ] Selecting a card still switches the session theme instantly (001 behaviour unregressed);
      the `.on` state is visible on the selected card.
- [ ] Previews carry `aria-hidden` and do not add duplicate/confusing labels to the card button.

## Out of Scope

- Animated or live previews.
- Any change to the session-theme mechanism, defaults, or picker behaviour from 001.
- Restyling the Sessions list (`SessionsView`).
