# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-06-24

### Added

- Docs & specs browser modal (📖 button in the AIWF board header): three tabs — Project docs,
  Specs, and AIWF toolkit docs — with an inline split-pane preview that keeps the modal open (#62)
- Check out a card's task branch directly in the project root from the card sidebar (#58)
- Worktree manager modal for viewing and removing stale worktrees on both AIWF and Jira boards (#53)
- Automatic worktree cleanup when a card transitions to Complete, and a configurable cap on the
  Done column size (#52)
- Task-scoped git worktrees for AIWF spec card runs, so parallel spec sessions stay isolated (#49)
- Terminal button in the run panel to open a session's working directory in your terminal (#48)
- Spec files surfaced as read-only cards on the AIWF board, with expand/collapse for sliced specs (#46)
- AI Workflow skills guide modal showing phases, skills, and links to the toolkit repo (#45)
- Rate limiting on session-spawning API endpoints to prevent runaway agent bursts (#40)
- Project-level `/smoke`, `/config-field`, and `/aiwf-sync` skills for common maintenance tasks (#35)
- Project Claude session button for launching a session scoped to the whole project (#55)
- Revamped AIWF card modals: larger "See more" area and a markdown-rendered sidebar (#54)
- Running a skill on a spec creates or reuses a board task and starts the session from it,
  preserving the spec's semantic git branch (HAN-10)

### Changed

- Removed the dedicated Spec cards section and sidebar from the AIWF view; specs are now browsed
  through the docs modal (#61)

### Fixed

- Task worktrees are stored in the data directory so untracked spec files survive server restarts (#57)
- Two spec files sharing a numeric prefix (e.g. `014_a.md` and `014_b.md`) now get unique board
  keys instead of colliding on the same `SPEC-014` row (HAN-13)
- Jira board action icons are now rendered at the right edge of the card, consistently grouped (#60)
- Unified task-scoped worktrees across all board card types for consistent isolation (#51)
- Spec list sorts newest first and pagination navigates correctly between pages (#50)
- Jira credentials are stripped from agent session environments so they are never leaked to
  subprocesses (HAN-11, #43)
- Graceful shutdown on SIGTERM and automatic pruning of stale worktrees at startup (#41)
- AIWF install and uninstall no longer block the server event loop (#39)
- Previous workflow step results injected into the next step note are now truncated to prevent
  oversized prompts (#38)
- Persist debounce timer is cancelled when a run is deleted, preventing a stale write after removal (#37)
- Working directory in the terminal command template is now shell-quoted to handle paths with spaces (#36)
- Dashboard scroll restored; `--text-dim` CSS token added and body/settings overflow corrected (#47)

## [0.5.0] - 2026-06-18

### Added

- Group sessions by project with a tab bar, and scope the clear buttons to the active project (#31, #33)
- Project-colored skill tags and model chips on agents and skills (#33)
- Board skills allowlist for the AI Workflow board (#33)
- Archive, delete, and view-data options on AI Workflow cards (#32)
- Segmented buttons for picking the skill when starting an AI Workflow session (#24, #29)
- Add, relocate, and remove AI Workflow projects (#19, #20, #21)
- Persist a run's PR link onto its AI Workflow card (#27)
- One-click resume for a session, plus added server resilience (#14)
- Open a run's Claude session in your terminal, including a Warp preset (#17, #28)
- Allow selecting multiple answers when a session asks a multi-select question (#22)

### Changed

- Show whole assistant messages in the session modal instead of streaming token-by-token (#25)

### Fixed

- Remove the duplicated resume option from the sessions list (#30)
- Isolate code-producing AI Workflow tasks in their own git worktree (#23)
