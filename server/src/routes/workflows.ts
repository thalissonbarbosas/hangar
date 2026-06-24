import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  startWorkflow,
  listWorkflowRuns,
  stopWorkflowRun,
  deleteWorkflowRun,
  clearWorkflowRuns,
} from "../workflows";
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

export const workflowsRouter = Router();

// ---------------- Board workflows (sequential agent pipelines) ----------------

// Start a workflow on a ticket: { boardKey, workflowId, ticket }.
workflowsRouter.post("/api/workflows/runs", runCreateLimiter, async (req, res) => {
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

workflowsRouter.get("/api/workflows/runs", (_req, res) => {
  res.json({ runs: listWorkflowRuns() });
});

workflowsRouter.post("/api/workflows/runs/:id/stop", async (req, res) => {
  const ok = await stopWorkflowRun(req.params.id);
  if (!ok) return res.status(404).json({ error: "No such workflow run" });
  res.json({ ok: true });
});

// Clear workflow runs: ?scope=finished (default) or ?scope=all. Must precede the :id route.
workflowsRouter.delete("/api/workflows/runs", async (req, res) => {
  const scope = req.query.scope === "all" ? "all" : "finished";
  const cleared = await clearWorkflowRuns(scope);
  res.json({ ok: true, cleared });
});

workflowsRouter.delete("/api/workflows/runs/:id", async (req, res) => {
  const ok = await deleteWorkflowRun(req.params.id);
  if (!ok) return res.status(404).json({ error: "No such workflow run" });
  res.json({ ok: true });
});
