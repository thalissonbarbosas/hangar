# Slice 002: Docs & Specs Modal

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** high
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-docs-modal-ui`
- **Depends on:** 001 (merged first so the spec section is already gone from below the board)

## Slicing justification

Server, types, API client, and UI form a single vertical slice — each layer is non-functional
without the others. Additions are ~220 lines with changes only to the project header and a new
`activeDoc` state in `App.tsx`.

## Problem

1. AIWF methodology docs (`~/.local/share/ai-workflow/docs/`) are unreachable from Hangar.
2. The old `SpecCardsSection` (removed in Slice 001) left spec files inaccessible.
3. Directory (sliced) specs expose only their `README.md` — the individual slice files
   (`001_...md`, `002_...md`) are dark.

## Solution

A `📖` icon-button in the project header opens `AiwfDocsModal`, a large two-tab modal:

- **Documents tab** — plain list of AIWF methodology docs. Row: title + "Run skill" button.
  Clicking a row opens `DocPanel`.
- **Specs tab** — plain list of project spec cards. Single-file specs: one row per spec.
  Directory specs: one collapsible folder row; expanding it reveals the slice files inside.

Both tabs use the same list row style. The key chip appears on spec rows only.

## Technical Design

### API Changes

**`GET /api/aiwf/docs`** — list docs in `~/.local/share/ai-workflow/docs/`.

Response `200 OK`:
```json
{ "docs": [{ "slug": "REFERENCE", "title": "Workflow Toolkit Reference" }] }
```

When the directory doesn't exist: `{ "docs": [] }`.

- **title** = first `# …` heading in the file, or `formatSpecName(filename)` as fallback.

**`GET /api/aiwf/docs/:slug`** — full markdown for one doc.

Response `200 OK`: `{ "content": "# Workflow Toolkit Reference\n…" }`.
Response `400`: slug contains chars outside `[A-Za-z0-9_-]` (traversal guard).
Response `404`: file not found.

### Data Model

**New `AiwfDoc` interface** (`server/src/types.ts` + `web/src/types.ts`):
```ts
export interface AiwfDoc {
  slug: string;
  title: string;
}
```

**New `SpecSlice` interface** (`server/src/types.ts` + `web/src/types.ts`):
```ts
export interface SpecSlice {
  filename: string;  // e.g. "001_remove-spec-section.md"
  title: string;     // parsed from first # heading
  content: string;   // full markdown
}
```

**Add `specChildren` to `Ticket`** (`server/src/types.ts` + `web/src/types.ts`):
```ts
specChildren?: SpecSlice[];  // populated only for directory spec cards
```
`specChildren` is `undefined` for single-file specs and for non-spec cards — no change to
existing fields, fully backwards-compatible.

### Name formatting utility

Both the server (title fallback) and the client (display) must format raw filenames into
readable titles. Define this once as a shared pure function — `formatSpecName` in
`server/src/aiwf.ts` (re-exported or duplicated in `web/src/utils.ts`):

```ts
function formatSpecName(raw: string): string {
  return raw
    .replace(/^\d{3}[._]/, "")   // strip leading NNN_ or NNN. prefix
    .replace(/\.md$/i, "")        // strip .md extension
    .replace(/[-_]/g, " ")        // hyphens/underscores → spaces
    .replace(/\b\w/g, (c) => c.toUpperCase()); // title-case each word
}
```

Examples:
| Raw | Formatted |
|-----|-----------|
| `001_remove-spec-section.md` | `Remove Spec Section` |
| `002_docs-modal-ui.md` | `Docs Modal Ui` |
| `spec-driven-development.md` | `Spec Driven Development` |
| `TRUNK_BASED_WORKFLOW.md` | `Trunk Based Workflow` |
| `REFERENCE.md` | `Reference` |

This replaces the existing `entryName.replace(/\.md$/, "")` fallback in `parseSpecFile`
and the equivalent fallback in the new docs listing code.

### `listSpecCards` change (`server/src/aiwf.ts`)

For directory spec entries, after reading `README.md`, also scan the directory for
`NNN_*.md` files (anything matching `/^\d{3}_.*\.md$/`, excluding `README.md`), parse the
title from each file's first `# ` heading (falling back to `formatSpecName(filename)`), and
attach as `specChildren` on the card. Sort children by filename ascending (slice order).

Single-file spec cards are unchanged — `specChildren` is left `undefined`.

### Architecture

**API client (`web/src/api.ts`):**
```ts
aiwfDocs: () => getJson<{ docs: AiwfDoc[] }>("/api/aiwf/docs"),
aiwfDoc: (slug: string) => getJson<{ content: string }>(`/api/aiwf/docs/${encodeURIComponent(slug)}`),
```

**App.tsx:**
- Add `activeDoc: { title: string; content?: string; slug?: string } | null` state.
- Pass `onOpenDoc` callback down to `AiWorkflowView`.
- Render `<DocPanel>` when `activeDoc` is set, `<RunPanel>` when `activeRun` is set —
  one panel at a time; opening one clears the other.

**`DocPanel` (`web/src/components/DocPanel.tsx`):**
- Props: `{ title: string; content?: string; slug?: string; onClose: () => void }`.
- If `slug` is set and `content` is absent, fetches `api.aiwfDoc(slug)` on mount.
  Spinner while loading; error message on failure.
- Reuses RunPanel CSS shell (`run-panel`, `run-panel-head`, `run-panel-body`).
- Header: title + `×`. Body: `<Markdown>`. Escape key closes. No footer actions.

**`AiWorkflowView` (`AiWorkflow.tsx`):**
- Add `onOpenDoc: (doc: { title: string; content?: string; slug?: string }) => void` prop.
- Add `docsOpen` boolean state.
- In `aiwf-board-header`, add `BookOpen` icon-btn before `MoreVertical`:
  ```jsx
  <button className="icon-btn has-tip" data-tip="Documents & specs" onClick={() => setDocsOpen(true)}>
    <BookOpen size={15} />
  </button>
  ```
- Pass `specCards`, `phaseSkills`, `skillsByName`, and `onOpenDoc` into `AiwfDocsModal`.

**`AiwfDocsModal` (new, in `AiWorkflow.tsx`):**

```ts
Props: {
  specCards: Ticket[];
  phaseSkills: Record<string, string[]>;
  skillsByName: Map<string, Skill>;
  onOpenDoc: (doc: { title: string; content?: string; slug?: string }) => void;
  onRunSpecSkill: (key: string) => void;
  onRunDocSkill: (slug: string) => void;
  onClose: () => void;
}
```

State: `activeTab: "docs" | "specs"` (default `"docs"`).

_Shared row design_ (used by both tabs, and by spec child rows):
```
[ key? ] [ ▶ folder? ] [ title ]          [ Run skill ]
```

_Documents tab:_
- Fetches `api.aiwfDocs()` on mount. Spinner while loading.
- Empty state: "Install AI Workflow to browse its docs."
- Each row: title + "Run skill".
  - Click row → `onOpenDoc({ title, slug })` + `onClose()`.
  - "Run skill" → `onRunDocSkill(slug)`.

_Specs tab:_
- Receives `specCards` as prop (no extra fetch). Filter input + pagination.
- **Single-file spec row** (`!card.specChildren`): key chip + title + "Run skill" + draggable.
  - Click row → `onOpenDoc({ title: card.summary, content: card.description })` + `onClose()`.
  - "Run skill" → `onRunSpecSkill(card.key)`.
- **Directory spec row** (`card.specChildren` present): folder row.
  - Shows `ChevronRight` / `ChevronDown` toggle + `FolderOpen` icon + title + "Run skill".
    The "Run skill" on the folder row runs against the README card (same flow as single-file).
  - Click anywhere on the row (except "Run skill") → toggle expand/collapse.
  - When expanded: child rows rendered beneath, indented. Each child row:
    - Title only — `child.title` (already formatted via `formatSpecName` fallback; no raw
      filename shown, no key chip, not draggable).
    - Click row → `onOpenDoc({ title: child.title, content: child.content })` + `onClose()`.
    - No "Run skill" on child rows (run from the parent folder row).
- Drag-to-promote works only on folder rows (not child rows) — same `TICKET_DND_MIME`
  payload as before.
- Empty state: "No specs in this project yet."

**Skill pickers:**

_Spec "Run skill"_ — unchanged: `setPicker({ key, phase: "Implementation" })`.

_Doc "Run skill"_ — new `docPicker: { slug: string } | null` state. When set, renders
`PhaseSkillModal` with Design + Implementation skills combined:
```ts
const docSkills = [
  ...(phaseSkills["Design"] ?? []),
  ...(phaseSkills["Implementation"] ?? []),
];
```
On confirm: `createAiwfCard` (kind: thread, status: chosen skill's phase, description includes
doc title + slug) → `aiwfRunCard(card.key, skill)` — same sequence as spec promotion.

### CSS

`DocPanel` reuses RunPanel CSS. New utilities in `styles.css`:

```css
/* Tab bar shared by AiwfDocsModal */
.aiwf-modal-tabs { display: flex; border-bottom: 1px solid var(--border); margin-bottom: .75rem; }
.aiwf-modal-tab  { padding: .4rem .9rem; font-size: .85rem; cursor: pointer; border-bottom: 2px solid transparent; }
.aiwf-modal-tab.active { border-bottom-color: var(--accent); color: var(--accent); }

/* Indented child rows inside an expanded folder spec */
.aiwf-spec-child-row { padding-left: 2rem; }
```

## Security Considerations

- Doc slug validated to `[A-Za-z0-9_-]` only — directory traversal blocked.
- Docs served from a fixed path; no user-controlled directory component.
- `specChildren` content comes from the project repo (same trust boundary as spec card
  descriptions today).

## Feature Flag

`None` — ships user-ready on merge.

## Verification Criteria

### Unit Tests
- N/A (no test suite yet).

### Integration Tests
- [ ] `GET /api/aiwf/docs` → array of `{ slug, title }`.
- [ ] `GET /api/aiwf/docs/REFERENCE` → `{ content: "# Workflow Toolkit Reference\n…" }`.
- [ ] `GET /api/aiwf/docs/../../etc/passwd` → `400`.
- [ ] `/api/aiwf/projects/:id/cards` — a directory spec card (e.g. SPEC-016) includes
  `specChildren` array with one entry per slice file, each having `filename`, `title`,
  `content`. A single-file spec card has no `specChildren` field.
- [ ] `npm run typecheck` passes.

### E2E Tests
- [ ] `📖` button appears in the AIWF project header (before `⋮`).
- [ ] Clicking `📖` opens the modal with **Documents** and **Specs** tabs.
- [ ] **Documents tab:** plain list of AIWF doc titles + "Run skill" per row. Clicking a row
  opens `DocPanel` with formatted markdown.
- [ ] **Documents tab:** "Run skill" opens `PhaseSkillModal` with Design + Implementation
  skills. Confirming creates a board card and starts the session.
- [ ] **Specs tab, single-file spec:** row shows key chip + title + "Run skill". Clicking
  opens `DocPanel`. Drag to a phase column opens the promote picker.
- [ ] **Specs tab, directory spec:** row shows folder icon + `▶` toggle + title + "Run skill".
  Clicking the row expands it; child rows appear indented below with slice titles. Clicking
  a child opens `DocPanel` with that slice's markdown. Clicking the row again collapses it.
- [ ] "Run skill" on a folder spec row uses the README content (same as single-file flow).
- [ ] Filter input narrows both single-file and folder rows (matches on title).
- [ ] `DocPanel` closes via `×` and Escape. Starting a run clears the doc panel.
- [ ] Demo mode: Documents tab shows install-prompt empty state; Specs tab shows seeded cards
  (demo specs are single-file, so no folder rows expected in demo).

## Out of Scope

- Root-level AIWF files (`README.md`, `CHANGELOG.md`, etc.).
- "Run skill" on individual child slice rows.
- Search within the Documents tab.
- Refreshing the docs list without a restart.
