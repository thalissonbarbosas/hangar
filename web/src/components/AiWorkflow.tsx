import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderPlus,
  Download,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Plus,
  Loader2,
  ExternalLink,
  MoreVertical,
  RotateCw,
  Pencil,
  User,
  Play,
  Activity,
  Bot,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  AiwfProject,
  AiwfStatus,
  RunSummary,
  Skill,
  Ticket,
  TICKET_DND_MIME,
  TicketDragData,
  isActive,
} from "../types";

// ---------------------------------------------------------------------------
// AI Workflow connection — phases ARE the columns. A card is a work thread that
// flows through the phases; moving it into a phase pops that phase's skill picker
// to start a session, and every session result is logged to the card's history.
//   • <AiWorkflowBar>  — topbar sub-menu: project picker + install/options
//   • <AiWorkflowView> — the phase board
// ---------------------------------------------------------------------------

interface OpenSession {
  runId: string;
  ticketKey: string;
  agentName: string;
}

// ---- Sub-menu bar ----

export function AiWorkflowBar({
  status,
  projects,
  selectedId,
  onSelect,
  onReload,
  onError,
  onOpenSession,
}: {
  status: AiwfStatus | null;
  projects: AiwfProject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReload: () => void;
  onError: (msg: string) => void;
  onOpenSession: (a: OpenSession) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<AiwfProject | null>(null);

  function install() {
    if (!window.confirm("Install AI Workflow into ~/.claude? This runs the aiwf bootstrap script.")) return;
    setBusy(true);
    api
      .aiwfInstall()
      .then(() => onReload())
      .catch((e) => onError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  }
  function uninstall() {
    if (
      !window.confirm(
        "Uninstall AI Workflow from ~/.claude? This removes the toolkit only — your projects and their " +
          "board cards are left untouched.",
      )
    )
      return;
    setBusy(true);
    api
      .aiwfUninstall()
      .then(() => onReload())
      .catch((e) => onError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  }
  function removeProject(p: AiwfProject) {
    if (
      !window.confirm(
        `Remove project “${p.name}” from AI Workflow? This only unregisters it from Hangar — your repo ` +
          "stays untouched and the project's board state is left on disk in Hangar's data dir.",
      )
    )
      return;
    setBusy(true);
    api
      .deleteAiwfProject(p.id)
      .then(() => onReload())
      .catch((e) => onError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="subbar aiwf-bar">
      {status && !status.installed ? (
        <>
          <span className="subbar-warn">
            <AlertTriangle size={14} /> AI Workflow isn’t installed
          </span>
          <button className="btn" onClick={install} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Install
          </button>
        </>
      ) : (
        <>
          <div className="aiwf-proj-picker">
            {projects.map((p) => (
              <span key={p.id} className="aiwf-proj">
                <button className={`pill${p.id === selectedId ? " on" : ""}`} onClick={() => onSelect(p.id)}>
                  {p.name}
                </button>
                <button
                  className="aiwf-proj-edit has-tip"
                  data-tip="Edit project"
                  disabled={busy}
                  onClick={() => setEditing(p)}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="aiwf-proj-remove has-tip"
                  data-tip="Remove project"
                  disabled={busy}
                  onClick={() => removeProject(p)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {projects.length === 0 && <span className="subbar-dim">No projects yet</span>}
          </div>
          <button className="btn-ghost" onClick={() => setWizardOpen(true)}>
            <FolderPlus size={15} /> New project
          </button>
        </>
      )}

      <div className="subbar-spacer" />

      {status?.installed && (
        <span className="aiwf-health has-tip" data-tip={status.skillsFound.join(", ")}>
          <CheckCircle2 size={13} /> Installed{status.version ? ` · ${status.version}` : ""}
        </span>
      )}

      <OptionsMenu status={status} busy={busy} onReinstall={install} onUninstall={uninstall} />

      {wizardOpen && (
        <NewProjectWizard
          onClose={() => setWizardOpen(false)}
          onError={onError}
          onCreated={(runId, project) => {
            setWizardOpen(false);
            onReload();
            onSelect(project.id);
            if (runId)
              onOpenSession({ runId, ticketKey: `${project.name}: scaffold`, agentName: "new-project" });
          }}
        />
      )}

      {editing && (
        <EditProjectModal
          project={editing}
          onClose={() => setEditing(null)}
          onError={onError}
          onSaved={(project) => {
            setEditing(null);
            onReload();
            onSelect(project.id);
          }}
        />
      )}
    </div>
  );
}

function OptionsMenu({
  status,
  busy,
  onReinstall,
  onUninstall,
}: {
  status: AiwfStatus | null;
  busy: boolean;
  onReinstall: () => void;
  onUninstall: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const repoUrl = status?.repoUrl ?? "https://github.com/0xrafasec/ai-workflow";
  const author = status?.author ?? "0xrafasec";
  const authorUrl = status?.authorUrl ?? "https://github.com/0xrafasec";

  return (
    <div className="aiwf-options" ref={ref}>
      <button className="icon-btn has-tip" data-tip="AI Workflow options" onClick={() => setOpen((v) => !v)}>
        <MoreVertical size={17} />
      </button>
      {open && (
        <div className="aiwf-options-pop">
          <a className="aiwf-opt" href={repoUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> Open ai-workflow repo
          </a>
          <a className="aiwf-opt" href={authorUrl} target="_blank" rel="noreferrer">
            <User size={13} /> by {author}
          </a>
          <div className="aiwf-opt-sep" />
          <button
            className="aiwf-opt"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onReinstall();
            }}
          >
            <RotateCw size={13} /> {status?.installed ? "Reinstall" : "Install"}
          </button>
          {status?.installed && (
            <button
              className="aiwf-opt danger"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onUninstall();
              }}
            >
              <Trash2 size={13} /> Uninstall (keep projects)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Phase board ----

const COLUMN_COLORS = ["#4f7cff", "#8b5cf6", "#10b981", "#e08e0b", "#0ea5e9", "#22c55e"];

export function AiWorkflowView({
  project,
  status,
  skills,
  runs,
  onOpenRun,
  onOpenSession,
  onError,
}: {
  project: AiwfProject | null;
  status: AiwfStatus | null;
  skills: Skill[];
  runs: RunSummary[];
  onOpenRun: (run: RunSummary) => void;
  onOpenSession: (a: OpenSession) => void;
  onError: (msg: string) => void;
}) {
  const [cards, setCards] = useState<Ticket[]>([]);
  const [newItem, setNewItem] = useState<string | null>(null); // phase for the New-item modal
  const [picker, setPicker] = useState<{ key: string; phase: string } | null>(null); // phase skill picker

  const loadCards = useCallback(
    (id: string) => {
      api
        .aiwfCards(id)
        .then((r) => setCards(r.tickets))
        .catch((e) => onError(String(e.message ?? e)));
    },
    [onError],
  );

  useEffect(() => {
    if (!project) {
      setCards([]);
      return;
    }
    loadCards(project.id);
    const t = setInterval(() => loadCards(project.id), 4000);
    return () => clearInterval(t);
  }, [project, loadCards]);

  const skillsByName = useMemo(() => new Map(skills.map((s) => [s.name, s])), [skills]);
  const runByTicket = useMemo(() => {
    const m = new Map<string, RunSummary>();
    for (const r of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
      if (!r.ticketKey) continue;
      const cur = m.get(r.ticketKey);
      if (!cur || (!isActive(cur.state) && isActive(r.state))) m.set(r.ticketKey, r);
    }
    return m;
  }, [runs]);

  if (!project) {
    return (
      <div className="empty">
        <FolderPlus size={32} strokeWidth={1.5} />
        <span>
          {status?.installed
            ? "Select or create a project in the bar above."
            : "Install AI Workflow in the bar above, then create a project."}
        </span>
      </div>
    );
  }

  const phaseSkills = status?.columnSkills ?? {};
  const columns = project.columns?.length ? project.columns : (status?.defaultColumns ?? []);
  const extra = [...new Set(cards.map((c) => c.status))].filter((s) => !columns.includes(s));
  const allColumns = [...columns, ...extra];

  function runCard(key: string, skill: string, note?: string) {
    api
      .aiwfRunCard(project!.id, key, skill, note)
      .then((r) => onOpenSession({ runId: r.runId, ticketKey: key, agentName: skill }))
      .catch((e) => onError(String(e.message ?? e)));
  }
  function createItem(
    phase: string,
    fields: { title: string; kind: "thread" | "task"; skill?: string; note?: string },
  ) {
    api
      .createAiwfCard(project!.id, {
        title: fields.title,
        status: phase,
        kind: fields.kind,
        skill: fields.skill,
      })
      .then((r) => {
        loadCards(project!.id);
        if (fields.kind === "thread" && fields.skill) runCard(r.ticket.key, fields.skill, fields.note);
      })
      .catch((e) => onError(String(e.message ?? e)));
  }
  function moveCard(key: string, target: string) {
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.key === key ? { ...c, status: target } : c)));
    api
      .transitionAiwfCard(project!.id, key, target)
      .then(() => {
        loadCards(project!.id);
        // Moving into a phase (not Complete) offers that phase's skills to start a session.
        if (target !== "Complete" && (phaseSkills[target]?.length ?? 0) > 0)
          setPicker({ key, phase: target });
      })
      .catch((e) => {
        setCards(prev);
        onError(String(e.message ?? e));
      });
  }

  return (
    <div className="aiwf-board-area">
      <div className="columns">
        {allColumns.map((phase, i) => (
          <AiwfColumn
            key={phase}
            phase={phase}
            color={COLUMN_COLORS[i % COLUMN_COLORS.length]}
            projectId={project.id}
            cards={cards.filter((c) => c.status === phase)}
            hasSkills={(phaseSkills[phase]?.length ?? 0) > 0}
            runByTicket={runByTicket}
            onNew={() => setNewItem(phase)}
            onMove={moveCard}
            onRunPhase={(key) => setPicker({ key, phase })}
            onOpenRun={onOpenRun}
          />
        ))}
      </div>

      {newItem && (
        <NewItemModal
          phase={newItem}
          phaseSkills={phaseSkills[newItem] ?? []}
          skillsByName={skillsByName}
          onCancel={() => setNewItem(null)}
          onCreate={(fields) => {
            createItem(newItem, fields);
            setNewItem(null);
          }}
        />
      )}

      {picker && (
        <PhaseSkillModal
          phase={picker.phase}
          phaseSkills={phaseSkills[picker.phase] ?? []}
          skillsByName={skillsByName}
          onCancel={() => setPicker(null)}
          onRun={(skill, note) => {
            runCard(picker.key, skill, note);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

function AiwfColumn({
  phase,
  color,
  projectId,
  cards,
  hasSkills,
  runByTicket,
  onNew,
  onMove,
  onRunPhase,
  onOpenRun,
}: {
  phase: string;
  color: string;
  projectId: string;
  cards: Ticket[];
  hasSkills: boolean;
  runByTicket: Map<string, RunSummary>;
  onNew: () => void;
  onMove: (key: string, target: string) => void;
  onRunPhase: (key: string) => void;
  onOpenRun: (run: RunSummary) => void;
}) {
  const [over, setOver] = useState(false);
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const raw = e.dataTransfer.getData(TICKET_DND_MIME);
    if (!raw) return;
    let data: TicketDragData;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (data.boardKey !== projectId || data.status === phase) return;
    onMove(data.key, phase);
  }
  return (
    <div
      className={`column${over ? " drop-over" : ""}`}
      style={{ borderTopColor: color }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TICKET_DND_MIME)) return;
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="column-header">
        <span className="status-dot" style={{ background: color }} />
        <span className="column-title" style={{ color }}>
          {phase}
        </span>
        <span className="count">{cards.length}</span>
        <button className="icon-btn col-add has-tip" data-tip={`New item in ${phase}`} onClick={onNew}>
          <Plus size={14} />
        </button>
      </div>
      <div className="column-body">
        {cards.map((c) => (
          <AiwfCard
            key={c.key}
            card={c}
            hasSkills={hasSkills}
            run={runByTicket.get(c.key)}
            onRunPhase={() => onRunPhase(c.key)}
            onOpenRun={onOpenRun}
          />
        ))}
      </div>
    </div>
  );
}

function AiwfCard({
  card,
  hasSkills,
  run,
  onRunPhase,
  onOpenRun,
}: {
  card: Ticket;
  hasSkills: boolean;
  run?: RunSummary;
  onRunPhase: () => void;
  onOpenRun: (run: RunSummary) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const active = run ? isActive(run.state) : false;
  const history = card.history ?? [];
  return (
    <div
      className={`card aiwf-card${active ? " active" : ""}${dragging ? " dragging" : ""}`}
      draggable
      onDragStart={(e) => {
        const data: TicketDragData = { key: card.key, boardKey: card.boardKey, status: card.status };
        e.dataTransfer.setData(TICKET_DND_MIME, JSON.stringify(data));
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      <div className="card-key-row">
        <span className="card-key">{card.key}</span>
        <span className={`aiwf-kind ${card.kind ?? "thread"}`}>{card.kind === "task" ? "task" : "work"}</span>
      </div>
      <div className="card-summary">{card.summary}</div>

      {history.length > 0 && (
        <div className="aiwf-history">
          {history.slice(-4).map((h, idx) => (
            <span key={idx} className="aiwf-hist" title={h.summary || `${h.phase} · /${h.skill}`}>
              <CheckCircle2 size={10} /> {h.phase}·/{h.skill}
            </span>
          ))}
        </div>
      )}

      <div className="card-actions">
        {run ? (
          <button
            className={`run-tag ${run.state}`}
            onClick={() => onOpenRun(run)}
            title={`Open session (${run.agentName})`}
          >
            {active ? <Loader2 size={12} className="spin" /> : <Activity size={12} />}
            <Bot size={11} /> {run.agentName} · {run.state}
          </button>
        ) : (
          card.kind !== "task" &&
          hasSkills && (
            <button className="btn-ghost sm" onClick={onRunPhase} title={`Run a ${card.status} skill`}>
              <Play size={12} /> Run skill
            </button>
          )
        )}
      </div>
    </div>
  );
}

function NewItemModal({
  phase,
  phaseSkills,
  skillsByName,
  onCreate,
  onCancel,
}: {
  phase: string;
  phaseSkills: string[];
  skillsByName: Map<string, Skill>;
  onCreate: (fields: { title: string; kind: "thread" | "task"; skill?: string; note?: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"session" | "task">(phaseSkills.length ? "session" : "task");
  const [skill, setSkill] = useState(phaseSkills[0] ?? "");
  const [note, setNote] = useState("");

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal aiwf-modal" onClick={(e) => e.stopPropagation()}>
        <h2>New item in {phase}</h2>
        <label className="field">
          <span>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Auth feature"
            autoFocus
          />
        </label>
        <div className="field">
          <span>Type</span>
          <div className="seg">
            <button
              className={type === "session" ? "on" : ""}
              disabled={!phaseSkills.length}
              onClick={() => setType("session")}
            >
              Session (run a skill)
            </button>
            <button className={type === "task" ? "on" : ""} onClick={() => setType("task")}>
              Task (manual)
            </button>
          </div>
        </div>
        {type === "session" && phaseSkills.length > 0 && (
          <>
            <div className="field">
              <span>{phase} skill</span>
              {/* buttons instead of <select> so the picker is consistent with the Type row */}
              <div className="seg wrap">
                {phaseSkills.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={skill === s ? "on" : ""}
                    disabled={!skillsByName.has(s)}
                    onClick={() => setSkill(s)}
                  >
                    /{s}
                    {!skillsByName.has(s) && " (not installed)"}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Note (optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Steer the session…"
              />
            </label>
          </>
        )}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={!title.trim() || (type === "session" && !skill)}
            onClick={() =>
              onCreate({
                title: title.trim(),
                kind: type === "task" ? "task" : "thread",
                skill: type === "session" ? skill : undefined,
                note: note.trim() || undefined,
              })
            }
          >
            {type === "session" ? "Create & start" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhaseSkillModal({
  phase,
  phaseSkills,
  skillsByName,
  onRun,
  onCancel,
}: {
  phase: string;
  phaseSkills: string[];
  skillsByName: Map<string, Skill>;
  onRun: (skill: string, note?: string) => void;
  onCancel: () => void;
}) {
  const [skill, setSkill] = useState(phaseSkills[0] ?? "");
  const [note, setNote] = useState("");
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal aiwf-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Start a {phase} session</h2>
        <p className="aiwf-skill-desc">
          {skillsByName.get(skill)?.description ?? `Run a ${phase} skill on this card.`}
        </p>
        <div className="field">
          <span>Skill</span>
          {/* buttons instead of <select> so the picker is consistent with the Type row */}
          <div className="seg wrap">
            {phaseSkills.map((s) => (
              <button
                key={s}
                type="button"
                className={skill === s ? "on" : ""}
                disabled={!skillsByName.has(s)}
                onClick={() => setSkill(s)}
                title={skillsByName.has(s) ? undefined : `/${s} (not installed)`}
              >
                /{s}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Note (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Steer the session…"
          />
        </label>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>
            Just move, no session
          </button>
          <button className="btn" disabled={!skill} onClick={() => onRun(skill, note.trim() || undefined)}>
            Start session
          </button>
        </div>
      </div>
    </div>
  );
}

function NewProjectWizard({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (runId: string | undefined, project: AiwfProject) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [mode, setMode] = useState<"new" | "adopt">("new");
  const [pathOk, setPathOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = repoPath.trim();
    if (!p) {
      setPathOk(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .checkPath(p)
        .then((r) => setPathOk(r.exists))
        .catch(() => setPathOk(null));
    }, 300);
    return () => clearTimeout(t);
  }, [repoPath]);

  function submit() {
    if (!name.trim() || !repoPath.trim()) return;
    setBusy(true);
    api
      .createAiwfProject(name.trim(), repoPath.trim(), mode)
      .then((r) => onCreated(r.runId, r.project))
      .catch((e) => onError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal aiwf-modal aiwf-wizard" onClick={(e) => e.stopPropagation()}>
        <h2>New AI Workflow project</h2>
        <label className="field">
          <span>Project name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dynamic Core"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Repository path</span>
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="~/dev/thalissonbarbosa/dynamiccore"
          />
          {pathOk === false && <em className="field-warn">Path does not exist</em>}
          {pathOk === true && <em className="field-ok">Path found</em>}
        </label>
        <div className="field">
          <span>Setup mode</span>
          <div className="seg">
            <button className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>
              New project (scaffold)
            </button>
            <button className={mode === "adopt" ? "on" : ""} onClick={() => setMode("adopt")}>
              Adopt existing
            </button>
          </div>
          <em className="hint">
            {mode === "new"
              ? "Runs the new-project skill in the repo to scaffold the workflow structure."
              : "Registers the repo as-is; create Planning cards and run /prd, /roadmap to get going."}
          </em>
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={submit} disabled={busy || !name.trim() || !repoPath.trim()}>
            {busy ? <Loader2 size={15} className="spin" /> : null} Create
          </button>
        </div>
      </div>
    </div>
  );
}

// Edit a registered project's display name and location (repoPath) in place. The id is unchanged,
// so the board and its cards just re-point to the new location.
function EditProjectModal({
  project,
  onClose,
  onSaved,
  onError,
}: {
  project: AiwfProject;
  onClose: () => void;
  onSaved: (project: AiwfProject) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [repoPath, setRepoPath] = useState(project.repoPath);
  const [pathOk, setPathOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = repoPath.trim();
    if (!p) {
      setPathOk(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .checkPath(p)
        .then((r) => setPathOk(r.exists))
        .catch(() => setPathOk(null));
    }, 300);
    return () => clearTimeout(t);
  }, [repoPath]);

  const changed = name.trim() !== project.name || repoPath.trim() !== project.repoPath;

  function submit() {
    if (!name.trim() || !repoPath.trim() || !changed) return;
    setBusy(true);
    api
      .updateAiwfProject(project.id, { name: name.trim(), repoPath: repoPath.trim() })
      .then((r) => onSaved(r.project))
      .catch((e) => onError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal aiwf-modal aiwf-wizard" onClick={(e) => e.stopPropagation()}>
        <h2>Edit AI Workflow project</h2>
        <label className="field">
          <span>Project name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dynamic Core"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Repository path</span>
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="~/dev/thalissonbarbosa/dynamiccore"
          />
          {pathOk === false && <em className="field-warn">Path does not exist</em>}
          {pathOk === true && <em className="field-ok">Path found</em>}
          <em className="hint">
            Cards stay with the project in Hangar's data dir; only future work uses the new path.
          </em>
        </label>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={submit}
            disabled={busy || !name.trim() || !repoPath.trim() || !changed}
          >
            {busy ? <Loader2 size={15} className="spin" /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
}
