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
  onSelect: (name: string, kind: RunKind | null) => void;
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
  const effectiveProj = activeProj && skillGroups.has(activeProj) ? activeProj : (projKeys[0] ?? null);
  const visibleSkills = effectiveProj !== null ? (skillGroups.get(effectiveProj) ?? []) : [];

  function select(name: string, kind: RunKind) {
    // clicking the already-selected item deselects it; null kind signals "nothing selected"
    const isDeselect = selectedName === name && selectedKind === kind;
    onSelect(isDeselect ? "" : name, isDeselect ? null : kind);
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
