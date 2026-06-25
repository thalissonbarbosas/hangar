# Feature: Smart Buttons for AIWF Sessions (HAN-17)

## Trunk Metadata

- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-aiwf-smart-buttons`

## Problem

After a skill finishes in an AIWF session, the natural next step is always another skill — `commit`
leads to `pr`, `spec` leads to `feature`, `review` leads to `fix`. Today the operator must close
the run panel, navigate back to the card, and manually pick the next skill to start a new session.
This is pure mechanical overhead for a transition that is predictable 80% of the time.

The operator wants contextual "smart buttons" that appear directly above the session's composer
input when the session is done, so the next skill can be launched with a single click — **in the
same session**, without a new hand-off or a new worktree.

## Solution

Add a `SmartButtons` strip above the `run-composer` form in `RunPanel`. When a skill session
completes, the strip appears with one or more buttons derived from a static `SKILL_NEXT_MAP`.
Clicking a button calls `sendFollowup("/<skillName>")`, resuming the current session with that
skill's slash command — exactly as if the operator had typed it in the composer and pressed Enter.

No new API endpoints. No new server state. All logic is client-side in `RunPanel.tsx`.

## Technical Design

### Architecture

Changes are confined to two files:

```
web/src/components/RunPanel.tsx   ← SKILL_NEXT_MAP + SmartButtons component + render placement
web/src/styles.css                ← .smart-buttons + .smart-btn styles
```

### `SKILL_NEXT_MAP`

A static `Record<string, string[]>` that maps a running skill's name to a list of suggested
next-skill names. The order within each array sets the button order in the UI.

```ts
const SKILL_NEXT_MAP: Record<string, string[]> = {
  // Spec workflow
  prd:             ["roadmap", "spec"],
  roadmap:         ["spec"],
  adr:             ["spec"],
  rfc:             ["spec"],
  spec:            ["feature"],
  design:          ["spec"],
  // Implementation workflow
  tdd:             ["feature"],
  feature:         ["commit", "pr", "verify"],
  fix:             ["commit", "pr"],
  simplify:        ["commit", "pr"],
  // Quality workflow
  "code-review":   ["fix", "commit"],
  "security-review": ["fix"],
  security:        ["fix"],
  review:          ["fix"],
  verify:          ["commit", "pr"],
  // Delivery workflow
  commit:          ["pr"],
  pr:              ["review", "jira-comment"],
  "release-pr":    ["jira-announce"],
};
```

### `SmartButtons` component

Defined at module level (alongside `QuestionCard` and `StateBadge`), receives:

| Prop | Type | Description |
|------|------|-------------|
| `agentName` | `string` | The running skill's name (e.g. `"commit"`) |
| `skills` | `Skill[]` | All available skills — used to filter to only installed ones |
| `state` | `RunState` | Run state — buttons only show when `!isActive(state)` |
| `sessionId` | `string \| undefined` | Present only once the session has connected |
| `sendFollowup` | `(text: string) => void` | Calls the RunPanel's follow-up send path |

**Render logic:**
1. Return `null` if `isActive(state)` or `!sessionId` — mirrors the Resume button's guard.
2. Look up `SKILL_NEXT_MAP[agentName]`; return `null` if no entry.
3. Build a `Set<string>` of available skill names from `skills` prop.
4. Filter the map's suggestions to those present in the set.
5. Return `null` if nothing survived the filter (skill not installed).
6. Render a `.smart-buttons` strip with a muted "Next:" label and one `.smart-btn` per suggestion.

Each button `onClick` calls `sendFollowup("/" + name)`.

### Placement in RunPanel

Insert `<SmartButtons>` just above the `run-composer` form (between `run-body` and the form):

```tsx
{/* existing run-body */}
<div className="run-body" ref={bodyRef}>…</div>

{/* new smart buttons strip */}
{(sessionId || isActive(state)) && (
  <SmartButtons
    agentName={agentName}
    skills={skills}
    state={state}
    sessionId={sessionId}
    sendFollowup={sendFollowup}
  />
)}

{/* existing run-composer form */}
{(sessionId || isActive(state)) && (
  <form className={`run-composer${pendingQuestion ? " asking" : ""}`} …>…</form>
)}
```

The outer guard is identical to the composer's guard so both appear and disappear together.

### CSS

```css
/* Smart buttons — contextual next-skill strip above the composer */
.smart-buttons {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  flex-wrap: wrap;
}
.smart-buttons-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-right: 2px;
  white-space: nowrap;
}
.smart-btn {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: var(--r-sm);
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  transition: background var(--t), color var(--t);
  font-family: var(--mono);
  line-height: 1.5;
}
.smart-btn:hover {
  background: var(--accent-soft);
}
```

## Security Considerations

No new API surfaces. `sendFollowup` already validates and forwards text to the existing
`POST /api/runs/:id/message` endpoint, which is rate-limited and scoped to the in-memory run.
The skill names come from a static whitelist (`SKILL_NEXT_MAP` + filtered against installed
skills) — no user-supplied or server-supplied text is injected into the command string.

## Feature Flag

None — user-ready on merge.

## Verification Criteria

### Unit Tests

No server changes, so no new server unit tests required. TypeScript will catch structural errors.

### Manual Tests

- [ ] Open a session started with skill `commit`; when it finishes, a "Next: /pr" button appears
      above the composer and below `run-body`.
- [ ] Open a session started with skill `spec`; when it finishes, a "Next: /feature" button appears.
- [ ] Open a session started with skill `feature`; when it finishes, buttons "Next: /commit /pr /verify"
      appear (only for skills that are actually installed in the user's `~/.claude/skills/`).
- [ ] Clicking a smart button sends `/<skillName>` to the session and the session resumes — the
      same behavior as typing `/<skillName>` in the composer and pressing Enter.
- [ ] Smart buttons do **not** appear while the session is still running (state is active).
- [ ] Smart buttons do **not** appear for agent runs or chat runs (agentName not in SKILL_NEXT_MAP).
- [ ] Smart buttons do **not** appear if none of the suggested skills are installed.
- [ ] A skill with no entry in `SKILL_NEXT_MAP` (e.g. `jira-announce`) shows no strip.
- [ ] `npm run typecheck` passes with no errors.

## Out of Scope

- Configurable or user-editable smart button mappings (static map is sufficient for v1).
- Smart buttons for Jira agent runs (the map is skill-centric; agents are named differently).
- Showing all available skills in a picker (that's what the Hand-off button already does).
- Smart buttons on the AIWF card itself (buttons live in the run panel session view only).
