import { useEffect, useState } from "react";
import { Sparkles, Bot, Play, FolderGit2 } from "lucide-react";
import { Agent, RunKind, Skill } from "../types";

export function SkillRunner({
  agents,
  skills,
  codebasePaths,
  onRun,
}: {
  agents: Agent[];
  skills: Skill[];
  codebasePaths: string[];
  onRun: (name: string, kind: RunKind, note: string, cwd?: string, title?: string) => void;
}) {
  const [kind, setKind] = useState<RunKind>("skill");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [cwd, setCwd] = useState("");

  useEffect(() => setName(""), [kind]); // reset selection when switching kind

  const options = kind === "skill" ? skills : agents;
  const canRun = !!name && !!note.trim();

  function run() {
    if (!canRun) return;
    onRun(name, kind, note, cwd || undefined, `${name}`);
    setNote("");
  }

  return (
    <div className="settings">
      <section className="card-panel">
        <h2>
          <Sparkles size={17} /> Run a skill or agent
        </h2>
        <p className="hint">
          Run an ad-hoc task — no Jira ticket required. Mention ticket keys or links in the note if
          you want the agent to pull them in.
        </p>

        <div className="field">
          <label>What to run</label>
          <div className="board-toggles" style={{ width: "fit-content" }}>
            <label className={kind === "skill" ? "pill on" : "pill"}>
              <input type="radio" checked={kind === "skill"} onChange={() => setKind("skill")} />
              <Sparkles size={13} /> Skill
            </label>
            <label className={kind === "agent" ? "pill on" : "pill"}>
              <input type="radio" checked={kind === "agent"} onChange={() => setKind("agent")} />
              <Bot size={13} /> Agent
            </label>
          </div>
        </div>

        <div className="field">
          <label>{kind === "skill" ? "Skill" : "Agent"}</label>
          <select className="runner-select" value={name} onChange={(e) => setName(e.target.value)}>
            <option value="">Select a {kind}…</option>
            {options.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
          {name && <p className="hint">{options.find((o) => o.name === name)?.description}</p>}
        </div>

        <div className="field">
          <label>Task / note</label>
          <textarea
            className="note-input"
            rows={6}
            placeholder={
              kind === "skill"
                ? "e.g. Draft a Jira comment for PP-1234 explaining the eligibility fix."
                : "Describe what you want the agent to do…"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="field">
          <label>
            <FolderGit2 size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            Working directory
          </label>
          <select className="runner-select" value={cwd} onChange={(e) => setCwd(e.target.value)}>
            <option value="">Default (server working dir)</option>
            {codebasePaths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="row save-row">
          <button className="btn" disabled={!canRun} onClick={run}>
            <Play size={14} /> Run
          </button>
          {!canRun && <span className="hint">Pick {kind === "skill" ? "a skill" : "an agent"} and write a task.</span>}
        </div>
      </section>
    </div>
  );
}
