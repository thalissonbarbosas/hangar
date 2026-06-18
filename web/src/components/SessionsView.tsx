import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
  RotateCcw,
  Play,
  Terminal,
  X,
} from "lucide-react";
import { AiwfProject, BoardConfig, RunState, RunSummary, isActive } from "../types";

// Stable key for runs without a ticketKey (standalone / ad-hoc skill runs).
const ADHOC_KEY = "__adhoc__";
const ADHOC_LABEL = "Ad-hoc";

/** Resolve which project a run belongs to: AI Workflow > Jira board > ad-hoc. */
export function projectOf(
  run: RunSummary,
  boards: BoardConfig[],
  aiwfProjects: AiwfProject[],
): { key: string; label: string } {
  // 1. AI Workflow run — look up by id; fall back to the raw id string if not found.
  if (run.aiwfProjectId) {
    const proj = aiwfProjects.find((p) => p.id === run.aiwfProjectId);
    return proj ? { key: proj.id, label: proj.name } : { key: run.aiwfProjectId, label: run.aiwfProjectId };
  }
  // 2. Jira-board run — strip trailing `-<number>` to get the board key prefix.
  if (run.ticketKey) {
    const prefix = run.ticketKey.replace(/-\d+$/, "");
    const board = boards.find((b) => b.key === prefix);
    return board ? { key: prefix, label: board.name } : { key: prefix, label: prefix };
  }
  // 3. No ticketKey — ad-hoc bucket.
  return { key: ADHOC_KEY, label: ADHOC_LABEL };
}

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
  boards,
  aiwfProjects,
  onOpenRun,
  onStop,
  onDelete,
  onResume,
  onClear,
  onOpenInTerminal,
  terminalConfigured,
}: {
  runs: RunSummary[];
  boards: BoardConfig[];
  aiwfProjects: AiwfProject[];
  onOpenRun: (run: RunSummary) => void;
  onStop: (runId: string) => void;
  onDelete: (runId: string) => void;
  onResume: (runId: string, text: string) => void;
  onClear: (scope: "finished" | "all", runIds?: string[]) => void;
  onOpenInTerminal: (runId: string) => void;
  terminalConfigured: boolean;
}) {
  const [pendingResume, setPendingResume] = useState<RunSummary | null>(null);
  const [resumeText, setResumeText] = useState("");
  // Set when the operator clicks "Open in terminal" without a terminal configured (warn once).
  const [terminalWarning, setTerminalWarning] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("All");

  // Header counts always reflect all runs, not the filtered subset.
  const active = runs.filter((r) => isActive(r.state));
  const finished = runs.length - active.length;

  // Build ordered tab list: All first, then projects by descending count, ad-hoc last.
  // Memoised so the fallback useEffect only fires when the tab list actually changes.
  const tabs = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const run of runs) {
      const { key, label } = projectOf(run, boards, aiwfProjects);
      const entry = counts.get(key);
      if (entry) {
        entry.count++;
      } else {
        counts.set(key, { label, count: 1 });
      }
    }
    const projects = [...counts.entries()]
      .map(([key, { label, count }]) => ({ key, label, count }))
      .sort((a, b) => {
        // Ad-hoc always last.
        if (a.key === ADHOC_KEY) return 1;
        if (b.key === ADHOC_KEY) return -1;
        // Descending count, then alphabetical by label.
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
    return [{ key: "All", label: "All", count: runs.length }, ...projects];
  }, [runs, boards, aiwfProjects]);

  // If the active project tab disappears (e.g. its last session was cleared), fall back to All.
  useEffect(() => {
    if (activeTab !== "All" && !tabs.some((t) => t.key === activeTab)) {
      setActiveTab("All");
    }
  }, [tabs, activeTab]);

  // Filter the list for the active tab; preserve the incoming active-first / newest-first order.
  const visibleRuns =
    activeTab === "All" ? runs : runs.filter((r) => projectOf(r, boards, aiwfProjects).key === activeTab);

  function openInTerminal(runId: string) {
    if (!terminalConfigured) {
      setTerminalWarning(true);
      return;
    }
    onOpenInTerminal(runId);
  }

  const activeTabLabel = tabs.find((t) => t.key === activeTab)?.label ?? "this project";

  // When a project tab is active, scope clear buttons to only that project's runs.
  const scopedRunIds = activeTab === "All" ? undefined : visibleRuns.map((r) => r.id);
  const scopedFinished =
    activeTab === "All" ? finished : visibleRuns.filter((r) => !isActive(r.state)).length;
  const scopedTotal = activeTab === "All" ? runs.length : visibleRuns.length;
  const scopeSuffix = activeTab === "All" ? "" : ` in ${activeTabLabel}`;

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
          <button
            className="btn-ghost sm"
            disabled={scopedFinished === 0}
            onClick={() => onClear("finished", scopedRunIds)}
          >
            <Trash2 size={13} /> Clear finished{scopeSuffix}
          </button>
          <button
            className="btn-ghost danger sm"
            disabled={scopedTotal === 0}
            onClick={() => onClear("all", scopedRunIds)}
          >
            <Trash2 size={13} /> Clear all{scopeSuffix}
          </button>
        </span>
      </div>

      {/* Project tab bar — always shown so the operator knows which project they're in. */}
      <div className="sessions-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`sessions-tab${activeTab === tab.key ? " active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span className="sessions-tab-count">{tab.count}</span>
          </button>
        ))}
      </div>

      {terminalWarning && (
        <div className="banner warn">
          <AlertCircle size={14} /> No terminal configured. Set your default terminal in{" "}
          <b>Settings → Terminal</b> to use "Open in terminal".
        </div>
      )}

      {runs.length === 0 && (
        <div className="empty">No sessions yet. Assign an agent to a ticket to start one.</div>
      )}

      {runs.length > 0 && visibleRuns.length === 0 && (
        <div className="empty">No sessions for {activeTabLabel}.</div>
      )}

      <div className="sessions-list">
        {visibleRuns.map((r) => (
          <div className={`session-row${isActive(r.state) ? " active" : ""}`} key={r.id}>
            <StateChip state={r.state} />
            {r.ticketUrl ? (
              <a
                className="session-ticket"
                href={r.ticketUrl}
                target="_blank"
                rel="noreferrer"
                title="Open in Jira"
              >
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
              {!isActive(r.state) && r.sessionId && (
                <button
                  className="btn-ghost sm"
                  onClick={() => {
                    setResumeText("");
                    setPendingResume(r);
                  }}
                  title="Resume with a custom message"
                >
                  <RotateCcw size={13} /> Resume…
                </button>
              )}
              {!isActive(r.state) && r.sessionId && (
                <button
                  className="btn-ghost sm"
                  onClick={() => openInTerminal(r.id)}
                  title="Resume this session in your terminal"
                >
                  <Terminal size={13} /> Terminal
                </button>
              )}
              <button className="btn-ghost sm" onClick={() => onOpenRun(r)} title="Open session">
                <ExternalLink size={13} /> Open
              </button>
              {!isActive(r.state) && (
                <button className="icon-btn sm" onClick={() => onDelete(r.id)} title="Delete session">
                  <Trash2 size={14} />
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {pendingResume &&
        createPortal(
          <div className="modal-overlay" onClick={() => setPendingResume(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <span className="modal-title">
                  <RotateCcw size={15} /> Resume <b>{pendingResume.agentName}</b>
                  {pendingResume.ticketKey && (
                    <>
                      {" on "}
                      <span className="mono">{pendingResume.ticketKey}</span>
                    </>
                  )}
                </span>
                <button className="icon-btn" onClick={() => setPendingResume(null)} title="Cancel">
                  <X size={16} />
                </button>
              </div>
              <p className="hint">Send a message to resume this session from where it left off.</p>
              <textarea
                className="note-input"
                autoFocus
                rows={4}
                placeholder="e.g. Continue with the failing tests — focus on the auth module."
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && resumeText.trim()) {
                    onResume(pendingResume.id, resumeText.trim());
                    setPendingResume(null);
                  }
                }}
              />
              <div className="modal-actions">
                <button className="btn-ghost" onClick={() => setPendingResume(null)}>
                  Cancel
                </button>
                <button
                  className="btn"
                  disabled={!resumeText.trim()}
                  onClick={() => {
                    onResume(pendingResume.id, resumeText.trim());
                    setPendingResume(null);
                  }}
                >
                  <Play size={14} /> Resume
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
