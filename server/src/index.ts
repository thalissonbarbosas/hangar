import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import {
  loadConfig,
  getConfig,
  saveConfig,
  loadJiraEnv,
  jiraSettingsView,
  saveJiraSettings,
  expandHome,
  boardPaths,
  getAiwfProjects,
  saveAiwfProjects,
  JiraEnv,
  PORT,
} from "./config";
import {
  detectAiwf,
  installAiwf,
  listCards,
  listSpecCards,
  createCard,
  transitionCard,
  setCardArchived,
  deleteCard,
  uninstallAiwf,
  getCard,
  getSpecCard,
  boardDir,
  columnsFor,
  projectRunNote,
  skillNeedsWorktree,
  resolveTaskWorktree,
  resolveCardWorktree,
  clearSpecState,
  getCardState,
  clearCardState,
  listCardStates,
  DELIVERY_SKILLS,
  DEFAULT_COLUMNS,
  COLUMN_SKILLS,
  SKILL_GROUPS,
  AIWF_REPO_URL,
  AIWF_AUTHOR,
  AIWF_AUTHOR_URL,
} from "./aiwf";
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
import { openInTerminal, TerminalError } from "./terminal";
import { isDemo, demoTickets } from "./demo";
import {
  startWorkflow,
  listWorkflowRuns,
  stopWorkflowRun,
  deleteWorkflowRun,
  clearWorkflowRuns,
  loadPersistedWorkflowRuns,
} from "./workflows";
import { HangarConfig, Ticket, AiwfProject } from "./types";
import { pruneWorktrees, removeWorktree } from "./worktree";

const app = express();
app.use(cors());
app.use(express.json());

// Limit session-spawning endpoints: 30 requests per minute per IP.
// Hangar is a single-operator tool; this guards against runaway loops or misconfigured clients.
const runCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sessions started — slow down and try again in a minute." },
});

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

// ---------------- AI Workflow connection (self-hosted, Claude-run) ----------------

// Install detection + the column/skill presets the UI renders from.
app.get("/api/aiwf/status", (_req, res) => {
  res.json({
    ...detectAiwf(),
    defaultColumns: DEFAULT_COLUMNS,
    columnSkills: COLUMN_SKILLS,
    skillGroups: SKILL_GROUPS,
    repoUrl: AIWF_REPO_URL,
    author: AIWF_AUTHOR,
    authorUrl: AIWF_AUTHOR_URL,
  });
});

// One-click install (the client confirms first). Runs the aiwf bootstrap script.
app.post("/api/aiwf/install", async (_req, res) => {
  try {
    const { status, output } = await installAiwf();
    res.json({ ...status, output: output.slice(-2000) });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Uninstall aiwf from ~/.claude (toolkit only — projects and their .aiwf/board cards are kept).
app.post("/api/aiwf/uninstall", async (_req, res) => {
  try {
    const { status, output } = await uninstallAiwf();
    res.json({ ...status, output: output.slice(-2000) });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.get("/api/aiwf/projects", (_req, res) => {
  res.json({ projects: getAiwfProjects().map((p) => ({ ...p, columns: columnsFor(p) })) });
});

// Register a project. mode "new" scaffolds it in place via the new-project skill.
app.post("/api/aiwf/projects", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const repoPathRaw = String(req.body?.repoPath ?? "").trim();
  const mode = req.body?.mode === "adopt" ? "adopt" : "new";
  if (!name || !repoPathRaw) return res.status(400).json({ error: "name and repoPath are required" });
  if (isDemo()) {
    // Demo mode: don't touch the filesystem or start a scaffold run — just echo a project back.
    const demo: AiwfProject = { id: randomUUID(), name, repoPath: repoPathRaw, createdAt: 0 };
    return res.json({ project: { ...demo, columns: columnsFor(demo) } });
  }
  const repoPath = expandHome(repoPathRaw);
  if (!existsSync(repoPath)) return res.status(400).json({ error: `Path does not exist: ${repoPath}` });

  const project: AiwfProject = { id: randomUUID(), name, repoPath: repoPathRaw, createdAt: Date.now() };
  saveAiwfProjects([...getAiwfProjects(), project]);
  mkdirSync(boardDir(project), { recursive: true }); // ensure the board dir exists

  let runId: string | undefined;
  if (mode === "new") {
    const cfg = getConfig();
    if (skillExists(cfg, "new-project")) {
      const run = startRun({
        kind: "skill",
        name: "new-project",
        note: `Scaffold a new project named "${name}" in this directory.`,
        cwd: repoPath,
        title: `${name}: scaffold`,
        skillSource: findSkill(cfg, "new-project")?.source,
        skipWorktree: true, // scaffold in the real repo, not a worktree
      });
      runId = run.id;
    }
  }
  res.json({ project: { ...project, columns: columnsFor(project) }, runId });
});

// Change a project's location (repoPath) and/or display name. The id is kept stable so the
// synthetic boardKey and any in-flight references survive; the board lives in Hangar's data dir
// keyed by id, so cards carry over unchanged — only future runs use the new path.
app.patch("/api/aiwf/projects/:id", (req, res) => {
  const existing = getAiwfProjects().find((p) => p.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "No such AI Workflow project" });

  const hasName = req.body?.name !== undefined;
  const hasRepoPath = req.body?.repoPath !== undefined;
  const name = hasName ? String(req.body.name).trim() : existing.name;
  const repoPathRaw = hasRepoPath ? String(req.body.repoPath).trim() : existing.repoPath;
  if (!hasName && !hasRepoPath) {
    return res.status(400).json({ error: "name or repoPath is required" });
  }
  if (!name || !repoPathRaw) return res.status(400).json({ error: "name and repoPath cannot be empty" });

  const updated: AiwfProject = { ...existing, name, repoPath: repoPathRaw };
  if (isDemo()) return res.json({ project: { ...updated, columns: columnsFor(updated) } });

  // Validate the (possibly new) location before persisting anything.
  if (hasRepoPath && repoPathRaw !== existing.repoPath) {
    const repoPath = expandHome(repoPathRaw);
    if (!existsSync(repoPath)) return res.status(400).json({ error: `Path does not exist: ${repoPath}` });
  }
  mkdirSync(boardDir(updated), { recursive: true }); // board dir is keyed by id; ensure it exists
  saveAiwfProjects(getAiwfProjects().map((p) => (p.id === updated.id ? updated : p)));
  res.json({ project: { ...updated, columns: columnsFor(updated) } });
});

app.delete("/api/aiwf/projects/:id", (req, res) => {
  if (!getAiwfProjects().some((p) => p.id === req.params.id)) {
    return res.status(404).json({ error: "No such AI Workflow project" });
  }
  saveAiwfProjects(getAiwfProjects().filter((p) => p.id !== req.params.id));
  res.json({ ok: true });
});

function requireAiwfProject(res: express.Response, id: string): AiwfProject | null {
  const p = getAiwfProjects().find((x) => x.id === id);
  if (!p) {
    res.status(404).json({ error: "No such AI Workflow project" });
    return null;
  }
  return p;
}

// The project's board cards (markdown files in <DATA_DIR>/aiwf/<projectId>/board) plus
// read-only spec cards sourced from <repoPath>/docs/specs/. Spec cards have kind:"spec".
// Both list functions handle demo mode internally (listSpecCards returns [] in demo mode).
app.get("/api/aiwf/projects/:id/cards", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const ctxId = `aiwf-${p.id}`;
  const enrich = (c: ReturnType<typeof listCards>[number]) => {
    const state = getCardState(ctxId, c.key);
    return { ...c, hasWorktree: state !== null, taskBranch: state?.taskBranch };
  };
  res.json({ tickets: [...listCards(p).map(enrich), ...listSpecCards(p).map(enrich)] });
});

app.get("/api/aiwf/projects/:id/cards/:key", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const card = getCard(p, req.params.key);
  if (!card) return res.status(404).json({ error: "Card not found" });
  const state = getCardState(`aiwf-${p.id}`, card.key);
  res.json({ ticket: { ...card, hasWorktree: state !== null, taskBranch: state?.taskBranch } });
});

// ---- AIWF worktree management routes ----

app.get("/api/aiwf/projects/:id/worktrees", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  res.json({ worktrees: listCardStates(`aiwf-${p.id}`) });
});

app.delete("/api/aiwf/projects/:id/worktrees/:key", async (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const contextId = `aiwf-${p.id}`;
  const state = getCardState(contextId, req.params.key);
  if (state) {
    await removeWorktree({
      path: state.worktreePath,
      branch: state.taskBranch,
      repoRoot: expandHome(p.repoPath),
    });
    clearCardState(contextId, req.params.key);
  }
  res.json({ ok: true });
});

app.delete("/api/aiwf/projects/:id/worktrees", async (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const contextId = `aiwf-${p.id}`;
  const states = listCardStates(contextId);
  // Best-effort: attempt each entry independently; continue on per-item failure.
  for (const s of states) {
    try {
      await removeWorktree({ path: s.worktreePath, branch: s.taskBranch, repoRoot: expandHome(p.repoPath) });
      clearCardState(contextId, s.key);
    } catch {
      /* ignore per-item errors */
    }
  }
  res.json({ ok: true, removed: states.length });
});

// ---- Jira worktree management routes ----

app.get("/api/jira/boards/:boardKey/worktrees", (req, res) => {
  const board = getConfig().boards.find((b) => b.key === req.params.boardKey);
  if (!board) return res.status(404).json({ error: `Board not found: ${req.params.boardKey}` });
  res.json({ worktrees: listCardStates(`jira-${board.key}`) });
});

app.delete("/api/jira/boards/:boardKey/worktrees/:cardKey", async (req, res) => {
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

app.delete("/api/jira/boards/:boardKey/worktrees", async (req, res) => {
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

app.post("/api/aiwf/projects/:id/cards", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const title = String(req.body?.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const ticket = createCard(p, {
      title,
      status: req.body?.status,
      kind: req.body?.kind === "task" ? "task" : "thread",
      skill: typeof req.body?.skill === "string" ? req.body.skill : undefined,
      description: req.body?.description,
    });
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

app.post("/api/aiwf/projects/:id/cards/:key/transition", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const status = String(req.body?.status ?? "").trim();
  if (!status) return res.status(400).json({ error: "status is required" });
  // Spec cards have no mutable board card file. Allow Complete transitions only — they clear the
  // task-branch state so the next code run on the card gets a fresh worktree.
  if (req.params.key.startsWith("SPEC-")) {
    if (status !== "Complete") return res.status(400).json({ error: "Spec cards are read-only." });
    clearSpecState(p.id, req.params.key);
    return res.json({ ok: true });
  }
  try {
    transitionCard(p, req.params.key, status);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Soft-archive or unarchive a card. Body: { archived: boolean } (defaults to true).
// Demo mode returns success without writing to disk.
app.post("/api/aiwf/projects/:id/cards/:key/archive", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  if (req.params.key.startsWith("SPEC-")) return res.status(400).json({ error: "Spec cards are read-only." });
  const archived = req.body?.archived !== false; // coerce: absent or true → true, explicit false → false
  if (isDemo()) return res.json({ ok: true });
  try {
    setCardArchived(p, req.params.key, archived);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Permanently remove a card file. Demo mode returns success without touching disk.
app.delete("/api/aiwf/projects/:id/cards/:key", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  if (req.params.key.startsWith("SPEC-")) return res.status(400).json({ error: "Spec cards are read-only." });
  if (isDemo()) return res.json({ ok: true });
  const removed = deleteCard(p, req.params.key);
  if (!removed) return res.status(404).json({ error: "No such card" });
  res.json({ ok: true });
});

// Start a phase skill as an in-place session against a card. The card's current phase is
// recorded so the result lands in that phase of its history; the roadmap skill also seeds cards.
// Spec cards (kind:"spec") are read-only — the spec file is never written, but a normal session
// runs with the spec content as context; appendCardHistory no-ops because no board file exists.
app.post("/api/aiwf/projects/:id/cards/:key/run", runCreateLimiter, async (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  if (isDemo()) return res.json({ runId: "demo" }); // no real sessions in demo
  // Check board cards first, then read-only spec cards.
  const card = getCard(p, req.params.key) ?? getSpecCard(p, req.params.key);
  if (!card) return res.status(404).json({ error: "No such card" });
  const skill = String(req.body?.skill ?? "").trim();
  const userNote = typeof req.body?.note === "string" ? req.body.note : undefined;
  if (!skill) return res.status(400).json({ error: "skill is required" });
  const cfg = getConfig();
  if (!skillExists(cfg, skill)) {
    return res.status(400).json({ error: `Skill "${skill}" not found — install AI Workflow first.` });
  }

  // Delivery skills get a persistent task worktree shared across all runs on this card (any kind:
  // spec, thread, task). Other skills keep the per-run isolateRuns path so analysis agents and
  // Docker environments are unaffected. When isolateRuns is false the block is skipped entirely
  // and every skill runs in the real repo.
  let cwdOverride = expandHome(p.repoPath);
  let skipWorktree = !skillNeedsWorktree(skill);
  let taskBranch: string | undefined;

  if ((cfg.isolateRuns ?? true) && DELIVERY_SKILLS.has(skill)) {
    const taskWt = await resolveTaskWorktree(p, card.key, skill, card.description);
    if (taskWt) {
      cwdOverride = taskWt.cwd;
      skipWorktree = true;
      taskBranch = taskWt.branch;
    } else {
      // createWorktree failed (e.g. branch already checked out). Abort rather than silently running
      // in the wrong directory.
      return res.status(503).json({
        error: "Could not create task worktree — branch may already be checked out. Check git worktree list.",
      });
    }
  }

  const run = startRun({
    kind: "skill",
    name: skill,
    note: projectRunNote(skill, p, userNote),
    ticket: card,
    cwdOverride,
    skipWorktree,
    ...(taskBranch ? { branch: taskBranch } : {}),
    skillSource: findSkill(cfg, skill)?.source,
    aiwfProjectId: p.id,
    aiwfPhase: card.status,
  });
  res.json({ runId: run.id });
});

// ---------------- Phase 2: agent sessions ----------------

// Start a run. Either ticket-based ({ ticket, name, kind, note? }) or standalone
// ({ name, kind, note, cwd?, title? } — the note is the task, no ticket required).
app.post("/api/runs", runCreateLimiter, async (req, res) => {
  const ticket = req.body?.ticket as Ticket | undefined;
  const name = String(req.body?.name ?? req.body?.agentName ?? "");
  const kind = req.body?.kind === "skill" ? "skill" : req.body?.kind === "chat" ? "chat" : "agent";
  const note = typeof req.body?.note === "string" ? req.body.note : undefined;
  const cwd = typeof req.body?.cwd === "string" ? req.body.cwd : undefined;
  const title = typeof req.body?.title === "string" ? req.body.title : undefined;
  const model = typeof req.body?.model === "string" ? req.body.model : undefined;
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
  // kind === "chat": no name validation — the display name is always "claude".
  const resolvedName = kind === "chat" ? "claude" : name;

  const hasTicket = !!(ticket?.key && ticket.boardKey);
  // Chat sessions don't require a note (an empty note → "(no instructions provided)" server-side).
  if (!hasTicket && !parentRunId && kind !== "chat" && !note?.trim()) {
    return res.status(400).json({ error: "Provide a ticket, or a note describing the standalone task." });
  }

  // Delivery skill on a Jira ticket: resolve a persistent task worktree (one branch per card,
  // shared across all skill runs). Non-delivery skills and agents keep the isolateRuns path so
  // Docker environments and analysis agents are unaffected. When isolateRuns is false, the block
  // is skipped and every run uses the real repo path.
  let jiraTaskCwd: string | undefined;
  let jiraSkipWorktree: boolean | undefined;
  let jiraTaskBranch: string | undefined;

  if (hasTicket && kind === "skill" && (cfg.isolateRuns ?? true) && DELIVERY_SKILLS.has(name)) {
    const board = cfg.boards.find((b) => b.key === ticket!.boardKey);
    const repoRoot = boardPaths(board)[0];
    if (repoRoot) {
      const taskWt = await resolveCardWorktree(`jira-${ticket!.boardKey}`, ticket!.key, name, repoRoot);
      if (taskWt) {
        jiraTaskCwd = taskWt.cwd;
        jiraSkipWorktree = true;
        jiraTaskBranch = taskWt.branch;
      }
      // If resolveCardWorktree returns null (git error), fall through to the isolateRuns path.
    }
  }

  const skillSource = kind === "skill" ? findSkill(cfg, name)?.source : undefined;
  const run = parentRunId
    ? startRun({ kind, name: resolvedName, note, parentRunId, skillSource })
    : hasTicket
      ? startRun({
          kind,
          name: resolvedName,
          note,
          ticket,
          skillSource,
          ...(jiraTaskCwd
            ? { cwdOverride: jiraTaskCwd, skipWorktree: jiraSkipWorktree, branch: jiraTaskBranch }
            : {}),
        })
      : startRun({
          kind,
          name: resolvedName,
          note,
          cwd,
          title,
          modelOverride: model,
          skillSource,
          skipWorktree: kind === "chat" ? true : undefined,
        });
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

// Open the run's Claude session in the operator's configured terminal (resume from where it left
// off). 400 when no terminal is configured / the run has no resumable session.
app.post("/api/runs/:id/terminal", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No such run" });
  try {
    const command = openInTerminal(run);
    res.json({ ok: true, command });
  } catch (err) {
    if (err instanceof TerminalError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Stop a run (interrupt the session).
app.post("/api/runs/:id/stop", async (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No such run" });
  await stopRun(run);
  res.json({ ok: true });
});

// Clear runs: ?scope=finished (default, keeps active) or ?scope=all.
// Body may include { ids: string[] } to restrict to a specific set (project-scoped clear).
app.delete("/api/runs", async (req, res) => {
  const scope = req.query.scope === "all" ? "all" : "finished";
  const ids = Array.isArray(req.body?.ids) ? new Set<string>(req.body.ids as string[]) : undefined;
  const cleared = await clearRuns(scope, ids);
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
app.post("/api/workflows/runs", runCreateLimiter, async (req, res) => {
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
  // Last-resort safety net: a stray rejection or async error outside the guarded run loops
  // would otherwise crash the process and silently kill every live session (see sessions.ts).
  // Log it loudly and keep serving instead of exiting.
  process.on("unhandledRejection", (reason) => {
    console.error("[hangar] unhandledRejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[hangar] uncaughtException:", err);
  });

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

  // Graceful shutdown: clean up active runs and worktrees before exiting.
  async function shutdown(signal: string): Promise<void> {
    console.log(`[hangar] ${signal} received — shutting down gracefully`);
    await Promise.allSettled([clearRuns("all"), clearWorkflowRuns("all")]);
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Prune stale worktrees left over from any previous crash (best-effort, non-blocking).
  for (const board of getConfig().boards) {
    const paths = boardPaths(board);
    if (paths[0]) pruneWorktrees(paths[0]).catch(() => {});
  }
}
