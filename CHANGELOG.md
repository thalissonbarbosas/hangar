# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
