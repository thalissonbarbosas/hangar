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
} from "lucide-react";
import { api } from "./api";
import {
  Agent,
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
import { useTheme } from "./useTheme";

type View = "board" | "settings" | "sessions" | "run";

const SELECTED_BOARDS_KEY = "hangar.selectedBoards";
const ASSIGNEE_KEY = "hangar.assignee";

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
  const [view, setView] = useState<View>("board");
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
  const [assignee, setAssignee] = useState<string>(() => localStorage.getItem(ASSIGNEE_KEY) ?? "");
  const [ticketFilter, setTicketFilter] = useState("");

  const loadMeta = useCallback(() => {
    return Promise.all([api.config(), api.agents(), api.skills()])
      .then(([cfg, ag, sk]) => {
        setBoards(cfg.boards);
        setBypass(cfg.bypassPermissions ?? true);
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
  }, [loadMeta]);

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
    if (view === "board") loadTickets(selected);
  }, [selected, view]);

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
  function stop(runId: string) {
    api
      .stopRun(runId)
      .then(refreshRuns)
      .catch(() => {});
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
  function clearRuns(scope: "finished" | "all") {
    api
      .clearRuns(scope)
      .then(() => {
        if (scope === "all") setActiveRun(null);
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

        {bypass && (
          <button
            className="bypass-flag has-tip"
            data-tip="Agents run unrestricted — click to change"
            onClick={() => setView("settings")}
          >
            <ShieldAlert size={13} /> Unrestricted
          </button>
        )}

        {view === "board" && boards.length > 0 && (
          <>
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
          </>
        )}

        <div className="topbar-actions">
          {view === "board" && (
            <button
              className="icon-btn has-tip"
              data-tip="Refresh tickets"
              onClick={() => loadTickets(selected)}
              disabled={loading}
            >
              <RefreshCw size={17} className={loading ? "spin" : undefined} />
            </button>
          )}
          <button
            className={`icon-btn has-tip${view === "run" ? " on" : ""}`}
            data-tip="Run a skill (no ticket)"
            onClick={() => setView((v) => (v === "run" ? "board" : "run"))}
          >
            <Sparkles size={17} />
          </button>
          <button
            className={`icon-btn badge-host has-tip${view === "sessions" ? " on" : ""}`}
            data-tip="Sessions"
            onClick={() => setView((v) => (v === "sessions" ? "board" : "sessions"))}
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
            className={`icon-btn has-tip${view === "settings" ? " on" : ""}`}
            data-tip={view === "settings" ? "Back to board" : "Settings"}
            onClick={() => setView((v) => (v === "settings" ? "board" : "settings"))}
          >
            {view === "settings" ? <ArrowLeft size={17} /> : <SettingsIcon size={17} />}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner error">
          <span>{error}</span>
        </div>
      )}

      {view === "settings" ? (
        <div className="settings-area">
          <Settings onSaved={loadMeta} />
        </div>
      ) : view === "sessions" ? (
        <div className="settings-area">
          <SessionsView
            runs={runs}
            onOpenRun={openRun}
            onStop={stop}
            onDelete={deleteRun}
            onClear={clearRuns}
          />
        </div>
      ) : view === "run" ? (
        <div className="settings-area">
          <SkillRunner agents={agents} skills={skills} codebasePaths={codebasePaths} onRun={runStandalone} />
        </div>
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
                skills={skills}
                runByTicket={runByTicket}
                onAssign={assign}
                onStartWorkflow={startWorkflow}
                onMoveTicket={moveTicket}
                onOpenRun={openRun}
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
          agents={agents}
          skills={skills}
          onHandoff={handoff}
          onClose={() => setActiveRun(null)}
        />
      )}
    </div>
  );
}
