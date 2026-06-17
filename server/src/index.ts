import express from "express";
import cors from "cors";
import { existsSync } from "fs";
import {
  loadConfig,
  getConfig,
  saveConfig,
  loadJiraEnv,
  jiraSettingsView,
  saveJiraSettings,
  expandHome,
  boardPaths,
  JiraEnv,
  PORT,
} from "./config";
import { loadAgents, loadAgent } from "./agents";
import { allSkills, skillExists, findSkill } from "./skills";
import {
  fetchTickets,
  testConnection,
  listProjects,
  listStatuses,
  transitionIssue,
  fetchTicketPr,
} from "./jira";
import {
  startRun,
  getRun,
  listRuns,
  runToJson,
  resolvePermission,
  sendMessage,
  stopRun,
  deleteRun,
  clearRuns,
  loadPersistedRuns,
  seedDemoRuns,
} from "./sessions";
import { isDemo, demoTickets } from "./demo";
import {
  startWorkflow,
  listWorkflowRuns,
  stopWorkflowRun,
  deleteWorkflowRun,
  clearWorkflowRuns,
  loadPersistedWorkflowRuns,
} from "./workflows";
import { HangarConfig, Ticket } from "./types";

const app = express();
app.use(cors());
app.use(express.json());

loadConfig(); // initialize (throws early if the config file is invalid)
loadPersistedRuns(); // restore runs saved before the last restart
loadPersistedWorkflowRuns(); // restore workflow runs too
if (isDemo()) seedDemoRuns(); // HANGAR_DEMO=1: fictional sessions for a credential-free demo

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    jiraConfigured: loadJiraEnv() !== null,
    boards: getConfig().boards.map((b) => b.key),
  });
});

// Full board config (keys, names, statuses, repo paths) + agents dir.
// Each board gets resolvedPaths: the home-expanded versions of its repoPaths, so the
// client can match repo skills to the board without knowing the home directory.
app.get("/api/config", (_req, res) => {
  const cfg = getConfig();
  res.json({
    ...cfg,
    boards: cfg.boards.map((b) => ({ ...b, resolvedPaths: boardPaths(b) })),
  });
});

// Save board config (from the Settings UI).
app.put("/api/config", (req, res) => {
  try {
    res.json(saveConfig(req.body as HangarConfig));
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Non-secret Jira settings view (never returns the token).
app.get("/api/settings/jira", (_req, res) => {
  res.json(jiraSettingsView());
});

// Save Jira settings to .env. Blank token = keep the existing one.
app.put("/api/settings/jira", (req, res) => {
  try {
    saveJiraSettings(req.body ?? {});
    res.json(jiraSettingsView());
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Test a connection — uses creds from the body if given, else the saved ones.
app.post("/api/jira/test", async (req, res) => {
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

function requireJira(res: express.Response): JiraEnv | null {
  const jira = loadJiraEnv();
  if (!jira) {
    res.status(503).json({ error: "Save your Jira connection first (Settings → Jira)." });
    return null;
  }
  return jira;
}

// Discovery: list projects to pick from.
app.get("/api/jira/projects", async (_req, res) => {
  const jira = requireJira(res);
  if (!jira) return;
  try {
    res.json({ projects: await listProjects(jira) });
  } catch (err) {
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Discovery: status names available on a project (to fill columns).
app.get("/api/jira/statuses", async (req, res) => {
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
app.get("/api/agents", (_req, res) => {
  try {
    res.json({ agents: loadAgents(getConfig().agentsDir) });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// All skills: user-scoped (~/.claude/skills) + repo skills from each board's codebase
// (<repo>/.claude/skills), each flagged with its repo basename.
app.get("/api/skills", (_req, res) => {
  try {
    res.json({ skills: allSkills(getConfig()) });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Tickets for the selected boards. ?boards=PP,INT (defaults to all).
app.get("/api/tickets", async (req, res) => {
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
app.get("/api/tickets/:key/pr", async (req, res) => {
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

// Check whether a filesystem path exists (used by the Settings UI to validate codebase paths).
app.get("/api/fs/exists", (req, res) => {
  const raw = String(req.query.path ?? "").trim();
  if (!raw) return res.status(400).json({ error: "path query param required" });
  const expanded = expandHome(raw);
  res.json({ exists: existsSync(expanded) });
});

// Move a ticket to a target status (drag-and-drop between columns). Body: { status }.
app.post("/api/tickets/:key/transition", async (req, res) => {
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

// ---------------- Phase 2: agent sessions ----------------

// Start a run. Either ticket-based ({ ticket, name, kind, note? }) or standalone
// ({ name, kind, note, cwd?, title? } — the note is the task, no ticket required).
app.post("/api/runs", (req, res) => {
  const ticket = req.body?.ticket as Ticket | undefined;
  const name = String(req.body?.name ?? req.body?.agentName ?? "");
  const kind = req.body?.kind === "skill" ? "skill" : "agent";
  const note = typeof req.body?.note === "string" ? req.body.note : undefined;
  const cwd = typeof req.body?.cwd === "string" ? req.body.cwd : undefined;
  const title = typeof req.body?.title === "string" ? req.body.title : undefined;
  const parentRunId = typeof req.body?.parentRunId === "string" ? req.body.parentRunId : undefined;
  const cfg = getConfig();

  if (kind === "agent" && (!name || !loadAgent(cfg.agentsDir, name))) {
    return res.status(404).json({ error: `Unknown agent: ${name}` });
  }
  if (kind === "skill" && (!name || !skillExists(cfg, name))) {
    return res.status(404).json({ error: `Unknown skill: ${name}` });
  }
  if (parentRunId && !getRun(parentRunId)) {
    return res.status(404).json({ error: "Parent run not found" });
  }

  const hasTicket = !!(ticket?.key && ticket.boardKey);
  if (!hasTicket && !parentRunId && !note?.trim()) {
    return res.status(400).json({ error: "Provide a ticket, or a note describing the standalone task." });
  }

  const skillSource = kind === "skill" ? findSkill(cfg, name)?.source : undefined;
  const run = parentRunId
    ? startRun({ kind, name, note, parentRunId, skillSource })
    : hasTicket
      ? startRun({ kind, name, note, ticket, skillSource })
      : startRun({ kind, name, note, cwd, title, skillSource });
  res.json({ runId: run.id });
});

app.get("/api/runs", (_req, res) => {
  res.json({ runs: listRuns() });
});

app.get("/api/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No such run" });
  res.json(runToJson(run, true));
});

// Answer an interactive permission request (allow/deny a gated tool).
app.post("/api/runs/:id/permissions/:requestId", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No such run" });
  const decision = req.body?.decision;
  if (decision !== "allow" && decision !== "deny") {
    return res.status(400).json({ error: "decision must be 'allow' or 'deny'" });
  }
  const ok = resolvePermission(run, req.params.requestId, decision);
  if (!ok) return res.status(409).json({ error: "No pending request with that id" });
  res.json({ ok: true });
});

// Send a follow-up from the operator: answers an open AskUserQuestion, steers a running
// turn, or resumes a finished session. Body: { text }.
app.post("/api/runs/:id/message", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No such run" });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  const mode = sendMessage(run, text);
  if (mode === "none") return res.status(409).json({ error: "Run has no open session to message." });
  res.json({ ok: true, mode });
});

// Stop a run (interrupt the session).
app.post("/api/runs/:id/stop", async (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No such run" });
  await stopRun(run);
  res.json({ ok: true });
});

// Clear runs: ?scope=finished (default, keeps active) or ?scope=all.
app.delete("/api/runs", async (req, res) => {
  const scope = req.query.scope === "all" ? "all" : "finished";
  const cleared = await clearRuns(scope);
  res.json({ ok: true, cleared });
});

// Delete a single run (stops it first if active).
app.delete("/api/runs/:id", async (req, res) => {
  const ok = await deleteRun(req.params.id);
  if (!ok) return res.status(404).json({ error: "No such run" });
  res.json({ ok: true });
});

// ---------------- Board workflows (sequential agent pipelines) ----------------

// Start a workflow on a ticket: { boardKey, workflowId, ticket }.
app.post("/api/workflows/runs", async (req, res) => {
  const boardKey = String(req.body?.boardKey ?? "");
  const workflowId = String(req.body?.workflowId ?? "");
  const ticket = req.body?.ticket as Ticket | undefined;
  if (!ticket?.key) return res.status(400).json({ error: "A ticket is required to start a workflow." });
  try {
    const wf = await startWorkflow(boardKey, workflowId, ticket);
    res.json({ workflowRunId: wf.id });
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/api/workflows/runs", (_req, res) => {
  res.json({ runs: listWorkflowRuns() });
});

app.post("/api/workflows/runs/:id/stop", async (req, res) => {
  const ok = await stopWorkflowRun(req.params.id);
  if (!ok) return res.status(404).json({ error: "No such workflow run" });
  res.json({ ok: true });
});

// Clear workflow runs: ?scope=finished (default) or ?scope=all. Must precede the :id route.
app.delete("/api/workflows/runs", async (req, res) => {
  const scope = req.query.scope === "all" ? "all" : "finished";
  const cleared = await clearWorkflowRuns(scope);
  res.json({ ok: true, cleared });
});

app.delete("/api/workflows/runs/:id", async (req, res) => {
  const ok = await deleteWorkflowRun(req.params.id);
  if (!ok) return res.status(404).json({ error: "No such workflow run" });
  res.json({ ok: true });
});

// Server-Sent Events stream of a run's events (replays history, then live).
app.get("/api/runs/:id/stream", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write("retry: 3000\n\n");

  const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const finishedKinds = new Set(["result", "error", "stopped"]);

  for (const ev of run.events) send(ev);
  if (run.state === "done" || run.state === "error" || run.state === "stopped") {
    res.write("event: end\ndata: {}\n\n");
    return res.end();
  }

  const listener = (ev: { kind: string }) => {
    send(ev);
    if (finishedKinds.has(ev.kind)) {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    }
  };
  run.listeners.add(listener);
  req.on("close", () => run.listeners.delete(listener));
});

// Export the app so tests (and other entry points) can mount it without binding a port.
export { app };

// Only listen when run directly as the entrypoint — not when imported (e.g. by tests).
if (require.main === module) {
  app.listen(PORT, () => {
    const jira = loadJiraEnv();
    console.log(`Hangar server on http://localhost:${PORT}`);
    console.log(
      `  boards: ${getConfig()
        .boards.map((b) => b.key)
        .join(", ")}`,
    );
    console.log(`  agentsDir: ${getConfig().agentsDir}`);
    console.log(`  jira: ${jira ? jira.baseUrl : "NOT CONFIGURED (set in Settings)"}`);
  });
}
