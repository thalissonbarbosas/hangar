# Phase 002 — Card State Borders

## Context

Replaces the `cardpulse` CSS animation on active cards with a static left-border stripe, and
adds equivalent border treatments for awaiting-input and done cards. The left stripe is
perceptually faster to locate in a dense column than a color-cycling full border.

Depends on Phase 001 (correct accent tokens must be in place first).

## Trunk Alignment

Both tasks ship user-visible on merge. No feature flags.

## Tasks

### Task 1: Active card — replace animation with left-border stripe

- **Type:** perf
- **Files:** `web/src/styles.css` (around line 1071)
- **Dependencies:** Phase 001 complete (uses corrected `--accent` value)
- **Verification:** Start a run; card shows a solid blue left stripe instead of pulsing border
- **Feature flag:** none
- **Estimated complexity:** Low

Remove `cardpulse` and replace with a left-border stripe:

```css
/* web/src/styles.css */
.card.active {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  border-left: 3px solid var(--accent);
  padding-left: 9px; /* compensate: keeps content-to-edge visual distance constant */
  /* REMOVE: animation: cardpulse 2.4s ease-in-out infinite; */
}
/* REMOVE the entire @keyframes cardpulse block */
```

---

### Task 2: Awaiting-input and done card borders

- **Type:** feat
- **Files:** `web/src/styles.css`, `web/src/components/Board.tsx`
- **Dependencies:** Task 1 (same CSS block; do in the same PR or sequentially)
- **Verification:** `awaiting_input` run → amber left stripe on card; `done` run → green left stripe
- **Feature flag:** none
- **Estimated complexity:** Medium

**CSS additions** (`styles.css`):

```css
.card.awaiting-input {
  border-color: color-mix(in srgb, var(--warning) 45%, var(--border));
  border-left: 3px solid var(--warning);
  padding-left: 9px;
}

.card.done {
  border-color: color-mix(in srgb, var(--success) 35%, var(--border));
  border-left: 3px solid var(--success);
  padding-left: 9px;
}
```

**Board.tsx — Card component** (`className` line ~461):

The Card component currently emits only `active`. It needs to also emit `awaiting-input` and
`done` based on the latest run's state. The exact prop shape depends on what run data is already
passed to the Card — look for where `active` is derived and use the same source to determine
`awaitingInput` (run state is `awaiting_input`) and `hasDoneRun` (latest run is `done`).

```tsx
className={`card${active ? " active" : ""}${awaitingInput ? " awaiting-input" : ""}${hasDoneRun ? " done" : ""}${dragging ? " dragging" : ""}`}
```

Note: `active` and `awaiting-input` are mutually exclusive (a card can't be both running and
awaiting at the same time); `done` may overlap with neither.

## Execution Order

1. Task 1 first (remove animation, add active stripe) — CSS only, fast to verify
2. Task 2 immediately after (add awaiting/done, both files) — can be one PR with Task 1

## Phase Checklist

- [ ] `cardpulse` animation and `@keyframes cardpulse` removed
- [ ] `.card.active` has `border-left: 3px solid var(--accent)` and `padding-left: 9px`
- [ ] `.card.awaiting-input` and `.card.done` CSS rules exist
- [ ] `Board.tsx` Card component emits `awaiting-input` / `done` class names
- [ ] Visual check: all three card states show distinct left-border colors at a glance
- [ ] `npm run typecheck` passes
