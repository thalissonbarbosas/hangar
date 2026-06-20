# Feature: Standardize Agent/Skill Selects (HAN-2)

## Trunk Metadata
- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-standardize-agent-skill-selects`

## Problem

The Jira board card's **Assign** menu (`AssignMenu` in `Board.tsx`) filters agents and skills to those relevant to the active board/project using three cascading rules:

1. `board.agents` allow-list (empty = all agents)
2. `board.resolvedPaths` path filter (repo skills only from this board's paths)
3. `board.skills` allow-list (empty = all path-filtered skills)

The **session sidebar handoff modal** (`HandoffModal`) and the **Run page** (`SkillRunner`) both receive the *full* unfiltered agent and skill lists from `App.tsx` — so a user working on a board with a scoped skill set sees every installed skill/agent in those two places, breaking consistency.

Affected users: anyone who has multiple boards or scoped skill/agent lists configured.

## Solution

Apply the same board-based filtering logic already present in `Board.tsx` to both `HandoffModal` and `SkillRunner`:

- **HandoffModal**: The active run always carries a `ticketKey`. Extract the board key from that key (text before the first `-`), find the matching `BoardConfig`, and pass board-filtered lists to `RunPanel` → `HandoffModal`. Falls back to unfiltered lists when the ticket key doesn't map to a known board (standalone/ad-hoc runs).
- **SkillRunner**: The "Working directory" selector already maps to a board's `resolvedPaths`. When a cwd is selected, derive the matching board and apply its filtering. When "Default (server working dir)" is selected, show all agents/skills (no restriction).

No visual redesign is needed — the filtering plumbs through the existing `<select>` elements in both components.

## Technical Design

### Architecture

Four files change; no new files, no API changes, no schema changes.

```
web/src/utils.ts            ← new filterByBoard() utility (extracts Board.tsx logic)
web/src/App.tsx             ← derive activeRunAgents/activeRunSkills; pass boards to SkillRunner
web/src/components/SkillRunner.tsx  ← accept boards prop; filter by selected cwd
web/src/components/HandoffModal.tsx ← no change needed (filtering happens upstream)
```

### API Changes

None. The server already returns `resolvedPaths` in `/api/config` → `BoardConfig`.

### Data Model

No schema changes.

### Component Changes

#### 1. `web/src/utils.ts` — add `filterByBoard`

```ts
import { Agent, BoardConfig, Skill } from "./types"; // add to existing imports

/**
 * Apply the same board-scoped agent/skill filtering used in Board.tsx.
 * Pass board=null to get back the original unfiltered lists unchanged.
 */
export function filterByBoard(
  board: BoardConfig | null,
  agents: Agent[],
  skills: Skill[],
): { agents: Agent[]; skills: Skill[] } {
  if (!board) return { agents, skills };
  const filteredAgents = board.agents?.length
    ? agents.filter((a) => board.agents!.includes(a.name))
    : agents;
  const pathFiltered = board.resolvedPaths?.length
    ? skills.filter((s) => s.source !== "repo" || board.resolvedPaths!.includes(s.repoPath ?? ""))
    : skills;
  const filteredSkills = board.skills?.length
    ? pathFiltered.filter((s) => board.skills!.includes(s.name))
    : pathFiltered;
  return { agents: filteredAgents, skills: filteredSkills };
}
```

#### 2. `web/src/App.tsx` — filter for active run's board

Add a `useMemo` **alongside** the existing `enrichedSkills` memo:

```ts
// Board-scoped filtering for the active run's HandoffModal.
// Extract board key = text before the first "-" in ticketKey (e.g. "PP" from "PP-123").
// Ad-hoc/standalone runs use "ad-hoc" or a title with no "-" → no board match → full list.
const { agents: activeRunAgents, skills: activeRunSkills } = useMemo(() => {
  if (!activeRun) return { agents, skills: enrichedSkills };
  const boardKey = activeRun.ticketKey.split("-")[0];
  const board = boards.find((b) => b.key === boardKey) ?? null;
  return filterByBoard(board, agents, enrichedSkills);
}, [activeRun, boards, agents, enrichedSkills]);
```

Replace the existing `RunPanel` call site (lines ~602–611):

```tsx
<RunPanel
  runId={activeRun.runId}
  ticketKey={activeRun.ticketKey}
  agentName={activeRun.agentName}
  ticketUrl={activeRun.ticketUrl}
  agents={activeRunAgents}       // ← was: agents
  skills={activeRunSkills}       // ← was: enrichedSkills
  onHandoff={handoff}
  onClose={() => setActiveRun(null)}
/>
```

Also pass `boards` to `SkillRunner`:

```tsx
<SkillRunner
  agents={agents}
  skills={enrichedSkills}
  codebasePaths={codebasePaths}
  boards={boards}                // ← new prop
  onRun={runStandalone}
/>
```

#### 3. `web/src/components/SkillRunner.tsx` — filter by selected cwd

Add `boards: BoardConfig[]` to the props interface and import `filterByBoard` + `BoardConfig`:

```ts
import { Agent, BoardConfig, RunKind, Skill } from "../types";
import { filterByBoard } from "../utils";
```

Add two memos inside the component body:

```ts
// Derive the board whose resolvedPaths contains the selected cwd.
const activeBoard = useMemo((): BoardConfig | null => {
  if (!cwd) return null;
  return (
    boards.find((b) => (b.resolvedPaths ?? [b.repoPath].filter(Boolean) as string[]).includes(cwd)) ??
    null
  );
}, [cwd, boards]);

const { agents: filteredAgents, skills: filteredSkills } = useMemo(
  () => filterByBoard(activeBoard, agents, skills),
  [activeBoard, agents, skills],
);
```

Reset name when switching cwd causes the selected item to disappear:

```ts
// Reset selected name if it is no longer available after a cwd change.
useEffect(() => {
  const opts = kind === "skill" ? filteredSkills : filteredAgents;
  if (name && !opts.some((o) => o.name === name)) setName("");
}, [filteredAgents, filteredSkills, kind, name]);
```

Replace `options` derivation:

```ts
const options = kind === "skill" ? filteredSkills : filteredAgents;
```

(The existing `const options = kind === "skill" ? skills : agents;` line is updated in-place — no structural change to the render.)

## Security Considerations

No new endpoints, no user input sent to the server, no authentication changes. The filtering is purely client-side display logic operating on data already fetched from `/api/config`, `/api/agents`, and `/api/skills`. No PHI or credentials involved.

## Feature Flag

None — slice is user-ready on merge. The change is additive (narrowing displayed lists) and degrades gracefully: a board with no `agents`/`skills`/`resolvedPaths` restrictions passes through unchanged.

## Verification Criteria

### Unit Tests

- [ ] `filterByBoard(null, agents, skills)` → returns `{ agents, skills }` unchanged
- [ ] `filterByBoard(board with agents:["a1"], allAgents, skills)` → only `a1` in result agents
- [ ] `filterByBoard(board with resolvedPaths:["/repo/A"], allAgents, mixedSkills)` → repo skills from `/repo/B` excluded; user-scoped skills kept
- [ ] `filterByBoard(board with skills:["spec"], allAgents, allSkills)` → only `spec` in result skills
- [ ] `filterByBoard(board with empty agents:[], allAgents, skills)` → all agents returned (no restriction)
- [ ] Cascading: `resolvedPaths` filter then `skills` allow-list narrows correctly

### Integration / Manual Tests

- [ ] **HandoffModal — board run**: start a run for a ticket on board `PP`. Open the handoff modal. The agent list shows only agents in `board.agents` (or all if `board.agents` is empty). The skill list respects `board.resolvedPaths` and `board.skills`.
- [ ] **HandoffModal — ad-hoc run**: start a standalone run from the Run page with no cwd. Open the handoff modal. All agents and skills are shown (no restriction).
- [ ] **SkillRunner — cwd selected**: select a working directory that belongs to board `PP`. The agent and skill dropdowns narrow to that board's configured lists.
- [ ] **SkillRunner — no cwd**: "Default (server working dir)" selected. All agents and skills shown.
- [ ] **SkillRunner — cwd switch**: pick a cwd with a filtered agent selected, then switch to a cwd from a different board that doesn't include that agent. The selected agent resets to the placeholder.
- [ ] **Board card unchanged**: the `AssignMenu` behavior is identical before and after (it doesn't use `filterByBoard` — it keeps its own inline logic; no regression).

## Out of Scope

- Replacing the `<select>` in `HandoffModal` / `SkillRunner` with the rich popup UI from `AssignMenu` — visual redesign is a separate concern.
- Stage-aware (`columnSkills`) filtering for `HandoffModal` or `SkillRunner` — that's AIWF-specific and not applicable outside the board card context.
- Adding a board selector UI to `SkillRunner` for cases where cwd doesn't map to a known board.
