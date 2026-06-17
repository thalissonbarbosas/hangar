import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  Tag,
  Flag,
  Bot,
  Activity,
  ChevronDown,
  Loader2,
  Sparkles,
  StickyNote,
  GitPullRequest,
  Workflow as WorkflowIcon,
} from "lucide-react";
import {
  Agent,
  BoardConfig,
  RunKind,
  RunState,
  RunSummary,
  Skill,
  Ticket,
  TicketDragData,
  TICKET_DND_MIME,
  WorkflowConfig,
  isActive,
} from "../types";
import { api } from "../api";
import { Avatar } from "./Avatar";
import { NoteModal } from "./NoteModal";

const COLUMN_COLORS = [
  "#4f7cff",
  "#10b981",
  "#e08e0b",
  "#ec4899",
  "#8b5cf6",
  "#0ea5e9",
  "#f43f5e",
  "#14b8a6",
];

const STATE_LABEL: Record<RunState, string> = {
  queued: "queued",
  starting: "starting",
  running: "running",
  awaiting_input: "needs approval",
  done: "done",
  error: "error",
  stopped: "stopped",
};

function typeColor(t: string | null): string {
  const x = (t ?? "").toLowerCase();
  if (x.includes("bug") || x.includes("defect")) return "#ef4444";
  if (x.includes("story")) return "#22c55e";
  if (x.includes("epic")) return "#8b5cf6";
  if (x.includes("sub")) return "#14b8a6";
  if (x.includes("spike")) return "#e08e0b";
  if (x.includes("incident")) return "#f43f5e";
  if (x.includes("task")) return "#4f7cff";
  return "#8b93a3";
}
function priorityColor(p: string | null): string {
  const x = (p ?? "").toLowerCase();
  if (x.includes("highest") || x.includes("blocker") || x.includes("critical")) return "#dc2626";
  if (x.includes("high")) return "#ef4444";
  if (x.includes("medium")) return "#e08e0b";
  if (x.includes("lowest")) return "#6b7280";
  if (x.includes("low")) return "#0ea5e9";
  return "#8b93a3";
}

interface CardCtx {
  boardKey: string;
  agents: Agent[];
  skills: Skill[];
  workflows: WorkflowConfig[];
  runByTicket: Map<string, RunSummary>;
  onAssign: (ticketKey: string, name: string, kind: RunKind, note?: string) => void;
  onStartWorkflow: (ticketKey: string, workflowId: string) => void;
  onMoveTicket: (ticketKey: string, targetStatus: string) => void;
  onOpenRun: (run: RunSummary) => void;
}

function ItemRow({
  name,
  label,
  kind,
  sub,
  onRun,
  onNote,
}: {
  name: string;
  label?: string;
  kind: RunKind;
  sub: string;
  onRun: () => void;
  onNote: () => void;
}) {
  return (
    <div className="assign-item">
      <button className="assign-item-main" onClick={onRun} title={sub}>
        {kind === "skill" ? <Sparkles size={12} /> : <Bot size={12} />}
        <span className="ami-name">{label ?? name}</span>
      </button>
      <button className="assign-item-note" onClick={onNote} title="Run with a note…">
        <StickyNote size={12} />
      </button>
    </div>
  );
}

function AssignMenu({ ticketKey, ctx }: { ticketKey: string; ctx: CardCtx }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [pendingNote, setPendingNote] = useState<{ name: string; kind: RunKind } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function toggle() {
    if (open) return setOpen(false);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 460)) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      const t = e.target as Node;
      if (popRef.current && (popRef.current === t || popRef.current.contains(t))) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function run(name: string, kind: RunKind) {
    setOpen(false);
    ctx.onAssign(ticketKey, name, kind);
  }
  function askNote(name: string, kind: RunKind) {
    setOpen(false);
    setPendingNote({ name, kind });
  }
  function startWorkflow(workflowId: string) {
    setOpen(false);
    ctx.onStartWorkflow(ticketKey, workflowId);
  }

  return (
    <>
      <button ref={btnRef} className="agent-menu-btn" onClick={toggle} title="Assign an agent or skill">
        <Bot size={13} /> Assign <ChevronDown size={12} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="assign-pop"
            ref={popRef}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
          >
            {ctx.workflows.length > 0 && (
              <div className="assign-col">
                <div className="assign-col-head">
                  <WorkflowIcon size={12} /> Workflows
                </div>
                {ctx.workflows.map((w) => (
                  <div className="assign-item" key={w.id}>
                    <button
                      className="assign-item-main"
                      onClick={() => startWorkflow(w.id)}
                      title={`${w.steps.length} step${w.steps.length === 1 ? "" : "s"}: ${w.steps.map((s) => s.name).join(" → ")}`}
                    >
                      <WorkflowIcon size={12} />
                      <span className="ami-name">{w.name}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="assign-col">
              <div className="assign-col-head">
                <Bot size={12} /> Agents
              </div>
              {ctx.agents.map((a) => (
                <ItemRow
                  key={a.name}
                  name={a.name}
                  kind="agent"
                  sub={a.description}
                  onRun={() => run(a.name, "agent")}
                  onNote={() => askNote(a.name, "agent")}
                />
              ))}
            </div>
            <div className="assign-col">
              <div className="assign-col-head">
                <Sparkles size={12} /> Skills
              </div>
              {ctx.skills.length === 0 && <div className="assign-empty">No skills found</div>}
              {ctx.skills.map((s) => (
                <ItemRow
                  key={`${s.name}:${s.repo ?? ""}`}
                  name={s.name}
                  label={s.repo ? `${s.name} (${s.repo})` : s.name}
                  kind="skill"
                  sub={s.description}
                  onRun={() => run(s.name, "skill")}
                  onNote={() => askNote(s.name, "skill")}
                />
              ))}
            </div>
          </div>,
          document.body,
        )}
      {pendingNote &&
        (() => {
          const p = pendingNote;
          return (
            <NoteModal
              ticketKey={ticketKey}
              name={p.name}
              kind={p.kind}
              onRun={(note) => {
                ctx.onAssign(ticketKey, p.name, p.kind, note);
                setPendingNote(null);
              }}
              onCancel={() => setPendingNote(null)}
            />
          );
        })()}
    </>
  );
}

function TicketCard({ ticket, ctx }: { ticket: Ticket; ctx: CardCtx }) {
  const run = ctx.runByTicket.get(ticket.key);
  const active = run ? isActive(run.state) : false;
  const [jiraPrUrl, setJiraPrUrl] = useState<string | null>(null);
  const prUrl = run?.prUrl ?? jiraPrUrl;
  const prNum = prUrl?.match(/\/pull\/(\d+)/)?.[1];
  const [dragging, setDragging] = useState(false);

  // When there is no run-detected PR URL, try to pull one from Jira (dev panel, remote links, comments).
  useEffect(() => {
    if (run?.prUrl || !ticket.key) return;
    api
      .ticketPr(ticket.key)
      .then(({ prUrl: p }) => {
        if (p) setJiraPrUrl(p);
      })
      .catch(() => {});
  }, [ticket.key, run?.prUrl]);

  function onDragStart(e: React.DragEvent) {
    const data: TicketDragData = { key: ticket.key, boardKey: ticket.boardKey, status: ticket.status };
    e.dataTransfer.setData(TICKET_DND_MIME, JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  }

  return (
    <div
      className={`card${active ? " active" : ""}${dragging ? " dragging" : ""}`}
      title={ticket.summary}
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
    >
      <div className="card-key-row">
        <span className="card-links">
          <a className="card-key" href={ticket.url} target="_blank" rel="noreferrer" draggable={false}>
            {ticket.key}
            <ExternalLink size={11} />
          </a>
          {prUrl && (
            <a
              className="card-pr"
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              draggable={false}
              title="Open pull request"
            >
              <GitPullRequest size={11} />
              {prNum ? `#${prNum}` : "PR"}
            </a>
          )}
        </span>
        {ticket.priority && (
          <span className="card-priority" style={{ color: priorityColor(ticket.priority) }}>
            <Flag size={10} />
            {ticket.priority}
          </span>
        )}
      </div>
      <div className="card-summary">{ticket.summary}</div>
      <div className="card-meta">
        {ticket.issuetype && (
          <span
            className="tag"
            style={{
              color: typeColor(ticket.issuetype),
              background: `color-mix(in srgb, ${typeColor(ticket.issuetype)} 16%, transparent)`,
            }}
          >
            <Tag size={10} />
            {ticket.issuetype}
          </span>
        )}
        <span className="card-assignee">
          <Avatar name={ticket.assignee} src={ticket.assigneeAvatar} size={18} />
          {ticket.assignee ?? "Unassigned"}
        </span>
      </div>
      <div className="card-actions">
        {run ? (
          <>
            <button
              className={`run-tag ${run.state}`}
              onClick={() => ctx.onOpenRun(run)}
              title={`Open session (${run.agentName})`}
            >
              {active ? <Loader2 size={12} className="spin" /> : <Activity size={12} />}
              {run.kind === "skill" ? <Sparkles size={11} /> : <Bot size={11} />}
              {run.agentName} · {STATE_LABEL[run.state]}
            </button>
            {active && run.phase && (
              <div className="card-phase" title="Current step">
                {run.phase}
              </div>
            )}
          </>
        ) : (
          <AssignMenu ticketKey={ticket.key} ctx={ctx} />
        )}
      </div>
    </div>
  );
}

function Column({
  status,
  targetStatus,
  tickets,
  color,
  ctx,
}: {
  status: string;
  targetStatus: string;
  tickets: Ticket[];
  color: string;
  ctx: CardCtx;
}) {
  const [over, setOver] = useState(false);

  function readDrag(e: React.DragEvent): TicketDragData | null {
    const raw = e.dataTransfer.getData(TICKET_DND_MIME);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TicketDragData;
    } catch {
      return null;
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(TICKET_DND_MIME)) return;
    e.preventDefault(); // allow drop
    e.dataTransfer.dropEffect = "move";
    if (!over) setOver(true);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const data = readDrag(e);
    if (!data || data.boardKey !== ctx.boardKey) return; // only within the same Jira project
    if (data.status === targetStatus) return; // already here
    ctx.onMoveTicket(data.key, targetStatus);
  }

  return (
    <div
      className={`column${over ? " drop-over" : ""}`}
      style={{ borderTopColor: color }}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="column-header">
        <span className="status-dot" style={{ background: color }} />
        <span className="column-title" style={{ color }}>
          {status}
        </span>
        <span className="count">{tickets.length}</span>
      </div>
      <div className="column-body">
        {tickets.map((t) => (
          <TicketCard key={t.key} ticket={t} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

export function Board({
  board,
  tickets,
  agents,
  skills,
  runByTicket,
  onAssign,
  onStartWorkflow,
  onMoveTicket,
  onOpenRun,
}: {
  board: BoardConfig;
  tickets: Ticket[];
  agents: Agent[];
  skills: Skill[];
  runByTicket: Map<string, RunSummary>;
  onAssign: (ticketKey: string, name: string, kind: RunKind, note?: string) => void;
  onStartWorkflow: (ticketKey: string, workflowId: string) => void;
  onMoveTicket: (ticketKey: string, targetStatus: string) => void;
  onOpenRun: (run: RunSummary) => void;
}) {
  // Restrict the Assign menu to the board's enabled agents (empty/undefined = all).
  const boardAgents = board.agents?.length ? agents.filter((a) => board.agents!.includes(a.name)) : agents;
  const ctx: CardCtx = {
    boardKey: board.key,
    agents: boardAgents,
    skills,
    workflows: (board.workflows ?? []).filter((w) => w.steps.length > 0),
    runByTicket,
    onAssign,
    onStartWorkflow,
    onMoveTicket,
    onOpenRun,
  };
  const byStatus = (status: string) => tickets.filter((t) => t.status === status);
  const extra = [...new Set(tickets.map((t) => t.status))].filter((s) => !board.statuses.includes(s));
  const allColumns = [...board.statuses, ...extra.map((s) => `${s} (unmapped)`)];

  return (
    <section className="board">
      <h2 className="board-title">
        {board.name} <span className="board-key">{board.key}</span>
        <span className="board-total">{tickets.length} tickets</span>
      </h2>
      <div className="columns">
        {allColumns.map((label, i) => {
          const status = label.endsWith(" (unmapped)") ? label.slice(0, -11) : label;
          return (
            <Column
              key={label}
              status={label}
              targetStatus={status}
              tickets={byStatus(status)}
              color={COLUMN_COLORS[i % COLUMN_COLORS.length]}
              ctx={ctx}
            />
          );
        })}
      </div>
    </section>
  );
}
