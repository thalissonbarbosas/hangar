import { useEffect, useMemo, useRef, useState } from "react";
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
  Wrench,
  MessageSquare,
  X,
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
import { AgentSkillPicker } from "./AgentSkillPicker";
import { WorktreeManagerModal } from "./WorktreeManagerModal";
import { projectColor, skillProject } from "../utils";

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
  columnSkills?: Record<string, string[]>; // aiwf: stage-aware skill filter, keyed by column
  workflows: WorkflowConfig[];
  runByTicket: Map<string, RunSummary>;
  onAssign: (ticketKey: string, name: string, kind: RunKind, note?: string) => void;
  onStartWorkflow: (ticketKey: string, workflowId: string) => void;
  onMoveTicket: (ticketKey: string, targetStatus: string) => void;
  onOpenRun: (run: RunSummary) => void;
}

function ItemRow({
  name,
  repo,
  kind,
  model,
  sub,
  onRun,
  onNote,
}: {
  name: string;
  repo?: string;
  kind: RunKind;
  model?: string;
  sub: string;
  onRun: () => void;
  onNote: () => void;
}) {
  const repoColor = repo ? projectColor(repo) : undefined;
  return (
    <div className="assign-item">
      <button className="assign-item-main" onClick={onRun} title={sub}>
        {kind === "skill" ? <Sparkles size={12} /> : <Bot size={12} />}
        <span className="ami-name">{name}</span>
        {repo && (
          <span className="ami-repo" style={{ color: repoColor }}>
            ({repo})
          </span>
        )}
        {model && <span className="ami-model">{model}</span>}
      </button>
      <button className="assign-item-note" onClick={onNote} title="Run with a note…">
        <StickyNote size={12} />
      </button>
    </div>
  );
}

// A compact inline popover that starts a session scoped to a repo path — a plain Claude chat, or
// (via the picker) a standalone agent/skill run in that same repo.
const LS_KEY = (cwd: string) => `hangar-chat:${cwd}`;

// Options handed to onStart. name/kind undefined → plain chat; modelTouched tells the caller
// whether the operator explicitly picked a model (so an agent's frontmatter model can win when not).
export type ClaudeSessionStart = {
  name?: string;
  kind?: RunKind | null;
  model: string;
  modelTouched: boolean;
  note?: string;
};

// Reused by the Jira board header and each AI Workflow project pill, so it's exported.
export function ClaudeSessionButton({
  cwd,
  title,
  runs,
  agents,
  skills,
  onStart,
  onOpenRun,
}: {
  cwd: string;
  title: string;
  runs: RunSummary[];
  agents: Agent[];
  skills: Skill[];
  onStart: (opts: ClaudeSessionStart) => Promise<string>;
  onOpenRun: (run: RunSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<"haiku" | "sonnet" | "opus">("sonnet");
  const [modelTouched, setModelTouched] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<RunKind | null>(null);
  const [note, setNote] = useState("");

  // A selected agent/skill needs a task note (the standalone run path rejects an empty note).
  const hasSelection = !!name && !!kind;
  const canRun = !hasSelection || !!note.trim();

  // Find the last session started from this button (stored by runId in localStorage).
  const lastRun = useMemo(() => {
    const stored = localStorage.getItem(LS_KEY(cwd));
    if (!stored) return null;
    return runs.find((r) => r.id === stored) ?? null;
  }, [cwd, runs, open]); // re-evaluate when modal opens

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setName("");
    setKind(null);
    setNote("");
    setModelTouched(false);
  }

  function start() {
    onStart({ name: name || undefined, kind, model, modelTouched, note: note.trim() || undefined }).then(
      (runId) => {
        localStorage.setItem(LS_KEY(cwd), runId);
      },
    );
    setOpen(false);
    reset();
  }

  return (
    <>
      <button
        className="icon-btn has-tip board-title-btn"
        data-tip="Start a Claude session"
        onClick={() => setOpen(true)}
      >
        <MessageSquare size={14} />
      </button>
      {open &&
        createPortal(
          <div
            className="modal-overlay"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="modal">
              <div className="modal-head">
                <span className="modal-title">
                  <MessageSquare size={14} />
                  {title}
                </span>
                <button className="icon-btn" onClick={() => setOpen(false)}>
                  <X size={14} />
                </button>
              </div>
              <div className="claude-session-cwd" title={cwd}>
                {cwd}
              </div>
              {lastRun && (
                <div className="claude-session-last">
                  <span className="claude-session-last-label">Last session</span>
                  <button
                    className="claude-session-last-btn"
                    onClick={() => {
                      setOpen(false);
                      onOpenRun(lastRun);
                    }}
                  >
                    <span className={`run-dot ${lastRun.state}`} />
                    {lastRun.title ?? lastRun.ticketKey}
                  </button>
                </div>
              )}
              <div className="field" style={{ marginTop: 10 }}>
                <label>Agent or Skill (optional)</label>
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
              <div className="seg" style={{ marginTop: 10 }}>
                {(["haiku", "sonnet", "opus"] as const).map((m) => (
                  <button
                    key={m}
                    className={model === m ? "on" : undefined}
                    onClick={() => {
                      setModel(m);
                      setModelTouched(true);
                    }}
                  >
                    {m[0].toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
              <textarea
                className="claude-session-note"
                placeholder={
                  hasSelection ? "Describe the task for this agent/skill…" : "What would you like to work on?"
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ marginTop: 10 }}
              />
              <div className="modal-actions">
                <button className="btn-ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button className="btn" onClick={start} disabled={!canRun}>
                  Start session
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function AssignMenu({ ticketKey, ctx, skills }: { ticketKey: string; ctx: CardCtx; skills: Skill[] }) {
  const [open, setOpen] = useState(false);
  // top: popup opens below the button; bottom: popup opens above it (viewport-flipped)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  // NoteModal is only reachable for agent/skill assignment — chat sessions never flow here.
  const [pendingNote, setPendingNote] = useState<{ name: string; kind: "agent" | "skill" } | null>(null);
  const [activeSkillProj, setActiveSkillProj] = useState<string | null>(null);

  // Group skills by project key; each group sorted by name.
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
  const skillProjKeys = useMemo(() => [...skillGroups.keys()], [skillGroups]);
  // Keep active tab valid when skills change; default to first group.
  const effectiveProj =
    activeSkillProj && skillGroups.has(activeSkillProj) ? activeSkillProj : (skillProjKeys[0] ?? null);
  const visibleSkills = effectiveProj !== null ? (skillGroups.get(effectiveProj) ?? []) : [];
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function toggle() {
    if (open) return setOpen(false);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 460));
      // Estimate popup height: assign-col max-height (340px) + heading + padding
      const estimatedH = 380;
      const spaceBelow = window.innerHeight - r.bottom;
      // Flip upward when there's not enough room below but more room above
      if (spaceBelow < estimatedH && r.top > spaceBelow) {
        setPos({ bottom: window.innerHeight - r.top + 4, left });
      } else {
        setPos({ top: r.bottom + 4, left });
      }
    }
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
  function askNote(name: string, kind: "agent" | "skill") {
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
            style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left }}
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
                  model={a.model}
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
              {skillProjKeys.length > 1 && (
                <div className="assign-skill-tabs">
                  {skillProjKeys.map((proj) => {
                    const isOther = proj === "other";
                    const color = !isOther ? projectColor(proj) : undefined;
                    return (
                      <button
                        key={proj}
                        className={`assign-skill-tab${effectiveProj === proj ? " active" : ""}`}
                        style={color ? ({ "--tab-color": color } as React.CSSProperties) : undefined}
                        onClick={() => setActiveSkillProj(proj)}
                      >
                        {isOther ? "other" : proj}
                      </button>
                    );
                  })}
                </div>
              )}
              {skills.length === 0 && <div className="assign-empty">No skills found</div>}
              {visibleSkills.map((s) => (
                <ItemRow
                  key={`${s.name}:${s.repo ?? ""}`}
                  name={s.name}
                  repo={skillProjKeys.length <= 1 ? s.repo : undefined}
                  kind="skill"
                  model={s.model}
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
  // Derive extra state classes for left-border strip (awaiting-input overrides active; done is terminal).
  const stateClass =
    run?.state === "awaiting_input" ? " awaiting-input" : run?.state === "done" ? " done" : "";
  const [jiraPrUrl, setJiraPrUrl] = useState<string | null>(null);
  const prUrl = run?.prUrl ?? ticket.prUrl ?? jiraPrUrl;
  const prNum = prUrl?.match(/\/pull\/(\d+)/)?.[1];
  const [dragging, setDragging] = useState(false);
  const hasLink = !!ticket.url && /^https?:/i.test(ticket.url);

  // Stage-aware skills (aiwf): if a column→skills map is set, narrow the menu to this card's column.
  const menuSkills =
    ctx.columnSkills && ctx.columnSkills[ticket.status]
      ? ctx.skills.filter((s) => ctx.columnSkills![ticket.status].includes(s.name))
      : ctx.skills;

  // Jira-only: pull a PR from the dev panel/remote links/comments. Skip for self-hosted aiwf cards.
  useEffect(() => {
    if (run?.prUrl || !ticket.key || ticket.source === "aiwf") return;
    api
      .ticketPr(ticket.key)
      .then(({ prUrl: p }) => {
        if (p) setJiraPrUrl(p);
      })
      .catch(() => {});
  }, [ticket.key, ticket.source, run?.prUrl]);

  function onDragStart(e: React.DragEvent) {
    const data: TicketDragData = { key: ticket.key, boardKey: ticket.boardKey, status: ticket.status };
    e.dataTransfer.setData(TICKET_DND_MIME, JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  }

  return (
    <div
      className={`card${active ? " active" : ""}${stateClass}${dragging ? " dragging" : ""}`}
      title={ticket.summary}
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
    >
      <div className="card-key-row">
        <span className="card-links">
          {hasLink ? (
            <a className="card-key" href={ticket.url} target="_blank" rel="noreferrer" draggable={false}>
              {ticket.key}
              <ExternalLink size={11} />
            </a>
          ) : (
            <span className="card-key">{ticket.key}</span>
          )}
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
          <AssignMenu ticketKey={ticket.key} ctx={ctx} skills={menuSkills} />
        )}
      </div>
    </div>
  );
}

// Modal listing all completed tickets with a live name filter and full card options.
function CompletedTicketsModal({
  tickets,
  ctx,
  onClose,
}: {
  tickets: Ticket[]; // already sorted by summary desc
  ctx: CardCtx;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const q = filter.toLowerCase();
  const visible = q ? tickets.filter((t) => t.summary.toLowerCase().includes(q)) : tickets;
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Done ({tickets.length})</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <input
          className="col-done-filter"
          autoFocus
          placeholder="Filter by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="col-done-list">
          {visible.length === 0 ? (
            <div className="col-done-empty">No completed tickets match "{filter}"</div>
          ) : (
            visible.map((t) => <TicketCard key={t.key} ticket={t} ctx={ctx} />)
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const DONE_CAP = 5; // max cards shown in the done column before "See more" kicks in

// Maps a column status name to a semantic CSS class for top-border coloring.
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (/progress|develop|active|doing/.test(s)) return "status-in-progress";
  if (/review|testing|qa/.test(s)) return "status-in-review";
  if (/done|complete|deliver|shipped|closed/.test(s)) return "status-done";
  return "";
}

function Column({
  status,
  targetStatus,
  tickets,
  color,
  ctx,
  isDone,
}: {
  status: string;
  targetStatus: string;
  tickets: Ticket[];
  color: string;
  ctx: CardCtx;
  isDone?: boolean; // true for the last (done) column
}) {
  const [over, setOver] = useState(false);
  const [doneModalOpen, setDoneModalOpen] = useState(false);

  // Sort done-column tickets by summary descending; leave other columns untouched.
  const sorted = isDone ? [...tickets].sort((a, b) => b.summary.localeCompare(a.summary)) : tickets;
  const visible = isDone ? sorted.slice(0, DONE_CAP) : sorted;
  const hidden = isDone ? Math.max(0, sorted.length - DONE_CAP) : 0;

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

  const sc = statusClass(status);
  return (
    <div
      className={`column${over ? " drop-over" : ""}${sc ? ` ${sc}` : ""}`.trim()}
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
        {visible.map((t) => (
          <TicketCard key={t.key} ticket={t} ctx={ctx} />
        ))}
        {hidden > 0 && (
          <button className="btn-ghost sm col-see-more" onClick={() => setDoneModalOpen(true)}>
            See {hidden} more ▾
          </button>
        )}
      </div>
      {doneModalOpen && (
        <CompletedTicketsModal tickets={sorted} ctx={ctx} onClose={() => setDoneModalOpen(false)} />
      )}
    </div>
  );
}

export function Board({
  board,
  tickets,
  agents,
  skills,
  columnSkills,
  runs,
  runByTicket,
  onAssign,
  onStartWorkflow,
  onMoveTicket,
  onOpenRun,
  onStartClaude,
}: {
  board: BoardConfig;
  tickets: Ticket[];
  agents: Agent[];
  skills: Skill[];
  columnSkills?: Record<string, string[]>; // aiwf: stage-aware skill filter per column
  runs: RunSummary[];
  runByTicket: Map<string, RunSummary>;
  onAssign: (ticketKey: string, name: string, kind: RunKind, note?: string) => void;
  onStartWorkflow: (ticketKey: string, workflowId: string) => void;
  onMoveTicket: (ticketKey: string, targetStatus: string) => void;
  onOpenRun: (run: RunSummary) => void;
  onStartClaude: (cwd: string, title: string, opts: ClaudeSessionStart) => Promise<string>;
}) {
  // Restrict the Assign menu to the board's enabled agents (empty/undefined = all).
  const boardAgents = board.agents?.length ? agents.filter((a) => board.agents!.includes(a.name)) : agents;
  // Show user-scoped skills always; repo skills only if their repoPath belongs to this board.
  const pathFiltered = board.resolvedPaths?.length
    ? skills.filter((s) => s.source !== "repo" || board.resolvedPaths!.includes(s.repoPath ?? ""))
    : skills;
  // Further restrict to the board's skill allow-list (empty/undefined = all path-filtered skills).
  const boardSkills = board.skills?.length
    ? pathFiltered.filter((s) => board.skills!.includes(s.name))
    : pathFiltered;
  const ctx: CardCtx = {
    boardKey: board.key,
    agents: boardAgents,
    skills: boardSkills,
    columnSkills,
    workflows: (board.workflows ?? []).filter((w) => w.steps.length > 0),
    runByTicket,
    onAssign,
    onStartWorkflow,
    onMoveTicket,
    onOpenRun,
  };
  const [worktreeManagerOpen, setWorktreeManagerOpen] = useState(false);

  // Primary repo path for a board-scoped Claude session (first resolved path, else raw repoPath).
  const primaryCwd = board.resolvedPaths?.[0] ?? board.repoPath ?? "";

  const byStatus = (status: string) => tickets.filter((t) => t.status === status);
  const extra = [...new Set(tickets.map((t) => t.status))].filter((s) => !board.statuses.includes(s));
  const allColumns = [...board.statuses, ...extra.map((s) => `${s} (unmapped)`)];

  return (
    <section className="board">
      <h2 className="board-title">
        {board.name} <span className="board-key">{board.key}</span>
        <span className="board-total">{tickets.length} tickets</span>
        <button
          className="icon-btn has-tip board-title-btn"
          data-tip="Manage task worktrees"
          onClick={() => setWorktreeManagerOpen(true)}
        >
          <Wrench size={14} />
        </button>
        {primaryCwd && (
          <ClaudeSessionButton
            cwd={primaryCwd}
            title={`${board.name} — Claude`}
            runs={runs}
            agents={boardAgents}
            skills={boardSkills}
            onOpenRun={onOpenRun}
            onStart={(opts) => onStartClaude(primaryCwd, `${board.name} — Claude`, opts)}
          />
        )}
      </h2>
      <div className="columns">
        {allColumns.map((label, i) => {
          const status = label.endsWith(" (unmapped)") ? label.slice(0, -11) : label;
          // The last configured status is the "done" column — cap it and add "See more".
          const isDone = i === board.statuses.length - 1;
          return (
            <Column
              key={label}
              status={label}
              targetStatus={status}
              tickets={byStatus(status)}
              color={COLUMN_COLORS[i % COLUMN_COLORS.length]}
              ctx={ctx}
              isDone={isDone}
            />
          );
        })}
      </div>
      {worktreeManagerOpen && (
        <WorktreeManagerModal
          contextId={`jira-${board.key}`}
          title={board.name}
          onClose={() => setWorktreeManagerOpen(false)}
        />
      )}
    </section>
  );
}
