# Feature: Agent/Skill Selection in the Project "Start Claude Session" (HAN-44)

## Trunk Metadata
- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-orphan-session-agent-skill`

## Problem

The project "Start Claude session" popover (`ClaudeSessionButton` in `web/src/components/Board.tsx`,
reused by the Jira board header and each AI Workflow project) starts an **orphan session** — a
plain `kind: "chat"` Claude session scoped to a repo path. Today it only lets the operator pick a
**model** (Haiku / Sonnet / Opus) and type an optional note.

There is no way to start that repo-scoped orphan session *as a specific agent or skill*. To do
that the operator must fall back to the Run overlay (`SkillRunner`) and re-pick the working
directory. The session sidebar **hand-off modal** (`HandoffModal`) already offers a clean
agent/skill chooser (`AgentSkillPicker`) — the orphan-session popover should offer the same.

Affected users: anyone starting a scoped session from a board header or AIWF project pill who
wants an agent/skill rather than a bare chat.

## Solution

Add the shared `AgentSkillPicker` to the `ClaudeSessionButton` popover, above the existing model
pills and note, exactly like the hand-off modal. Selection is **optional**:

- **Nothing selected** → unchanged behavior: a plain `kind: "chat"` session on the chosen model.
- **Agent selected** → a standalone `kind: "agent"` run scoped to the same cwd, note as its task.
- **Skill selected** → a standalone `kind: "skill"` run scoped to the same cwd, note as its task.

The server's standalone `POST /api/runs` path already accepts `{ name, kind, note, cwd, title,
model }` and maps `model` as `modelOverride` (`server/src/routes/runs.ts` → `startRun`), so **no
server change is required**. The work is client-side plumbing plus reusing `AgentSkillPicker`.

### Model / agent-frontmatter interaction

Per the chosen behavior — *frontmatter wins unless touched*:

- The popover tracks whether the operator explicitly clicked a model pill (`modelTouched`).
- **chat / skill** (no frontmatter model to defer to) → always send the selected pill as `model`.
- **agent** → send the pill as `model` **only if `modelTouched`**; otherwise omit `model` so the
  agent's own `model:` frontmatter wins (avoids silently downgrading e.g. an Opus agent to Sonnet).

### Note requirement

The standalone agent/skill path 400s on an empty note (`runs.ts` guard). So:

- **Agent/skill selected** → the Start button is disabled until the note is non-empty (matches
  `HandoffModal`).
- **Chat (nothing selected)** → note stays optional (unchanged).

## Technical Design

### API Changes

None on the server. Client `web/src/api.ts` — extend `startStandalone` with an optional `model`:

```ts
startStandalone: (name: string, kind: RunKind, note: string, cwd?: string, title?: string, model?: string) =>
  sendJson<StartRunResult>("POST", "/api/runs", { name, kind, note, cwd, title, model }),
```

`startClaude` is unchanged and still used for the plain-chat case.

### Data Model

No schema changes. Chat runs remain `kind: "chat"`; agent/skill orphan runs reuse the existing
standalone `kind: "agent" | "skill"` records.

### Architecture

Files changed (no new files):

```
web/src/api.ts                    ← add optional model arg to startStandalone
web/src/components/Board.tsx      ← ClaudeSessionButton: accept agents/skills, render AgentSkillPicker,
                                     track selection + modelTouched, branch onStart; pass boardAgents/boardSkills at render
web/src/App.tsx                   ← openClaudeSession branches chat vs standalone; pass agents to AiWorkflowView
web/src/components/AiWorkflow.tsx ← AiWorkflowView accepts agents; pass to ClaudeSessionButton
```

No `docs/AI_WORKFLOW.md` change: this touches neither the AIWF routes, board model, phases/skills,
config shape, install flow, nor card format — only a UI affordance on the project-header session
button, which the doc does not enumerate.

### Component Changes

#### `web/src/components/Board.tsx` — `ClaudeSessionButton`

Add to props: `agents: Agent[]` and `skills: Skill[]`. Change the `onStart` signature to carry the
selection and model-override intent:

```ts
onStart: (opts: {
  name?: string;         // undefined → plain chat
  kind?: RunKind | null; // "agent" | "skill" | null
  model: string;         // selected pill (haiku|sonnet|opus)
  modelTouched: boolean; // whether the operator clicked a pill
  note?: string;
}) => Promise<string>;
```

Internal state additions: `name: string`, `kind: RunKind | null` (drives the picker), and
`modelTouched: boolean` (set true in the pill `onClick`). Render `<AgentSkillPicker agents={agents}
skills={skills} selectedName={name} selectedKind={kind} onSelect={(n,k) => { setName(n); setKind(k); }} />`
above the model `seg`.

`canRun`: `true` when no selection (chat, note optional) **or** when a selection exists and
`note.trim()` is non-empty. Disable the Start button accordingly.

`start()` calls `onStart({ name: name || undefined, kind, model, modelTouched, note: note.trim() || undefined })`,
stores the returned `runId` in `localStorage` (unchanged), closes, and resets `name`/`kind`/`note`/`modelTouched`.

At the two render sites in `Board.tsx`, pass the already-computed board-scoped lists so the orphan
session respects the same filtering as the Assign menu:

```tsx
<ClaudeSessionButton cwd={primaryCwd} title={`${board.name} — Claude`} runs={runs}
  agents={boardAgents} skills={boardSkills} onOpenRun={onOpenRun}
  onStart={(o) => onStartClaude(primaryCwd, `${board.name} — Claude`, o)} />
```

#### `web/src/App.tsx` — `openClaudeSession`

Change the handler to accept the option object and branch on selection:

```ts
function openClaudeSession(cwd: string, title: string, o: {
  name?: string; kind?: RunKind | null; model: string; modelTouched: boolean; note?: string;
}): Promise<string> {
  setError(null);
  // agent → send model only when the operator explicitly picked one (frontmatter wins otherwise).
  const call = o.name && o.kind
    ? api.startStandalone(o.name, o.kind, o.note ?? "", cwd, title,
        o.kind === "agent" && !o.modelTouched ? undefined : o.model)
    : api.startClaude(cwd, title, o.model, o.note || undefined);
  return call
    .then((r) => {
      setActiveRun({ runId: r.runId, ticketKey: title, agentName: o.name ?? "claude" });
      refreshRuns();
      return r.runId;
    })
    .catch((e) => { setError(String(e.message ?? e)); throw e; });
}
```

Also pass `agents={agents}` to `<AiWorkflowView>` (it currently only receives `skills`).

#### `web/src/components/AiWorkflow.tsx` — `AiWorkflowView`

Add `agents: Agent[]` to props; forward `agents` (and the existing `skills`) to the
`ClaudeSessionButton` render at ~line 805, and update its `onStart` to pass the option object
through to `onStartClaude`.

The `onStartClaude` prop type in both `Board.tsx` and `AiWorkflow.tsx` updates to the new option
object signature.

## Security Considerations

No new endpoints. `cwd` is still server-expanded and existence-checked in `startRun`; `model` is
mapped through `mapModel` (unknown → SDK default). Agent/skill names are validated server-side
(404 on unknown) exactly as the existing standalone path. Board-scoped filtering means the picker
only surfaces agents/skills already permitted for that board. No PHI or credentials involved.
Reference `docs/THREAT_MODEL.md` — this reuses the standalone-run surface with no new vectors.

## Feature Flag

None — user-ready on merge. Selection is additive and optional; leaving the picker untouched
preserves the current plain-chat behavior exactly.

## Verification Criteria

### Unit / Integration Tests (server — `server/src/__tests__/index.test.ts`)

- [ ] `POST /api/runs` `{ kind: "agent", name: <known>, cwd, title, note: "do x", model: "opus" }` → `200`, run `kind: "agent"`, model mapped to the opus id.
- [ ] `POST /api/runs` `{ kind: "agent", name: <known>, cwd, title, note: "do x" }` (no `model`) → `200`, run uses the agent's frontmatter model.
- [ ] `POST /api/runs` `{ kind: "skill", name: <known>, cwd, title, note: "" }` → `400` (empty-note guard unchanged).
- [ ] `POST /api/runs` `{ kind: "chat", cwd, title }` (no name, no note) → still `200` (regression guard).

### Manual Tests — Jira board header

- [ ] Board with a repo path → the ✉/MessageSquare button opens the popover showing the `AgentSkillPicker`, model pills, and note.
- [ ] Nothing selected + note empty → Start enabled → plain chat session starts (unchanged), `agentName: "claude"`.
- [ ] Select an agent whose frontmatter is Opus, do **not** touch the pills, add a note → run starts as that agent on **Opus** (frontmatter honored).
- [ ] Select the same agent, click **Sonnet**, add a note → run starts as that agent on **Sonnet** (explicit override).
- [ ] Select an agent, leave note empty → Start disabled.
- [ ] Select a skill + note → standalone skill run in the board's primary cwd.
- [ ] Picker only lists the board's allowed agents/skills (respects `board.agents` / `board.skills` / `resolvedPaths`).

### Manual Tests — AI Workflow project

- [ ] AIWF project pill button opens the same popover with agents + skills populated.
- [ ] Selecting an agent/skill starts a run scoped to `project.repoPath`; title `"<project> — Claude"`.

### Cross-cutting

- [ ] `npm run typecheck` passes.
- [ ] `npm run lint -- --max-warnings=2` passes.
- [ ] `npm --prefix server test` passes.
- [ ] `npm run format:check` passes.

## Out of Scope

- Replacing the model pills with anything other than the existing segmented control.
- Adding agent/skill selection to `SkillRunner` (already has its own selector) or to ticket-based board-card assignment.
- Persisting the last-used agent/skill per cwd (only the last `runId` is remembered today).
- Any change to the server's `POST /api/runs` contract or run model.
