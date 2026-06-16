import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Sparkles, X, GitBranch } from "lucide-react";
import { Agent, RunKind, Skill } from "../types";

export function HandoffModal({
  fromLabel,
  agents,
  skills,
  initialNote,
  onRun,
  onCancel,
}: {
  fromLabel: string;
  agents: Agent[];
  skills: Skill[];
  initialNote: string;
  onRun: (name: string, kind: RunKind, note: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<RunKind>("agent");
  const [name, setName] = useState("");
  const [note, setNote] = useState(initialNote);

  useEffect(() => setName(""), [kind]);

  const options = kind === "skill" ? skills : agents;
  const canRun = !!name && !!note.trim();

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">
            <GitBranch size={15} /> Hand off from <b>{fromLabel}</b>
          </span>
          <button className="icon-btn" onClick={onCancel} title="Cancel">
            <X size={16} />
          </button>
        </div>
        <p className="hint">
          Starts a new session in the same repo. The note is pre-filled with the previous result — edit it to
          tell the next agent what to do.
        </p>

        <div className="field">
          <label>Run</label>
          <div className="board-toggles" style={{ width: "fit-content" }}>
            <label className={kind === "agent" ? "pill on" : "pill"}>
              <input type="radio" checked={kind === "agent"} onChange={() => setKind("agent")} />
              <Bot size={13} /> Agent
            </label>
            <label className={kind === "skill" ? "pill on" : "pill"}>
              <input type="radio" checked={kind === "skill"} onChange={() => setKind("skill")} />
              <Sparkles size={13} /> Skill
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
        </div>

        <div className="field">
          <label>Note (handed to the next agent)</label>
          <textarea className="note-input" rows={10} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={!canRun} onClick={() => onRun(name, kind, note)}>
            <GitBranch size={14} /> Hand off
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
