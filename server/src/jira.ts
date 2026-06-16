import { JiraEnv } from "./config";
import { BoardConfig, Ticket } from "./types";

interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string; avatarUrls?: Record<string, string> } | null;
    issuetype?: { name?: string };
    priority?: { name?: string } | null;
  };
}

function authHeader(env: JiraEnv): string {
  return "Basic " + Buffer.from(`${env.email}:${env.token}`).toString("base64");
}

async function jiraGet<T>(env: JiraEnv, pathAndQuery: string): Promise<T> {
  const res = await fetch(`${env.baseUrl}${pathAndQuery}`, {
    headers: { Authorization: authHeader(env), Accept: "application/json" },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Jira ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function jiraPost(env: JiraEnv, pathAndQuery: string, body: unknown): Promise<void> {
  const res = await fetch(`${env.baseUrl}${pathAndQuery}`, {
    method: "POST",
    headers: { Authorization: authHeader(env), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Jira ${res.status}: ${detail.slice(0, 300)}`);
  }
}

function buildJql(board: BoardConfig, myTicketsOnly: boolean): string {
  const statuses = board.statuses.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(", ");
  const clauses = [`project = "${board.key}"`, `status in (${statuses})`];
  if (myTicketsOnly) clauses.push("assignee = currentUser()");
  return `${clauses.join(" AND ")} ORDER BY Rank ASC`;
}

async function fetchBoard(env: JiraEnv, board: BoardConfig): Promise<Ticket[]> {
  // Jira Cloud's current search endpoint (the old /rest/api/3/search is deprecated).
  const res = await fetch(`${env.baseUrl}/rest/api/3/search/jql`, {
    method: "POST",
    headers: {
      Authorization: authHeader(env),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jql: buildJql(board, env.myTicketsOnly),
      fields: ["summary", "status", "assignee", "issuetype", "priority"],
      maxResults: 100,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Jira ${res.status} for board ${board.key}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { issues?: JiraIssue[] };
  return (data.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary ?? "(no summary)",
    status: issue.fields.status?.name ?? "Unknown",
    assignee: issue.fields.assignee?.displayName ?? null,
    assigneeAvatar:
      issue.fields.assignee?.avatarUrls?.["24x24"] ?? issue.fields.assignee?.avatarUrls?.["32x32"] ?? null,
    issuetype: issue.fields.issuetype?.name ?? null,
    priority: issue.fields.priority?.name ?? null,
    boardKey: board.key,
    url: `${env.baseUrl}/browse/${issue.key}`,
  }));
}

/** Fetch tickets for the given boards, one JQL per board, in parallel. */
export async function fetchTickets(env: JiraEnv, boards: BoardConfig[]): Promise<Ticket[]> {
  const results = await Promise.all(boards.map((b) => fetchBoard(env, b)));
  return results.flat();
}

/** Verify credentials by reading the current user. */
export async function testConnection(env: JiraEnv): Promise<{ displayName: string }> {
  const me = await jiraGet<{ displayName?: string }>(env, "/rest/api/3/myself");
  return { displayName: me.displayName ?? "(unknown)" };
}

/** List visible projects (for the project picker). Capped at 100. */
export async function listProjects(env: JiraEnv): Promise<{ key: string; name: string }[]> {
  const data = await jiraGet<{ values?: { key: string; name: string }[] }>(
    env,
    "/rest/api/3/project/search?maxResults=100&orderBy=key"
  );
  return (data.values ?? []).map((p) => ({ key: p.key, name: p.name }));
}

interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string };
}

/** Transitions currently legal for an issue (depends on its workflow + current status). */
export async function listTransitions(env: JiraEnv, key: string): Promise<JiraTransition[]> {
  const data = await jiraGet<{ transitions?: JiraTransition[] }>(
    env,
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`
  );
  return data.transitions ?? [];
}

/** Move an issue to the named target status by finding & executing the matching transition. */
export async function transitionIssue(env: JiraEnv, key: string, targetStatus: string): Promise<void> {
  const transitions = await listTransitions(env, key);
  const want = targetStatus.trim().toLowerCase();
  const match =
    transitions.find((t) => (t.to?.name ?? "").toLowerCase() === want) ??
    transitions.find((t) => t.name.toLowerCase() === want);
  if (!match) {
    const avail = transitions.map((t) => t.to?.name ?? t.name).filter(Boolean).join(", ");
    throw new Error(`No legal transition to "${targetStatus}". Available from here: ${avail || "(none)"}.`);
  }
  await jiraPost(env, `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: match.id } });
}

/** Distinct status names available on a project, in first-seen order (for filling columns). */
export async function listStatuses(env: JiraEnv, projectKey: string): Promise<string[]> {
  const data = await jiraGet<{ statuses?: { name: string }[] }[]>(
    env,
    `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const issueType of data ?? []) {
    for (const s of issueType.statuses ?? []) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        out.push(s.name);
      }
    }
  }
  return out;
}
