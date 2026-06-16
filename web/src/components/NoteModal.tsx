import { useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Sparkles, X, Play } from "lucide-react";

export function NoteModal({
  ticketKey,
  name,
  kind,
  onRun,
  onCancel,
}: {
  ticketKey: string;
  name: string;
  kind: "agent" | "skill";
  onRun: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">
            {kind === "skill" ? <Sparkles size={15} /> : <Bot size={15} />}
            Run <b>{name}</b> on <span className="mono">{ticketKey}</span>
          </span>
          <button className="icon-btn" onClick={onCancel} title="Cancel">
            <X size={16} />
          </button>
        </div>
        <p className="hint">This note is added to the task context — it doesn't replace anything.</p>
        <textarea
          className="note-input"
          autoFocus
          rows={5}
          placeholder="e.g. Focus on the eligibility mapping; the customer says it broke after the last release."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onRun(note);
          }}
        />
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" onClick={() => onRun(note)}>
            <Play size={14} /> Run with note
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
