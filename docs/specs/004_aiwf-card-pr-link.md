# Spec 004 — Add PR link to the AIWF task when available

## Trunk Metadata

- **Type:** feat
- **Issue:** (none — ran before /issues)
- **Ticket:** HAN-10 — Add PR link to the AIWF task when available
- **Slug:** aiwf-card-pr-link

## Problem

An AI Workflow (aiwf) card maps onto Hangar's `Ticket` shape, and a card's `pr:` frontmatter is
already **read** into `Ticket.prUrl` (`cardToTicket` in `server/src/aiwf.ts`) and **displayed** on
the board (`web/src/components/Board.tsx` renders `ticket.prUrl` as the card's PR pill). The board
also shows a live run's PR via `run.prUrl`, which `detectPr` in `server/src/sessions.ts` sets the
moment a GitHub PR URL appears in the run's streamed output.

The gap: nothing ever **writes** the detected PR URL back to the card. When an aiwf card run (e.g. a
`feature`/`fix`/`pr` skill) opens a pull request, `run.prUrl` lives only in memory for that run. Once
the run ends and is cleared — or Hangar restarts — the PR link is lost, because the card's `pr:`
frontmatter was never populated. The card should durably remember the PR its run produced, so the
link keeps showing on the board (matching the documented card format in `docs/ai-workflow.md`, which
already lists `pr:` as a frontmatter field).

## Approach

When an aiwf card run finishes and a PR URL was detected during the run (`run.prUrl`), persist that
URL to the card's `pr:` frontmatter — at the same point we already append the run to the card's
history (`server/src/sessions.ts`, the `result`/`success` branch that calls `appendCardHistory`).

Extend `appendCardHistory` in `server/src/aiwf.ts` with an optional `prUrl` parameter. When a
non-empty `prUrl` is supplied, set `fm.pr = prUrl` before serializing the card back to disk; this
reuses the existing single atomic write (frontmatter + description + history). When `prUrl` is
absent/empty, leave any existing `fm.pr` untouched (never clear a known PR with a missing one).

The read path (`cardToTicket` → `prUrl: fm.pr || undefined`) and the web display (`Board.tsx`)
already surface `ticket.prUrl`, so **no web changes are required** — once the frontmatter is written,
the link shows on the card across reloads and restarts.

Scope is aiwf cards only. Jira tickets already resolve their PRs live via the dev-status API
(`fetchTicketPr` / `GET /api/tickets/:key/pr`) and are unaffected.

## Affected Files

### Server

- `server/src/aiwf.ts` — add an optional `prUrl?: string` parameter to `appendCardHistory`. When a
  truthy/non-empty `prUrl` is passed, set `fm.pr = prUrl.trim()` (only persist a real URL; do not
  overwrite an existing `pr:` with an empty value). Update the function's doc comment.
- `server/src/sessions.ts` — at the existing aiwf success branch that calls `appendCardHistory`, pass
  `run.prUrl` through so the detected PR is persisted alongside the history entry.

### Docs

- `docs/ai-workflow.md` — note (in the Execution model / card format area) that a run's detected PR
  URL is persisted to the card's `pr:` frontmatter on completion, so the link survives the run. Keep
  it brief; the `pr:` field is already shown in the card-format example.
- `CHANGELOG.md` — one entry under `[Unreleased]` (or a new version heading) in the appropriate
  category (Added/Changed), plus the matching root `package.json` `version` bump (PATCH — small
  feature; it persists an already-displayed value).

## Verification Criteria

1. `appendCardHistory(projectId, key, entry, prUrl)` writes `pr: <url>` into the card file's
   frontmatter when `prUrl` is a non-empty string.
2. Calling `appendCardHistory` with no `prUrl` (or an empty string) does **not** add or clear the
   `pr:` frontmatter — an existing `pr:` value is preserved.
3. After persistence, `getCard` / `listCards` return the card with `prUrl` set to the persisted URL.
4. The history entry is still appended and the card's `skill` is still updated, exactly as before
   (the new parameter is purely additive — existing call sites and behavior are unchanged).
5. A run-completion path that has `run.prUrl` set persists it to the card (covered by a unit test on
   `appendCardHistory`; an integration test on the sessions completion path is optional if it fits
   the existing test patterns).
6. `npm run typecheck`, `npm test`, and `npm run lint` all pass.

## Test Strategy

Tests use **Jest** (`npm test` runs `jest` in `server/`). Add unit coverage to
`server/src/__tests__/aiwf.test.ts` mirroring the existing `appendCardHistory` tests:
- persists `pr:` when a URL is supplied (read back via `getCard`/`listCards`);
- leaves frontmatter unchanged when no/empty URL is supplied;
- still appends history and updates `skill` (regression guard).
