# Feature: Running a skill on a spec creates a board task

## Trunk Metadata

- **Type:** feat
- **Flag:** `none`
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-aiwf-spec-run-creates-task`
- **Ticket:** HAN-10 — Create a task for a SPEC when running a skill

### Why one PR

The web convergence (route the three spec "Run skill" entry points through one
promote-then-run helper) and the server branch-preservation fix are a single vertical slice:
promotion without branch preservation regresses the documented semantic-branch behavior, and the
branch fix has no user-visible value without promotion. Estimated diff ~180 lines incl. tests.

---

## Problem

Spec files in a project repo (`docs/specs/NNN_*.md`) surface on the AI Workflow board as read-only
`SPEC-NNN` cards in the **Specs (N)** section (spec 006). There are three ways to run a skill on
one:

1. **"▶ Run skill"** on a spec row → opens the Implementation skill picker → runs the skill **on
   the read-only `SPEC-NNN` card directly**.
2. **SpecSidebar "▶ Run skill"** → same: runs on `SPEC-NNN` directly.
3. **Drag-to-promote** onto a phase column → **creates a real board card** (`kind: "thread"`,
   copying the spec's title + description) and runs the skill on it.

Paths (1) and (2) leave **nothing on the board**: the run targets the read-only spec key, so
`appendCardHistory` no-ops (there is no board card file for `SPEC-*`), no card appears in a phase
column, and the work has no visible home or accruing history. The operator must remember to use
drag-to-promote to get a tracked card. Per HAN-10: *running a skill for a spec should create a task
that shows on the board, and start the session from that created task* — i.e. all spec runs should
behave like drag-to-promote.

A second, subtler problem: spec runs of delivery skills currently get a **semantic git branch**
derived from the spec filename — `feat/<spec-slug>` via `branchFromSpec` (because
`resolveTaskWorktree` resolves a spec path from the `SPEC-*` key). A promoted board card keyed
`DC-7` would instead get `feat/dc-7` from `branchForCard`, regressing the behavior documented in
`docs/ai-workflow.md` ("a semantic branch derived from the spec's filename"). The promoted card
already carries the spec's `Spec: <path>` description prefix, so the server can recover the
semantic branch from it.

---

## Solution

**Web — converge all three paths on promote-then-run.** Extract one helper,
`promoteSpecAndRun(specKey, phase, skill, note)`, that the spec row button, the SpecSidebar, and
the drag-to-promote confirm all call. It:

1. Looks up the spec card by `specKey` and reads its `Spec: <relPath>` header line.
2. **Dedup:** finds an existing non-archived board card whose description starts with the same
   `Spec: <relPath>` line. If found, runs the skill on **that** card (history accumulates in one
   place). Otherwise creates a new `kind: "thread"` board card in `phase` (default
   `"Implementation"`), copying the spec's `summary` → title and full `description` (with the
   `Spec:` prefix), reloads cards, and runs the skill on the new card.

The board now shows a task for the spec, and the session is started from that task — for the row
button, the sidebar, and drag alike.

**Server — preserve the semantic branch through promotion.** `resolveTaskWorktree` learns to
resolve the source spec from a **non-`SPEC-` card's description** (its `Spec: <relPath>` line) and
keep deriving `feat/<spec-slug>` via `branchFromSpec`. So `/feature`, `/commit`, `/pr` on the
promoted card land on the same semantic branch they would have on the spec card today.

The server's existing `getSpecCard` fallback in the run route is **left intact** (API contract /
safety net) — the web simply no longer drives a run with a raw `SPEC-*` key.

---

## Technical Design

### Web board (`web/src/components/AiWorkflow.tsx`)

#### New helper — `promoteSpecAndRun`

Replaces the body of the existing `confirmPromote` and becomes the single entry point:

```ts
// First line of a spec/promoted-card description, e.g. "Spec: docs/specs/014_foo.md".
function specLine(desc?: string): string | null {
  const first = (desc ?? "").split("\n", 1)[0];
  return /^Spec:\s+\S/.test(first) ? first : null;
}

// Create-or-reuse a board task for a spec, then run the skill on it.
function promoteSpecAndRun(specKey: string, phase: string, skill: string, note?: string) {
  const specCard = specCards.find((c) => c.key === specKey);
  if (!specCard) return;
  const line = specLine(specCard.description);
  const existing = line
    ? cards.find((c) => c.kind !== "spec" && !c.archived && specLine(c.description) === line)
    : undefined;
  if (existing) {
    runCard(existing.key, skill, note); // reuse — accumulate history on one card
    return;
  }
  api
    .createAiwfCard(project!.id, {
      title: specCard.summary,
      status: phase,
      kind: "thread",
      description: specCard.description, // includes the "Spec: <path>" prefix
    })
    .then((r) => {
      loadCards(project!.id);
      runCard(r.ticket.key, skill, note);
    })
    .catch((e) => onError(String(e.message ?? e)));
}
```

#### Wire the three entry points

- **Spec row button** (`SpecCardsSection`): unchanged — `onRunSkill` still opens the picker via
  `setPicker({ key: specKey, phase: "Implementation" })`. The change is in the **picker's
  `onRun`** (line ~570): branch on the key —

  ```ts
  onRun={(skill, note) => {
    if (picker.key.startsWith("SPEC-")) promoteSpecAndRun(picker.key, picker.phase, skill, note);
    else runCard(picker.key, skill, note);
    setPicker(null);
  }}
  ```

- **SpecSidebar `onRun`** (line ~623): replace `runCard(specSidebar.key, …)` with
  `promoteSpecAndRun(specSidebar.key, "Implementation", skill, note)` (then `setSpecSidebar(null)`).

- **Drag-to-promote** (`confirmPromote`, line ~436): re-implement as a thin wrapper —
  `const { specKey, phase } = pendingPromote; setPendingPromote(null);
  promoteSpecAndRun(specKey, phase, skill, note);` (preserves the drag's chosen target phase, and
  now dedups too).

No CSS, no new components, no API-wrapper changes (reuses `createAiwfCard` + `aiwfRunCard`).

### Server (`server/src/aiwf.ts`)

#### New helper — resolve a spec path from a card description

```ts
/** Resolve the absolute spec path from a promoted card's "Spec: <relPath>" description line.
 *  For sliced specs the relPath points at README.md; return the parent directory so
 *  branchFromSpec derives the directory slug (matching specAbsPath's sliced-spec behavior). */
function specPathFromDescription(project: AiwfProject, description?: string): string | null {
  const m = (description ?? "").split("\n", 1)[0].match(/^Spec:\s+(.+\.md)\s*$/);
  if (!m) return null;
  let abs = path.join(expandHome(project.repoPath), m[1].trim());
  if (path.basename(abs) === "README.md") abs = path.dirname(abs); // sliced spec → directory
  if (!fs.existsSync(abs)) return null;
  return abs;
}
```

#### `resolveTaskWorktree` — use it for non-`SPEC-` cards

`resolveTaskWorktree` needs the card description. Add an optional `description` param (the run
route already holds `card`), and resolve the spec path from either source:

```ts
export async function resolveTaskWorktree(
  project: AiwfProject,
  cardKey: string,
  skill: string,
  description?: string,
): Promise<{ cwd: string; branch: string } | null> {
  if (!DELIVERY_SKILLS.has(skill)) return null;
  const repoRoot = expandHome(project.repoPath);
  const specPath = cardKey.startsWith("SPEC-")
    ? specAbsPath(project, cardKey)
    : specPathFromDescription(project, description);
  return resolveCardWorktree(`aiwf-${project.id}`, cardKey, skill, repoRoot, specPath);
}
```

`branchForCard(skill, cardKey)` stays the fallback inside `resolveCardWorktree` when `specPath` is
null (board cards with no spec origin — unchanged behavior).

### Server route (`server/src/index.ts`)

In `POST /api/aiwf/projects/:id/cards/:key/run`, pass the card's description through:

```ts
const taskWt = await resolveTaskWorktree(p, card.key, skill, card.description);
```

No other route changes. Spec-key mutation guards, the `getSpecCard` run fallback, and the
Complete-transition spec-state reset all stay as-is.

### Architecture

No new components, routes, types, or config fields. The change reuses the existing card-create,
card-run, and task-worktree machinery (see `docs/ai-workflow.md` → *The phase board*,
*Task isolation*, *Execution model*).

---

## Security Considerations

No new attack surface. The promoted card's title and description are copied from a spec file in the
project's own `repoPath` (operator-trusted; see spec 006's analysis). `specPathFromDescription`
resolves only paths that (a) match `Spec: <relPath>.md`, (b) join under the operator-registered
`repoPath`, and (c) already exist on disk; it is used solely to derive a git branch name, never to
read or write the file. No user-supplied data flows in beyond the skill name and optional note,
both already accepted by the existing run/create routes. Spec files remain read-only — the spec
card itself is never mutated; only a separate board card is created.

---

## Feature Flag

`None` — user-ready on merge. The Specs section already only appears when `docs/specs/` exists, and
the behavior change is confined to the spec "Run skill" / promote paths.

---

## Verification Criteria

### Unit Tests (`server/src/__tests__/aiwf.test.ts`)

- [ ] `resolveTaskWorktree(project, "DC-7", "feature", "Spec: docs/specs/014_foo.md\n\n…")` →
  branch `feat/<foo-slug>` (semantic, from `branchFromSpec`), **not** `feat/dc-7`.
- [ ] `resolveTaskWorktree(project, "DC-7", "feature", "Spec: docs/specs/006_bar/README.md\n…")`
  (sliced spec) → branch derived from the **directory** slug (`feat/<bar-slug>`), confirming the
  README.md → parent-directory normalization.
- [ ] A board card whose description has **no** `Spec:` line → falls back to `branchForCard`
  (`feat/dc-7` for `feature`, `fix/dc-7` for `fix`) — unchanged behavior.
- [ ] `resolveTaskWorktree` with a non-delivery skill → still returns `null` (runs in place).

### Integration Tests (`server/src/__tests__/index.aiwf.test.ts`)

- [ ] `POST .../cards/:key/run` on a board card whose description carries a `Spec:` line, with a
  delivery skill, starts a run on the semantic branch (assert via the same worktree/branch hook the
  existing spec-card worktree tests use).
- [ ] Existing spec-card run tests (`SPEC-007` worktree/branch) still pass — the `getSpecCard`
  fallback and `specAbsPath` path are untouched.

### E2E / Manual

- [ ] With a project whose repo has `docs/specs/NNN_*.md`, click **▶ Run skill** on a spec row,
  pick a skill, confirm → a **new board card** appears in the **Implementation** column (title =
  spec title) and a session starts on it (visible in the run panel + Sessions view). The spec file
  and the `SPEC-NNN` card are unchanged.
- [ ] Run a skill on the **same** spec a second time (row button or sidebar) → **no** new card is
  created; the session starts on the existing promoted card and a new history entry is appended to
  it.
- [ ] Open the **SpecSidebar** for a spec, pick a skill, **▶ Run skill** (or `⌘↵`) → same
  create-or-reuse behavior as the row button.
- [ ] **Drag** a spec row onto a phase column, pick a skill, confirm → creates/reuses a board card
  in **that** column and runs the skill on it.
- [ ] Run `/feature` then `/commit` on a promoted card → both land on `feat/<spec-slug>` (one shared
  task worktree), matching the pre-promotion branch name. `git worktree list` shows the semantic
  branch, not `feat/<card-key>`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, and `npm run format:check` all pass.

---

## Docs

- `docs/ai-workflow.md` — in **Spec tasks**, update the **Run skill** bullet: running a skill on a
  spec card (row button, sidebar, or drag) now **creates a board task** (or reuses the existing one
  for that spec) and starts the session from it. In **Task isolation**, note the semantic branch is
  preserved for the promoted card via its `Spec:` description line. Run `/aiwf-sync` after.
- `CHANGELOG.md` — one **Added** entry under `[Unreleased]`; bump root `package.json` `version`
  (MINOR: `0.5.0` → `0.6.0`).

---

## Out of Scope

- Removing the server's read-only `getSpecCard` run fallback or the direct-run API contract for
  `SPEC-*` keys (kept as a safety net).
- Auto-archiving or hiding the `SPEC-NNN` card once promoted — the spec card stays visible (it is
  scanned live from disk).
- Dedup across **archived** promoted cards (archived cards are ignored; a new card is created).
- Choosing the promotion target phase from the row/sidebar buttons (fixed to `Implementation`;
  drag still honors the dropped column).
- Two-way sync of run history back into the spec file.
