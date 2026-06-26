# Feature: AIWF spec tasks in the AIWF board

## Trunk Metadata

- **Type:** feat
- **Flag:** `none`
- **Complexity:** high
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-aiwf-spec-tasks`

### Why one PR despite >200 lines

The server scan, the API extension, and the UI section are a single vertical slice — the UI
section is unusable without the API, and the API alone has no user-visible value. Splitting
produces two unshippable halves. Actual diff: ~500 lines (tests included), driven by the
`SpecSidebar` component and `SpecCardsSection` supporting UI (filter, pagination, drag-to-promote).

---

## Problem

Skills like `/spec` and `/roadmap` write task files into the project repo
(`docs/specs/NNN_<slug>.md`). These files represent planned/active work units that a developer
naturally wants to delegate to an agent or skill from Hangar's board. Today Hangar only surfaces
cards in `.hangar/aiwf/<projectId>/board/` — it has no awareness of the repo's `docs/specs/`
directory. The operator must either manually create a duplicate board card for each spec file, or
leave them invisible on the board.

The goal is to surface those spec files as **read-only cards** on the AIWF board so any skill
(most commonly `/feature`, `/fix`, `/review`) can be delegated directly to them — without ever
mutating the spec file itself.

---

## Solution

Scan `<project.repoPath>/docs/specs/` for `.md` files that match the `NNN_` naming convention and
surface them as `kind: "spec"` tickets merged into the existing `GET .../cards` response. The
web renders them in a collapsible **Specs (N)** section below the phase columns. Spec cards are
read-only: mutation routes (`transition`, `archive`, `DELETE`) return 400 for `SPEC-*` keys, and
the spec file is never written to by the run engine.

Three interaction paths are available from the Specs section:

1. **"▶ Run skill" button** — opens the Implementation-phase skill picker and starts a session
   directly on the spec card; the spec file is never modified.
2. **Click-to-read sidebar** — clicking a spec row opens a slide-in `SpecSidebar` panel that
   renders the spec's markdown and includes an inline skill picker for launching a run.
3. **Drag-to-promote** — dragging a spec row onto a phase column opens a skill picker for that
   phase; on confirm, a new **mutable** board card is created in that column (populated with the
   spec's title and description) and the chosen skill is run on it immediately. This is a
   deliberate, user-initiated promotion from read-only spec to active work item — distinct from
   the spec file being auto-modified or the spec card itself being mutated.

---

## Technical Design

### Parsing logic (`server/src/aiwf.ts`)

#### `parseSpecFile(content, filename, relPath, project): Ticket`

- **Key** — match `/^(\d{3})_/` on the entry name (file or parent directory); key = `SPEC-<NNN>`
  (e.g. `006_aiwf-spec-tasks.md` → `SPEC-006`).
- **Summary** — first `# ` heading found in the content; strip common skill-generated prefixes
  (`Spec NNN — `, `Feature: `, `Phase NNN: `) with a simple regex so the title is clean.
  Fall back to the slug when no heading is found.
- **Description** — full file content prefixed by `Spec: <relPath>\n\n` so the running skill can
  resolve the file by path (e.g. `docs/specs/006_aiwf-spec-tasks.md`). When a spec is promoted
  to a board card via drag-to-promote, this description (path prefix included) is copied into the
  new board card's description so the running skill still receives the full spec context.
- **Status** — `"Implementation"` (the phase `/spec` belongs to; unused for column placement but
  needed by the run engine's `aiwfPhase` tag).
- **Kind** — `"spec"`.
- **Source** — `"aiwf"`.
- All other `Ticket` fields (`assignee`, `assigneeAvatar`, `issuetype`, `priority`) — `null`.

#### `listSpecCards(project: AiwfProject): Ticket[]`

```
<project.repoPath>/docs/specs/
  001_foo.md               → single-file spec  → SPEC-001
  006_bar/                 → sliced spec dir   → SPEC-006 (reads README.md)
    README.md
    001_slice-a.md          → skip (slice file, not a top-level entry)
```

Algorithm:
1. Resolve `specsDir = expandHome(project.repoPath) + "/docs/specs"`. Return `[]` if missing.
2. `readdirSync(specsDir, { withFileTypes: true })`.
3. For each entry:
   - **File** matching `/^\d{3}_.*\.md$/`: parse directly.
   - **Directory** matching `/^\d{3}_/`: look for `README.md` inside; parse that if found.
   - Everything else: skip.
4. Sort ascending by numeric prefix (same `keyNum` helper already in the module).
5. Return `[]` in demo mode — demo cards are already seeded by `demoAiwfCards()`.

#### `getSpecCard(project: AiwfProject, key: string): Ticket | null`

Find the spec card whose key matches `SPEC-NNN` — re-run the scan and return the matching entry, or `null`. Used by the run route when `getCard` returns `null`.

---

### Types (`server/src/types.ts` + `web/src/types.ts`)

Add `"spec"` to the `kind` union on `Ticket`:

```ts
kind?: "thread" | "task" | "spec";
```

Document inline: `// "spec" = read-only card sourced from docs/specs/ in the project repo`.

Mirror the change in `web/src/types.ts`.

Add `kind?` to `TicketDragData` so the drop handler can detect a spec drag:

```ts
kind?: string; // "spec" when dragging a spec card to promote it to a board card
```

---

### API extension (`server/src/index.ts`)

#### `GET /api/aiwf/projects/:id/cards` — merge spec cards

```ts
const boardCards = isDemo() ? demoAiwfCards() : listCards(p);
const specCards  = isDemo() ? [] : listSpecCards(p);
res.json({ tickets: [...boardCards, ...specCards] });
```

The response shape (`{ tickets: Ticket[] }`) and all downstream consumers are unchanged; clients
distinguish mutable board cards from read-only spec cards via `ticket.kind === "spec"`.

#### `POST /api/aiwf/projects/:id/cards/:key/run` — spec card fallback

Replace the existing `getCard(p, key)` lookup:

```ts
const card = getCard(p, req.params.key) ?? getSpecCard(p, req.params.key);
if (!card) return res.status(404).json({ error: "No such card" });
```

Everything else in the route stays the same. When the run completes, `appendCardHistory` is
called as usual but returns early because `findCardFile` finds no `.hangar/board/` file for
`SPEC-*` keys — the spec file is never touched, satisfying the read-only constraint.

#### Mutation routes — guard spec keys

Add at the top of `transition`, `archive`, and `DELETE` card routes:

```ts
if (req.params.key.startsWith("SPEC-")) {
  return res.status(400).json({ error: "Spec cards are read-only." });
}
```

---

### Web board (`web/src/components/AiWorkflow.tsx`)

#### `AiWorkflowView` state additions

```ts
const [specCardsOpen, setSpecCardsOpen] = useState(true);
const [specSidebar, setSpecSidebar] = useState<Ticket | null>(null);
const [pendingPromote, setPendingPromote] = useState<{ specKey: string; phase: string } | null>(null);
```

`specCards` is derived as `cards.filter((c) => c.kind === "spec")`. Spec cards are excluded from
`activeCards` and `archivedCards` so they never appear in phase columns.

#### New `SpecCardsSection` component

Below the archived section, render:

```tsx
{specCards.length > 0 && (
  <SpecCardsSection
    cards={specCards}
    open={specCardsOpen}
    onToggle={() => setSpecCardsOpen((v) => !v)}
    onRunSkill={(key) => setPicker({ key, phase: "Implementation" })}
    onOpenSidebar={setSpecSidebar}
  />
)}
```

`SpecCardsSection` renders:
- A collapsible header **"Specs (N)"** (`BookOpen` icon + `ChevronDown`/`ChevronRight` toggle).
- An inline **filter input** (`Search` icon) visible when the section is expanded. Filters by
  key or summary (case-insensitive). Resetting the filter resets the page to 1.
- A card list paginated at **10 rows per page** with Prev/Next controls shown only when
  `totalPages > 1`.
- Each row (`.aiwf-spec-row`) shows:
  - **Key chip** (`SPEC-NNN`) in `.card-key.aiwf-spec-key` style.
  - **Title** (`.aiwf-spec-title`) — truncated with ellipsis.
  - **"▶ Run skill" button** (`.aiwf-spec-run`) — `stopPropagation` so it doesn't also open
    the sidebar; fires `onRunSkill(key)` which opens `PhaseSkillModal` for `"Implementation"`.
- Each row is **clickable** (fires `onOpenSidebar(card)`) and **draggable** (see
  drag-to-promote below).
- An empty-state message when the filter matches nothing.
- The section is entirely hidden when `specCards.length === 0`.

#### Drag-to-promote

Spec rows set `draggable` and populate `TicketDragData` with `kind: "spec"`. In
`AiwfColumn.handleDrop`, when `data.kind === "spec"` the column calls `onPromoteSpec(key, phase)`
instead of `onMove`. This triggers:

```ts
function promoteSpec(specKey: string, targetPhase: string) {
  setPendingPromote({ specKey, phase: targetPhase });
}
```

A `PhaseSkillModal` appears for `pendingPromote.phase`. On confirm:

```ts
function confirmPromote(skill: string, note?: string) {
  // 1. Create a mutable board card in the target phase, copying the spec's title + description.
  api.createAiwfCard(project.id, {
    title: specCard.summary,
    status: phase,
    kind: "thread",
    description: specCard.description,   // includes "Spec: path\n\n" prefix
  }).then((r) => {
    loadCards(project.id);
    runCard(r.ticket.key, skill, note);  // run skill on the new board card
  });
}
```

The spec file is not modified. The `SPEC-*` card in the Specs section remains unchanged.

#### New `SpecSidebar` component

A slide-in panel (`.spec-overlay` + `.spec-panel`) anchored to the right edge of the viewport,
opened by clicking a spec row. Contains:
- **Header** — `BookOpen` icon, key chip, title, close (`X`) button.
- **Body** (`.spec-body`) — the spec markdown rendered via `<Markdown>`, with the
  `Spec: path\n\n` header line stripped so only the document content is shown.
- **Footer** (`.spec-footer`) — a skill segmented control (Implementation skills) and an
  optional note textarea. `⌘↵` / `Ctrl↵` submits. "▶ Run skill" button calls
  `runCard(card.key, skill, note)` directly (no board card is created; same path as the
  "▶ Run skill" button on the row).

#### Modal refinements (`NewItemModal`, `PhaseSkillModal`)

Both modals are upgraded to `modal modal-lg` (wider) with a `modal-head` header block
(`modal-title` + `icon-btn` close button), replacing the bare `<h2>` heading. No behaviour change.

#### CSS

New classes added to `web/src/styles.css`:

| Block | Classes |
|---|---|
| Spec section | `.aiwf-spec-section`, `.aiwf-spec-header`, `.aiwf-spec-toggle`, `.aiwf-spec-filter-wrap`, `.aiwf-spec-filter` |
| Spec rows | `.aiwf-spec-list`, `.aiwf-spec-row`, `.aiwf-spec-key`, `.aiwf-spec-title`, `.aiwf-spec-run`, `.aiwf-spec-empty` |
| Pagination | `.aiwf-spec-pagination`, `.aiwf-spec-page` |
| Sidebar | `.spec-overlay`, `.spec-panel`, `.spec-head`, `.spec-head-main`, `.spec-head-title`, `.spec-body`, `.spec-body-empty`, `.spec-footer`, `.spec-footer-actions` |

Rows use a muted border (`var(--border)`) and reduced opacity (`0.88`) to signal read-only status,
with a hover state that restores full opacity and highlights the accent border. The sidebar panel
uses an existing `slidein` animation and `fade` overlay — both already defined in `styles.css`.

---

### Docs

- `docs/ai-workflow.md` — add a new **Spec tasks** subsection under "The phase board" documenting
  the scan path, the `Specs (N)` section, the `SPEC-NNN` key scheme, and the read-only guarantee.
  Add the mutation-guard note to the API table: mutation routes return 400 for `SPEC-*` keys.
- `CHANGELOG.md` — one **Added** entry under `[Unreleased]`.

---

## Security Considerations

Spec files are read from the project's own `repoPath`, which the operator already registered and
trusts. No new path traversal surface: `listSpecCards` resolves from `project.repoPath` (an
operator-controlled absolute path) and lists only files directly under `docs/specs/` without
following symlinks (`Dirent.isFile()` / `isDirectory()` do not dereference symlinks). No spec
file content is written back anywhere.

Drag-to-promote creates a board card whose description is the spec content — content the operator
already trusts (it comes from their own repo). No user-supplied data flows into the board card
beyond the skill name and an optional freetext note, both of which are already accepted by the
existing card-creation route.

---

## Feature Flag

`None` — the Specs section is user-ready on merge. It only appears when `docs/specs/` exists in
a project's repo and contains matching files, so projects without specs see no change.

---

## Verification Criteria

### Unit Tests (`server/src/__tests__/aiwf.test.ts`)

- [x] `listSpecCards` with a mock `docs/specs/` containing `001_foo.md` (H1 `# Spec 001 — Foo`) →
  returns one ticket: `key: "SPEC-001"`, `summary: "Foo"`, `kind: "spec"`, `source: "aiwf"`,
  `status: "Implementation"`, `description` starts with `Spec: docs/specs/001_foo.md`.
- [x] `listSpecCards` with a sliced spec directory `006_bar/README.md` (H1 `# Feature: Bar`) →
  returns key `SPEC-006`, summary `Bar`.
- [x] `listSpecCards` ignores `docs/specs/006_bar/001_slice-a.md` (slice files, not top-level).
- [x] `listSpecCards` with a non-existent `docs/specs/` → returns `[]`.
- [x] `listSpecCards` in demo mode → returns `[]`.
- [x] `getSpecCard(project, "SPEC-001")` → returns the matching ticket; `"SPEC-999"` → `null`.
- [ ] `listSpecCards` with `001_a.md` and `006_b.md` both present → returns them in ascending
  key order (`[SPEC-001, SPEC-006]`). *(sort direction regression guard)*

### Integration Tests (`server/src/__tests__/index.aiwf.test.ts`)

- [x] `GET /api/aiwf/projects/:id/cards` response includes spec cards (kind `"spec"`) alongside
  board cards when `docs/specs/` contains matching files.
- [x] `POST .../cards/SPEC-001/run` with a valid skill → 200 `{ runId: "..." }` (spec card found
  via `getSpecCard` fallback).
- [x] `POST .../cards/SPEC-001/transition` → 400 `{ error: "Spec cards are read-only." }`.
- [x] `POST .../cards/SPEC-001/archive` → 400 `{ error: "Spec cards are read-only." }`.
- [x] `DELETE .../cards/SPEC-001` → 400 `{ error: "Spec cards are read-only." }`.

### E2E / Manual

- [ ] With a project registered whose repo contains `docs/specs/NNN_*.md` files, the AIWF board
  shows a collapsed **Specs (N)** section below the phase columns; expanding it lists the spec
  cards with their keys and titles in ascending key order.
- [ ] Typing in the filter box narrows the visible rows; clearing it restores all rows.
- [ ] With more than 10 spec files, pagination controls appear and navigate correctly.
- [ ] Clicking "▶ Run skill" on a spec card, picking a skill, and confirming starts a session
  visible in the live run panel and the Sessions view. The spec file on disk is unchanged.
- [ ] Clicking a spec row opens the `SpecSidebar`; the spec markdown is rendered; picking a skill
  and clicking "▶ Run skill" (or pressing `⌘↵`) starts a session on the spec card.
- [ ] Dragging a spec row onto a phase column opens a skill picker for that phase; confirming
  creates a new board card in that column, starts a run on it, and leaves the spec file unchanged.
- [ ] A project with no `docs/specs/` directory shows no Specs section.
- [ ] `npm run typecheck` and `npm test` pass.

---

## Known Bugs

- **Sort direction inverted** (`server/src/aiwf.ts` line 435): the comparator reads
  `keyNum(b.key) - keyNum(a.key)` (descending) but should be `keyNum(a.key) - keyNum(b.key)`
  (ascending), consistent with `listCards` and the comment above. Fix: swap `a` and `b`.
  The ascending sort test above will catch a regression if this is re-introduced.

---

## Out of Scope

- Scanning `docs/roadmap/` (phase files) — spec files are the atomic work units; roadmap phases
  are milestones. Can be added later if needed.
- Scanning other locations (e.g. `docs/tasks/`, `.aiwf/tasks/`).
- Editing, archiving, deleting, or transitioning spec cards from Hangar.
- Two-way sync: writing Hangar run history back into the spec file's frontmatter.
