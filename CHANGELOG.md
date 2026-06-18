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

_Nothing yet._

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
