import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import { HangarConfig, WorkflowConfig } from "./types";
import { isDemo, demoConfig } from "./demo";

// Resolve repo root = hangar/ (two levels up from server/src)
const ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.resolve(ROOT, ".env");

dotenv.config({ path: ENV_PATH });

const CONFIG_PATH = process.env.CONFIG_PATH
  ? expandHome(process.env.CONFIG_PATH)
  : path.resolve(ROOT, "hangar.config.json");

let currentConfig: HangarConfig | null = null;

/** Expand a leading ~ to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Sanitize a board's workflows: keep id/name/steps, trim names, drop empty steps/workflows. */
function cleanWorkflows(raw: unknown): WorkflowConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkflowConfig[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const wf = w as Partial<WorkflowConfig>;
    const name = String(wf.name ?? "").trim();
    const steps = (Array.isArray(wf.steps) ? wf.steps : [])
      .map((s) => ({
        name: String(s?.name ?? "").trim(),
        kind: s?.kind === "skill" ? ("skill" as const) : ("agent" as const),
        ...(s?.note && String(s.note).trim() ? { note: String(s.note).trim() } : {}),
      }))
      .filter((s) => s.name);
    if (!name) continue; // keep named drafts even with no steps yet; run-time guards execution
    out.push({ id: String(wf.id ?? "").trim() || name, name, steps });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function validateConfig(raw: HangarConfig): void {
  if (!raw || !Array.isArray(raw.boards) || raw.boards.length === 0) {
    throw new Error("Config must define at least one board");
  }
  for (const b of raw.boards) {
    if (!b.key || !b.name || !Array.isArray(b.statuses) || b.statuses.length === 0) {
      throw new Error(`Invalid board config: ${JSON.stringify(b)}`);
    }
  }
  if (!raw.agentsDir) throw new Error("Config must define agentsDir");
}

export function loadConfig(): HangarConfig {
  // Demo mode is fully self-contained: synthesize a config and never touch the real file.
  if (isDemo()) {
    currentConfig = demoConfig();
    return currentConfig;
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found at ${CONFIG_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as HangarConfig;
  validateConfig(raw);
  // Workflows list by name everywhere they're shown; sort here so a hand-edited config is honored too.
  for (const b of raw.boards) {
    if (Array.isArray(b.workflows)) b.workflows.sort((a, b) => a.name.localeCompare(b.name));
  }
  currentConfig = raw;
  return raw;
}

export function getConfig(): HangarConfig {
  if (!currentConfig) loadConfig();
  return currentConfig!;
}

/** Validate, write to disk, and hot-swap the in-memory config. */
export function saveConfig(raw: HangarConfig): HangarConfig {
  if (isDemo()) return getConfig(); // never overwrite the real config while in demo mode
  validateConfig(raw);
  const clean: HangarConfig = {
    agentsDir: raw.agentsDir,
    ...(raw.skillsDir
      ? { skillsDir: raw.skillsDir }
      : currentConfig?.skillsDir
        ? { skillsDir: currentConfig.skillsDir }
        : {}),
    boards: raw.boards.map((b) => {
      const paths = (b.repoPaths ?? (b.repoPath ? [b.repoPath] : [])).map((p) => p.trim()).filter(Boolean);
      const agents = Array.isArray(b.agents) ? b.agents.map((s) => String(s).trim()).filter(Boolean) : [];
      const workflows = cleanWorkflows(b.workflows);
      return {
        key: b.key.trim(),
        name: b.name.trim(),
        statuses: b.statuses.map((s) => s.trim()).filter(Boolean),
        ...(paths.length ? { repoPaths: paths } : {}),
        ...(agents.length ? { agents } : {}),
        ...(workflows.length ? { workflows } : {}),
      };
    }),
    // Explicit value wins; otherwise preserve the existing setting (so saving boards
    // from the UI doesn't reset the permission mode).
    ...(typeof raw.bypassPermissions === "boolean"
      ? { bypassPermissions: raw.bypassPermissions }
      : typeof currentConfig?.bypassPermissions === "boolean"
        ? { bypassPermissions: currentConfig.bypassPermissions }
        : {}),
    ...(typeof raw.isolateRuns === "boolean"
      ? { isolateRuns: raw.isolateRuns }
      : typeof currentConfig?.isolateRuns === "boolean"
        ? { isolateRuns: currentConfig.isolateRuns }
        : {}),
    ...(Array.isArray(raw.exclusiveAgents)
      ? { exclusiveAgents: raw.exclusiveAgents.map((s) => String(s).trim()).filter(Boolean) }
      : currentConfig?.exclusiveAgents
        ? { exclusiveAgents: currentConfig.exclusiveAgents }
        : {}),
    // Numeric limits: a positive number sets it, 0 clears it, undefined preserves.
    ...(typeof raw.maxTurns === "number"
      ? raw.maxTurns > 0
        ? { maxTurns: Math.floor(raw.maxTurns) }
        : {}
      : typeof currentConfig?.maxTurns === "number"
        ? { maxTurns: currentConfig.maxTurns }
        : {}),
    ...(typeof raw.maxBudgetUsd === "number"
      ? raw.maxBudgetUsd > 0
        ? { maxBudgetUsd: raw.maxBudgetUsd }
        : {}
      : typeof currentConfig?.maxBudgetUsd === "number"
        ? { maxBudgetUsd: currentConfig.maxBudgetUsd }
        : {}),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(clean, null, 2) + "\n");
  currentConfig = clean;
  return clean;
}

/** A board's codebase paths, home-expanded. First is the cwd, rest are additionalDirectories. */
export function boardPaths(board?: { repoPath?: string; repoPaths?: string[] }): string[] {
  if (!board) return [];
  const raw = board.repoPaths?.length ? board.repoPaths : board.repoPath ? [board.repoPath] : [];
  return raw.map(expandHome);
}

export interface JiraEnv {
  baseUrl: string;
  email: string;
  token: string;
  myTicketsOnly: boolean;
}

/** Returns Jira env config, or null if not yet configured (so the board still loads). */
export function loadJiraEnv(): JiraEnv | null {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/+$/, "");
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) return null;
  return {
    baseUrl,
    email,
    token,
    myTicketsOnly: (process.env.JIRA_MY_TICKETS_ONLY ?? "false").toLowerCase() === "true",
  };
}

/** Non-secret view of the current Jira settings (never exposes the token). */
export function jiraSettingsView() {
  return {
    configured: loadJiraEnv() !== null,
    baseUrl: process.env.JIRA_BASE_URL ?? "",
    email: process.env.JIRA_EMAIL ?? "",
    myTicketsOnly: (process.env.JIRA_MY_TICKETS_ONLY ?? "false").toLowerCase() === "true",
    hasToken: !!process.env.JIRA_API_TOKEN,
  };
}

export interface JiraSettingsInput {
  baseUrl?: string;
  email?: string;
  token?: string; // omitted/empty = keep the existing token
  myTicketsOnly?: boolean;
}

/** Persist Jira settings to .env (preserving other keys/comments) and to process.env. */
export function saveJiraSettings(input: JiraSettingsInput): void {
  if (isDemo()) return; // never write .env while in demo mode
  const updates: Record<string, string> = {};
  if (input.baseUrl !== undefined) updates.JIRA_BASE_URL = input.baseUrl.replace(/\/+$/, "");
  if (input.email !== undefined) updates.JIRA_EMAIL = input.email;
  if (input.token) updates.JIRA_API_TOKEN = input.token; // only when a non-empty token is provided
  if (input.myTicketsOnly !== undefined) updates.JIRA_MY_TICKETS_ONLY = String(input.myTicketsOnly);

  writeEnv(updates);
  for (const [k, v] of Object.entries(updates)) process.env[k] = v;
}

/** Merge keys into .env, preserving existing lines, comments, and ordering. */
function writeEnv(updates: Record<string, string>): void {
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const remaining = new Set(Object.keys(updates));
  const out = lines.map((line) => {
    const m = line.match(/^([A-Za-z0-9_]+)=/);
    if (m && updates[m[1]] !== undefined) {
      remaining.delete(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  for (const k of remaining) out.push(`${k}=${updates[k]}`);
  fs.writeFileSync(ENV_PATH, out.join("\n").replace(/\n*$/, "\n"));
}

export const PORT = Number(process.env.PORT ?? 3001);
