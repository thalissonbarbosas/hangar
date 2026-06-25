# Feature: Hand-off Modal Dropdown Design (HAN-18)

## Trunk Metadata
- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-handoff-modal-dropdown-design`

## Problem

The hand-off modal (`HandoffModal.tsx`) selects an agent or skill through a plain native
`<select className="runner-select">` element. Visually this is inconsistent with the
board card's **Assign menu** (`AssignMenu` in `Board.tsx`), which uses a rich inline popover
showing each item with its icon, name, repo badge, and model tag — and groups skills by
project with colour-coded tabs.

The gap matters because both surfaces serve the same purpose (pick an agent or skill to
run), but they look and behave completely differently.

## Solution

Replace the kind-toggle + `<select>` pair in `HandoffModal` with an **inline two-column
panel** that reuses the same `assign-pop` CSS vocabulary as `AssignMenu`:

- Left column: Agents (icon, name, model)
- Right column: Skills (icon, name, repo badge when ungrouped, model), with project tabs
  when multiple repos/projects are present
- Clicking a row selects it (highlighted state); a second click on the same row deselects
- The "Hand off" button stays disabled until a selection is made
- The note textarea is unchanged

The kind radio-toggle (Agent / Skill) is removed — the inline panel surfaces both at once,
just as the board card does.

A new shared component `AgentSkillPicker` encapsulates the panel so `HandoffModal` stays
thin; `Board.tsx` keeps its own `ItemRow` unchanged.

## Technical Design

### Architecture

Three files change; one new file is added.

```
web/src/components/AgentSkillPicker.tsx   ← NEW  inline picker panel
web/src/components/HandoffModal.tsx       ← replace select with AgentSkillPicker
web/src/styles.css                        ← .handoff-picker + .assign-item-main.selected
```

`Board.tsx` is **not touched** — its `ItemRow` and `AssignMenu` remain independent.

### API Changes

None.

### Data Model

None.

### Component Changes

#### 1. `web/src/components/AgentSkillPicker.tsx` — new file (~65 lines)

```tsx
import { useMemo, useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import { Agent, RunKind, Skill } from "../types";
import { projectColor, skillProject } from "../utils";

export function AgentSkillPicker({
  agents,
  skills,
  selectedName,
  selectedKind,
  onSelect,
}: {
  agents: Agent[];
  skills: Skill[];
  selectedName: string;
  selectedKind: RunKind | null;
  onSelect: (name: string, kind: RunKind) => void;
}) {
  const [activeProj, setActiveProj] = useState<string | null>(null);

  const skillGroups = useMemo(() => {
    const groups = new Map<string, Skill[]>();
    for (const s of skills) {
      const proj = skillProject(s) ?? "other";
      if (!groups.has(proj)) groups.set(proj, []);
      groups.get(proj)!.push(s);
    }
    for (const [, sk] of groups) sk.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, [skills]);

  const projKeys = useMemo(() => [...skillGroups.keys()], [skillGroups]);
  const effectiveProj =
    activeProj && skillGroups.has(activeProj) ? activeProj : (projKeys[0] ?? null);
  const visibleSkills = effectiveProj !== null ? (skillGroups.get(effectiveProj) ?? []) : [];

  function select(name: string, kind: RunKind) {
    // clicking the already-selected item deselects
    onSelect(selectedName === name && selectedKind === kind ? "" : name, kind);
  }

  return (
    <div className="assign-pop handoff-picker">
      <div className="assign-col">
        <div className="assign-col-head">
          <Bot size={12} /> Agents
        </div>
        {agents.length === 0 && <div className="assign-empty">No agents configured</div>}
        {agents.map((a) => (
          <div key={a.name} className="assign-item">
            <button
              className={`assign-item-main${selectedName === a.name && selectedKind === "agent" ? " selected" : ""}`}
              title={a.description}
              onClick={() => select(a.name, "agent")}
            >
              <Bot size={12} />
              <span className="ami-name">{a.name}</span>
              {a.model && <span className="ami-model">{a.model}</span>}
            </button>
          </div>
        ))}
      </div>
      <div className="assign-col">
        <div className="assign-col-head">
          <Sparkles size={12} /> Skills
        </div>
        {projKeys.length > 1 && (
          <div className="assign-skill-tabs">
            {projKeys.map((proj) => {
              const color = proj !== "other" ? projectColor(proj) : undefined;
              return (
                <button
                  key={proj}
                  className={`assign-skill-tab${effectiveProj === proj ? " active" : ""}`}
                  style={color ? ({ "--tab-color": color } as React.CSSProperties) : undefined}
                  onClick={() => setActiveProj(proj)}
                >
                  {proj}
                </button>
              );
            })}
          </div>
        )}
        {skills.length === 0 && <div className="assign-empty">No skills found</div>}
        {visibleSkills.map((s) => (
          <div key={`${s.name}:${s.repo ?? ""}`} className="assign-item">
            <button
              className={`assign-item-main${selectedName === s.name && selectedKind === "skill" ? " selected" : ""}`}
              title={s.description}
              onClick={() => select(s.name, "skill")}
            >
              <Sparkles size={12} />
              <span className="ami-name">{s.name}</span>
              {projKeys.length <= 1 && s.repo && (
                <span className="ami-repo" style={{ color: projectColor(s.repo) }}>
                  ({s.repo})
                </span>
              )}
              {s.model && <span className="ami-model">{s.model}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 2. `web/src/components/HandoffModal.tsx` — replace select UI (~15 lines net delta)

- Remove `const [kind, setKind] = useState<RunKind>("agent")` and the kind-toggle `<div className="field">` block
- Change `const [name, setName] = useState("")` → keep `name`; add `const [kind, setKind] = useState<RunKind | null>(null)`
- Remove the agent/skill `<select>` field entirely
- Add `<AgentSkillPicker>` import and render it in its place:

```tsx
import { AgentSkillPicker } from "./AgentSkillPicker";
// ...
const [name, setName] = useState("");
const [kind, setKind] = useState<RunKind | null>(null);
// ...
const canRun = !!name && !!kind && !!note.trim();
// ...
<div className="field">
  <label>Agent or Skill</label>
  <AgentSkillPicker
    agents={agents}
    skills={skills}
    selectedName={name}
    selectedKind={kind}
    onSelect={(n, k) => { setName(n); setKind(n ? k : null); }}
  />
</div>
// ...
<button ... onClick={() => onRun(name, kind!, note)}>
```

#### 3. `web/src/styles.css` — add ~12 lines after the `.assign-skill-tab.active` block

```css
/* Inline picker inside hand-off modal */
.handoff-picker {
  position: static;          /* override fixed from assign-pop default context */
  width: 100%;
  max-height: 260px;
  box-shadow: none;
  border-radius: var(--r-md);
}
.assign-item-main.selected {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
```

## Security Considerations

No endpoints, no server calls, no user data transmitted. The picker is pure client-side
display over lists already fetched from `/api/agents` and `/api/skills`. No PHI or
credentials involved.

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Unit Tests
- [ ] `AgentSkillPicker`: clicking an agent row calls `onSelect(name, "agent")`
- [ ] `AgentSkillPicker`: clicking the already-selected row calls `onSelect("", kind)` (deselect)
- [ ] `AgentSkillPicker`: skills with multiple repos render project tabs; single-repo shows repo badge inline
- [ ] `HandoffModal`: "Hand off" button is disabled with no selection; enabled once name + kind + note are set
- [ ] `HandoffModal`: `onRun` is called with `(name, kind, note)` on submit

### E2E / Manual Tests
- [ ] Open a session's run panel → click "Hand off" → modal opens with the inline picker; no native `<select>` visible
- [ ] Both Agents and Skills columns are visible side by side; scroll works independently within each column
- [ ] Clicking an agent highlights it; clicking the same agent un-highlights; clicking a skill deselects the agent and highlights the skill
- [ ] Skills with multiple project origins show coloured project tabs; clicking a tab filters the skill list
- [ ] "Hand off" button remains greyed out until an item is selected and a note is written
- [ ] Board card **Assign** menu is visually unchanged (regression check)
- [ ] `SkillRunner` page is visually unchanged (regression check)

## Out of Scope
- Updating `SkillRunner`'s agent/skill `<select>` — a separate follow-up if desired
- Adding per-item "run with note" (StickyNote) buttons inside the handoff picker — the modal already has a dedicated note textarea
- Extracting `ItemRow` from `Board.tsx` into `AgentSkillPicker` — Board's `ItemRow` includes a note button and different click semantics; keeping them separate avoids coupling
