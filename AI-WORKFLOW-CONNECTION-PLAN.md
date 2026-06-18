# Plan: AI Workflow connection (self-hosted, Claude-run, dedicated view)

## Context

Today Hangar's only work source is **Jira**. We want a second **connection** —
`0xrafasec/ai-workflow` (aiwf), a spec-driven-development toolkit — for **self-hosted, Jira-free
projects** (e.g. `~/dev/thalissonbarbosa/dynamiccore`, currently an empty Gemini repo we'd set up
from scratch).

"Connections" is the top-level idea: `Jira` shows today's boards/settings unchanged; `AI Workflow`
shows your self-hosted aiwf projects in a **dedicated view** — a **normal kanban board** that also
**guides you through the aiwf methodology**.

> **Supersedes the earlier "local board" plan.** That abstraction only ever did one necessary job —
> store work items when there's no Jira — which is now an _internal detail_ of this connection, not a
> separate user-facing feature.

### Decisions locked (from the user)

1. **Executor = Claude.** Hangar's existing `@anthropic-ai/claude-agent-sdk` engine runs the aiwf
   skills. No Gemini/multi-engine work. A Gemini repo's `GEMINI.md` is just context Claude reads;
   setup can also drop a project `CLAUDE.md`.
2. **Install = detect + one-click (confirmed).** Hangar detects aiwf; if missing, a button runs the
   installer after explicit confirmation. Hangar mutates `~/.claude` only on click.
3. **UI = a dedicated AI Workflow view**, distinct from the Jira board.
4. **Columns = a normal dev kanban** (configurable), defaults: `Ready for Development → In Progress →
In Review → Testing → Done`. The aiwf _phases_ are NOT columns — they're guidance.
5. **Guidance = both** project onboarding (seeds the backlog) **and** per-card, stage-aware skill
   suggestions.
6. **Card storage = in the target repo** (markdown files), alongside the aiwf docs the skills produce.

### Key facts about aiwf that shape the design

- aiwf installs **globally into `~/.claude/`** (`skills/`, `agents/`, `commands/`, `CLAUDE.md`,
  `settings.json`) + an `aiwf` launcher in `~/.local/bin/`. Bootstrap:
  `curl -fsSL https://raw.githubusercontent.com/0xrafasec/ai-workflow/main/bootstrap.sh | bash`.
- **Hangar already reads `~/.claude/skills`** (`server/src/skills.ts`) — once aiwf is installed its
  skills (`prd`, `architecture`, `tdd`, `security`, `roadmap`, `spec`, `feature`, `fix`, `autopilot`,
  `factory`, `new-project`, `review`, `sec-review`, `commit`, `pr`, `design`, `verify-design`) are in
  the registry for free.
- **`/new-project`, `/prd`, `/roadmap`… are skills** → both project setup and per-card actions are
  just `kind: "skill"` runs through the existing engine, streamed in the existing RunPanel.

## How the board works

### Columns (configurable kanban)

Per project: `columns: string[]`, default `["Ready for Development","In Progress","In Review",
"Testing","Done"]`. Cards move between columns via drag-and-drop (existing Board UI).

### Cards = markdown in the repo

Stored at `<repoPath>/.aiwf/board/*.md`, one file per card, flat frontmatter + body (mirrors the
existing parser in `agents.ts:11` / `skills.ts:6`, plus a writer):

```markdown
---
key: DC-1
title: Implement login endpoint
status: Ready for Development
pr: https://github.com/...
---

Acceptance criteria / context (becomes the agent prompt body).
```

A card maps onto the existing `Ticket` shape (`key`, `summary`=title, `status`, `boardKey`=projectId,
`url?` empty, `description`=body, `source:"aiwf"`), so runs/worktrees/RunPanel work unchanged.

### Guidance — level 1: project onboarding (seeds the backlog)

The setup wizard walks the planning arc as a guided checklist, each step a one-click skill run:
`/prd → /architecture → /roadmap`. The **`/roadmap` run is prompted to also write one board card
per task** into `.aiwf/board/` in our card schema — so the backlog is seeded directly by the agent
(robust; no parsing of aiwf's internal doc format). `/new-project` (new) or an adopt flow runs first.

### Guidance — level 2: per-card, stage-aware skills

A configurable `COLUMN_SKILLS` map (defaults below) filters each card's action menu to the skills that
fit its column. Picking one starts a `kind:"skill"` run against that card.

- Ready for Development: `spec`, `feature`, `design`
- In Progress: `feature`, `fix`
- In Review: `review`, `sec-review`
- Testing: `verify-design`, `fix`
- Done: `commit`, `pr`

## Server changes (`server/src/`)

### New: `aiwf.ts`

- Constants: `DEFAULT_COLUMNS`, `COLUMN_SKILLS`, `ONBOARDING_STEPS` (the planning arc) — single source
  of truth, mirrored to the web.
- `detectAiwf()` → `{ installed, aiwfBin, version?, skillsFound }`: check `~/.local/bin/aiwf` (run
  `aiwf status`/`version` if present) and/or core aiwf skill folders in `~/.claude/skills`. Reuse
  `expandHome`.
- `installAiwf()` → run the bootstrap one-liner via `child_process` (only from the confirmed route);
  return refreshed `detectAiwf()`.
- Card storage (the absorbed local-board mechanism, now internal): `boardDir(project)` =
  `<repoPath>/.aiwf/board`; `listCards`, `createCard`, `transitionCard` (read/write the markdown).

### `types.ts` + `config.ts`

- New top-level config: `aiWorkflow?: { projects: AiwfProject[] }`,
  `AiwfProject = { id, name, repoPath, columns?, createdAt }`. Add to `validateConfig` (light) and the
  `saveConfig` whitelist so it persists.
- `Ticket`: make `url` optional, add `description?` and `source?` (used for aiwf cards).
- `sessions.ts` `buildPrompt` (`sessions.ts:234`): genericize "Jira ticket" → "ticket" and append
  `ticket.description` when present.

### `index.ts` routes (new, `/api/aiwf/*`)

- `GET /api/aiwf/status` → `detectAiwf()` + the column/skill presets.
- `POST /api/aiwf/install` → `installAiwf()` (client confirms first).
- `GET/POST /api/aiwf/projects` → list / register `{ name, repoPath, mode:"new"|"adopt" }`; on register,
  create `.aiwf/board/` and return any kicked-off setup `runId`.
- `GET/POST /api/aiwf/projects/:id/cards` and `POST .../cards/:key/transition` → board CRUD over the
  markdown store.
- `POST /api/aiwf/projects/:id/onboard/:step` → start an onboarding skill run (`prd`/`architecture`/
  `roadmap`/`new-project`) via the existing `startRun`.
- Card skill assignment reuses the existing `POST /api/runs` (pass the card as the `ticket`).

### Reused as-is

`sessions.ts` (runs/worktrees/SSE), `store.ts`, `worktree.ts`, the skill registry, `RunPanel`. No
engine changes.

## Web changes (`web/src/`)

### `App.tsx`

Extend `type View` (`App.tsx:35`) with `"aiworkflow"`; add a topbar nav button and a conditional
render of a new `AiWorkflowView` (mirrors how `sessions`/`run` mount). Reuse `activeRun`/`RunPanel`,
`assign`/`startRun`, and the 2s run polling.

### New: `components/AiWorkflow.tsx`

- **Install banner** — `api.aiwfStatus()`; if not installed, button → confirm → `api.aiwfInstall()`.
- **Project list + setup wizard** — "＋ New project": pick a repo path (reuse `/api/fs/exists` +
  `PathsEditor`), choose _new_ vs _adopt_, submit → `api.createAiwfProject(...)` → open the setup run
  in `RunPanel`.
- **Onboarding guide** — a checklist of `ONBOARDING_STEPS` (PRD → Architecture → Roadmap); each step a
  button that starts the skill run; the roadmap step seeds cards, then the board fills in.
- **Kanban board** — the project's configurable columns over its cards (reuse `Board`/column +
  drag-and-drop). Each card's action menu = `COLUMN_SKILLS[card.status]`; selecting one calls
  `assign(cardKey, skillName, "skill")`.

### `api.ts` + `types.ts`

Add wrappers `aiwfStatus`, `aiwfInstall`, `aiwfProjects`, `createAiwfProject`, card list/create/move,
`onboardStep`. Mirror the new types and the column/skill presets (or fetch them from `/api/aiwf/status`).

## Out of scope

- Gemini (or any non-Claude) executor.
- Cursor/Codex install targets (Claude only).
- Auto-parsing aiwf's roadmap/spec doc formats — v1 seeds cards by instructing the roadmap run to
  emit them in our schema, rather than reverse-engineering aiwf's files.
- A generic Jira-less board for non-aiwf use (folded away; can re-surface later if wanted).

## Verification

1. `npm run typecheck` (server + web) — the gate.
2. `GET /api/aiwf/status` is correct with and without aiwf installed; one-click install flips it to
   installed (confirm `~/.claude/skills/prd` etc.).
3. Set up `~/dev/thalissonbarbosa/dynamiccore` as a _new_ project → a `new-project` run launches in the
   RunPanel and `.aiwf/board/` is created in the repo.
4. Run the onboarding `/roadmap` step → board cards appear as `.aiwf/board/*.md` in the repo and render
   in the `Ready for Development` column.
5. A card in `In Review` offers `review`/`sec-review` (not Planning skills); assigning one starts a run
   in the repo's worktree; dragging a card persists its `status` to the file.
6. Jira boards and `HANGAR_DEMO=1` are unaffected (the connection is purely additive).
7. Document the new connection + config section in `README.md` and `hangar.config.example.json`.
