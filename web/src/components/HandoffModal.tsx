import { useState } from "react";
import { createPortal } from "react-dom";
import { X, GitBranch } from "lucide-react";
import { Agent, RunKind, Skill } from "../types";
import { AgentSkillPicker } from "./AgentSkillPicker";

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
  const [name, setName] = useState("");
  const [kind, setKind] = useState<RunKind | null>(null);
  const [note, setNote] = useState(initialNote);

  const canRun = !!name && !!kind && !!note.trim();

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
          <label>Agent or Skill</label>
          <AgentSkillPicker
            agents={agents}
            skills={skills}
            selectedName={name}
            selectedKind={kind}
            onSelect={(n, k) => {
              setName(n);
              setKind(k);
            }}
          />
        </div>

        <div className="field">
          <label>Note (handed to the next agent)</label>
          <textarea className="note-input" rows={10} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={!canRun} onClick={() => onRun(name, kind!, note)}>
            <GitBranch size={14} /> Hand off
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
