# Design System

**Project:** Hangar
**Last updated:** June 2026
**Brand direction:** Precision instrument / command center — dense information, technical authority, dark-first
**Source:** `web/src/styles.css` (canonical implementation). This doc formalizes and refines what's there.

---

## Color Palette

**Color harmony:** Monochromatic + semantic. Single accent hue family, semantic colors separate from the brand accent.

**Design philosophy:** Dark backgrounds with near-black depth layers. Accent shifts slightly cooler and more electric than the original blue-indigo — toward a precision instrument blue that avoids the generic "AI startup" indigo register.

### Accent (Precision Blue)

| Token | Dark Mode | Light Mode | Usage |
|-------|-----------|------------|-------|
| `--accent` | `#5C91FF` | `#3050D4` | Primary CTAs, active states, links, run status |
| `--accent-hover` | `#7AAEFF` | `#1F3DB8` | Hover on primary interactive elements |
| `--accent-soft` | `rgba(92,145,255,0.12)` | `rgba(48,80,212,0.10)` | Active card backgrounds, focus rings, soft badges |
| `--accent-contrast` | `#0b0e14` | `#ffffff` | Text on accent-colored backgrounds |

**Rationale for the shift from #6e8bff / #5566ef:** The original accent reads in the indigo-purple territory common to AI/SaaS products. Shifting ~10° cooler (from H:225° toward H:218°) and increasing saturation slightly produces a more precise, instrument-panel quality — less "startup launch page," more "command center."

### Neutral Scale (Dark Mode)

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#0b0e14` | Page background |
| `--surface` | `#12151e` | Topbar, columns, modals |
| `--surface-2` | `#181c28` | Cards, inputs, secondary panels |
| `--surface-3` | `#1e2235` | Hover states, tertiary surfaces |
| `--border` | `#252b3a` | Standard borders |
| `--border-strong` | `#353d52` | Dividers, focus rings |
| `--text` | `#e8ebf2` | Primary text |
| `--text-muted` | `#99a2b5` | Secondary text, labels |
| `--text-dim` | `#8b93a3` | Tertiary text |
| `--text-faint` | `#6b7488` | Timestamps, placeholders, meta |

### Neutral Scale (Light Mode)

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#f3f5f9` | Page background |
| `--surface` | `#ffffff` | Topbar, columns, modals |
| `--surface-2` | `#f6f8fb` | Cards, inputs |
| `--surface-3` | `#eceff4` | Hover states |
| `--border` | `#e3e7ee` | Standard borders |
| `--border-strong` | `#ccd2dd` | Dividers, focus rings |
| `--text` | `#1a1e29` | Primary text |
| `--text-muted` | `#59616f` | Secondary text |
| `--text-dim` | `#747882` | Tertiary text |
| `--text-faint` | `#8b93a3` | Timestamps, placeholders |

### Semantic Colors

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--success` | `#34d399` | `#0f9d63` | Done state, confirmations, success badges |
| `--danger` | `#f87171` | `#dc2626` | Error state, destructive actions |
| `--warning` | `#fbbf24` | `#c2730a` | Human-in-the-loop gates, warnings |

Semantic colors are independent of the accent hue. They must not change with accent palette changes.

### Status Column Colors (design refinement)

Column headers get a semantic top-border based on their Jira/aiwf status type. This allows the board to be read at a glance without inspecting column labels:

| Status type | Top-border token | Example |
|-------------|-----------------|---------|
| Backlog / To Do | `transparent` (no highlight) | "Backlog", "To Do" |
| In Progress | `--accent` | "In Progress", "Development" |
| In Review | `--warning` | "In Review", "PR Review" |
| Done / Complete | `--success` | "Done", "Complete", "Delivered" |

This mapping is heuristic (applied by class) — boards may override per column.

---

## Typography

**Primary font:** Inter, -apple-system, BlinkMacSystemFont, "Segoe UI" (system stack fallback)
**Mono font:** JetBrains Mono, ui-monospace, SFMono-Regular, Menlo

Inter is a deliberate choice for legibility in dense developer-tool contexts. The mono stack is used for: ticket keys, agent names in code-style contexts, session IDs, cost values, file paths, tool call inputs.

### Type Scale

| Use | Size | Weight | Tracking | Notes |
|-----|------|--------|----------|-------|
| Board section title | 15px | **700** | -0.02em | Project name, board name (was 600) |
| Column header label | 12px | 600 | 0em | Uppercase already handles visual weight |
| Card summary | 13px | 400 | 0em | Primary card content |
| Card key / agent | 12px | 600 | 0em | Monospace |
| Run title | 14px | 600 | 0em | Agent session heading |
| Section heading | 17px | 700 | -0.025em | Sessions view, settings |
| Setting label | 11px | 600 | 0.05em | Uppercase form labels |
| Meta / timestamp | 11-12px | 400-500 | 0em | Session age, cost |
| Badge / tag | 10-11px | 600-700 | 0.2px | Status pills, model badges |

**Weight contrast rule:** The gap between UI chrome (headings at 700) and content (body at 400) should be maintained. Never use 500 weight as a heading — it reads as "medium" both visually and semantically.

---

## Component Patterns

### Cards

**Idle card:**
- `--surface-2` background, `--border` border, `--r-md` radius
- Hover: `translateY(-1px)`, `--shadow`, `--border-strong`

**Active card (agent running):**
- Background: `--accent-soft`
- Left border: `3px solid --accent` (instead of animated border-color)
- **Rationale:** A solid left-stripe is perceptually faster to locate in a dense column than a color-cycling full border. Peripheral vision catches the stripe while reading column content.

```css
.card.active {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  border-left: 3px solid var(--accent);
  /* remove: animation: cardpulse 2.4s ease-in-out infinite */
}
```

**Awaiting input card:**
- Left border: `3px solid --warning`
- Border color: `color-mix(in srgb, var(--warning) 45%, var(--border))`

**Done card:**
- Left border: `3px solid --success`
- Border color: `color-mix(in srgb, var(--success) 35%, var(--border))`

### Columns

**Column top border by status type:**
```css
.column.status-in-progress { border-top-color: var(--accent); }
.column.status-in-review   { border-top-color: var(--warning); }
.column.status-done        { border-top-color: var(--success); }
/* default: --border (no semantic highlight) */
```

### Buttons

| Variant | Background | Text | Border |
|---------|------------|------|--------|
| Primary | `--accent` | `--accent-contrast` | none |
| Ghost | `--surface-2` | `--text` | `--border` |
| Ghost danger | `--surface-2` | `--danger` | `--border` hover `--danger` |
| Icon | `--surface-2` | `--text-muted` | `--border` |

**Focus state (all interactive elements):**
```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft);
  border-color: var(--accent);
}
```

### Run Tags (on cards)

| State | Background | Text |
|-------|------------|------|
| queued | `warning-soft` | `--warning` |
| starting / running | `--accent-soft` | `--accent` |
| awaiting_input | `warning-soft` | `--warning` |
| done | `success-soft` | `--success` |
| error | `danger-soft` | `--danger` |
| stopped | `--surface-3` | `--text-muted` |

### Model Badges

| Model | Background | Text (dark) | Text (light) |
|-------|------------|-------------|--------------|
| opus | `color-mix(#a855f7 22%, transparent)` | `#c4a0ff` | `#7c3aed` |
| sonnet | `color-mix(#38bdf8 22%, transparent)` | `#7dd3fc` | `#0284c7` |
| haiku | `color-mix(#34d399 22%, transparent)` | `#6ee7b7` | `#059669` |

### Run Panel

Slides in from the right: `width: max(360px, 50vw)`, `max-width: 96vw`.

Sub-bar under the header (branch, session ID, cost) uses `--mono` font at 11px `--text-faint`. This metadata strip should always be visible when a session has an ID — it's the operator's audit trail.

**Permission gate:** Amber background + amber border — distinct from warning (which is also amber, but the gate is larger and has action buttons). No change needed; the visual distinction is in the size and button presence.

---

## Spacing System

Base unit: **4px**. All spacing is multiples of 4.

| Use | Value |
|-----|-------|
| Icon-to-label gap | 6-7px |
| Card internal padding | 11px 12px |
| Column body padding | 9px |
| Column header padding | 11px 13px |
| Board area padding | 20px |
| Gap between columns | 14px |
| Gap between board sections | 26px |
| Topbar padding | 12px 20px |
| Settings max-width | 780px |

---

## Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.35)` | Cards, inputs |
| `--shadow` | `0 1px 2px rgba(0,0,0,0.4), 0 10px 28px rgba(0,0,0,0.3)` | Dropdowns, panels |

Shadows are stronger in dark mode because backgrounds are darker — the contrast threshold for a shadow to read requires more opacity.

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--r-sm` | `6px` | Badges, small chips, tags |
| `--r-md` | `9px` | Buttons, inputs, cards |
| `--r-lg` | `13px` | Columns, modals, large panels |
| `--r-pill` | `999px` | Pills, avatars, tab toggles |

---

## Transitions

**Standard:** `140ms cubic-bezier(0.4, 0, 0.2, 1)` — used on all interactive state changes (border, background, color, transform).

**Slide in (run panel):** `180ms cubic-bezier(0.4, 0, 0.2, 1)` — translates 24px + fades from 0.6 opacity.

**Do not transition:** layout-affecting properties (width, height, padding) — these cause layout thrash on the dense board.

---

## Doc Tree Sidebar

*Added for: SPEC-017 (AIWF doc tree sidebar)*

### Layout

```css
.doc-sidebar {
  width: 220px;           /* fixed; collapses to 0 when hidden */
  background: var(--surface);
  border-right: 1px solid var(--border);
  flex-shrink: 0;
  transition: width 140ms cubic-bezier(0.4, 0, 0.2, 1);
}
.doc-sidebar.collapsed { width: 0; overflow: hidden; }
```

The sidebar sits between the AIWF sub-bar and the board. When collapsed the board reflows to
fill the available width without any JS measurement.

### Section label

```css
.doc-sidebar-section-label {
  font-size: 9.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--text-faint);
  padding: 10px 12px 6px;
}
```

Used for "DOCUMENTS" and "ACTIVE · N" headings inside the sidebar.

### Tree row

```css
.doc-tree-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px 5px 12px;
  border-radius: 6px;
  font-size: 11.5px; color: var(--text);
  cursor: pointer;
  transition: background 140ms cubic-bezier(0.4, 0, 0.2, 1);
}
.doc-tree-row:hover   { background: var(--surface-3); }
.doc-tree-row.selected { background: var(--accent-soft); }
.doc-tree-row.absent  { opacity: 0.45; cursor: default; }
.doc-tree-row.indent-1 { padding-left: 24px; }
.doc-tree-row.indent-2 { padding-left: 36px; }
```

**Anatomy of a tree row:**

| Part | Spec |
|------|------|
| Chevron (folders) | `ChevronRight` / `ChevronDown`, `8px`, `var(--text-faint)` |
| Icon | emoji: 📋 PRD, 🏗 ARCH, 🛡 THREATS, 🎨 DESIGN_SYSTEM, 📁 folder, 📝 spec |
| Title | `flex: 1`, one line, `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` |
| Exists badge | `✓` at `8.5px / 700`, `var(--success)` on `var(--success-soft)` bg, `border-radius: 3px`, `padding: 1px 5px` |

Absent rows (file does not exist on disk): render at `opacity: 0.45` with `cursor: default`.
No "missing" badge — the dimming is the only signal.

### Active thread row

```css
.sidebar-thread-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px; border-radius: 5px;
  font-size: 10.5px; cursor: pointer;
}
.sidebar-thread-row:hover { background: var(--surface-3); }
```

Run dot: `5×5px`, `border-radius: 50%`. Running → `var(--accent)`; awaiting → `var(--warning)`.
Card key: `var(--mono)`, `9.5px`, `var(--text-faint)`. Thread title: `var(--text-muted)`,
`overflow: hidden; text-overflow: ellipsis`.

---

## Implementation Notes

### Applying the accent color refinement

The primary change from the existing system is the accent token. Update in `web/src/styles.css`:

```css
/* dark mode — change from #6e8bff / #8aa0ff */
--accent: #5C91FF;
--accent-hover: #7AAEFF;
--accent-soft: rgba(92, 145, 255, 0.12);

/* light mode — change from #5566ef / #4453d6 */
--accent: #3050D4;
--accent-hover: #1F3DB8;
--accent-soft: rgba(48, 80, 212, 0.10);
```

### Applying the active card treatment

In `web/src/styles.css`, replace:

```css
/* remove the pulse animation */
.card.active {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  /* DELETE: animation: cardpulse 2.4s ease-in-out infinite; */
  border-left: 3px solid var(--accent);
  padding-left: 9px; /* compensate for the extra 3px left border */
}
```

### Applying semantic column top borders

In `Board.tsx`, when rendering a column, derive the status type from the column's `status` name and apply a CSS class:

```typescript
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (/progress|develop|active|doing/.test(s)) return 'status-in-progress';
  if (/review|testing|qa/.test(s)) return 'status-in-review';
  if (/done|complete|deliver|shipped|closed/.test(s)) return 'status-done';
  return '';
}
```

```css
.column.status-in-progress { border-top-color: var(--accent); }
.column.status-in-review   { border-top-color: var(--warning); }
.column.status-done        { border-top-color: var(--success); }
```

### Board section title weight

In `styles.css`, update `.board-title`:
```css
.board-title { font-size: 15px; font-weight: 700; } /* was 600 */
```

---

## Session themes

The live session stream (the RunPanel body) has two looks, selectable in **Settings → Session
theme** and stored per-browser in `localStorage` (`hangar-session-theme`). The choice applies
via a `data-session-theme` attribute on `<html>` — mirroring the light/dark `data-theme`
mechanism — and is **orthogonal** to light/dark: all four combinations render.

| Theme | `data-session-theme` | Look |
|-------|----------------------|------|
| **Terminal** (default) | `terminal` | Monospace console. Prompt-prefixed lines (`▸` assistant, `$` user/tool), tool calls echoed as commands, flat dark surface, ruled result blocks with a semantic left border. |
| **Classic** | `classic` | Chat-style feed — proportional text, soft cards, rounded tool chips. The absence of terminal overrides. |

The Terminal surface introduces a few local tokens (scoped to
`html[data-session-theme="terminal"] .run-panel`), independent of the neutral scale so the
console reads as a terminal. The palette **follows the app light/dark theme** — the dark set is
the default, and a light override (`html[data-theme="light"][data-session-theme="terminal"]`)
supplies a paper-console variant. Semantic success/danger colors are reused for result-block left
borders in both.

| Token | Dark | Light | Role |
|-------|------|-------|------|
| `--term-bg` | `#0a0c10` | `#f6f7f9` | Console surface |
| `--term-fg` | `#d3dae6` | `#1f2430` | Console text |
| `--term-dim` | `#6b7488` | `#6b7280` | Muted / secondary |
| `--term-prompt` | `#5ef2a0` (phosphor green) | `#0f9d63` (light `--success`) | `▸` / `$` prompt markers |
| `--term-panel` | `#12161f` | `#ffffff` | Window chrome, cards, gates |
| `--term-border` | `#222a37` | `#dfe3ea` | Console borders |

The Settings terminal preview swatch mirrors these via `--tp-*` tokens so the picker reflects the
active theme.
