import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutGrid,
  RefreshCw,
  Settings as SettingsIcon,
  ArrowLeft,
  Sun,
  Moon,
  Inbox,
  Activity,
  ShieldAlert,
  Users,
  Sparkles,
  Search,
  Workflow,
  CircleDollarSign,
} from "lucide-react";
import { api } from "./api";
import {
  Agent,
  AiwfProject,
  AiwfStatus,
  BoardConfig,
  RunKind,
  RunSummary,
  Skill,
  Ticket,
  WorkflowRunSummary,
  isActive,
} from "./types";
import { Board } from "./components/Board";
import { Settings } from "./components/Settings";
import { RunPanel } from "./components/RunPanel";
import { SessionsView } from "./components/SessionsView";
import { SkillRunner } from "./components/SkillRunner";
import { WorkflowsBar } from "./components/WorkflowsBar";
import { AiWorkflowView, AiWorkflowBar } from "./components/AiWorkflow";
import { UsageCostOverlay } from "./components/UsageCost";
import { useTheme } from "./useTheme";
import { useSessionTheme } from "./useSessionTheme";
import { filterByBoard } from "./utils";

// Two connections (sources) share the board surface; overlays take over the main area.
type Connection = "jira" | "aiworkflow";
type Overlay = "settings" | "sessions" | "run" | "usage" | null;

const SELECTED_BOARDS_KEY = "hangar.selectedBoards";
const ASSIGNEE_KEY = "hangar.assignee";
const CONNECTION_KEY = "hangar.connection";
const AIWF_SELECTED_KEY = "hangar.aiwf.selectedProject";

function loadSelectedBoards(): string[] | null {
  try {
    const v = localStorage.getItem(SELECTED_BOARDS_KEY);
    return v ? (JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}

interface ActiveRun {
  runId: string;
  ticketKey: string;
  agentName: string;
  ticketUrl?: string;
}

export function App() {
  const { theme, toggle } = useTheme();
  const { sessionTheme, setSessionTheme } = useSessionTheme();
  const [connection, setConnection] = useState<Connection>(
    () => (localStorage.getItem(CONNECTION_KEY) as Connection) || "jira",
  );
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [boards, setBoards] = useState<BoardConfig[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selected, setSelected] = useState<string[]>(() => loadSelectedBoards() ?? []);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [bypass, setBypass] = useState(false);
  const [terminalConfigured, setTerminalConfigured] = useState(false);
  const [assignee, setAssignee] = useState<string>(() => localStorage.getItem(ASSIGNEE_KEY) ?? "");
  const [ticketFilter, setTicketFilter] = useState("");
  // AI Workflow connection state (shared between the sub-menu bar and the content view).
  const [aiwf, setAiwf] = useState<AiwfStatus | null>(null);
  const [aiwfProjects, setAiwfProjects] = useState<AiwfProject[]>([]);
  const [aiwfSelected, setAiwfSelected] = useState<string | null>(() =>
    localStorage.getItem(AIWF_SELECTED_KEY),
  );
  // Doc tree sidebar open/closed — persisted to localStorage so it survives page reloads.
  const [aiwfSidebarOpen, setAiwfSidebarOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("hangar.aiwf.sidebarOpen") !== "false";
    } catch {
      return true;
    }
  });
  const toggleAiwfSidebar = () =>
    setAiwfSidebarOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("hangar.aiwf.sidebarOpen", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const loadAiwf = useCallback(() => {
    api
      .aiwfStatus()
      .then(setAiwf)
      .catch((e) => setError(String(e.message ?? e)));
    api
      .aiwfProjects()
      .then((r) => {
        setAiwfProjects(r.projects);
        // Keep the current selection if it still exists; otherwise fall back to
        // the first project (so removing the selected project doesn't strand the view).
        setAiwfSelected((cur) =>
          cur && r.projects.some((p) => p.id === cur) ? cur : (r.projects[0]?.id ?? null),
        );
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const loadMeta = useCallback(() => {
    return Promise.all([api.config(), api.agents(), api.skills()])
      .then(([cfg, ag, sk]) => {
        setBoards(cfg.boards);
        setBypass(cfg.bypassPermissions ?? true);
        setTerminalConfigured(!!cfg.terminal);
        setSelected((prev) => {
          const keys = cfg.boards.map((b) => b.key);
          const kept = prev.filter((k) => keys.includes(k));
          return kept.length ? kept : keys;
        });
        setAgents(ag.agents);
        setSkills(sk.skills);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // Mark skills from the aiwf toolkit so downstream components can group/tag them.
  // Use skillGroups (the authoritative phase→skills spec) rather than skillsFound
  // (detection-based, incomplete if the server hasn't reloaded since install).
  const enrichedSkills = useMemo(() => {
    const found = new Set(aiwf?.skillGroups?.flatMap((g) => g.skills) ?? []);
    if (!found.size) return skills;
    return skills.map((s) => (found.has(s.name) ? { ...s, aiwf: true as const } : s));
  }, [skills, aiwf]);

  // Board-scoped filtering for the active run's HandoffModal.
  // Extract board key = text before the first "-" in ticketKey (e.g. "PP" from "PP-123").
  // Ad-hoc/standalone runs use "ad-hoc" or a title with no "-" → no board match → full list.
  const { agents: activeRunAgents, skills: activeRunSkills } = useMemo(() => {
    if (!activeRun) return { agents, skills: enrichedSkills };
    const boardKey = activeRun.ticketKey.split("-")[0];
    const board = boards.find((b) => b.key === boardKey) ?? null;
    return filterByBoard(board, agents, enrichedSkills);
  }, [activeRun, boards, agents, enrichedSkills]);

  const refreshRuns = useCallback(() => {
    api
      .runs()
      .then((r) => setRuns(r.runs))
      .catch(() => {});
  }, []);

  const refreshWorkflowRuns = useCallback(() => {
    api
      .workflowRuns()
      .then((r) => setWorkflowRuns(r.runs))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadMeta();
    loadAiwf();
  }, [loadMeta, loadAiwf]);

  useEffect(() => {
    try {
      localStorage.setItem(CONNECTION_KEY, connection);
    } catch {
      /* ignore */
    }
  }, [connection]);

  useEffect(() => {
    refreshRuns();
    refreshWorkflowRuns();
    const id = setInterval(() => {
      refreshRuns();
      refreshWorkflowRuns();
    }, 2000);
    return () => clearInterval(id);
  }, [refreshRuns, refreshWorkflowRuns]);

  function loadTickets(boardKeys: string[]) {
    if (boardKeys.length === 0) {
      setTickets([]);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .tickets(boardKeys)
      .then((r) => setTickets(r.tickets))
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (connection === "jira" && !overlay) loadTickets(selected);
  }, [selected, connection, overlay]);

  // Persist board-show and assignee-filter preferences across reloads.
  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_BOARDS_KEY, JSON.stringify(selected));
    } catch {
      /* ignore */
    }
  }, [selected]);
  useEffect(() => {
    try {
      localStorage.setItem(ASSIGNEE_KEY, assignee);
    } catch {
      /* ignore */
    }
  }, [assignee]);
  useEffect(() => {
    try {
      if (aiwfSelected) localStorage.setItem(AIWF_SELECTED_KEY, aiwfSelected);
      else localStorage.removeItem(AIWF_SELECTED_KEY);
    } catch {
      /* ignore */
    }
  }, [aiwfSelected]);

  function toggleBoard(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function assign(ticketKey: string, name: string, kind: RunKind, note?: string) {
    const ticket = tickets.find((t) => t.key === ticketKey);
    if (!ticket) return;
    setError(null);
    api
      .startRun(ticket, name, kind, note)
      .then((r) => {
        setActiveRun({ runId: r.runId, ticketKey, agentName: name, ticketUrl: ticket.url });
        refreshRuns();
      })
      .catch((e) => setError(String(e.message ?? e)));
  }

  function openRun(run: RunSummary) {
    setActiveRun({
      runId: run.id,
      ticketKey: run.ticketKey || run.title || "ad-hoc",
      agentName: run.agentName,
      ticketUrl: run.ticketUrl,
    });
  }

  function openRunById(runId: string) {
    const r = runs.find((x) => x.id === runId);
    if (r) openRun(r);
  }

  // Open a session just started elsewhere (e.g. the AI Workflow view), before polling sees it.
  function openSession(a: { runId: string; ticketKey: string; agentName: string }) {
    setActiveRun({ runId: a.runId, ticketKey: a.ticketKey, agentName: a.agentName });
    refreshRuns();
  }

  function startWorkflow(ticketKey: string, workflowId: string) {
    const ticket = tickets.find((t) => t.key === ticketKey);
    if (!ticket) return;
    setError(null);
    api
      .startWorkflow(ticket.boardKey, workflowId, ticket)
      .then(() => refreshWorkflowRuns())
      .catch((e) => setError(String(e.message ?? e)));
  }

  function moveTicket(ticketKey: string, targetStatus: string) {
    setError(null);
    const prev = tickets;
    // Optimistic: move the card immediately, then reconcile with Jira (revert on failure).
    setTickets((ts) => ts.map((t) => (t.key === ticketKey ? { ...t, status: targetStatus } : t)));
    api
      .transitionTicket(ticketKey, targetStatus)
      .then(() => loadTickets(selected))
      .catch((e) => {
        setTickets(prev);
        setError(String(e.message ?? e));
      });
  }

  function stopWorkflow(id: string) {
    api
      .stopWorkflow(id)
      .then(refreshWorkflowRuns)
      .catch(() => {});
  }
  function deleteWorkflowRun(id: string) {
    api
      .deleteWorkflowRun(id)
      .then(refreshWorkflowRuns)
      .catch(() => {});
  }

  function runStandalone(name: string, kind: RunKind, note: string, cwd?: string, title?: string) {
    setError(null);
    api
      .startStandalone(name, kind, note, cwd, title)
      .then((r) => {
        setActiveRun({ runId: r.runId, ticketKey: title || "ad-hoc", agentName: name });
        refreshRuns();
      })
      .catch((e) => setError(String(e.message ?? e)));
  }

  // Plain Claude session scoped to a project's repo (Jira board header / AIWF project pill).
  function openClaudeSession(cwd: string, title: string, model: string, note?: string): Promise<string> {
    setError(null);
    return api
      .startClaude(cwd, title, model, note || undefined)
      .then((r) => {
        setActiveRun({ runId: r.runId, ticketKey: title, agentName: "claude" });
        refreshRuns();
        return r.runId;
      })
      .catch((e) => {
        setError(String(e.message ?? e));
        throw e;
      });
  }

  function handoff(name: string, kind: RunKind, note: string) {
    const parent = activeRun;
    if (!parent) return;
    setError(null);
    api
      .handoff(parent.runId, name, kind, note)
      .then((r) => {
        setActiveRun({
          runId: r.runId,
          ticketKey: parent.ticketKey,
          agentName: name,
          ticketUrl: parent.ticketUrl,
        });
        refreshRuns();
      })
      .catch((e) => setError(String(e.message ?? e)));
  }
  function restart(runId: string) {
    const prev = activeRun;
    setError(null);
    api
      .restartRun(runId)
      .then((r) => {
        setActiveRun({
          runId: r.runId,
          ticketKey: prev?.ticketKey ?? "",
          agentName: prev?.agentName ?? "",
          ticketUrl: prev?.ticketUrl,
        });
        refreshRuns();
      })
      .catch((e) => setError(String(e.message ?? e)));
  }
  function stop(runId: string) {
    api
      .stopRun(runId)
      .then(refreshRuns)
      .catch(() => {});
  }
  function resumeRun(runId: string, text: string) {
    api
      .sendMessage(runId, text)
      .then(() => {
        openRunById(runId);
        refreshRuns();
      })
      .catch((e) => setError(String(e.message ?? e)));
  }
  function openInTerminal(runId: string) {
    setError(null);
    api.openInTerminal(runId).catch((e) => setError(String(e.message ?? e)));
  }
  function deleteRun(runId: string) {
    api
      .deleteRun(runId)
      .then(() => {
        setActiveRun((cur) => (cur?.runId === runId ? null : cur));
        refreshRuns();
      })
      .catch(() => {});
  }
  function clearRuns(scope: "finished" | "all", runIds?: string[]) {
    api
      .clearRuns(scope, runIds)
      .then(() => {
        // Clear the active run if it was in the cleared set (or if clearing all with no filter).
        if (scope === "all") {
          if (!runIds || (activeRun && runIds.includes(activeRun.runId))) setActiveRun(null);
        }
        refreshRuns();
      })
      .catch(() => {});
  }

  // Delete every session tied to a task: all runs sharing the run's ticketKey (or just the run
  // itself when it's ad-hoc). Stops active ones, then closes the panel.
  function clearTaskSessions(runId: string) {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;
    const ids = run.ticketKey ? runs.filter((r) => r.ticketKey === run.ticketKey).map((r) => r.id) : [runId];
    api
      .clearRuns("all", ids)
      .then(() => {
        setActiveRun(null);
        refreshRuns();
      })
      .catch(() => {});
  }

  const runByTicket = useMemo(() => {
    const m = new Map<string, RunSummary>();
    for (const r of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
      if (!r.ticketKey) continue; // standalone runs aren't tied to a card
      const cur = m.get(r.ticketKey);
      if (!cur || (!isActive(cur.state) && isActive(r.state))) m.set(r.ticketKey, r);
    }
    return m;
  }, [runs]);

  const codebasePaths = useMemo(() => {
    const set = new Set<string>();
    for (const b of boards) (b.repoPaths ?? (b.repoPath ? [b.repoPath] : [])).forEach((p) => set.add(p));
    return [...set];
  }, [boards]);

  const assignees = useMemo(
    () => [...new Set(tickets.map((t) => t.assignee).filter((a): a is string => !!a))].sort(),
    [tickets],
  );

  // Drop a persisted assignee filter that no longer applies to the loaded board (e.g. after
  // switching boards) — otherwise it silently hides every card with no visible cause.
  useEffect(() => {
    if (assignee && assignees.length && !assignees.includes(assignee)) setAssignee("");
  }, [assignees, assignee]);

  const activeCount = runs.filter((r) => isActive(r.state)).length;
  const selectedBoards = boards.filter((b) => selected.includes(b.key));
  const ticketFilterLower = ticketFilter.trim().toLowerCase();
  const visible = (t: Ticket) => {
    if (assignee && assignees.includes(assignee) && t.assignee !== assignee) return false;
    if (ticketFilterLower) {
      const matchKey = t.key.toLowerCase().includes(ticketFilterLower);
      const matchSummary = t.summary.toLowerCase().includes(ticketFilterLower);
      if (!matchKey && !matchSummary) return false;
    }
    return true;
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <LayoutGrid size={18} />
          </span>
          Hangar
        </div>

        {/* Connection switcher: the two work sources share the board surface below. */}
        <div className="conn-switch">
          <button
            className={`conn-tab${connection === "jira" && !overlay ? " on" : ""}`}
            onClick={() => {
              setConnection("jira");
              setOverlay(null);
            }}
          >
            <LayoutGrid size={15} /> Jira
          </button>
          <button
            className={`conn-tab${connection === "aiworkflow" && !overlay ? " on" : ""}`}
            onClick={() => {
              setConnection("aiworkflow");
              setOverlay(null);
            }}
          >
            <Workflow size={15} /> AI Workflow
          </button>
        </div>

        {bypass && (
          <button
            className="bypass-flag has-tip"
            data-tip="Agents run unrestricted — click to change"
            onClick={() => setOverlay("settings")}
          >
            <ShieldAlert size={13} /> Unrestricted
          </button>
        )}

        <div className="topbar-actions">
          <button
            className={`icon-btn has-tip${overlay === "usage" ? " on" : ""}`}
            data-tip="Usage cost"
            onClick={() => setOverlay((o) => (o === "usage" ? null : "usage"))}
          >
            <CircleDollarSign size={17} />
          </button>
          <button
            className={`icon-btn has-tip${overlay === "run" ? " on" : ""}`}
            data-tip="Run a skill (no ticket)"
            onClick={() => setOverlay((o) => (o === "run" ? null : "run"))}
          >
            <Sparkles size={17} />
          </button>
          <button
            className={`icon-btn badge-host has-tip${overlay === "sessions" ? " on" : ""}`}
            data-tip="Sessions"
            onClick={() => setOverlay((o) => (o === "sessions" ? null : "sessions"))}
          >
            <Activity size={17} />
            {activeCount > 0 && <span className="badge">{activeCount}</span>}
          </button>
          <button
            className="icon-btn has-tip"
            data-tip={theme === "dark" ? "Light mode" : "Dark mode"}
            onClick={toggle}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className={`icon-btn has-tip${overlay === "settings" ? " on" : ""}`}
            data-tip={overlay === "settings" ? "Back" : "Settings"}
            onClick={() => setOverlay((o) => (o === "settings" ? null : "settings"))}
          >
            {overlay === "settings" ? <ArrowLeft size={17} /> : <SettingsIcon size={17} />}
          </button>
        </div>
      </header>

      {/* Connection sub-menu: Jira shows projects + filters, AI Workflow shows its bar. */}
      {!overlay && connection === "jira" && (
        <div className="subbar">
          <div className="board-toggles">
            {boards.map((b) => (
              <label key={b.key} className={selected.includes(b.key) ? "pill on" : "pill"}>
                <input
                  type="checkbox"
                  checked={selected.includes(b.key)}
                  onChange={() => toggleBoard(b.key)}
                />
                {b.name}
              </label>
            ))}
          </div>
          <div className="assignee-filter has-tip" data-tip="Filter by assignee">
            <Users size={14} />
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">All assignees</option>
              {assignees.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="ticket-filter">
            <Search size={14} />
            <input
              type="text"
              placeholder="Filter tickets…"
              value={ticketFilter}
              onChange={(e) => setTicketFilter(e.target.value)}
            />
          </div>
          <div className="subbar-spacer" />
          <button
            className="icon-btn has-tip"
            data-tip="Refresh tickets"
            onClick={() => loadTickets(selected)}
            disabled={loading}
          >
            <RefreshCw size={17} className={loading ? "spin" : undefined} />
          </button>
        </div>
      )}
      {!overlay && connection === "aiworkflow" && (
        <AiWorkflowBar
          status={aiwf}
          projects={aiwfProjects}
          selectedId={aiwfSelected}
          skills={enrichedSkills}
          sidebarOpen={aiwfSidebarOpen}
          onSelect={setAiwfSelected}
          onReload={loadAiwf}
          onError={setError}
          onOpenSession={openSession}
          onToggleSidebar={toggleAiwfSidebar}
        />
      )}

      {error && (
        <div className="banner error">
          <span>{error}</span>
        </div>
      )}

      {overlay === "settings" ? (
        <div className="settings-area">
          <Settings onSaved={loadMeta} sessionTheme={sessionTheme} onSessionThemeChange={setSessionTheme} />
        </div>
      ) : overlay === "sessions" ? (
        <div className="settings-area">
          <SessionsView
            runs={runs}
            boards={boards}
            aiwfProjects={aiwfProjects}
            onOpenRun={openRun}
            onStop={stop}
            onDelete={deleteRun}
            onResume={resumeRun}
            onClear={clearRuns}
            onOpenInTerminal={openInTerminal}
            terminalConfigured={terminalConfigured}
          />
        </div>
      ) : overlay === "run" ? (
        <div className="settings-area">
          <SkillRunner
            agents={agents}
            skills={enrichedSkills}
            codebasePaths={codebasePaths}
            boards={boards}
            onRun={runStandalone}
          />
        </div>
      ) : overlay === "usage" ? (
        <div className="settings-area">
          <UsageCostOverlay />
        </div>
      ) : connection === "aiworkflow" ? (
        <AiWorkflowView
          project={aiwfProjects.find((p) => p.id === aiwfSelected) ?? null}
          status={aiwf}
          skills={enrichedSkills}
          runs={runs}
          sidebarOpen={aiwfSidebarOpen}
          onOpenRun={openRun}
          onOpenSession={openSession}
          onReload={loadAiwf}
          onStartClaude={openClaudeSession}
          onError={setError}
          onClearRun={() => setActiveRun(null)}
        />
      ) : (
        <div className="main">
          {selectedBoards.length > 0 && (
            <WorkflowsBar
              boards={selectedBoards}
              workflowRuns={workflowRuns}
              onOpenRunId={openRunById}
              onStartWorkflow={startWorkflow}
              onStop={stopWorkflow}
              onDelete={deleteWorkflowRun}
            />
          )}
          <div className="boards-area">
            {selectedBoards.length === 0 && !error && (
              <div className="empty">
                <Inbox size={32} strokeWidth={1.5} />
                <span>Select a board, or add one in Settings.</span>
              </div>
            )}
            {selectedBoards.map((b) => (
              <Board
                key={b.key}
                board={b}
                tickets={tickets.filter((t) => t.boardKey === b.key && visible(t))}
                agents={agents}
                skills={enrichedSkills}
                runs={runs}
                runByTicket={runByTicket}
                onAssign={assign}
                onStartWorkflow={startWorkflow}
                onMoveTicket={moveTicket}
                onOpenRun={openRun}
                onStartClaude={openClaudeSession}
              />
            ))}
          </div>
        </div>
      )}

      {activeRun && (
        <RunPanel
          runId={activeRun.runId}
          ticketKey={activeRun.ticketKey}
          agentName={activeRun.agentName}
          ticketUrl={activeRun.ticketUrl}
          agents={activeRunAgents}
          skills={activeRunSkills}
          onHandoff={handoff}
          onRestart={() => restart(activeRun.runId)}
          onClose={() => setActiveRun(null)}
          onClearTask={() => clearTaskSessions(activeRun.runId)}
          onOpenInTerminal={() => openInTerminal(activeRun.runId)}
          terminalConfigured={terminalConfigured}
        />
      )}
    </div>
  );
}
