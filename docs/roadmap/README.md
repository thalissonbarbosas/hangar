# Roadmap

## Overview

Two tracks running in sequence:

1. **Design (Phases 001–003)** — visual refinement per `docs/design/DESIGN_SYSTEM.md`: accent
   tokens, card-state borders, column status indicators.
2. **Security + Architecture (Phases 004–007)** — all HIGH/MEDIUM/LOW security controls from
   `docs/THREAT_MODEL.md`, then route splitting from `docs/ARCHITECTURE.md`.

## MVP Boundary

**The design MVP ends at Phase 002.** At that point the board has a precise accent color and
clean static card-state borders. Phase 003 (column status borders) is post-MVP polish.

Security phases have no MVP framing — they are correctness work. **Phase 004 (security HIGH)
should be treated as urgent** regardless of where the design phases stand.

## Phases

| # | Phase | Tasks | Key files | Priority | Status |
|---|-------|-------|-----------|----------|--------|
| [001](001_token-refinement.md) | Token refinement | 2 | `styles.css` | Design | Not started |
| [002](002_card-state-borders.md) | Card state borders | 2 | `styles.css`, `Board.tsx` | Design MVP ★ | Not started |
| [003](003_column-status-borders.md) | Column status borders | 1 | `styles.css`, `Board.tsx` | Design | Not started |
| [004](004_security-high.md) | Security HIGH | 2 | `index.ts`, `aiwf.ts` | **Urgent** | Not started |
| [005](005_security-medium.md) | Security MEDIUM | 3 | `index.ts`, `config.ts`, `Settings.tsx` | High | Not started |
| [006](006_route-splitting.md) | Route splitting | 5 | `index.ts` → `routes/` | Architecture | Not started |
| [007](007_security-low.md) | Security LOW | 2 | `store.ts`, `config.ts`, `SessionsView.tsx` | Low | Not started |

★ Design MVP ends here.

## Execution Notes

- **Design track (001–003):** sequential — all touch `styles.css`.
- **Security HIGH (004):** Tasks 1 and 2 touch different files and can run in parallel.
- **Security MEDIUM (005):** Tasks 1 and 3 can be parallel; Task 2 must follow Task 3 (both
  touch `config.ts`).
- **Route splitting (006):** strictly sequential — all 5 tasks shrink the same `index.ts`.
  Run `/smoke` after each PR before starting the next slice. **Depends on 004 + 005 merged.**
- **Security LOW (007):** Tasks 1 and 2 are independent — parallel. Can run concurrently with
  Phase 006 (no file overlap with the route modules).
- **Critical path:** 004 → 005 → 006 (longest sequential chain; ~8 PRs in series).
