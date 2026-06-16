import {
  Bot,
  Square,
  ExternalLink,
  Loader2,
  ShieldQuestion,
  CheckCircle2,
  AlertCircle,
  Activity,
  Trash2,
  GitPullRequest,
  Sparkles,
} from "lucide-react";
import { RunState, RunSummary, isActive } from "../types";

function StateChip({ state }: { state: RunState }) {
  const map: Record<RunState, { label: string; cls: string; icon: JSX.Element }> = {
    queued: { label: "Queued", cls: "await", icon: <Loader2 size={12} /> },
    starting: { label: "Starting", cls: "running", icon: <Loader2 size={12} className="spin" /> },
    running: { label: "Running", cls: "running", icon: <Loader2 size={12} className="spin" /> },
    awaiting_input: { label: "Needs approval", cls: "await", icon: <ShieldQuestion size={12} /> },
    done: { label: "Done", cls: "done", icon: <CheckCircle2 size={12} /> },
    error: { label: "Error", cls: "error", icon: <AlertCircle size={12} /> },
    stopped: { label: "Stopped", cls: "stopped", icon: <Square size={12} /> },
  };
  const m = map[state];
  return (
    <span className={`run-badge ${m.cls}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

function ago(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

export function SessionsView({
  runs,
  onOpenRun,
  onStop,
  onDelete,
  onClear,
}: {
  runs: RunSummary[];
  onOpenRun: (run: RunSummary) => void;
  onStop: (runId: string) => void;
  onDelete: (runId: string) => void;
  onClear: (scope: "finished" | "all") => void;
}) {
  const active = runs.filter((r) => isActive(r.state));
  const finished = runs.length - active.length;

  return (
    <div className="sessions-view">
      <div className="sessions-head">
        <h2>
          <Activity size={18} /> Sessions
        </h2>
        <span className="hint">
          {active.length} active · {runs.length} total
        </span>
        <span className="sessions-head-actions">
          <button className="btn-ghost sm" disabled={finished === 0} onClick={() => onClear("finished")}>
            <Trash2 size={13} /> Clear finished
          </button>
          <button className="btn-ghost danger sm" disabled={runs.length === 0} onClick={() => onClear("all")}>
            <Trash2 size={13} /> Clear all
          </button>
        </span>
      </div>

      {runs.length === 0 && <div className="empty">No sessions yet. Assign an agent to a ticket to start one.</div>}

      <div className="sessions-list">
        {runs.map((r) => (
          <div className={`session-row${isActive(r.state) ? " active" : ""}`} key={r.id}>
            <StateChip state={r.state} />
            {r.ticketUrl ? (
              <a className="session-ticket" href={r.ticketUrl} target="_blank" rel="noreferrer" title="Open in Jira">
                {r.ticketKey} <ExternalLink size={11} />
              </a>
            ) : (
              <span className="session-ticket">{r.ticketKey || "ad-hoc"}</span>
            )}
            <span className="session-arrow">→</span>
            <span className="session-agent">
              {r.kind === "skill" ? <Sparkles size={13} /> : <Bot size={13} />} {r.agentName}
            </span>
            {isActive(r.state) && r.phase && (
              <span className="session-phase" title="Current step">
                {r.phase}
              </span>
            )}
            {r.prUrl && (
              <a className="session-pr" href={r.prUrl} target="_blank" rel="noreferrer" title={r.prUrl}>
                <GitPullRequest size={12} /> PR
              </a>
            )}
            <span className="session-meta">
              {r.model} · {ago(r.startedAt)}
              {typeof r.costUsd === "number" ? ` · $${r.costUsd.toFixed(4)}` : ""}
            </span>
            <span className="session-actions">
              {isActive(r.state) && (
                <button className="btn-ghost danger sm" onClick={() => onStop(r.id)} title="Stop">
                  <Square size={13} /> Stop
                </button>
              )}
              <button className="btn-ghost sm" onClick={() => onOpenRun(r)} title="Open session">
                <ExternalLink size={13} /> Open
              </button>
              <button className="icon-btn sm" onClick={() => onDelete(r.id)} title="Delete session">
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
