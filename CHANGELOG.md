# Changelog

All notable changes to Hangar are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Versioning.** Hangar uses [SemVer](https://semver.org/) but does **not** cut formal releases —
the goal is to track _every change_, one entry per merged PR. While pre-1.0:

- **MINOR** (`0.x.0`) — a notable/large change (a new feature like the AI Workflow connection).
- **PATCH** (`0.0.x`) — a small change (a single fix, tweak, or doc update).

There are no GitHub Releases or git tags; this file is the record, and the root `package.json`
`version` tracks the latest entry. Every PR adds its own entry (see `CLAUDE.md`).

## [Unreleased]

### Added

- **Change an AI Workflow project's location** — each project chip now has an **Edit** (pencil)
  button that opens a modal to change the project's display name and **location** (`repoPath`) in
  place, with the same live path-validation as the New-project wizard. The project keeps its id, so
  its board cards (stored under `<HANGAR_DATA_DIR>/aiwf/<projectId>/board/`) carry over unchanged —
  re-pointing the location just runs future work against the new path. New
  `PATCH /api/aiwf/projects/:id` route + `updateAiwfProject` client wrapper.
- **Remove an AI Workflow project** — each project chip in the AI Workflow sub-bar now has a remove
  (✕) button that reveals on hover. It unregisters the project from Hangar (confirm first) via the
  existing `DELETE /api/aiwf/projects/:id` route; your repo stays untouched and the project's board
  state under `<HANGAR_DATA_DIR>/aiwf/<projectId>/board/` is left on disk. If the removed project was
  selected, the view falls back to the first remaining project.
- **One-click Resume** — a quick **Resume** button on any stopped/finished run that has a Claude
  session id picks the session up where it left off (sends a default "Continue.") with no modal. It
  appears both in the Sessions list and in the run panel header, to the left of **Hand off**. In the
  Sessions list the existing message-resume is still available as **Resume…**.
- **Open in terminal** — the Sessions view has an _Open in terminal_ action on each session (with a
  Claude session id) that resumes it in your own terminal (`claude --resume <id>` in the run's
  working directory). Configure your terminal under **Settings → Terminal** as a command template
  with `{{dir}}` and `{{command}}` placeholders (presets for macOS Terminal, iTerm2, and Ghostty);
  when no terminal is set, clicking the action warns and points you to Settings. New `terminal`
  config field and `POST /api/runs/:id/terminal` route.

### Changed

- **AI Workflow new-item skill picker replaced with buttons** — the `{phase} skill` `<select>` dropdown
  in the "New item" modal is now a group of buttons (matching the existing Type picker), with
  `flex-wrap` support for longer skill names. Not-installed skills remain disabled. No data-flow
  change; pure presentational swap. (HAN-9)
- **AI Workflow board lives in Hangar's data dir** — board cards moved from each project repo's
  `.aiwf/board/` to `<HANGAR_DATA_DIR>/aiwf/<projectId>/board/` (gitignored runtime state, like
  `.hangar/`). Target repos now stay completely pristine — nothing writes `.aiwf/` into them. The
  `roadmap` seed instruction is given the absolute board path. A task's durable criteria belong in a
  tracked `docs/specs/NNN_*.md`. Point dev + stable instances at one `HANGAR_DATA_DIR` to share a
  board. (Supersedes the brief tracking of the `HAN-1`/`HAN-2`/`HAN-3` cards.)

### Fixed

- **AI Workflow runs isolate code-producing tasks in a worktree** — the implementation skills that
  edit source directly (`feature`, `fix`) launched from an AI Workflow card now run in their own git
  worktree + branch like any other Hangar run, instead of always in the project repo. Parallel
  implementation runs (and your own working tree) no longer clobber each other. Planning/design/doc/
  review/delivery skills still run in place so their docs land in the real repo and aiwf's own
  `/commit` and `/pr` operate there; the `autopilot`/`factory` orchestrators also stay in place since
  they spawn their own worktree subagents and open their own PRs (`skillNeedsWorktree` in
  `server/src/aiwf.ts`).
- **Server resilience** — install top-level `unhandledRejection`/`uncaughtException` handlers
  (entrypoint only) that log loudly and keep serving, so a stray async error no longer crashes the
  process and silently kills every live session.

## [0.3.0] - 2026-06-17

Shipped in [#13](https://github.com/thalissonbarbosas/hangar/pull/13).

### Added

- **AI Workflow demo seeding** — `HANGAR_DEMO=1` now shows a populated AI Workflow connection (a
  seeded "Aurora" project with cards across every phase, history, and a PR link); install/uninstall
  and card mutations are simulated, so demo touches no filesystem and starts no real runs.

### Changed

- Move detailed docs into `docs/`: add `docs/ai-workflow.md` (full AI Workflow guide, with
  screenshots), trim the README's connection section to a pointer, refresh the screenshots
  (`board`, `running`, `wait-input`, `done`, `aiwf-board`, `aiwf-new-item`), and drop
  `AI-WORKFLOW-CONNECTION-PLAN.md`. `CLAUDE.md` now keeps docs in `docs/` and requires updating
  `docs/ai-workflow.md` whenever the connection changes.

## [0.2.0] - 2026-06-17

Added in [#11](https://github.com/thalissonbarbosas/hangar/pull/11).

### Added

- **AI Workflow connection** — a second board source (alongside Jira) for self-hosted projects driven
  by [ai-workflow](https://github.com/0xrafasec/ai-workflow), with a topbar connection switcher and a
  per-connection sub-menu. Detects + one-click-installs/uninstalls aiwf in `~/.claude`; registers
  projects ("new" scaffolds via the `new-project` skill, "adopt" registers an existing repo).
- A **phase-lifecycle board** whose columns are the aiwf phases (`Planning → Design → Implementation →
Review → Delivery → Complete`). Cards are work threads stored as markdown in the repo at
  `<repoPath>/.aiwf/board/*.md`; each column offers its phase's skills (New session / New task), moving
  a card into a phase pops its skill picker, and every session result is logged to the card's history.
  Runs execute in-place via Claude (the existing engine).

## [0.1.1] - 2026-06-17

### Added

- `CHANGELOG.md` and a per-PR versioning scheme; `CLAUDE.md` now requires every change to update the changelog ([#10](https://github.com/thalissonbarbosas/hangar/pull/10)).

## [0.1.0] - 2026-06-17

Initial baseline — the app and its tooling through PR #9.

### Added

- Lint, format, coverage gate, and pre-commit hooks ([#1](https://github.com/thalissonbarbosas/hangar/pull/1)).
- Configurable web UI port, default `5180` ([#2](https://github.com/thalissonbarbosas/hangar/pull/2)).
- Full server test suite with a coverage gate ([#3](https://github.com/thalissonbarbosas/hangar/pull/3)).
- PR link shown on a task card ([#4](https://github.com/thalissonbarbosas/hangar/pull/4)).
- Path validation in Settings and a Jira PR link on board cards ([#6](https://github.com/thalissonbarbosas/hangar/pull/6)).
- Delete and resume actions for stopped/done sessions ([#9](https://github.com/thalissonbarbosas/hangar/pull/9)).

### Changed

- Filter the assign menu to board-relevant skills ([#8](https://github.com/thalissonbarbosas/hangar/pull/8)).

### Fixed

- Handoff runs reuse the parent worktree instead of creating a new one ([#5](https://github.com/thalissonbarbosas/hangar/pull/5)).
- Prefer the open PR from the Jira dev-status API ([#7](https://github.com/thalissonbarbosas/hangar/pull/7)).

[unreleased]: https://github.com/thalissonbarbosas/hangar/compare/main...HEAD
