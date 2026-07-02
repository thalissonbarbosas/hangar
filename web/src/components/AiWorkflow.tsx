import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  Archive,
  ArchiveRestore,
  Eye,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Wrench,
  GitBranch,
  CornerUpLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { api, CheckoutFailed } from "../api";
import {
  AiwfDocTreeNode,
  AiwfProject,
  AiwfSkillGroup,
  AiwfStatus,
  RunEvent,
  RunSummary,
  Skill,
  Ticket,
  TICKET_DND_MIME,
  TicketDragData,
  isActive,
} from "../types";
import { Markdown } from "./Markdown";
import { WorktreeManagerModal } from "./WorktreeManagerModal";
import { ClaudeSessionButton } from "./Board";
import { DocPanel } from "./DocPanel";

// ---------------------------------------------------------------------------
// AI Workflow connection — phases ARE the columns. A card is a work thread that
// flows through the phases; moving it into a phase pops that phase's skill picker
// to start a session, and every session result is logged to the card's history.
//   • <AiWorkflowBar>  — topbar sub-menu: project picker + install/options
//   • <AiWorkflowView> — the phase board
// ---------------------------------------------------------------------------

/** Extract the NNN prefix from paths like docs/specs/019_foo.md or docs/roadmap/001_bar.md.
 *  Returns null for folder roots (e.g. "docs/specs") that have no prefix. */
function extractItemNumber(path: string): string | null {
  const m = path.match(/\/(\d{3})[_.]/);
  return m ? m[1] : null;
}

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
  skills,
  sidebarOpen,
  onSelect,
  onReload,
  onError,
  onOpenSession,
  onToggleSidebar,
}: {
  status: AiwfStatus | null;
  projects: AiwfProject[];
  selectedId: string | null;
  skills?: Skill[];
  sidebarOpen?: boolean;
  onSelect: (id: string) => void;
  onReload: () => void;
  onError: (msg: string) => void;
  onOpenSession: (a: OpenSession) => void;
  onToggleSidebar?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [guidanceOpen, setGuidanceOpen] = useState(false);

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

  return (
    <div className="subbar aiwf-bar">
      {status && !status.installed ? (
        <>
          <span className="subbar-warn">
            <AlertTriangle size={14} /> AI Workflow isn't installed
          </span>
          <button className="btn" onClick={install} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Install
          </button>
        </>
      ) : (
        <>
          {onToggleSidebar && (
            <button
              className="icon-btn has-tip"
              data-tip={sidebarOpen ? "Hide docs" : "Show docs"}
              onClick={onToggleSidebar}
              aria-label={sidebarOpen ? "Hide doc sidebar" : "Show doc sidebar"}
            >
              {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            </button>
          )}
          <div className="aiwf-proj-picker">
            {projects.map((p) => (
              <span key={p.id} className="aiwf-proj">
                <button className={`pill${p.id === selectedId ? " on" : ""}`} onClick={() => onSelect(p.id)}>
                  {p.name}
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

      <button className="icon-btn has-tip" data-tip="Skills guide" onClick={() => setGuidanceOpen(true)}>
        <BookOpen size={17} />
      </button>

      <OptionsMenu status={status} busy={busy} onReinstall={install} onUninstall={uninstall} />

      {guidanceOpen && (
        <AiwfGuidanceModal
          skillGroups={status?.skillGroups ?? []}
          skills={skills ?? []}
          repoUrl={status?.repoUrl ?? "https://github.com/0xrafasec/ai-workflow"}
          author={status?.author ?? "0xrafasec"}
          authorUrl={status?.authorUrl ?? "https://github.com/0xrafasec"}
          onClose={() => setGuidanceOpen(false)}
        />
      )}

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

// ---- Doc tree sidebar ----

// Icon mapping for standard doc types — shown before the title in each tree row.
function docIcon(node: AiwfDocTreeNode): string {
  if (node.path === "docs/PRD.md") return "📋";
  if (node.path === "docs/ARCHITECTURE.md") return "🏗";
  if (node.path === "docs/THREAT_MODEL.md") return "🛡";
  if (node.path === "docs/design/DESIGN_SYSTEM.md") return "🎨";
  if (node.type === "folder" || node.type === "spec-dir") return "📁";
  return "📝";
}

function DocTreeRow({
  node,
  indent,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  node: AiwfDocTreeNode;
  indent?: 1 | 2;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const isFolder = node.type === "folder" || node.type === "spec-dir";
  const absent = !node.exists;
  // NNN badge for spec and roadmap-child rows — extracted once so the regex runs only once.
  const itemNumber =
    node.type === "spec" || node.type === "spec-dir" || node.path.startsWith("docs/roadmap/")
      ? extractItemNumber(node.path)
      : null;
  const classes = [
    "doc-tree-row",
    indent ? `indent-${indent}` : "",
    selected ? "selected" : "",
    absent ? "absent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  function handleClick() {
    if (absent) return;
    if (isFolder) onToggle();
    else onSelect();
  }

  return (
    <div
      className={classes}
      onClick={handleClick}
      role="button"
      tabIndex={absent ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={node.title}
      aria-expanded={isFolder ? expanded : undefined}
      aria-disabled={absent}
    >
      {isFolder ? (
        expanded ? (
          <ChevronDown size={12} style={{ flexShrink: 0 }} />
        ) : (
          <ChevronRight size={12} style={{ flexShrink: 0 }} />
        )
      ) : (
        // 12px spacer to align leaf nodes with folder label (chevron width + gap)
        <span style={{ width: 12, flexShrink: 0 }} />
      )}
      <span style={{ flexShrink: 0 }}>{docIcon(node)}</span>
      {itemNumber && <span className="doc-tree-num">{itemNumber}</span>}
      <span
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {node.title}
      </span>
      {node.exists && <span style={{ color: "var(--success)", fontSize: 10, flexShrink: 0 }}>✓</span>}
    </div>
  );
}

function DocTreeSidebar({
  projectId,
  open,
  activeThreads,
  runByTicket,
  selectedPath,
  onOpenDoc,
  onOpenThread,
}: {
  projectId: string;
  open: boolean;
  activeThreads: Ticket[];
  runByTicket: Map<string, RunSummary>;
  selectedPath: string | null;
  onOpenDoc: (node: AiwfDocTreeNode) => void;
  onOpenThread: (runId: string) => void;
}) {
  const [nodes, setNodes] = useState<AiwfDocTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  // Specs folder expanded by default.
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["docs/specs"]));
  // How many children to show in the paginated sections (10 at a time).
  const [specsLimit, setSpecsLimit] = useState(10);
  const [roadmapLimit, setRoadmapLimit] = useState(10);

  useEffect(() => {
    setLoading(true);
    api
      .aiwfProjectDocTree(projectId)
      .then((r) => setNodes(r.nodes))
      .catch(() => setNodes([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Reset pagination when the project changes.
  useEffect(() => {
    setSpecsLimit(10);
    setRoadmapLimit(10);
  }, [projectId]);

  function toggleExpanded(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // Limit active threads shown to 5.
  const visibleThreads = activeThreads.slice(0, 5);

  return (
    <div className={`doc-sidebar${open ? "" : " collapsed"}`}>
      <div className="doc-sidebar-section-label">Documents</div>
      {loading ? (
        <div style={{ padding: "8px 12px", color: "var(--text-faint)", fontSize: 11.5 }}>
          <Loader2 size={12} className="spin" /> Loading…
        </div>
      ) : (
        <div className="doc-tree">
          {nodes.map((node) => {
            const allChildren = node.children ?? [];
            const limit =
              node.path === "docs/specs"
                ? specsLimit
                : node.path === "docs/roadmap"
                  ? roadmapLimit
                  : allChildren.length;
            const visibleChildren = allChildren.slice(0, limit);
            const hiddenCount = allChildren.length - visibleChildren.length;
            const isPaginated = node.path === "docs/specs" || node.path === "docs/roadmap";
            return (
              <div key={node.path}>
                <DocTreeRow
                  node={node}
                  selected={selectedPath === node.path}
                  expanded={expanded.has(node.path)}
                  onToggle={() => toggleExpanded(node.path)}
                  onSelect={() => onOpenDoc(node)}
                />
                {(node.type === "folder" || node.type === "spec-dir") && expanded.has(node.path) && (
                  <>
                    {visibleChildren.map((child) => (
                      <div key={child.path}>
                        <DocTreeRow
                          node={child}
                          indent={1}
                          selected={selectedPath === child.path}
                          expanded={expanded.has(child.path)}
                          onToggle={() => toggleExpanded(child.path)}
                          onSelect={() => onOpenDoc(child)}
                        />
                        {(child.type === "folder" || child.type === "spec-dir") &&
                          expanded.has(child.path) &&
                          child.children?.map((grandchild) => (
                            <DocTreeRow
                              key={grandchild.path}
                              node={grandchild}
                              indent={2}
                              selected={selectedPath === grandchild.path}
                              expanded={expanded.has(grandchild.path)}
                              onToggle={() => toggleExpanded(grandchild.path)}
                              onSelect={() => onOpenDoc(grandchild)}
                            />
                          ))}
                      </div>
                    ))}
                    {isPaginated && hiddenCount > 0 && (
                      <button
                        className="btn-ghost sm doc-tree-see-more"
                        onClick={() => {
                          if (node.path === "docs/specs") setSpecsLimit((l) => l + 10);
                          else setRoadmapLimit((l) => l + 10);
                        }}
                      >
                        See {Math.min(hiddenCount, 10)} more…
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {visibleThreads.length > 0 && (
        <>
          <div className="doc-sidebar-section-label">Active · {visibleThreads.length}</div>
          {visibleThreads.map((thread) => {
            // Determine run state for the dot color — awaiting_input → warning, else → accent.
            const run = runByTicket.get(thread.key);
            const isAwaiting = run?.state === "awaiting_input";
            const dotClass = isAwaiting ? "run-dot awaiting" : "run-dot running";
            return (
              <div
                key={thread.key}
                className="sidebar-thread-row"
                role="button"
                tabIndex={0}
                aria-label={`Open ${thread.key}: ${thread.summary}`}
                onClick={() => {
                  if (run) onOpenThread(run.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (run) onOpenThread(run.id);
                  }
                }}
              >
                <span className={dotClass} />
                <span className="card-key">{thread.key}</span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {thread.summary}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ---- Phase board ----

const COLUMN_COLORS = ["#4f7cff", "#8b5cf6", "#10b981", "#e08e0b", "#0ea5e9", "#22c55e"];

// First line of a spec/promoted-card description, e.g. "Spec: docs/specs/014_foo.md".
// Used to dedup a spec to its already-promoted board card.
function specLine(desc?: string): string | null {
  const first = (desc ?? "").split("\n", 1)[0];
  return /^Spec:\s+\S/.test(first) ? first : null;
}

export function AiWorkflowView({
  project,
  status,
  skills,
  runs,
  sidebarOpen,
  onOpenRun,
  onOpenSession,
  onReload,
  onStartClaude,
  onError,
  onClearRun,
}: {
  project: AiwfProject | null;
  status: AiwfStatus | null;
  skills: Skill[];
  runs: RunSummary[];
  sidebarOpen: boolean;
  onOpenRun: (run: RunSummary) => void;
  onOpenSession: (a: OpenSession) => void;
  onReload: () => void;
  onStartClaude: (cwd: string, title: string, model: string, note?: string) => Promise<string>;
  onError: (msg: string) => void;
  /** Called when a doc is opened so the global RunPanel can be cleared. */
  onClearRun?: () => void;
}) {
  const [cards, setCards] = useState<Ticket[]>([]);
  const [newItem, setNewItem] = useState<string | null>(null); // phase for the New-item modal
  const [picker, setPicker] = useState<{ key: string; phase: string } | null>(null); // phase skill picker
  const [dataCard, setDataCard] = useState<Ticket | null>(null); // card shown in the See Data modal
  const [sessionTranscript, setSessionTranscript] = useState<{ runId: string; label: string } | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false); // archived section collapsed state
  // Pending promote: spec dragged to a column — card not created yet, waiting for skill picker confirm
  const [pendingPromote, setPendingPromote] = useState<{ specKey: string; phase: string } | null>(null);
  // Moving to Complete with an active worktree — prompt before transitioning
  const [completeWorktreeModal, setCompleteWorktreeModal] = useState<{
    key: string;
    branch: string;
    target: string;
  } | null>(null);
  const [worktreeManagerOpen, setWorktreeManagerOpen] = useState(false);
  const [editing, setEditing] = useState<AiwfProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  const projMenuRef = useRef<HTMLDivElement>(null);

  // activeDoc and the global activeRun are mutually exclusive — opening one clears the other.
  const [activeDoc, setActiveDoc] = useState<AiwfDocTreeNode | null>(null);

  useEffect(() => {
    if (!projMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!projMenuRef.current?.contains(e.target as Node)) setProjMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [projMenuOpen]);

  function removeProject() {
    if (
      !window.confirm(
        `Remove project "${project!.name}" from AI Workflow? This only unregisters it from Hangar — your repo ` +
          "stays untouched and the project's board state is left on disk in Hangar's data dir.",
      )
    )
      return;
    setBusy(true);
    api
      .deleteAiwfProject(project!.id)
      .then(() => onReload())
      .catch((e) => onError(String(e.message ?? e)))
      .finally(() => setBusy(false));
  }

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
  const activeCards = cards.filter((c) => !c.archived && c.kind !== "spec");
  const archivedCards = cards.filter((c) => c.archived);
  const extra = [...new Set(activeCards.map((c) => c.status))].filter((s) => !columns.includes(s));
  const allColumns = [...columns, ...extra];
  // Cards that have an active run — shown in the sidebar's "Active" section.
  const activeThreads = activeCards.filter((c) => {
    const run = runByTicket.get(c.key);
    return run ? isActive(run.state) : false;
  });

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
  function doTransition(key: string, target: string) {
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
  function moveCard(key: string, target: string) {
    const lastColumn = allColumns[allColumns.length - 1];
    const card = cards.find((c) => c.key === key);
    if (target === lastColumn && card?.hasWorktree && card.taskBranch) {
      setCompleteWorktreeModal({ key, branch: card.taskBranch, target });
      return;
    }
    doTransition(key, target);
  }
  // Step 1 — just open the picker; the board card is NOT created yet.
  function promoteSpec(specKey: string, targetPhase: string) {
    setPendingPromote({ specKey, phase: targetPhase });
  }
  // Create-or-reuse a board task for a spec, then run the skill on it. Single entry point shared by
  // the spec row button, the SpecSidebar, and drag-to-promote — so every spec run lands a task on
  // the board and starts the session from it (HAN-10).
  function promoteSpecAndRun(specKey: string, phase: string, skill: string, note?: string) {
    const specCard = cards.find((c) => c.kind === "spec" && c.key === specKey);
    if (!specCard) return;
    const line = specLine(specCard.description);
    // Dedup: reuse an existing non-archived board card promoted from the same spec, so history
    // accumulates in one place instead of spawning a card per run.
    const existing = line
      ? cards.find((c) => c.kind !== "spec" && !c.archived && specLine(c.description) === line)
      : undefined;
    if (existing) {
      runCard(existing.key, skill, note);
      return;
    }
    api
      .createAiwfCard(project!.id, {
        title: specCard.summary,
        status: phase,
        kind: "thread",
        description: specCard.description, // includes the "Spec: <path>" prefix
      })
      .then((r) => {
        loadCards(project!.id);
        runCard(r.ticket.key, skill, note);
      })
      .catch((e) => onError(String(e.message ?? e)));
  }
  // Step 2 — user confirmed a skill from the drag-to-promote picker; create/reuse then run.
  function confirmPromote(skill: string, note?: string) {
    if (!pendingPromote) return;
    const { specKey, phase } = pendingPromote;
    setPendingPromote(null);
    promoteSpecAndRun(specKey, phase, skill, note);
  }
  function archiveCard(key: string, archived: boolean) {
    api
      .archiveAiwfCard(project!.id, key, archived)
      .then(() => loadCards(project!.id))
      .catch((e) => onError(String(e.message ?? e)));
  }
  function removeCard(key: string) {
    api
      .deleteAiwfCard(project!.id, key)
      .then(() => loadCards(project!.id))
      .catch((e) => onError(String(e.message ?? e)));
  }

  return (
    <div className="aiwf-content">
      {/* Doc tree sidebar — collapsible, controlled by sidebarOpen from App */}
      <DocTreeSidebar
        projectId={project.id}
        open={sidebarOpen}
        activeThreads={activeThreads}
        runByTicket={runByTicket}
        selectedPath={activeDoc?.path ?? null}
        onOpenDoc={(node) => {
          setActiveDoc(node);
          // Clear the global RunPanel so DocPanel has room on the right.
          onClearRun?.();
        }}
        onOpenThread={(runId) => {
          const run = runs.find((r) => r.id === runId);
          if (run) {
            setActiveDoc(null);
            onOpenRun(run);
          }
        }}
      />

      {/* Board area — wrapped so we can control its scroll independent of the sidebar */}
      <div className="aiwf-board-area" style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
        <div className="aiwf-board-header">
          <span className="aiwf-board-project-name">{project.name}</span>
          <ClaudeSessionButton
            cwd={project.repoPath}
            title={`${project.name} — Claude`}
            runs={runs}
            onOpenRun={onOpenRun}
            onStart={(model, note) =>
              onStartClaude(project.repoPath, `${project.name} — Claude`, model, note)
            }
          />
          <button
            className="icon-btn has-tip"
            data-tip="Manage task worktrees"
            onClick={() => setWorktreeManagerOpen(true)}
          >
            <Wrench size={15} />
          </button>
          <div className="aiwf-options" ref={projMenuRef}>
            <button
              className="icon-btn has-tip"
              data-tip="Project options"
              disabled={busy}
              onClick={() => setProjMenuOpen((v) => !v)}
            >
              <MoreVertical size={15} />
            </button>
            {projMenuOpen && (
              <div className="aiwf-options-pop">
                <button
                  className="aiwf-opt"
                  onClick={() => {
                    setProjMenuOpen(false);
                    setEditing(project);
                  }}
                >
                  <Pencil size={13} /> Edit project
                </button>
                <div className="aiwf-opt-sep" />
                <button
                  className="aiwf-opt danger"
                  onClick={() => {
                    setProjMenuOpen(false);
                    removeProject();
                  }}
                >
                  <X size={13} /> Remove project
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="columns">
          {allColumns.map((phase, i) => (
            <AiwfColumn
              key={phase}
              phase={phase}
              color={COLUMN_COLORS[i % COLUMN_COLORS.length]}
              projectId={project.id}
              cards={activeCards.filter((c) => c.status === phase)}
              hasSkills={(phaseSkills[phase]?.length ?? 0) > 0}
              runByTicket={runByTicket}
              onNew={() => setNewItem(phase)}
              onMove={moveCard}
              onPromoteSpec={promoteSpec}
              onRunPhase={(key) => setPicker({ key, phase })}
              onOpenRun={(run) => {
                setActiveDoc(null);
                onOpenRun(run);
              }}
              onSeeData={setDataCard}
              onArchive={(key) => archiveCard(key, true)}
              onDelete={removeCard}
              isComplete={i === allColumns.length - 1}
            />
          ))}
        </div>

        {archivedCards.length > 0 && (
          <div className="aiwf-archived-section">
            <button className="aiwf-archived-toggle" onClick={() => setArchivedOpen((v) => !v)}>
              {archivedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Archive size={13} />
              Archived ({archivedCards.length})
            </button>
            {archivedOpen && (
              <div className="aiwf-archived-list">
                {archivedCards.map((c) => (
                  <div key={c.key} className="aiwf-archived-row">
                    <span className="card-key aiwf-archived-key">{c.key}</span>
                    <span className="aiwf-archived-title">{c.summary}</span>
                    <div className="aiwf-archived-actions">
                      <button className="aiwf-opt" title="See data" onClick={() => setDataCard(c)}>
                        <Eye size={13} /> See data
                      </button>
                      <button
                        className="aiwf-opt"
                        title="Unarchive"
                        onClick={() => archiveCard(c.key, false)}
                      >
                        <ArchiveRestore size={13} /> Unarchive
                      </button>
                      <button
                        className="aiwf-opt danger"
                        title="Delete"
                        onClick={() => {
                          if (window.confirm(`Delete card ${c.key} "${c.summary}"? This cannot be undone.`))
                            removeCard(c.key);
                        }}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* DocPanel — shown instead of the global RunPanel when a doc is open */}
      {activeDoc && <DocPanel projectId={project.id} node={activeDoc} onClose={() => setActiveDoc(null)} />}

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
            // Spec rows promote-then-run; existing board cards run in place.
            if (picker.key.startsWith("SPEC-")) promoteSpecAndRun(picker.key, picker.phase, skill, note);
            else runCard(picker.key, skill, note);
            setPicker(null);
          }}
        />
      )}

      {pendingPromote && (
        <PhaseSkillModal
          phase={pendingPromote.phase}
          phaseSkills={phaseSkills[pendingPromote.phase] ?? []}
          skillsByName={skillsByName}
          onCancel={() => setPendingPromote(null)}
          onRun={confirmPromote}
        />
      )}

      {dataCard && (
        <CardDataModal
          card={dataCard}
          projectId={project.id}
          onError={onError}
          onClose={() => setDataCard(null)}
          onViewSession={(runId, label) => setSessionTranscript({ runId, label })}
        />
      )}

      {sessionTranscript && (
        <SessionTranscriptSidebar
          runId={sessionTranscript.runId}
          label={sessionTranscript.label}
          onClose={() => setSessionTranscript(null)}
        />
      )}

      {completeWorktreeModal && (
        <CompleteWorktreeModal
          cardKey={completeWorktreeModal.key}
          branch={completeWorktreeModal.branch}
          onClose={() => setCompleteWorktreeModal(null)}
          onMoveOnly={() => {
            const { key, target } = completeWorktreeModal;
            setCompleteWorktreeModal(null);
            doTransition(key, target);
          }}
          onMoveAndCleanup={() => {
            const { key, target } = completeWorktreeModal;
            setCompleteWorktreeModal(null);
            api
              .deleteAiwfWorktree(project!.id, key)
              .then(() => doTransition(key, target))
              .catch((e) => onError(String(e.message ?? e)));
          }}
        />
      )}

      {worktreeManagerOpen && (
        <WorktreeManagerModal
          contextId={`aiwf-${project.id}`}
          title={project.name}
          onClose={() => setWorktreeManagerOpen(false)}
        />
      )}

      {editing && (
        <EditProjectModal
          project={editing}
          onClose={() => setEditing(null)}
          onError={onError}
          onSaved={() => {
            setEditing(null);
            onReload();
          }}
        />
      )}
    </div>
  );
}

// Modal listing all cards in the complete column with a live name filter.
// Rows are one-line and clickable — clicking opens the card data sidebar.
function CompleteCardsModal({
  cards,
  onSeeData,
  onClose,
}: {
  cards: Ticket[];
  onSeeData: (card: Ticket) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const q = filter.toLowerCase();
  const visible = q ? cards.filter((c) => c.summary.toLowerCase().includes(q)) : cards;
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Complete ({cards.length})</span>
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
            <div className="col-done-empty">No complete cards match "{filter}"</div>
          ) : (
            visible.map((c) => (
              <div
                key={c.key}
                className="col-done-row"
                onClick={() => {
                  onSeeData(c);
                  onClose();
                }}
              >
                <span className="card-key col-done-key">{c.key}</span>
                <span className="col-done-title">{c.summary}</span>
              </div>
            ))
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

// Prompt shown when moving a card with an active task worktree to the Complete column.
function CompleteWorktreeModal({
  cardKey,
  branch,
  onClose,
  onMoveOnly,
  onMoveAndCleanup,
}: {
  cardKey: string;
  branch: string;
  onClose: () => void;
  onMoveOnly: () => void;
  onMoveAndCleanup: () => void;
}) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal aiwf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Move to Complete</span>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p style={{ margin: "1rem 1.25rem" }}>
          Card <strong>{cardKey}</strong> has an active task worktree on branch <code>{branch}</code>.
        </p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onMoveOnly}>
            Move only
          </button>
          <button className="btn" onClick={onMoveAndCleanup}>
            Move + clean up worktree
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const COMPLETE_CAP = 5; // max cards shown in the complete column before "See more" kicks in

// Completion timestamp for ordering the Complete column: the stamped completedAt, else the last
// history entry's time, else 0 (unknown — sorts last).
function completedTs(c: Ticket): number {
  if (c.completedAt) return c.completedAt;
  const history = c.history ?? [];
  return history.length ? history[history.length - 1].at : 0;
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
  onPromoteSpec,
  onRunPhase,
  onOpenRun,
  onSeeData,
  onArchive,
  onDelete,
  isComplete,
}: {
  phase: string;
  color: string;
  projectId: string;
  cards: Ticket[];
  hasSkills: boolean;
  runByTicket: Map<string, RunSummary>;
  onNew: () => void;
  onMove: (key: string, target: string) => void;
  onPromoteSpec: (key: string, phase: string) => void;
  onRunPhase: (key: string) => void;
  onOpenRun: (run: RunSummary) => void;
  onSeeData: (card: Ticket) => void;
  onArchive: (key: string) => void;
  onDelete: (key: string) => void;
  isComplete?: boolean; // true for the last (complete) column
}) {
  const [over, setOver] = useState(false);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);

  // Sort complete-column cards by completion date (newest first); leave other columns untouched.
  // Fall back to the latest history entry, then title, for cards completed before completedAt existed.
  const sorted = isComplete
    ? [...cards].sort((a, b) => completedTs(b) - completedTs(a) || a.summary.localeCompare(b.summary))
    : cards;
  const visible = isComplete ? sorted.slice(0, COMPLETE_CAP) : sorted;
  const hidden = isComplete ? Math.max(0, sorted.length - COMPLETE_CAP) : 0;

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
    if (data.boardKey !== projectId) return;
    if (data.kind === "spec") {
      onPromoteSpec(data.key, phase);
      return;
    }
    if (data.status === phase) return;
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
        {visible.map((c) => (
          <AiwfCard
            key={c.key}
            card={c}
            hasSkills={hasSkills}
            run={runByTicket.get(c.key)}
            onRunPhase={() => onRunPhase(c.key)}
            onOpenRun={onOpenRun}
            onSeeData={() => onSeeData(c)}
            onArchive={() => onArchive(c.key)}
            onDelete={() => onDelete(c.key)}
          />
        ))}
        {hidden > 0 && (
          <button className="btn-ghost sm col-see-more" onClick={() => setCompleteModalOpen(true)}>
            See {hidden} more ▾
          </button>
        )}
      </div>
      {completeModalOpen && (
        <CompleteCardsModal
          cards={sorted}
          onSeeData={onSeeData}
          onClose={() => setCompleteModalOpen(false)}
        />
      )}
    </div>
  );
}

function AiwfCard({
  card,
  hasSkills,
  run,
  onRunPhase,
  onOpenRun,
  onSeeData,
  onArchive,
  onDelete,
}: {
  card: Ticket;
  hasSkills: boolean;
  run?: RunSummary;
  onRunPhase: () => void;
  onOpenRun: (run: RunSummary) => void;
  onSeeData: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = run ? isActive(run.state) : false;
  const history = card.history ?? [];

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

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
        <div className="aiwf-card-right">
          <span className={`aiwf-kind ${card.kind ?? "thread"}`}>
            {card.kind === "task" ? "task" : "work"}
          </span>
          {/* Per-card options menu — must not trigger drag */}
          <div
            className="aiwf-card-menu"
            ref={menuRef}
            onMouseDown={(e) => e.stopPropagation()}
            onDragStart={(e) => e.stopPropagation()}
          >
            <button
              className="icon-btn aiwf-card-menu-btn has-tip"
              data-tip="Card options"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
            >
              <MoreVertical size={13} />
            </button>
            {menuOpen && (
              <div className="aiwf-options-pop aiwf-card-pop">
                <button
                  className="aiwf-opt"
                  onClick={() => {
                    setMenuOpen(false);
                    onSeeData();
                  }}
                >
                  <Eye size={13} /> See data
                </button>
                <button
                  className="aiwf-opt"
                  onClick={() => {
                    setMenuOpen(false);
                    onArchive();
                  }}
                >
                  <Archive size={13} /> Archive
                </button>
                <div className="aiwf-opt-sep" />
                <button
                  className="aiwf-opt danger"
                  onClick={() => {
                    setMenuOpen(false);
                    if (window.confirm(`Delete card ${card.key} "${card.summary}"? This cannot be undone.`))
                      onDelete();
                  }}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
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

// Read-only sidebar showing a card's full data — key, title, status, kind, skill, PR, description, history.
// Rendered as a right-side sidebar (like the session/spec sidebar) and portaled to <body> with an overlay
// stacked above the "See more" modal, so opening a card's data from inside that modal takes priority.
function CardDataModal({
  card,
  projectId,
  onError,
  onClose,
  onViewSession,
}: {
  card: Ticket;
  projectId: string;
  onError: (msg: string) => void;
  onClose: () => void;
  onViewSession: (runId: string, label: string) => void;
}) {
  const history = card.history ?? [];
  // The card's task branch is captured once on open; the worktree (and so card.taskBranch) is cleared
  // by checkout, so we keep it locally to keep the "Back to main" control available afterwards.
  const [taskBranch] = useState<string | undefined>(card.taskBranch);
  const [rootBranch, setRootBranch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Active-session warning surfaced when checkout is blocked (409 active_sessions).
  const [blocked, setBlocked] = useState<{ message: string; titles: string[] } | null>(null);

  // Reflect the project root's actual HEAD so the checkout state survives page refreshes.
  useEffect(() => {
    if (!taskBranch) return;
    let alive = true;
    api
      .aiwfBranch(projectId)
      .then((r) => alive && setRootBranch(r.branch))
      .catch(() => alive && setRootBranch(null));
    return () => {
      alive = false;
    };
  }, [projectId, taskBranch]);

  const onTaskBranch = !!taskBranch && rootBranch === taskBranch;

  function checkoutTaskBranch() {
    setBusy(true);
    setBlocked(null);
    api
      .aiwfCheckoutCard(projectId, card.key)
      .then((r) => setRootBranch(r.branch))
      .catch((e) => {
        if (e instanceof CheckoutFailed && e.detail.error === "active_sessions") {
          setBlocked({
            message: e.detail.message ?? "Sessions are still running.",
            titles: e.detail.titles ?? [],
          });
        } else {
          onError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => setBusy(false));
  }

  function backToMain() {
    setBusy(true);
    setBlocked(null);
    api
      .aiwfCheckoutBranch(projectId, "main")
      .then((r) => setRootBranch(r.branch))
      .catch((e) => {
        if (e instanceof CheckoutFailed && e.detail.error === "active_sessions") {
          setBlocked({
            message: e.detail.message ?? "Sessions are still running.",
            titles: e.detail.titles ?? [],
          });
        } else {
          onError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => setBusy(false));
  }

  return createPortal(
    <div className="aiwf-data-overlay" onClick={onClose}>
      <aside className="aiwf-data-panel" onClick={(e) => e.stopPropagation()}>
        <header className="spec-head">
          <div className="spec-head-main">
            <span className="card-key">{card.key}</span>
            <span className="spec-head-title">{card.summary}</span>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="spec-body">
          <div className="aiwf-data-meta">
            <span>
              <strong>Status</strong> {card.status}
            </span>
            <span>
              <strong>Kind</strong> {card.kind ?? "thread"}
            </span>
            {card.skill && (
              <span>
                <strong>Skill</strong> /{card.skill}
              </span>
            )}
            {card.archived && (
              <span className="aiwf-data-archived">
                <Archive size={12} /> Archived
              </span>
            )}
            {card.prUrl && (
              <a href={card.prUrl} target="_blank" rel="noreferrer" className="aiwf-opt aiwf-data-pr">
                <ExternalLink size={12} /> PR
              </a>
            )}
          </div>

          {taskBranch && (
            <div className="aiwf-data-section">
              <strong>Task branch</strong>
              <div className="aiwf-checkout-row">
                <code className="aiwf-checkout-branch">{taskBranch}</code>
                {onTaskBranch ? (
                  <>
                    <span className="aiwf-checkout-active">
                      <GitBranch size={12} /> On this branch
                    </span>
                    <button className="aiwf-btn-secondary" onClick={backToMain} disabled={busy}>
                      {busy ? <Loader2 size={12} className="spin" /> : <CornerUpLeft size={12} />} Back to
                      main
                    </button>
                  </>
                ) : (
                  <button className="aiwf-btn-primary" onClick={checkoutTaskBranch} disabled={busy}>
                    {busy ? <Loader2 size={12} className="spin" /> : <GitBranch size={12} />} Checkout
                  </button>
                )}
              </div>
              {blocked && (
                <div className="aiwf-checkout-warning">
                  <AlertTriangle size={13} />
                  <div>
                    <div>{blocked.message}</div>
                    {blocked.titles.length > 0 && (
                      <ul className="aiwf-checkout-warning-list">
                        {blocked.titles.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="aiwf-data-section">
            <strong>Description</strong>
            {card.description ? (
              <Markdown>{card.description}</Markdown>
            ) : (
              <span className="aiwf-data-muted">No description</span>
            )}
          </div>

          <div className="aiwf-data-section">
            <strong>History</strong>
            {history.length === 0 ? (
              <span className="aiwf-data-muted">No runs yet</span>
            ) : (
              <div className="aiwf-data-history">
                {history.map((h, idx) => (
                  <div key={idx} className="aiwf-data-hist-row">
                    <span className="aiwf-data-hist-trail">
                      {h.phase} · /{h.skill}
                    </span>
                    <span className="aiwf-data-hist-time">{new Date(h.at).toLocaleString()}</span>
                    {h.summary && (
                      <div className="aiwf-data-hist-summary">
                        <Markdown>{h.summary}</Markdown>
                      </div>
                    )}
                    {h.runId && (
                      <button
                        className="aiwf-data-hist-view-btn"
                        onClick={() => onViewSession(h.runId!, `${h.phase} · /${h.skill}`)}
                      >
                        <Activity size={11} /> View session
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

// Transcript sidebar — replays a run's assistant_text events from the SSE stream.
// Stacked above the card data panel (z-index 80 vs 70) so both can be open at once.
function SessionTranscriptSidebar({
  runId,
  label,
  onClose,
}: {
  runId: string;
  label: string;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [done, setDone] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents([]);
    setDone(false);
    setStreamError(false);
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (e) => {
      try {
        setEvents((prev) => [...prev, JSON.parse(e.data) as RunEvent]);
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("end", () => {
      setDone(true);
      es.close();
    });
    // CLOSED means the server rejected or dropped the connection (e.g. 404).
    // CONNECTING means the browser is retrying — leave it alone.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStreamError(true);
      }
    };
    return () => es.close();
  }, [runId]);

  // Exit loading state as soon as any event arrives, stream ends, or connection fails.
  const loaded = events.length > 0 || done || streamError;

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [events]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const messages = events.filter((e) => e.kind === "assistant_text");

  return createPortal(
    <div className="session-transcript-overlay" onClick={onClose}>
      <aside className="aiwf-data-panel session-transcript-panel" onClick={(e) => e.stopPropagation()}>
        <header className="spec-head">
          <div className="spec-head-main">
            <Activity size={14} />
            <span className="spec-head-title">{label}</span>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="spec-body session-transcript-body" ref={bodyRef}>
          {!loaded && (
            <span className="aiwf-data-muted">
              <Loader2 size={13} className="spin" /> Loading transcript…
            </span>
          )}
          {streamError && <span className="aiwf-data-muted">Session transcript unavailable.</span>}
          {loaded && !streamError && messages.length === 0 && (
            <span className="aiwf-data-muted">No assistant messages in this session.</span>
          )}
          {messages.map((e, idx) => (
            <div key={idx} className="session-transcript-msg">
              <Markdown>{String(e.text ?? "")}</Markdown>
            </div>
          ))}
        </div>
      </aside>
    </div>,
    document.body,
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
    // Intentionally no overlay onClick — the New item modal must not close on outside click,
    // so an in-progress title/note isn't lost by a stray click.
    <div className="modal-overlay">
      <div className="modal modal-lg aiwf-modal">
        <div className="modal-head">
          <span className="modal-title">New item in {phase}</span>
          <button className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
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
                    <span className="aiwf-skill-tag">(aiwf)</span>
                    {skillsByName.get(s)?.model && (
                      <span className="model-chip">{skillsByName.get(s)!.model}</span>
                    )}
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
      <div className="modal modal-lg aiwf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Start a {phase} session</span>
          <button className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
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
                <span className="aiwf-skill-tag">(aiwf)</span>
                {skillsByName.get(s)?.model && (
                  <span className="model-chip">{skillsByName.get(s)!.model}</span>
                )}
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

// Brief, ordered descriptions for each aiwf skill — shown when the skill isn't installed locally.
const SKILL_DESCRIPTIONS: Record<string, string> = {
  prd: "Draft a Product Requirements Document capturing goals, scope, and user stories.",
  architecture: "Generate a system architecture document with components, data flow, and trade-offs.",
  tdd: "Write a Test-Driven Development plan before any implementation begins.",
  security: "Produce a security threat model — attack surface, STRIDE analysis, mitigations.",
  adr: "Record an Architecture Decision with context, options considered, and the rationale.",
  rfc: "Draft a Request for Comments for a design proposal, open for review.",
  roadmap: "Generate a phased project roadmap and seed the AI Workflow board with task cards.",
  issues: "Create GitHub issues from a roadmap, one issue per task.",
  design: "Generate UI/UX design artifacts — wireframes, component specs, interaction notes.",
  "verify-design": "Verify a design against the spec and catch gaps before implementation.",
  spec: "Write a detailed feature specification: behaviour, edge cases, acceptance criteria.",
  feature: "Implement a feature end-to-end from a spec file — code, tests, and commit.",
  fix: "Investigate, reproduce, and fix a bug with a confirming test.",
  autopilot: "Execute a roadmap end-to-end — phase by phase — with human checkpoints between.",
  factory: "Generate multiple independent implementations in parallel from one spec.",
  "new-project": "Scaffold a new project: folder structure, CI, and the first aiwf board.",
  review: "Review a PR or branch for correctness, security, and test coverage.",
  "sec-review": "Deep security-focused review — injection, auth, secrets, PHI handling.",
  commit: "Stage and commit changes with a conventional commit message.",
  pr: "Push the current branch and open a pull request via GitHub CLI.",
};

const PHASE_COLORS: Record<string, string> = {
  Planning: "#4f7cff",
  Design: "#8b5cf6",
  Implementation: "#10b981",
  Review: "#e08e0b",
  Delivery: "#0ea5e9",
};

function AiwfGuidanceModal({
  skillGroups,
  skills,
  repoUrl,
  author,
  authorUrl,
  onClose,
}: {
  skillGroups: AiwfSkillGroup[];
  skills: Skill[];
  repoUrl: string;
  author: string;
  authorUrl: string;
  onClose: () => void;
}) {
  const skillsByName = useMemo(() => new Map(skills.map((s) => [s.name, s])), [skills]);
  // Fall back to the static SKILL_GROUPS order when the server hasn't returned groups yet.
  const groups = skillGroups.length
    ? skillGroups
    : [
        {
          phase: "Planning",
          skills: ["prd", "architecture", "tdd", "security", "adr", "rfc", "roadmap", "issues"],
        },
        { phase: "Design", skills: ["design", "verify-design"] },
        {
          phase: "Implementation",
          skills: ["spec", "feature", "fix", "autopilot", "factory", "new-project"],
        },
        { phase: "Review", skills: ["review", "sec-review"] },
        { phase: "Delivery", skills: ["commit", "pr"] },
      ];
  const [activeTab, setActiveTab] = useState(groups[0]?.phase ?? "");
  const activeGroup = groups.find((g) => g.phase === activeTab) ?? groups[0];
  const activeColor = PHASE_COLORS[activeGroup?.phase ?? ""] ?? "#6b7488";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal aiwf-guide-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">
            <BookOpen size={16} /> AI Workflow skills guide
          </span>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="aiwf-guide-intro">
          Skills are organized by lifecycle phase. Run them in order on a work card to take a feature from
          idea to shipped PR.
        </p>

        <div className="aiwf-guide-tabs">
          {groups.map((group, idx) => {
            const color = PHASE_COLORS[group.phase] ?? "#6b7488";
            const active = group.phase === activeTab;
            return (
              <button
                key={group.phase}
                className={`aiwf-guide-tab${active ? " active" : ""}`}
                style={active ? { color, borderBottomColor: color } : undefined}
                onClick={() => setActiveTab(group.phase)}
              >
                <span className="aiwf-guide-tab-dot" style={{ background: color }} />
                {group.phase}
                {idx < groups.length - 1 && <span className="aiwf-guide-tab-arrow">→</span>}
              </button>
            );
          })}
        </div>

        {activeGroup && (
          <div className="aiwf-guide-skills">
            {activeGroup.skills.map((name) => {
              const installed = skillsByName.has(name);
              const desc = SKILL_DESCRIPTIONS[name] || skillsByName.get(name)?.description || "";
              return (
                <div key={name} className={`aiwf-guide-skill${installed ? "" : " not-installed"}`}>
                  <span className="aiwf-guide-skill-label">
                    <code className="aiwf-guide-skill-name" style={{ color: activeColor }}>
                      /{name}
                    </code>
                    {!installed && <span className="aiwf-guide-not-installed">not installed</span>}
                  </span>
                  {desc && <span className="aiwf-guide-skill-desc">{desc}</span>}
                </div>
              );
            })}
          </div>
        )}

        <div className="aiwf-guide-footer">
          Based on{" "}
          <a href={repoUrl} target="_blank" rel="noreferrer">
            ai-workflow
          </a>{" "}
          by{" "}
          <a href={authorUrl} target="_blank" rel="noreferrer">
            {author}
          </a>
          .
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
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
