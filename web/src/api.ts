import {
  Agent,
  FullConfig,
  JiraSettings,
  RunKind,
  RunSummary,
  Skill,
  Ticket,
  WorkflowRunSummary,
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
  startRun: (ticket: Ticket, name: string, kind: RunKind = "agent", note?: string) =>
    sendJson<StartRunResult>("POST", "/api/runs", { ticket, name, kind, note }),
  startStandalone: (name: string, kind: RunKind, note: string, cwd?: string, title?: string) =>
    sendJson<StartRunResult>("POST", "/api/runs", { name, kind, note, cwd, title }),
  handoff: (parentRunId: string, name: string, kind: RunKind, note: string) =>
    sendJson<StartRunResult>("POST", "/api/runs", { parentRunId, name, kind, note }),
  runs: () => getJson<{ runs: RunSummary[] }>("/api/runs"),
  resolvePermission: (runId: string, requestId: string, decision: "allow" | "deny") =>
    sendJson<{ ok: boolean }>("POST", `/api/runs/${runId}/permissions/${requestId}`, { decision }),
  sendMessage: (runId: string, text: string) =>
    sendJson<{ ok: boolean; mode: string }>("POST", `/api/runs/${runId}/message`, { text }),
  stopRun: (runId: string) => sendJson<{ ok: boolean }>("POST", `/api/runs/${runId}/stop`, {}),
  deleteRun: (runId: string) => sendJson<{ ok: boolean }>("DELETE", `/api/runs/${runId}`, {}),
  clearRuns: (scope: "finished" | "all" = "finished") =>
    sendJson<{ ok: boolean; cleared: number }>("DELETE", `/api/runs?scope=${scope}`, {}),
  startWorkflow: (boardKey: string, workflowId: string, ticket: Ticket) =>
    sendJson<{ workflowRunId: string }>("POST", "/api/workflows/runs", { boardKey, workflowId, ticket }),
  workflowRuns: () => getJson<{ runs: WorkflowRunSummary[] }>("/api/workflows/runs"),
  stopWorkflow: (id: string) => sendJson<{ ok: boolean }>("POST", `/api/workflows/runs/${id}/stop`, {}),
  deleteWorkflowRun: (id: string) => sendJson<{ ok: boolean }>("DELETE", `/api/workflows/runs/${id}`, {}),
  clearWorkflowRuns: (scope: "finished" | "all" = "finished") =>
    sendJson<{ ok: boolean; cleared: number }>("DELETE", `/api/workflows/runs?scope=${scope}`, {}),
};
