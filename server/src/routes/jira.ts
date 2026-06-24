import { Router } from "express";
import type { Response } from "express";
import { getConfig, loadJiraEnv, boardPaths } from "../config";
import { loadAgents } from "../agents";
import { allSkills } from "../skills";
import {
  fetchTickets,
  testConnection,
  listProjects,
  listStatuses,
  transitionIssue,
  fetchTicketPr,
} from "../jira";
import { isDemo, demoTickets } from "../demo";
import { getCardState, listCardStates, clearCardState } from "../aiwf";
import { removeWorktree } from "../worktree";
import { JiraEnv } from "../config";

export const jiraRouter = Router();

function requireJira(res: Response): JiraEnv | null {
  const jira = loadJiraEnv();
  if (!jira) {
    res.status(503).json({ error: "Save your Jira connection first (Settings → Jira)." });
    return null;
  }
  return jira;
}

// Test a connection — uses creds from the body if given, else the saved ones.
jiraRouter.post("/api/jira/test", async (req, res) => {
  const saved = loadJiraEnv();
  const body = req.body ?? {};
  const env: JiraEnv = {
    baseUrl: (body.baseUrl ?? saved?.baseUrl ?? "").replace(/\/+$/, ""),
    email: body.email ?? saved?.email ?? "",
    token: body.token || saved?.token || "",
    myTicketsOnly: false,
  };
  if (!env.baseUrl || !env.email || !env.token) {
    return res.json({ ok: false, error: "Base URL, email, and token are all required." });
  }
  try {
    const { displayName } = await testConnection(env);
    res.json({ ok: true, displayName });
  } catch (err) {
    res.json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

// Discovery: list projects to pick from.
jiraRouter.get("/api/jira/projects", async (_req, res) => {
  const jira = requireJira(res);
  if (!jira) return;
  try {
    res.json({ projects: await listProjects(jira) });
  } catch (err) {
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Discovery: status names available on a project (to fill columns).
jiraRouter.get("/api/jira/statuses", async (req, res) => {
  const jira = requireJira(res);
  if (!jira) return;
  const project = String(req.query.project ?? "").trim();
  if (!project) return res.status(400).json({ error: "project query param required" });
  try {
    res.json({ statuses: await listStatuses(jira, project) });
  } catch (err) {
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// The agent fleet, parsed from .claude/agents/*.md.
jiraRouter.get("/api/agents", (_req, res) => {
  try {
    res.json({ agents: loadAgents(getConfig().agentsDir) });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// All skills: user-scoped (~/.claude/skills) + repo skills from each board's codebase
// (<repo>/.claude/skills), each flagged with its repo basename.
jiraRouter.get("/api/skills", (_req, res) => {
  try {
    res.json({ skills: allSkills(getConfig()) });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Tickets for the selected boards. ?boards=PP,INT (defaults to all).
jiraRouter.get("/api/tickets", async (req, res) => {
  const requested = String(req.query.boards ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Demo mode: serve fictional tickets, no Jira needed.
  if (isDemo()) {
    const all = demoTickets();
    const tickets = requested.length ? all.filter((t) => requested.includes(t.boardKey)) : all;
    return res.json({ tickets });
  }

  const jira = requireJira(res);
  if (!jira) return;

  const boards = requested.length
    ? getConfig().boards.filter((b) => requested.includes(b.key))
    : getConfig().boards;

  if (boards.length === 0) {
    return res.status(400).json({ error: "No matching boards for: " + requested.join(",") });
  }

  try {
    res.json({ tickets: await fetchTickets(jira, boards) });
  } catch (err) {
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// PR URL for a ticket — checks Jira dev-status API, remote links, and comments in order.
jiraRouter.get("/api/tickets/:key/pr", async (req, res) => {
  if (isDemo()) return res.json({ prUrl: null });
  const jira = requireJira(res);
  if (!jira) return;
  try {
    const prUrl = await fetchTicketPr(jira, req.params.key);
    res.json({ prUrl });
  } catch (err) {
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Move a ticket to a target status (drag-and-drop between columns). Body: { status }.
jiraRouter.post("/api/tickets/:key/transition", async (req, res) => {
  if (isDemo()) return res.json({ ok: true }); // demo board has no real Jira to transition
  const jira = requireJira(res);
  if (!jira) return;
  const status = String(req.body?.status ?? "").trim();
  if (!status) return res.status(400).json({ error: "status is required" });
  try {
    await transitionIssue(jira, req.params.key, status);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ---- Jira worktree management routes ----

jiraRouter.get("/api/jira/boards/:boardKey/worktrees", (req, res) => {
  const board = getConfig().boards.find((b) => b.key === req.params.boardKey);
  if (!board) return res.status(404).json({ error: `Board not found: ${req.params.boardKey}` });
  res.json({ worktrees: listCardStates(`jira-${board.key}`) });
});

jiraRouter.delete("/api/jira/boards/:boardKey/worktrees/:cardKey", async (req, res) => {
  const board = getConfig().boards.find((b) => b.key === req.params.boardKey);
  if (!board) return res.status(404).json({ error: `Board not found: ${req.params.boardKey}` });
  const contextId = `jira-${board.key}`;
  const state = getCardState(contextId, req.params.cardKey);
  if (state) {
    const repoRoot = boardPaths(board)[0];
    if (repoRoot) await removeWorktree({ path: state.worktreePath, branch: state.taskBranch, repoRoot });
    clearCardState(contextId, req.params.cardKey);
  }
  res.json({ ok: true });
});

jiraRouter.delete("/api/jira/boards/:boardKey/worktrees", async (req, res) => {
  const board = getConfig().boards.find((b) => b.key === req.params.boardKey);
  if (!board) return res.status(404).json({ error: `Board not found: ${req.params.boardKey}` });
  const contextId = `jira-${board.key}`;
  const states = listCardStates(contextId);
  const repoRoot = boardPaths(board)[0];
  // Best-effort: attempt each entry independently; continue on per-item failure.
  for (const s of states) {
    try {
      if (repoRoot) await removeWorktree({ path: s.worktreePath, branch: s.taskBranch, repoRoot });
      clearCardState(contextId, s.key);
    } catch {
      /* ignore per-item errors */
    }
  }
  res.json({ ok: true, removed: states.length });
});
