import fs from "fs";
import os from "os";
import path from "path";
import { boardPaths, getConfig, jiraSettingsView } from "./config";
import { DATA_DIR } from "./store";
import { countWorktreeOrphans } from "./worktree";
import { listRuns, recoverableRuns } from "./sessions";
import type { DoctorCheck, DoctorReport, DoctorStatus } from "./types";

const DISK_WARN_BYTES = 500 * 1024 * 1024; // .hangar/ over 500 MB gets a warn

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Recursive byte sum of a directory tree. Best-effort — unreadable entries are skipped. */
function dirSize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirSize(full);
      else if (e.isFile()) total += fs.statSync(full).size;
    } catch {
      /* skip unreadable entry */
    }
  }
  return total;
}

/** Wrap a check builder so one throwing check reports as an error row instead of a 500. */
async function safeCheck(
  id: string,
  label: string,
  fn: () => Promise<Omit<DoctorCheck, "id" | "label">>,
): Promise<DoctorCheck> {
  try {
    return { id, label, ...(await fn()) };
  } catch (err) {
    return { id, label, status: "error", detail: `Check failed: ${String((err as Error).message ?? err)}` };
  }
}

async function authCheck(): Promise<Omit<DoctorCheck, "id" | "label">> {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const hasLogin = fs.existsSync(path.join(os.homedir(), ".claude"));
  if (hasKey || hasLogin) {
    return {
      status: "ok",
      detail: hasKey ? "ANTHROPIC_API_KEY is set." : "Using the host Claude Code login (~/.claude).",
    };
  }
  return {
    status: "error",
    detail: "No Claude credentials found — sessions can't start.",
    hint: "Log in with Claude Code, or set ANTHROPIC_API_KEY in the environment.",
  };
}

async function jiraCheck(): Promise<Omit<DoctorCheck, "id" | "label">> {
  const s = jiraSettingsView();
  if (s.configured) return { status: "ok", detail: `Configured for ${s.baseUrl} as ${s.email}.` };
  const missing = [!s.baseUrl && "base URL", !s.email && "email", !s.hasToken && "API token"].filter(Boolean);
  return {
    status: "warn",
    detail: `Jira not fully configured — missing ${missing.join(", ")}.`,
    hint: "Set it in Settings → Jira connection (AI Workflow boards don't need Jira).",
  };
}

async function worktreesCheck(): Promise<Omit<DoctorCheck, "id" | "label">> {
  const roots = new Set<string>();
  for (const b of getConfig().boards) {
    const p = boardPaths(b)[0];
    if (p) roots.add(p);
  }
  let orphans = 0;
  for (const root of roots) orphans += await countWorktreeOrphans(root);
  if (orphans === 0) return { status: "ok", detail: "No orphaned worktrees." };
  return {
    status: "warn",
    detail: `${orphans} orphaned worktree entr${orphans === 1 ? "y" : "ies"} (checkout dir gone).`,
    hint: "Run `git worktree prune` in the affected repo, or use the worktree manager.",
  };
}

async function diskCheck(): Promise<Omit<DoctorCheck, "id" | "label">> {
  const bytes = dirSize(DATA_DIR);
  const status: DoctorStatus = bytes > DISK_WARN_BYTES ? "warn" : "ok";
  return {
    status,
    detail: `.hangar/ data dir is ${fmtBytes(bytes)}.`,
    hint:
      status === "warn"
        ? "Old runs can be swept via runRetentionDays; clean stale worktrees too."
        : undefined,
  };
}

async function runsCheck(): Promise<Omit<DoctorCheck, "id" | "label">> {
  const all = listRuns();
  const stopped = all.filter((r) => r.state === "stopped").length;
  const errored = all.filter((r) => r.state === "error").length;
  return {
    status: "ok",
    detail: `${all.length} run(s) tracked — ${stopped} stopped, ${errored} errored.`,
  };
}

/** Build the read-only environment health report shown in the Doctor settings section. */
export async function runDiagnostics(): Promise<DoctorReport> {
  const checks = await Promise.all([
    safeCheck("auth", "Claude authentication", authCheck),
    safeCheck("jira", "Jira connection", jiraCheck),
    safeCheck("worktrees", "Git worktrees", worktreesCheck),
    safeCheck("disk", "Data directory", diskCheck),
    safeCheck("runs", "Sessions", runsCheck),
  ]);
  return { checks, recoverableSessions: recoverableRuns(), generatedAt: Date.now() };
}
