<div align="center">

<img src="web/public/favicon.svg" width="76" alt="Hangar logo" />

# Hangar

**A mouse-driven board that turns Jira tickets into Claude Code agent sessions.**

Pull your Jira tickets onto a Kanban board, assign an agent or skill to a card, and watch a
real [Claude Code](https://claude.com/claude-code) session run — streaming live, isolated per
run, with a human in the loop when it matters.

<img src="docs/screenshots/board.png" alt="The Hangar board" width="880" />

</div>

---

## Highlights

- **Your Jira, as a board** — tickets stream in live as Kanban columns, across multiple
  projects. Filter by assignee or text, and drag a card between columns to transition the issue.
- **Launch an agent on a ticket** — pick from your `~/.claude/agents` and `~/.claude/skills`,
  optionally add a note, and run. The session runs in that board's repo (with extra repos accessible
  in the same session for cross-repo work).
- **Live run panel** — live output, tool calls, the captured session id and running
  cost, an auto-detected PR link, and an **Open in terminal** button for finished sessions
  (set up in **Settings → Terminal**).
- **Usage cost panel** — a topbar button shows Claude Code session costs (requires
  [ccusage](https://github.com/ryoppippi/ccusage)) broken down by day, month, and billing block.
- **Human-in-the-loop** — run unrestricted, or _gated_: reads and edits auto-run while risky
  shell commands pause for approval. Agent questions surface right in the panel with answer buttons.
- **Run isolation** — each run gets its own git worktree + branch, so multiple agents work the
  same repo in parallel without clobbering each other. Per-run env namespaces Docker/compose
  stacks; an _exclusive runtime_ list serializes agents that need shared ports/tunnels.
- **Workflows & handoffs** — chain agents/skills into per-board pipelines, or hand one run's
  result straight to another agent.
- **No credentials? No problem** — a built-in [demo mode](#demo-mode) runs the whole thing on a
  fictional board with seeded sessions.

## Demo mode

Try Hangar with **no Jira and no config** — a fictional board with seeded sessions:

```sh
HANGAR_DEMO=1 npm run dev
```

Open **http://localhost:5180**. Your real config and credentials are never read or written in
this mode. (This is exactly how the screenshots in this README were produced.)

## Quick start

**Requirements:** Node 18+, and a working [Claude Code](https://claude.com/claude-code) login
(or an `ANTHROPIC_API_KEY`) — sessions use your existing auth.

```sh
git clone https://github.com/thalissonbarbosas/hangar.git
cd hangar
npm install            # root tooling (concurrently)
npm run install:all    # server + web dependencies
```

Then either explore in **[demo mode](#demo-mode)**, or connect your own Jira:

```sh
cp .env.example .env                               # add your Jira base URL, email, API token
cp hangar.config.example.json hangar.config.json   # or just configure boards in the UI
npm run dev                                         # server :3001 + web :5180
```

Open **http://localhost:5180** and click **⚙ Settings** to finish setup:

- **Jira connection** — base URL, email, and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens),
  with a **Test** button. Saved to `.env` (the token is write-only — never sent back to the browser).
- **Boards & agents** — add boards, edit project key / name / repo paths, and edit the column
  statuses. **Pull projects / statuses from Jira** discovers real values. Saved to
  `hangar.config.json` and hot-reloaded — no restart.

A ticket whose status isn't in a board's column list lands in an `(unmapped)` column, so nothing
silently disappears. The board still loads (columns + agents) before Jira is configured.

## Security & deployment

Hangar is a **single-operator, localhost-only tool**. It has no authentication layer — any client
that can reach port 3001 can start agent sessions, read run transcripts, and modify settings.

- **Do not expose port 3001** to your LAN, a cloud host, or the internet.
- Multi-user setups are not supported (the server uses single-process in-memory state).
- Run transcripts saved under `.hangar/runs/` are plain JSON and may contain file contents read by
  agent sessions during a run — treat them as sensitive.

## A look around

**Live agent session** — streaming output, tool calls, the worktree branch, session id, and cost:

<img src="docs/screenshots/running.png" alt="A live agent session" width="880" />

**Human-in-the-loop** — the agent asks; you answer inline (gated mode pauses risky tools the same way):

<img src="docs/screenshots/wait-input.png" alt="An agent awaiting input" width="880" />

**A finished run** — the result, captured session id, cost, and the auto-detected PR link:

<img src="docs/screenshots/done.png" alt="A finished agent session" width="880" />

**Sessions view** — every run, grouped by project with a tab bar, with state, model, age, cost, a
PR link when one was opened. **Resume** continues a finished session in-app; **Open in terminal**
hands it off to your shell (set it up in **Settings → Terminal**):

<img src="docs/screenshots/sessions.png" alt="The sessions view" width="880" />

Prefer a terminal aesthetic? **Settings → Session theme** switches the live session stream
between a monospace **Terminal** console (the default) and the **Classic** chat-style feed.

**Configure everything in the UI** — boards, columns, repo paths, and agents, no file editing required:

<img src="docs/screenshots/settings.png" alt="Settings" width="880" />

## How it works

A small monorepo:

```
hangar/
  server/   # Node + TypeScript + Express: Jira adapter, agent/skill registry, the SDK runner
  web/      # React + Vite + TypeScript: the board UI
```

The server talks to Jira via the REST API (one JQL per board) and spawns Claude Code sessions
with [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).
When you assign an agent to a ticket, its `.md` body becomes the system prompt and its
`model:`/`tools:` configure the run; the run executes in the board's repo path. The web app
streams each session over SSE into the run panel.

Run records persist as JSON under `.hangar/` so transcripts and results survive a restart.

### Connections: Jira and AI Workflow

The topbar has a **connection switcher**. **Jira** (the default) shows your project boards + filters.
**AI Workflow** is a **self-hosted** source for projects that use
[ai-workflow](https://github.com/0xrafasec/ai-workflow) (by [0xrafasec](https://github.com/0xrafasec))
instead of a tracker: Hangar detects/installs the toolkit, sets up a project, and gives it a
phase-lifecycle board (`Planning → Design → Implementation → Review → Delivery → Complete`) whose cards
are work threads stored in the repo. Runs are executed by Claude (the existing engine). Each project
chip can be edited to change its name or location (the repo path) in place. Cards support per-card
**archive**, **delete**, and **see data** actions via a `⋯` menu; a **checkout** action switches
the project root to the card's task branch. A **Worktrees** button in the board header lists and
removes stale task branches. A **📖 Skills guide** button in the sub-bar shows every aiwf skill
by phase tab, with install status and descriptions. A **doc tree sidebar** on the left of the AIWF
board shows the project's PRD, architecture doc, roadmap, and specs — click any entry to open it in
a doc panel alongside the board.

**→ Full guide: [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md).**

### Configuration

`hangar.config.json` (see [`hangar.config.example.json`](hangar.config.example.json)):

| Field                       | Meaning                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `agentsDir`                 | where to read agents (default `~/.claude/agents`)                                                     |
| `boards[]`                  | `key` (Jira project), `name`, `statuses` (column order), `repoPaths`, optional `agents` / `workflows` |
| `aiWorkflow.projects[]`     | self-hosted AI Workflow projects: `id`, `name`, `repoPath`, optional `columns`, `createdAt`           |
| `bypassPermissions`         | `true` = unrestricted; `false` = gated (approve risky shell)                                          |
| `isolateRuns`               | run each session in its own git worktree + branch (default on)                                        |
| `exclusiveAgents`           | agent/skill names that need shared ports/tunnels — run one at a time                                  |
| `maxTurns` / `maxBudgetUsd` | per-run limits (default 300 turns, no spend cap)                                                      |
| `runRetentionDays`          | auto-delete finished runs older than N days on startup; unset = keep forever                          |
| `terminal`                  | "Open in terminal" command template (`{{dir}}` + `{{command}}` placeholders); unset = action warns    |

Environment (`.env`, see [`.env.example`](.env.example)): `JIRA_BASE_URL`, `JIRA_EMAIL`,
`JIRA_API_TOKEN`, optional `JIRA_MY_TICKETS_ONLY`, `PORT`, and `HANGAR_DEMO`.

## Scripts

```sh
npm run dev          # server + web together
npm run dev:server   # server only (:3001)
npm run dev:web      # web only (:5180)
npm run typecheck    # tsc --noEmit across server + web
npm run screenshots  # capture README screenshots from demo mode (requires: npx playwright install chromium)
```

The UI port defaults to **5180** and is configurable — set `WEB_PORT` in `.env` (the proxy to the
server follows `PORT`). For example, `WEB_PORT=8080` serves the UI on http://localhost:8080.

## Permissions & safety

Fresh installs default to **gated** mode — reads and file edits auto-run while mutating or
unknown shell commands pause for an explicit Allow/Deny. **Unrestricted** mode (Settings →
Agent permissions) removes all approval prompts, like `claude --dangerously-skip-permissions`.
A topbar flag makes the current mode visible. Run Hangar against repos you trust.

## License

[MIT](LICENSE) © Thalisson Barbosa
