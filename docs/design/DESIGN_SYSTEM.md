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
