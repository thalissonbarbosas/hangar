import express from "express";
import cors from "cors";
import { loadConfig, getConfig, loadJiraEnv, boardPaths, PORT } from "./config";
import { configRouter } from "./routes/config";
import { jiraRouter } from "./routes/jira";
import { runsRouter } from "./routes/runs";
import { workflowsRouter } from "./routes/workflows";
import { aiwfRouter } from "./routes/aiwf";
import { usageRouter } from "./routes/usage";
import { updateRouter } from "./routes/update";
import { clearRuns, loadPersistedRuns, seedDemoRuns } from "./sessions";
import { sweepOldRuns } from "./store";
import { isDemo } from "./demo";
import { clearWorkflowRuns, loadPersistedWorkflowRuns } from "./workflows";
import { pruneWorktrees } from "./worktree";

const app = express();
// Restrict CORS to the local web dev server only — rejects cross-origin requests from any
// other origin, mitigating CSRF (Threats 1–3) and accidental LAN exposure (Threat 6).
const WEB_ORIGIN = `http://localhost:${process.env.WEB_PORT ?? 5180}`;
app.use(
  cors({
    origin: [WEB_ORIGIN, "http://127.0.0.1:5180"],
    credentials: false,
  }),
);
app.use(express.json());

loadConfig(); // initialize (throws early if the config file is invalid)
loadPersistedRuns(); // restore runs saved before the last restart
loadPersistedWorkflowRuns(); // restore workflow runs too
if (isDemo()) seedDemoRuns(); // HANGAR_DEMO=1: fictional sessions for a credential-free demo

// Sweep expired runs at startup when the operator has configured a retention policy.
const retention = getConfig().runRetentionDays;
if (retention) sweepOldRuns(retention);

app.use(configRouter);
app.use(jiraRouter);
app.use(runsRouter);
app.use(workflowsRouter);
app.use(aiwfRouter);
app.use(usageRouter);
app.use(updateRouter);

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

  // Pre-warm the ESM-only Agent SDK so the first run doesn't pay the import cost on its
  // critical path. Non-blocking; streamTurn() still awaits import() and hits the module cache.
  void import("@anthropic-ai/claude-agent-sdk").catch(() => {});

  app.listen(PORT, "127.0.0.1", () => {
    const jira = loadJiraEnv();
    console.log(`Hangar server on http://127.0.0.1:${PORT}`);
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
