import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";

// All shell execution goes through execFileAsync with an explicit args array — never shell-string
// interpolation — so user-supplied query params cannot reach the shell as code.
const execFileAsync = promisify(execFile);

export const usageRouter = Router();

const VALID_MODES = new Set(["daily", "monthly", "weekly", "blocks", "session"]);
// Accepts YYYY-MM-DD or YYYYMMDD with calendar-valid month (01–12) and day (01–31).
// Does not reject e.g. Feb 31 (ccusage handles gracefully), but rejects month 00/13+.
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$|^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;

// Run ccusage with args, trying the direct binary first then the npx cache.
// The npx fallback (--no-install prevents downloading) handles the case where the
// user ran ccusage via npx at some point — it lives in the npx cache but is not
// a global binary in PATH. If both paths fail, rethrows the original ENOENT.
async function execCcusage(args: string[], timeoutMs = 30000): Promise<string> {
  let notFoundErr: NodeJS.ErrnoException | undefined;
  try {
    const { stdout } = await execFileAsync("ccusage", args, { timeout: timeoutMs });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
    notFoundErr = e;
  }
  try {
    const { stdout } = await execFileAsync("npx", ["--no-install", "ccusage", ...args], {
      timeout: timeoutMs,
    });
    return stdout;
  } catch {
    throw notFoundErr!;
  }
}

// GET /api/usage/status — detect whether ccusage is installed and return its version.
usageRouter.get("/api/usage/status", async (_req, res) => {
  try {
    const stdout = await execCcusage(["--version"], 5000);
    res.json({ installed: true, version: stdout.trim() || null });
  } catch {
    res.json({ installed: false, version: null });
  }
});

// GET /api/usage/data — run ccusage with the requested options and return its JSON output.
//
// Query params:
//   mode    daily|monthly|weekly|blocks|session  (default: daily)
//   since   YYYY-MM-DD or YYYYMMDD               (optional)
//   until   YYYY-MM-DD or YYYYMMDD               (optional)
//   active  true                                  (blocks-only: show current active block)
//   recent  true                                  (blocks-only: last 3 days)
usageRouter.get("/api/usage/data", async (req, res) => {
  const mode = String(req.query.mode ?? "daily");

  if (!VALID_MODES.has(mode)) {
    return res.status(400).json({ error: "Invalid mode" });
  }

  const since = req.query.since ? String(req.query.since) : undefined;
  const until = req.query.until ? String(req.query.until) : undefined;

  if (since !== undefined && !DATE_RE.test(since)) {
    return res.status(400).json({ error: "Invalid since" });
  }
  if (until !== undefined && !DATE_RE.test(until)) {
    return res.status(400).json({ error: "Invalid until" });
  }

  const args: string[] = [mode, "--json", "--no-color"];
  if (since) args.push("--since", since);
  if (until) args.push("--until", until);
  // blocks-specific toggles — silently ignored for other modes
  if (mode === "blocks" && req.query.active === "true") args.push("--active");
  if (mode === "blocks" && req.query.recent === "true") args.push("--recent");

  try {
    const stdout = await execCcusage(args);
    res.json(JSON.parse(stdout));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return res.status(503).json({ error: "ccusage not installed" });
    }
    const message = String(err instanceof Error ? err.message : err);
    res.status(500).json({ error: message, raw: message });
  }
});

// POST /api/usage/install — install ccusage globally via npm.
// Uses execFileAsync with a fixed args array (no user-controlled arguments).
usageRouter.post("/api/usage/install", async (_req, res) => {
  try {
    const { stdout } = await execFileAsync("npm", ["install", "-g", "ccusage"], { timeout: 120000 });
    res.json({ ok: true, output: stdout.slice(-2000) });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    res.status(500).json({ error: message, raw: message });
  }
});
