import { Router } from "express";
import rateLimit from "express-rate-limit";
import { existsSync } from "fs";
import path from "path";
import { expandHome, getConfig, boardPaths } from "../config";
import { loadAgent } from "../agents";
import { skillExists, findSkill } from "../skills";
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
} from "../sessions";
import { openInTerminal, TerminalError } from "../terminal";
import { DELIVERY_SKILLS, resolveCardWorktree } from "../aiwf";
import { Ticket } from "../types";

// Limit session-spawning endpoints: 30 requests per minute per IP.
// Hangar is a single-operator tool; this guards against runaway loops or misconfigured clients.
const runCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sessions started — slow down and try again in a minute." },
});

export const runsRouter = Router();

// Check whether a filesystem path exists (used by the Settings UI to validate codebase paths).
// Restricted to configured repoPaths to prevent filesystem enumeration (Threat 12).
runsRouter.get("/api/fs/exists", (req, res) => {
  const raw = String(req.query.path ?? "").trim();
  if (!raw) return res.status(400).json({ error: "path query param required" });
  const expanded = expandHome(raw);
  const repoPaths = getConfig().boards.flatMap((b) => boardPaths(b));
  const allowed = repoPaths.some((root) => path.resolve(expanded).startsWith(path.resolve(root)));
  if (!allowed) return res.status(400).json({ error: "path outside configured repos" });
  res.json({ exists: existsSync(expanded) });
});

// ---------------- Phase 2: agent sessions ----------------

// Start a run. Either ticket-based ({ ticket, name, kind, note? }) or standalone
// ({ name, kind, note, cwd?, title? } — the note is the task, no ticket required).
runsRouter.post("/api/runs", runCreateLimiter, async (req, res) => {
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

runsRouter.get("/api/runs", (_req, res) => {
  res.json({ runs: listRuns() });
});

runsRouter.get("/api/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No such run" });
  res.json(runToJson(run, true));
});

// Answer an interactive permission request (allow/deny a gated tool).
runsRouter.post("/api/runs/:id/permissions/:requestId", (req, res) => {
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
runsRouter.post("/api/runs/:id/message", (req, res) => {
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
runsRouter.post("/api/runs/:id/terminal", (req, res) => {
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
runsRouter.post("/api/runs/:id/stop", async (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No such run" });
  await stopRun(run);
  res.json({ ok: true });
});

// Clear runs: ?scope=finished (default, keeps active) or ?scope=all.
// Body may include { ids: string[] } to restrict to a specific set (project-scoped clear).
runsRouter.delete("/api/runs", async (req, res) => {
  const scope = req.query.scope === "all" ? "all" : "finished";
  const ids = Array.isArray(req.body?.ids) ? new Set<string>(req.body.ids as string[]) : undefined;
  const cleared = await clearRuns(scope, ids);
  res.json({ ok: true, cleared });
});

// Delete a single run (stops it first if active).
runsRouter.delete("/api/runs/:id", async (req, res) => {
  const ok = await deleteRun(req.params.id);
  if (!ok) return res.status(404).json({ error: "No such run" });
  res.json({ ok: true });
});

// Server-Sent Events stream of a run's events (replays history, then live).
runsRouter.get("/api/runs/:id/stream", (req, res) => {
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
