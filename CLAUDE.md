# Hangar

A mouse-driven board that turns Jira tickets into Claude Code agent sessions. A React board
shows Jira tickets as Kanban columns; assigning an agent/skill to a card spawns a Claude Code
session via `@anthropic-ai/claude-agent-sdk` and streams it back live.

See `README.md` for the user-facing feature tour, `docs/` for detailed guides (e.g.
`docs/ai-workflow.md`), and `../Hangar-SPEC.md` for the full plan.

## Layout

```
hangar/
  hangar.config.json          # boards (Jira keys, columns), agentsDir, run settings — hot-reloaded
  hangar.config.example.json  # committed template; copy to hangar.config.json (the real one is gitignored)
  .env                        # Jira creds + PORT (copy from .env.example; never commit)
  .hangar/                    # runtime data dir (gitignored): runs/ and workflows/ JSON records
  server/                     # Node + TypeScript + Express: Jira adapter, agent/skill registry, SDK runner
  web/                        # React + Vite + TypeScript: the board UI
```

This is a monorepo with three `package.json`s: root (orchestration scripts only), `server/`,
and `web/`. Workspaces are NOT used — each installs into its own `node_modules`.

## Commands

Run from the repo root:

- `npm run install:all` — install server + web deps (root deps come from a plain `npm install`)
- `npm run dev` — start server (`:3001`) and web (`:5180`, override with `WEB_PORT`) via `concurrently`
- `npm run dev:server` / `npm run dev:web` — run one side alone
- `npm run typecheck` — `tsc --noEmit` across server + web. **Run this after any change** — there
  is no test suite yet, so typecheck is the gate.
- `npm run watch` — typecheck both sides in watch mode

The web dev server proxies `/api` to the server port, so always have the server running too.

**Demo mode** — `HANGAR_DEMO=1 npm run dev` runs with a fictional board + seeded sessions and
no Jira. It's fully self-contained: `config.ts` synthesizes `demoConfig()` and never reads or
writes the real `hangar.config.json`/`.env` (saves are guarded). Implemented in
`server/src/demo.ts` (demo board, fake tickets, run seeds); `seedDemoRuns()` in `sessions.ts`
loads the seeds in-memory only (never persisted). Used for credential-free trials and screenshots.

## Server architecture (`server/src/`)

- `index.ts` — Express app and all routes (`/api/*`), including the SSE stream at
  `/api/runs/:id/stream`. Read endpoints (config/agents/skills/tickets) + write endpoints
  (config, Jira settings, runs, workflow runs).
- `config.ts` — loads/validates/saves `hangar.config.json` (path overridable via `CONFIG_PATH`),
  resolves the repo root, reads/writes `.env` (Jira creds), exposes `PORT`. Config is held in
  memory and hot-swapped on save — no restart needed.
- `types.ts` — shared types. `HangarConfig`, `BoardConfig`, `WorkflowConfig`, `Agent`, `Skill`,
  `Ticket`, run/record shapes. **Source of truth — start here when adding a field.**
- `jira.ts` — Jira Cloud REST adapter (Basic auth: email + API token). One JQL per board.
- `agents.ts` / `skills.ts` — parse `~/.claude/agents/*.md` and `~/.claude/skills` (plus repo
  skills) into the fleet shown in the assign menu.
- `sessions.ts` — the core: builds SDK `query()` options, runs sessions in streaming-input mode,
  gates tools, injects per-run env, emits events to listeners. See "Run model" below.
- `store.ts` — persists each run/workflow as one JSON file under the data dir (`.hangar/`,
  overridable via `HANGAR_DATA_DIR`) so transcripts/results survive restarts.
- `worktree.ts` — creates/removes a git worktree per run on a `hangar/<label>-<id>` branch.
- `workflows.ts` — runs a board's multi-step agent/skill pipelines.

## Run model (the important part)

When a ticket is assigned an agent/skill, `sessions.ts` spawns a `query()`:

- **System prompt = the agent's `.md` body**; model from its `model:` frontmatter. Skills run a
  generic session with `~/.claude` loaded so the skill is available.
- **Working dir** = the board's first `repoPath`/`repoPaths` entry; the rest become the SDK's
  `additionalDirectories` (cross-repo access in one session).
- **Isolation** (config `isolateRuns`, default on): each run executes in its own git worktree +
  branch so parallel runs on one repo don't clobber each other. Non-git paths run in place.
- **Per-run env** injected into every session so parallel Docker/compose stacks don't collide:
  `COMPOSE_PROJECT_NAME=hangar-<id>`, `HANGAR_RUN_ID`, `HANGAR_PORT_OFFSET`. (These were renamed
  from `FLEETVIEW_*` — keep the `HANGAR_` prefix.)
- **Permission mode** (config `bypassPermissions`, default true = unrestricted). When gated,
  reads/edits and read-only shell auto-run; mutating or unrecognized shell pauses for Allow/Deny.
  Tunable via `AUTO_ALLOW_TOOLS` + `isSafeBashCommand` in `sessions.ts` (conservative: `$(…)`,
  backticks, `>` redirection, or unknown command → gated).
- **Exclusive runtime** (config `exclusiveAgents`): names that boot Docker/bind fixed ports/use a
  shared tunnel run one at a time (others queue); code-only agents stay parallel.
- **Limits** (config `maxTurns` default 300, optional `maxBudgetUsd`).

Runs are streamed token-by-token (`includePartialMessages`) over SSE and also persisted via
`store.ts`. **Auth uses the host's existing Claude Code login / `ANTHROPIC_API_KEY`** — Hangar
does not manage its own key.

## Web (`web/src/`)

- `App.tsx` — top-level board + topbar + view switching.
- `api.ts` — typed fetch wrappers for every `/api` endpoint; `types.ts` mirrors server types.
- `components/` — `Board`, `RunPanel` (live SSE stream), `SessionsView`, `Settings`,
  `SkillRunner`, `HandoffModal`, `NoteModal`, `WorkflowsBar`, `Markdown`, `Avatar`.
- `useTheme.ts`, `styles.css` — styling. Icons come from `lucide-react`.

## Conventions & gotchas

- **Match the existing style**: 2-space indent, double quotes, terse explanatory comments that
  state the _why_. No formatter/linter is configured — mirror surrounding code.
- **Naming**: the product is **Hangar**. The old name was FleetView — do not reintroduce it.
  The folder is `hangar/`, config is `hangar.config.json`, data dir `.hangar/`, injected env is
  `HANGAR_*`, and worktree branches are `hangar/…`.
- Adding a config field: update the `HangarConfig` type, `validateConfig`/`saveConfig` in
  `config.ts`, the Settings UI, and `README.md`.
- Adding an API route: define it in `index.ts`, add a typed wrapper in `web/src/api.ts`, and keep
  `web/src/types.ts` in sync with `server/src/types.ts`.
- Never commit `.env`, `hangar.config.json`, or anything under `.hangar/` — all gitignored
  (secrets / personal board config / runtime data). Ship changes to the committed templates
  (`.env.example`, `hangar.config.example.json`) instead.
- **PR titles**: plain sentence case, no type prefix. Write `Fix open-PR preference in dev-status`,
  not `bugfix: Fix open-PR preference` or `feat/my-branch: Fix open-PR preference`.
- **Changelog (required)**: always add the current change to `CHANGELOG.md`. Put it under
  `[Unreleased]` while iterating, or directly under a new version heading when finishing the PR.
  One entry per PR, in a Keep a Changelog category (Added / Changed / Fixed / Removed), and bump the
  root `package.json` `version` to match (MINOR for a notable feature, PATCH for a small change —
  see the versioning note at the top of `CHANGELOG.md`). There are no releases/tags; the changelog
  is the record.
- **Docs live in `docs/`** — all documentation goes there, except this `CLAUDE.md` and the root
  `README.md` / `CHANGELOG.md`. Keep `README.md` a lean overview that links into `docs/`; don't add
  new standalone doc files to the repo root.
- **AI Workflow doc (required)**: whenever you change the AI Workflow connection — its routes, board
  model, phases/skills, config shape, install flow, or card format — update `docs/ai-workflow.md` in
  the same change.
- No automated tests exist yet — verify changes with `npm run typecheck` and, where it matters, by
  running `npm run dev` and exercising the flow in the UI.
