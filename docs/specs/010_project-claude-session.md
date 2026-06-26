# Feature: Project Claude Session Button (HAN-4)

## Trunk Metadata
- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-project-claude-session`

## Problem

Starting a plain, interactive Claude session scoped to a specific project's repo currently
requires opening the "Run a skill" overlay (✨), selecting a skill or agent, typing a task,
and picking a working directory from a dropdown. There is no shortcut for "just open Claude
in this project, let me pick the model and start chatting."

Users who want a free-form session — to explore code, draft something, or get a quick
answer — must route through a skill/agent, which adds ceremony and hard-codes a system
prompt they may not want.

## Solution

Add a **"Start Claude session"** button (`MessageSquare` icon) to:

1. Each **Jira board** header (`h2.board-title` in `Board.tsx`)
2. Each **AI Workflow project** pill in the `AiWorkflowBar` sub-menu

Clicking either button opens the same compact inline popover with:

1. A **model selector** — Haiku / Sonnet (default) / Opus
2. An **optional initial message** textarea (placeholder: "What would you like to work on?")
3. A **Start session** button

Clicking Start creates a plain `kind: "chat"` session scoped to the project's repo path with
the chosen model. The session opens immediately in the RunPanel.

## Technical Design

### API Changes

**`POST /api/runs`** — extend to accept a new `kind` value.

New accepted body for a chat session:
```json
{
  "kind": "chat",
  "cwd": "/path/to/repo",
  "title": "PP — Claude session",
  "model": "sonnet",
  "note": ""
}
```

Validation changes (in `index.ts`):
- Skip agent/skill name lookup when `kind === "chat"`; use the hardcoded display name `"claude"`
- Allow an empty/absent `note` when `kind === "chat"` (removes the existing "Provide a note" guard for this kind)
- Parse `model` from the request body and pass it as `modelOverride` to `startRun`

### Data Model

No schema changes. The `Run` record already stores `model: string`; for chat runs this holds
the mapped model id (e.g., `"claude-sonnet-4-6"`).

`RunSummary.kind` is typed as `"agent" | "skill"` in `web/src/types.ts` — add `"chat"` to both
`RunKind` and `RunSummary.kind`. `WorkflowStep.kind` in `server/src/types.ts` stays as
`"agent" | "skill"` (workflows don't use chat sessions).

### Architecture

Seven files change; no new files, no config changes.

```
server/src/sessions.ts          ← add modelOverride to StartOpts; use it in model resolution
server/src/index.ts             ← handle kind:"chat" — skip validation, allow empty note
web/src/types.ts                ← add "chat" to RunKind and RunSummary.kind
web/src/api.ts                  ← add startClaude() helper
web/src/App.tsx                 ← add openClaudeSession handler; wire to Board + AiWorkflowBar
web/src/components/Board.tsx    ← export ClaudeSessionButton; render in board header
web/src/components/AiWorkflow.tsx  ← import ClaudeSessionButton; render per project in AiWorkflowBar
```

### Component Changes

#### `server/src/sessions.ts` — model override

Add to `StartOpts`:
```ts
modelOverride?: string; // explicit model for kind:"chat" sessions (mapped same as agent models)
```

In `startRun`, replace:
```ts
const model = mapModel(agent?.model);
```
with:
```ts
const model = mapModel(opts.modelOverride) ?? mapModel(agent?.model);
```

#### `server/src/index.ts` — chat kind

In the `POST /api/runs` handler, replace the `kind` derivation and validation block:

```ts
const kind = req.body?.kind === "skill" ? "skill"
           : req.body?.kind === "chat"  ? "chat"
           :                              "agent";
const model = typeof req.body?.model === "string" ? req.body.model : undefined;

if (kind === "agent" && (!name || !loadAgent(cfg.agentsDir, name))) {
  return res.status(404).json({ error: `Unknown agent: ${name}` });
}
if (kind === "skill" && (!name || !skillExists(cfg, name))) {
  return res.status(404).json({ error: `Unknown skill: ${name}` });
}
// kind === "chat": no validation — display name is always "claude"
const resolvedName = kind === "chat" ? "claude" : name;

// Chat sessions don't require a note (empty note → "(no instructions provided)" server-side)
if (!hasTicket && !parentRunId && kind !== "chat" && !note?.trim()) {
  return res.status(400).json({ error: "Provide a ticket, or a note describing the task." });
}

const run = parentRunId
  ? startRun({ kind, name: resolvedName, note, parentRunId, skillSource })
  : hasTicket
    ? startRun({ kind, name: resolvedName, note, ticket, skillSource })
    : startRun({ kind, name: resolvedName, note, cwd, title, modelOverride: model, skillSource });
```

#### `web/src/types.ts` — RunKind and RunSummary

```ts
export type RunKind = "agent" | "skill" | "chat";

export interface RunSummary {
  // ...
  kind?: "agent" | "skill" | "chat";
  // ...
}
```

#### `web/src/api.ts` — startClaude helper

```ts
startClaude: (cwd: string, title: string, model?: string, note?: string) =>
  sendJson<StartRunResult>("POST", "/api/runs", { kind: "chat", cwd, title, model, note }),
```

#### `web/src/App.tsx` — handler + props

Add handler (alongside the existing `runStandalone`):
```ts
function openClaudeSession(cwd: string, title: string, model: string, note?: string) {
  setError(null);
  api
    .startClaude(cwd, title, model, note || undefined)
    .then((r) => {
      setActiveRun({ runId: r.runId, ticketKey: title, agentName: "claude" });
      refreshRuns();
    })
    .catch((e) => setError(String(e.message ?? e)));
}
```

Pass to Board:
```tsx
<Board
  // ...existing props...
  onStartClaude={openClaudeSession}
/>
```

Pass to AiWorkflowBar (add prop to the existing `AiWorkflowBar` call site):
```tsx
<AiWorkflowBar
  // ...existing props...
  onStartClaude={openClaudeSession}
/>
```

#### `web/src/components/Board.tsx` — ClaudeSessionButton (exported)

Export a `ClaudeSessionButton` component so `AiWorkflow.tsx` can reuse it:

```ts
export function ClaudeSessionButton({
  cwd,
  title,
  onStart,
}: {
  cwd: string;
  title: string;
  onStart: (model: string, note?: string) => void;
}) { ... }
```

Internal state: `open: boolean`, `model: "haiku" | "sonnet" | "opus"` (default `"sonnet"`),
`note: string`.

Renders a small `<MessageSquare size={14} />` icon button with `data-tip="Start a Claude session"`.
When `open`, a popover appears (via `createPortal` — same pattern as `AssignMenu`) containing:
- Three segmented pill buttons: **Haiku** / **Sonnet** / **Opus** (Sonnet pre-selected)
- A textarea (placeholder: "What would you like to work on?")
- A **Start session** button that calls `onStart(model, note.trim() || undefined)` then closes the popover
- Dismisses on Escape or outside click

Add `onStartClaude` to Board's props interface and derive the primary cwd:
```ts
onStartClaude: (cwd: string, title: string, model: string, note?: string) => void;
```
```ts
const primaryCwd = board.resolvedPaths?.[0] ?? board.repoPath ?? "";
```

Render in the board header (only when a cwd is available):
```tsx
<h2 className="board-title">
  {board.name} <span className="board-key">{board.key}</span>
  <span className="board-total">{tickets.length} tickets</span>
  {primaryCwd && (
    <ClaudeSessionButton
      cwd={primaryCwd}
      title={`${board.name} — Claude`}
      onStart={(model, note) => onStartClaude(primaryCwd, `${board.name} — Claude`, model, note)}
    />
  )}
</h2>
```

#### `web/src/components/AiWorkflow.tsx` — per-project button in AiWorkflowBar

Import `ClaudeSessionButton` from `Board.tsx`:
```ts
import { ClaudeSessionButton } from "./Board";
```

Add `onStartClaude` to `AiWorkflowBar`'s props interface:
```ts
onStartClaude: (cwd: string, title: string, model: string, note?: string) => void;
```

In the project picker, add the button as a fourth icon next to each project's existing
Edit and Remove buttons:
```tsx
{projects.map((p) => (
  <span key={p.id} className="aiwf-proj">
    <button className={`pill${p.id === selectedId ? " on" : ""}`} onClick={() => onSelect(p.id)}>
      {p.name}
    </button>
    <ClaudeSessionButton
      cwd={p.repoPath}
      title={`${p.name} — Claude`}
      onStart={(model, note) => onStartClaude(p.repoPath, `${p.name} — Claude`, model, note)}
    />
    <button className="aiwf-proj-edit has-tip" ...>
    <button className="aiwf-proj-remove has-tip" ...>
  </span>
))}
```

(`p.repoPath` is the raw path stored in config; `expandHome` is applied server-side in `startRun`.)

## Security Considerations

- `cwd` is server-expanded with `expandHome` and validated via `existsSync` in `drive()` — no path
  traversal risk beyond what standalone runs already allow.
- `model` is mapped through `mapModel`; unrecognized values return `undefined` and the SDK uses its
  default. No injection risk.
- Chat sessions inherit the existing `bypassPermissions` and `exclusiveAgents` config — no new
  permission surface.
- No PHI or credentials involved.

## Feature Flag

None — user-ready on merge.
- Jira board button: only rendered when `board.resolvedPaths[0]` or `board.repoPath` is set.
- AI Workflow button: always rendered (every AIWF project has a `repoPath`).

## Verification Criteria

### Unit Tests

- [ ] `startRun` with `modelOverride: "sonnet"` → run record has `model: "claude-sonnet-4-6"`
- [ ] `startRun` with `modelOverride: "opus"` → run record has `model: "claude-opus-4-8"`
- [ ] `startRun` with no `modelOverride` and no agent → run record has `model: "(default)"`
- [ ] `POST /api/runs` with `kind: "chat"`, any `cwd`, no `name` → resolves name to `"claude"`, returns `200`
- [ ] `POST /api/runs` with `kind: "chat"` and empty `note` → accepted (no `400`)
- [ ] `POST /api/runs` with `kind: "agent"` and unknown name → still returns `404` (guard unchanged)

### Integration / Manual Tests — Jira view

- [ ] Board with configured `repoPath`/`repoPaths` → `MessageSquare` button appears in board title
- [ ] Board with no repo paths → button absent
- [ ] Click button → popover shows Haiku / Sonnet / Opus pills (Sonnet pre-selected) and note textarea
- [ ] Click Opus → Opus selected; click Start → Sessions panel shows run with model `claude-opus-4-8`
- [ ] Click Start without changing model → run uses `claude-sonnet-4-6`
- [ ] Type note "What tests are failing?" → session's first prompt contains the note text
- [ ] Leave textarea empty → session starts; first event shows `(no instructions provided)`, RunPanel accepts follow-up input
- [ ] Session's working directory matches the board's primary repo path (visible in the run's info event)
- [ ] Press Escape or click outside → popover closes without starting a session

### Integration / Manual Tests — AI Workflow view

- [ ] Switch to AI Workflow connection → each project pill shows the `MessageSquare` button
- [ ] Click button on project "Hangar" → popover opens
- [ ] Start session → session cwd is `p.repoPath`; title is `"Hangar — Claude"`
- [ ] Sessions overlay shows `agentName: "claude"` for the started run

### Cross-cutting

- [ ] `npm run typecheck` passes with no errors after all changes

## Out of Scope

- Adding the button to the **SkillRunner** overlay or the Sessions view
- Model picker for ticket-based agent/skill runs (agents define their model in frontmatter)
- A custom icon or label for `kind: "chat"` in the Sessions list (falls back to Bot icon)
