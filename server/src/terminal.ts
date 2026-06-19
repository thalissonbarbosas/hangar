import { spawn } from "child_process";
import { existsSync } from "fs";
import { getConfig } from "./config";
import { isDemo } from "./demo";
import type { Run } from "./sessions";

// "Open in terminal": launch the operator's configured terminal at a run's working directory,
// resuming its Claude session. The terminal is a command template (config.terminal) with two
// placeholders we substitute — `{{dir}}` (the run's cwd) and `{{command}}` (the resume command).
// The rendered string is run through the operator's shell, detached. This mirrors the app's
// existing trust model (operator-authored commands run on the host); the only interpolated values
// are the server-generated cwd and a validated session id.

const PLACEHOLDER = /\{\{\s*(dir|command)\s*\}\}/g;
// SDK session ids are UUIDs; allow the broader id charset but nothing that could break out of the
// resume command when interpolated.
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

/** The command run inside the terminal to resume a Claude session. */
export function resumeCommand(sessionId: string): string {
  return `claude --resume ${sessionId}`;
}

/** Shell-quote a string using single-quote escaping: safe for any path character. */
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Substitute `{{dir}}` and `{{command}}` (any number of times) in a terminal template. */
export function renderTerminalCommand(template: string, dir: string, command: string): string {
  // dir is shell-quoted so paths with spaces or metacharacters are safe.
  // Write {{dir}} without surrounding quotes in your template (e.g. `cd {{dir}}` not `cd "{{dir}}"`).
  return template.replace(PLACEHOLDER, (_m, key) => (key === "dir" ? shellQuote(dir) : command));
}

export class TerminalError extends Error {}

/**
 * Build the shell command that opens the configured terminal for `run`, resuming its session.
 * Throws TerminalError (no spawn) when the run can't be resumed or no terminal is configured.
 */
export function buildTerminalCommand(run: Run): string {
  const template = getConfig().terminal?.trim();
  if (!template) {
    throw new TerminalError("No terminal configured. Set your default terminal in Settings → Terminal.");
  }
  if (!run.sessionId || !SESSION_ID_RE.test(run.sessionId)) {
    throw new TerminalError("This session has no resumable Claude session id yet.");
  }
  if (!run.cwd || !existsSync(run.cwd)) {
    throw new TerminalError(`The session's working directory no longer exists: ${run.cwd}`);
  }
  // dir is shell-quoted by renderTerminalCommand; session id is validated above.
  return renderTerminalCommand(template, run.cwd, resumeCommand(run.sessionId));
}

/** Validate, build, and launch the terminal for `run`. Returns the command that was run. */
export function openInTerminal(run: Run): string {
  const command = buildTerminalCommand(run);
  if (isDemo()) return command; // never spawn host processes in demo mode
  const shell = process.env.SHELL || "/bin/sh";
  const child = spawn(shell, ["-c", command], { detached: true, stdio: "ignore" });
  // A detached child with no 'error' listener turns a failed spawn into an uncaught exception
  // that would crash the server. We've already returned the command, so just log and move on.
  child.on("error", (err) => console.error("[hangar] terminal spawn failed:", err));
  child.unref(); // let it outlive the request
  return command;
}
