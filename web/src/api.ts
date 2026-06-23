import {
  Agent,
  AiwfProject,
  AiwfStatus,
  FullConfig,
  JiraSettings,
  RunKind,
  RunSummary,
  Skill,
  Ticket,
  WorkflowRunSummary,
  WorktreeEntry,
} from "./types";

export interface StartRunResult {
  runId: string;
}

async function parseError(res: Response): Promise<string> {
  try {
    return (await res.json()).error ?? "";
  } catch {
    return "";
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await parseError(res)) || `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function sendJson<T>(method: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await parseError(res)) || `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface TestResult {
  ok: boolean;
  displayName?: string;
  error?: string;
}

// Structured error body returned by the checkout endpoints (active_sessions / dirty_tree / …).
export interface CheckoutError {
  error: string;
  message?: string;
  runIds?: string[];
  titles?: string[];
}

// Thrown by the checkout wrappers on a non-2xx response so callers can inspect `.detail`
// (e.g. to render the active-session blocking warning with session titles).
export class CheckoutFailed extends Error {
  detail: CheckoutError;
  constructor(detail: CheckoutError) {
    super(detail.message || detail.error);
    this.name = "CheckoutFailed";
    this.detail = detail;
  }
}

async function postCheckout<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail: CheckoutError = { error: `${res.status} ${res.statusText}` };
    try {
      detail = (await res.json()) as CheckoutError;
    } catch {
      /* keep the status-line fallback */
    }
    throw new CheckoutFailed(detail);
  }
  return res.json() as Promise<T>;
}

export interface JiraSettingsInput {
  baseUrl?: string;
  email?: string;
  token?: string;
  myTicketsOnly?: boolean;
}

export const api = {
  config: () => getJson<FullConfig>("/api/config"),
  saveConfig: (cfg: FullConfig) => sendJson<FullConfig>("PUT", "/api/config", cfg),
  agents: () => getJson<{ agents: Agent[] }>("/api/agents"),
  skills: () => getJson<{ skills: Skill[] }>("/api/skills"),
  tickets: (boardKeys: string[]) =>
    getJson<{ tickets: Ticket[] }>(`/api/tickets?boards=${encodeURIComponent(boardKeys.join(","))}`),
  jiraSettings: () => getJson<JiraSettings>("/api/settings/jira"),
  saveJiraSettings: (s: JiraSettingsInput) => sendJson<JiraSettings>("PUT", "/api/settings/jira", s),
  testJira: (creds: JiraSettingsInput) => sendJson<TestResult>("POST", "/api/jira/test", creds),
  jiraProjects: () => getJson<{ projects: { key: string; name: string }[] }>("/api/jira/projects"),
  jiraStatuses: (project: string) =>
    getJson<{ statuses: string[] }>(`/api/jira/statuses?project=${encodeURIComponent(project)}`),
  transitionTicket: (key: string, status: string) =>
    sendJson<{ ok: boolean }>("POST", `/api/tickets/${encodeURIComponent(key)}/transition`, { status }),
  // ---- AI Workflow connection ----
  aiwfStatus: () => getJson<AiwfStatus>("/api/aiwf/status"),
  aiwfInstall: () => sendJson<AiwfStatus & { output: string }>("POST", "/api/aiwf/install", {}),
  aiwfUninstall: () => sendJson<AiwfStatus & { output: string }>("POST", "/api/aiwf/uninstall", {}),
  aiwfProjects: () => getJson<{ projects: AiwfProject[] }>("/api/aiwf/projects"),
  createAiwfProject: (name: string, repoPath: string, mode: "new" | "adopt") =>
    sendJson<{ project: AiwfProject; runId?: string }>("POST", "/api/aiwf/projects", {
      name,
      repoPath,
      mode,
    }),
  updateAiwfProject: (id: string, fields: { name?: string; repoPath?: string }) =>
    sendJson<{ project: AiwfProject }>("PATCH", `/api/aiwf/projects/${id}`, fields),
  deleteAiwfProject: (id: string) => sendJson<{ ok: boolean }>("DELETE", `/api/aiwf/projects/${id}`, {}),
  aiwfCards: (id: string) => getJson<{ tickets: Ticket[] }>(`/api/aiwf/projects/${id}/cards`),
  getAiwfCard: (id: string, key: string) =>
    getJson<{ ticket: Ticket }>(`/api/aiwf/projects/${id}/cards/${encodeURIComponent(key)}`),
  createAiwfCard: (
    id: string,
    fields: {
      title: string;
      status?: string;
      kind?: "thread" | "task";
      skill?: string;
      description?: string;
    },
  ) => sendJson<{ ticket: Ticket }>("POST", `/api/aiwf/projects/${id}/cards`, fields),
  transitionAiwfCard: (id: string, key: string, status: string) =>
    sendJson<{ ok: boolean }>(
      "POST",
      `/api/aiwf/projects/${id}/cards/${encodeURIComponent(key)}/transition`,
      { status },
    ),
  archiveAiwfCard: (id: string, key: string, archived: boolean) =>
    sendJson<{ ok: boolean }>("POST", `/api/aiwf/projects/${id}/cards/${encodeURIComponent(key)}/archive`, {
      archived,
    }),
  deleteAiwfCard: (id: string, key: string) =>
    sendJson<{ ok: boolean }>("DELETE", `/api/aiwf/projects/${id}/cards/${encodeURIComponent(key)}`, {}),
  aiwfRunCard: (id: string, key: string, skill: string, note?: string) =>
    sendJson<{ runId: string }>("POST", `/api/aiwf/projects/${id}/cards/${encodeURIComponent(key)}/run`, {
      skill,
      note,
    }),
  listAiwfWorktrees: (id: string) =>
    getJson<{ worktrees: WorktreeEntry[] }>(`/api/aiwf/projects/${id}/worktrees`),
  deleteAiwfWorktree: (id: string, key: string) =>
    sendJson<{ ok: boolean }>("DELETE", `/api/aiwf/projects/${id}/worktrees/${encodeURIComponent(key)}`, {}),
  deleteAllAiwfWorktrees: (id: string) =>
    sendJson<{ ok: boolean; removed: number }>("DELETE", `/api/aiwf/projects/${id}/worktrees`, {}),
  // ---- Branch checkout (run the task branch in the project root) ----
  aiwfBranch: (id: string) => getJson<{ branch: string }>(`/api/aiwf/projects/${id}/branch`),
  aiwfCheckoutCard: (id: string, key: string) =>
    postCheckout<{ ok: boolean; branch: string; previousBranch: string }>(
      `/api/aiwf/projects/${id}/cards/${encodeURIComponent(key)}/checkout`,
    ),
  aiwfCheckoutBranch: (id: string, branch: string) =>
    postCheckout<{ ok: boolean; branch: string }>(`/api/aiwf/projects/${id}/checkout`, { branch }),
  listJiraWorktrees: (boardKey: string) =>
    getJson<{ worktrees: WorktreeEntry[] }>(`/api/jira/boards/${encodeURIComponent(boardKey)}/worktrees`),
  deleteJiraWorktree: (boardKey: string, cardKey: string) =>
    sendJson<{ ok: boolean }>(
      "DELETE",
      `/api/jira/boards/${encodeURIComponent(boardKey)}/worktrees/${encodeURIComponent(cardKey)}`,
      {},
    ),
  deleteAllJiraWorktrees: (boardKey: string) =>
    sendJson<{ ok: boolean; removed: number }>(
      "DELETE",
      `/api/jira/boards/${encodeURIComponent(boardKey)}/worktrees`,
      {},
    ),
  ticketPr: (key: string) => getJson<{ prUrl: string | null }>(`/api/tickets/${encodeURIComponent(key)}/pr`),
  checkPath: (path: string) =>
    getJson<{ exists: boolean }>(`/api/fs/exists?path=${encodeURIComponent(path)}`),
  startRun: (ticket: Ticket, name: string, kind: RunKind = "agent", note?: string) =>
    sendJson<StartRunResult>("POST", "/api/runs", { ticket, name, kind, note }),
  startStandalone: (name: string, kind: RunKind, note: string, cwd?: string, title?: string) =>
    sendJson<StartRunResult>("POST", "/api/runs", { name, kind, note, cwd, title }),
  startClaude: (cwd: string, title: string, model?: string, note?: string) =>
    sendJson<StartRunResult>("POST", "/api/runs", { kind: "chat", cwd, title, model, note }),
  handoff: (parentRunId: string, name: string, kind: RunKind, note: string) =>
    sendJson<StartRunResult>("POST", "/api/runs", { parentRunId, name, kind, note }),
  runs: () => getJson<{ runs: RunSummary[] }>("/api/runs"),
  resolvePermission: (runId: string, requestId: string, decision: "allow" | "deny") =>
    sendJson<{ ok: boolean }>("POST", `/api/runs/${runId}/permissions/${requestId}`, { decision }),
  sendMessage: (runId: string, text: string) =>
    sendJson<{ ok: boolean; mode: string }>("POST", `/api/runs/${runId}/message`, { text }),
  openInTerminal: (runId: string) =>
    sendJson<{ ok: boolean; command: string }>("POST", `/api/runs/${runId}/terminal`, {}),
  stopRun: (runId: string) => sendJson<{ ok: boolean }>("POST", `/api/runs/${runId}/stop`, {}),
  deleteRun: (runId: string) => sendJson<{ ok: boolean }>("DELETE", `/api/runs/${runId}`, {}),
  clearRuns: (scope: "finished" | "all" = "finished", ids?: string[]) =>
    sendJson<{ ok: boolean; cleared: number }>("DELETE", `/api/runs?scope=${scope}`, ids ? { ids } : {}),
  startWorkflow: (boardKey: string, workflowId: string, ticket: Ticket) =>
    sendJson<{ workflowRunId: string }>("POST", "/api/workflows/runs", { boardKey, workflowId, ticket }),
  workflowRuns: () => getJson<{ runs: WorkflowRunSummary[] }>("/api/workflows/runs"),
  stopWorkflow: (id: string) => sendJson<{ ok: boolean }>("POST", `/api/workflows/runs/${id}/stop`, {}),
  deleteWorkflowRun: (id: string) => sendJson<{ ok: boolean }>("DELETE", `/api/workflows/runs/${id}`, {}),
  clearWorkflowRuns: (scope: "finished" | "all" = "finished") =>
    sendJson<{ ok: boolean; cleared: number }>("DELETE", `/api/workflows/runs?scope=${scope}`, {}),
};
