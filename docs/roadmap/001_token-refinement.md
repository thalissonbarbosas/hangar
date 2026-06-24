# Phase 001 — Token Refinement

## Context

Pure CSS changes. No component logic. Safe to do first because the corrected accent values are
the baseline every other phase builds on (card borders and column borders all use `--accent`).

## Trunk Alignment

Both tasks ship user-visible on merge. No feature flags.

## Tasks

### Task 1: Accent color token update

- **Type:** perf (visual refinement, no behavior change)
- **Files:** `web/src/styles.css` (lines 23–26 dark, 46–49 light)
- **Dependencies:** None
- **Verification:** `npm run typecheck`; open board in dark + light mode, confirm accent is a cooler blue (less purple/indigo)
- **Feature flag:** none
- **Estimated complexity:** Low

**Dark mode** (`html[data-theme="dark"]`):

| Token | From | To |
|-------|------|----|
| `--accent` | `#6e8bff` | `#5C91FF` |
| `--accent-hover` | `#8aa0ff` | `#7AAEFF` |
| `--accent-soft` | `rgba(110, 139, 255, 0.14)` | `rgba(92, 145, 255, 0.12)` |

**Light mode** (`html[data-theme="light"]`):

| Token | From | To |
|-------|------|----|
| `--accent` | `#5566ef` | `#3050D4` |
| `--accent-hover` | `#4453d6` | `#1F3DB8` |
| `--accent-soft` | `rgba(85, 102, 239, 0.1)` | `rgba(48, 80, 212, 0.10)` |

---

### Task 2: Board title weight

- **Type:** perf
- **Files:** `web/src/styles.css` (line ~296)
- **Dependencies:** None (can be done in the same commit as Task 1)
- **Verification:** Board section titles (project name row) read heavier/bolder
- **Feature flag:** none
- **Estimated complexity:** Low

```css
/* web/src/styles.css */
.board-title {
  font-weight: 700; /* was 600 */
}
```

## Execution Order

Tasks 1 and 2 touch different rules in the same file — commit together in one PR.

## Phase Checklist

- [ ] Accent tokens updated in both dark and light modes
- [ ] Board title weight bumped to 700
- [ ] `npm run typecheck` passes
- [ ] Visual check: board in dark + light mode — accent reads as precision blue, not indigo
