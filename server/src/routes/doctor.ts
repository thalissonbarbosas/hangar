import { Router } from "express";
import rateLimit from "express-rate-limit";
import { runDiagnostics } from "../doctor";
import { getRun, recoverRun } from "../sessions";

// Recovering a session starts a Claude turn, so it shares the run-spawn rate limit.
const recoverLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many recovery attempts — slow down and try again in a minute." },
});

export const doctorRouter = Router();

// Read-only environment health report + recoverable-session list for the Doctor settings section.
doctorRouter.get("/api/doctor", async (_req, res) => {
  res.json(await runDiagnostics());
});

// Bring a recoverable session back: reattach its Claude session and continue where it left off.
doctorRouter.post("/api/doctor/sessions/:id/recover", recoverLimiter, (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "No such run" });
  const outcome = recoverRun(run);
  if (outcome === "not_recoverable") {
    return res.status(409).json({
      error: "not_recoverable",
      message: "Session can't be recovered — it's active, has no saved session id, or its worktree is gone.",
    });
  }
  res.json({ ok: true, runId: run.id });
});
