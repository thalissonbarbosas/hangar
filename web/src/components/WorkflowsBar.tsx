import { useState } from "react";
import {
  Workflow as WorkflowIcon,
  ChevronDown,
  ChevronRight,
  Bot,
  Sparkles,
  Loader2,
  Square,
  Trash2,
  Check,
} from "lucide-react";
import {
  BoardConfig,
  TicketDragData,
  TICKET_DND_MIME,
  WorkflowConfig,
  WorkflowRunSummary,
  WorkflowStatus,
  isWorkflowActive,
} from "../types";

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  running: "running",
  awaiting_input: "needs approval",
  done: "done",
  error: "error",
  stopped: "stopped",
};

const COLLAPSE_KEY = "hangar.workflowCollapsed";

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function WorkflowsBar({
  boards,
  workflowRuns,
  onOpenRunId,
  onStartWorkflow,
  onStop,
  onDelete,
}: {
  boards: BoardConfig[];
  workflowRuns: WorkflowRunSummary[];
  onOpenRunId: (runId: string) => void;
  onStartWorkflow: (ticketKey: string, workflowId: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const withWorkflows = boards.filter((b) => (b.workflows?.length ?? 0) > 0);
  if (withWorkflows.length === 0) return null;

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function runsFor(boardKey: string, wf: WorkflowConfig): WorkflowRunSummary[] {
    return workflowRuns
      .filter((r) => r.boardKey === boardKey && r.workflowId === wf.id)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  return (
    <div className="workflow-bar">
      {withWorkflows.map((board) =>
        (board.workflows ?? []).map((wf) => {
          const key = `${board.key}:${wf.id}`;
          const isCollapsed = collapsed.has(key);
          const runs = runsFor(board.key, wf);
          const activeCount = runs.filter((r) => isWorkflowActive(r.status)).length;

          const onDragOver = (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(TICKET_DND_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (dragOverKey !== key) setDragOverKey(key);
          };
          const onDrop = (e: React.DragEvent) => {
            e.preventDefault();
            setDragOverKey(null);
            const raw = e.dataTransfer.getData(TICKET_DND_MIME);
            if (!raw) return;
            let data: TicketDragData;
            try {
              data = JSON.parse(raw) as TicketDragData;
            } catch {
              return;
            }
            if (data.boardKey !== board.key) return; // workflow only runs on its own board's tickets
            onStartWorkflow(data.key, wf.id);
          };

          return (
            <div
              className={`workflow-strip${dragOverKey === key ? " drop-over" : ""}`}
              key={key}
              onDragOver={onDragOver}
              onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
              onDrop={onDrop}
            >
              <button className="workflow-head" onClick={() => toggle(key)}>
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <WorkflowIcon size={14} />
                <span className="workflow-name">{wf.name}</span>
                <span className="workflow-board">{board.key}</span>
                <span className="workflow-steps-inline">
                  {wf.steps.map((s, i) => (
                    <span key={i} className="workflow-step-chip">
                      {s.kind === "skill" ? <Sparkles size={10} /> : <Bot size={10} />}
                      {s.name}
                      {i < wf.steps.length - 1 && <span className="step-arrow">→</span>}
                    </span>
                  ))}
                </span>
                {activeCount > 0 && <span className="workflow-active-badge">{activeCount} active</span>}
              </button>

              {!isCollapsed && (
                <div className="workflow-runs">
                  {runs.length === 0 && (
                    <div className="workflow-empty">
                      No tickets in this workflow yet — start one from a card's Assign menu.
                    </div>
                  )}
                  {runs.map((r) => {
                    const active = isWorkflowActive(r.status);
                    return (
                      <div className={`wf-run wf-${r.status}`} key={r.id}>
                        <div className="wf-run-top">
                          <span className="wf-ticket">{r.ticketKey}</span>
                          <span className={`wf-state ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                          {active ? (
                            <button className="chip-btn" title="Stop workflow" onClick={() => onStop(r.id)}>
                              <Square size={12} />
                            </button>
                          ) : (
                            <button
                              className="chip-btn remove"
                              title="Remove workflow run"
                              onClick={() => onDelete(r.id)}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        <div className="wf-run-steps">
                          {r.steps.map((st, i) => {
                            const done = i < r.stepIndex;
                            const isCurrent = i === r.stepIndex && r.status !== "done";
                            const stepRunId = r.runIds[i];
                            const cls = done ? "done" : isCurrent ? `current ${r.status}` : "pending";
                            return (
                              <button
                                key={i}
                                className={`wf-step ${cls}`}
                                disabled={!stepRunId}
                                onClick={() => stepRunId && onOpenRunId(stepRunId)}
                                title={stepRunId ? `Open ${st.name}'s session` : `${st.name} (not started)`}
                              >
                                <span className="wf-step-n">{i + 1}</span>
                                {st.kind === "skill" ? <Sparkles size={10} /> : <Bot size={10} />}
                                <span className="wf-step-label">{st.name}</span>
                                {done && <Check size={11} />}
                                {isCurrent && r.status === "running" && (
                                  <Loader2 size={11} className="spin" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }),
      )}
    </div>
  );
}
