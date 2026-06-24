# Hangar — Product Requirements Document

**Version:** 1.0 (June 2026)
**Author:** Thalisson Barbosa
**Status:** Living document — update when scope, priorities, or constraints change materially.

---

## Problem

Software engineers who use Claude Code daily still have to manually context-switch between their
ticket tracker and their terminal. A ticket arrives in Jira; the engineer reads it, decides which
agent or skill to apply, opens a terminal, composes a prompt, monitors the session, and then
manually links the result back to the ticket. This is entirely mechanical — not judgment work.

The AI Workflow (aiwf) toolkit has the same gap: work threads live in a repo, but launching and
monitoring agent runs on them requires direct CLI access.

**The waste:** The engineer is the plumbing between the ticket and the session, doing coordination
work that a tool should own.

---

## Solution

Hangar is a localhost-only, mouse-driven board that bridges ticket tracking (Jira) and project
threads (AI Workflow) to Claude Code agent sessions.

The core interaction is: **pull ticket → assign agent → watch session run**. Hangar handles the
rest — spawning the session, isolating it in a git worktree, streaming the output live, and
persisting the transcript. The engineer's job is to assign the right agent to the right ticket
and review the result.

Hangar is a **personal workflow tool**, not a platform. It runs on one machine, for one operator,
against repos and accounts that operator trusts. No auth, no multi-tenancy, no SaaS.

---

## Design Principles

These hold regardless of how features evolve:

1. **The board is the trigger, not the workspace.** Hangar launches work; it does not replace
   Jira's planning or management features, nor does it replace the terminal for interactive work.

2. **Agents are plain text.** Agent definitions stay as `.md` files in `~/.claude/agents/`.
   No plugin system, no registry, no Hangar-specific agent format.

3. **Isolation by default.** Every run executes in its own git worktree and branch. Shared-repo
   parallel runs are safe without coordination by the operator.

4. **Human in the loop, always available.** Gated mode — where risky shell commands pause for
   approval — must always be one toggle away. The default may be unrestricted, but the gate must
   be cheap to engage.

5. **Localhost-only, forever.** No hosted variant, no shared instance, no network-accessible
   server beyond `127.0.0.1`. The threat model is: operator's machine, operator's credentials.

6. **Both Jira and aiwf are first-class.** Neither integration mode is a second-class citizen or
   an experiment. Feature parity is a standing goal.

---

## Scope

### In Scope (current + near-term)

- **Jira board** — tickets as Kanban columns, filtered by assignee/text, drag-to-transition,
  assign agent/skill to a card, stream the session live in the run panel.
- **AI Workflow board** — aiwf project cards with phase-lifecycle columns, per-card actions
  (archive, delete, see data), skills guide, card PR links.
- **Agent and skill registry** — reads `~/.claude/agents/*.md` and `~/.claude/skills/`; shown
  in the assign menu with model, tools, and description metadata.
- **Run isolation** — one git worktree + branch per run; `COMPOSE_PROJECT_NAME` / port-offset
  env injection for parallel Docker/compose stacks.
- **Worktree lifecycle management** — worktrees created on run start must be automatically and
  reliably cleaned up on run end (success, failure, or abandonment). Stale branches/worktrees
  must not accumulate. This is the top reliability priority for the near term.
- **Live run panel** — SSE-streamed assistant output, tool calls, session id, cost, PR link
  auto-detection, Open-in-terminal button.
- **Human-in-the-loop** — gated mode pauses risky shell; agent questions surface inline with
  answer buttons.
- **Workflows** — multi-step agent/skill pipelines per board; handoff from one run to another.
- **Persistence** — run transcripts survive restarts (`.hangar/runs/` JSON); session id and
  cost captured per run.
- **Demo mode** — `HANGAR_DEMO=1` runs a fictional board with seeded sessions; zero external
  dependencies, safe for screenshots and onboarding.
- **Settings UI** — configure Jira connection, boards, repo paths, column statuses, permissions,
  and terminal command in-app; hot-reload without restart.

### Out of Scope (hard non-goals)

- **Multi-user / team server** — Hangar is single-operator. No auth layer, no role model, no
  shared-instance deployment. Any feature that assumes multiple simultaneous operators is out.
- **Jira replacement** — issue creation, sprint planning, backlog grooming, roadmap management,
  and reporting stay in Jira. Hangar reads and transitions tickets; it does not manage them.
- **Agent marketplace or plugin registry** — no extension API, no Hangar-specific agent format,
  no curated or hosted agent directory. Agents are `.md` files; the ecosystem lives in Claude
  Code's own conventions.
- **Cloud or SaaS variant** — no hosted Hangar, no remote server, no multi-machine access.
  The tool runs where the repos and credentials live.
- **Non-engineering users** — Hangar is a power tool for a developer already running Claude Code.
  UX optimizations for non-technical users or project managers are not a goal.

---

## User

**Primary user:** A single software engineer (the operator) who:
- Uses Claude Code daily and has agents/skills configured.
- Tracks work in Jira and/or manages personal/side projects via AI Workflow.
- Wants to delegate implementation tickets to agents and review the output, not orchestrate the
  orchestration layer manually.
- Is comfortable running a localhost server and trusts their own machine's security posture.

There is no secondary user. Teams, managers, and non-engineers are out of scope.

---

## Key Flows

### 1. Ticket → Agent → PR (Jira board)

```
Open board → filter to my tickets → drag ticket to "In Progress" →
click card → assign agent (e.g. pp-debugger) → optionally add a note →
Run panel opens → session streams live → agent opens PR →
PR link appears in panel → open in terminal or review in GitHub
```

Worktree is created at run start, session executes in isolation, worktree is removed at run end.

### 2. aiwf Card → Skill → Commit (AI Workflow board)

```
Select aiwf project → open phase column (e.g. Implementation) →
click card → assign skill (e.g. /feature) → Run panel streams live →
skill completes → transcript saved → review result in panel or terminal
```

### 3. Human-in-the-loop (gated mode)

```
Agent runs → encounters risky shell command →
panel shows Approve / Deny prompt → operator decides →
session resumes or aborts
```

### 4. Workflow pipeline

```
Board workflow defined in config → trigger from card context menu →
step 1 agent runs → result passed to step 2 → ... →
final result shown; each step visible in runs list
```

---

## Success Criteria

Success is measured by one primary metric: **tickets delegated to agents per day**.
The goal is 3+ tickets per day with no manual orchestration required.

Supporting criteria:
- [ ] Zero stale worktrees / branches accumulate after a normal session of use (creates + runs + closes).
- [ ] A run assigned in the board streams its first output within 5 seconds of clicking Run.
- [ ] The operator can assign, monitor, and link a ticket to a merged PR without leaving the
      browser tab.
- [ ] Demo mode works fully offline (no Jira, no Anthropic key) — new clone to running board in
      under 3 minutes.
- [ ] `npm run typecheck` passes after every committed change.

---

## Constraints

**Technical:**
- Node 18+, TypeScript throughout (server + web).
- `@anthropic-ai/claude-agent-sdk` is the only supported session runner; no raw API calls.
- Sessions use the operator's existing Claude Code login or `ANTHROPIC_API_KEY` — Hangar does
  not manage API keys.
- No test suite yet; typecheck is the build gate. Any reliability work on sessions/worktrees
  should add test coverage or at minimum a smoke script.

**Operational:**
- Single-operator, localhost-only. Do not introduce features that require a network-accessible
  server or a persistent background daemon.
- Secrets (`.env`, `hangar.config.json`, `.hangar/`) are gitignored; never commit them.
  The run transcript store is sensitive (may contain file contents); treat it accordingly.

**Personal:**
- Solo maintainer (Thalisson). Features should be implementable in a day or two of focused work;
  avoid architectural changes that create long-lived maintenance debt without clear payoff.
- No long-lived feature branches. Every slice must land on `main` in a state that keeps the
  board usable.

---

## Risks and Open Questions

| Risk / Question | Impact | Mitigation |
|---|---|---|
| **SDK churn** — `@anthropic-ai/claude-agent-sdk` is relatively new; breaking changes could break all session dispatch. | High — entire value prop depends on it. | Pin the SDK version; treat upgrades as a deliberate migration with smoke testing. |
| **Worktree accumulation** — the top reliability pain point today. Runs that exit uncleanly (process kill, crash, network drop) may leave branches and worktrees. | Medium — reduces disk space; causes `git` conflicts on future runs against same repo. | Audit the cleanup path in `sessions.ts` + `worktree.ts`; add cleanup-on-startup sweep for orphaned worktrees. |
| **Horizon drift** — no defined "done" state; the project could keep growing in ways that increase maintenance burden without proportionate value. | Medium — solo maintainer burnout; tool becomes complex enough to resist quick changes. | This PRD is the first forcing function. Review scope annually: if a proposed feature isn't in Scope and doesn't serve the "delegate 3 tickets/day" metric, default to no. |
| **aiwf upstream changes** — the AI Workflow toolkit is maintained by a third party; format changes could silently break the aiwf board. | Low-medium — aiwf is used equally with Jira; breakage is immediately visible but recovery may be non-trivial. | Keep `docs/ai-workflow.md` current; run `/aiwf-sync` after any aiwf-adjacent change. |
| **SSE reliability** — long-running sessions over SSE can drop on network or process restart. | Low-medium — run panel goes silent; operator loses visibility but run continues. | Investigate reconnect / replay on the SSE stream for long-running sessions. |

---

## Horizon decision (open)

The user's "done" state is currently undecided. Two coherent paths:

**A. Stabilize** — Worktree cleanup, SSE reconnect, and minor UX polish. The feature set is
right; the tool becomes low-maintenance. Appropriate if 3 tickets/day is achievable with today's
feature set and reliability is the only gap.

**B. Extend** — Continue adding capabilities (richer workflow DSL, better session resume, terminal
integration depth, aiwf enhancements). Appropriate if current features still leave significant
manual steps in the daily loop.

Proposed decision rule: after worktree cleanup is resolved and the "3 tickets/day" metric is
measurable for 4 weeks, evaluate which path to take based on observed friction points.

---

## Future Work (deferred, not abandoned)

- **Session reconnect / replay** — SSE streams that drop mid-run should reconnect and replay the
  missed output, not just go silent.
- **Richer workflow DSL** — parallel steps, conditional branching, and typed handoffs between
  agents within a pipeline.
- **Transcript search** — full-text search across all run transcripts from the Sessions view.
- **Per-board agent defaults** — assign a default agent/skill to a board so common ticket types
  launch without manual selection.
- **Cost budgeting UI** — visual spend tracking across the day's runs; soft alerts at a
  configurable daily ceiling.

---

## Appendix: Architecture snapshot (June 2026)

```
hangar/
  server/src/
    index.ts        # Express app + all routes (SSE at /api/runs/:id/stream)
    sessions.ts     # SDK query(), isolation, streaming, event emission
    worktree.ts     # git worktree create/remove
    store.ts        # run/workflow JSON persistence under .hangar/
    jira.ts         # Jira Cloud REST adapter
    agents.ts       # ~/.claude/agents/*.md parser
    skills.ts       # ~/.claude/skills parser
    workflows.ts    # multi-step pipeline runner
    config.ts       # hangar.config.json + .env loader/saver
    types.ts        # shared types (source of truth)
  web/src/
    App.tsx         # board + topbar + view switching
    api.ts          # typed fetch wrappers
    components/     # Board, RunPanel, SessionsView, Settings, ...
```

Source of truth for type changes: `server/src/types.ts` → mirrored in `web/src/types.ts`.
Source of truth for config changes: follow `/config-field` skill (5 touch-points).
