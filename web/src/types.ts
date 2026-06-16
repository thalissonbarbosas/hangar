export interface WorkflowStep {
  name: string;
  kind: "agent" | "skill";
  note?: string;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  steps: WorkflowStep[];
}

export interface BoardConfig {
  key: string;
  name: string;
  statuses: string[];
  repoPath?: string;
  repoPaths?: string[];
  agents?: string[]; // enabled agent names; undefined/empty = all
  workflows?: WorkflowConfig[];
}

export interface FullConfig {
  agentsDir: string;
  boards: BoardConfig[];
  bypassPermissions?: boolean;
  isolateRuns?: boolean;
  exclusiveAgents?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
}

export interface JiraSettings {
  configured: boolean;
  baseUrl: string;
  email: string;
  myTicketsOnly: boolean;
  hasToken: boolean;
}

export interface Agent {
  name: string;
  description: string;
  model?: string;
  tools: string[];
  sourcePath: string;
}

export interface Ticket {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  assigneeAvatar: string | null;
  issuetype: string | null;
  priority: string | null;
  boardKey: string;
  url: string;
}

export interface Skill {
  name: string;
  description: string;
  sourcePath: string;
  source?: "user" | "repo";
  repo?: string; // repo basename flag, for repo skills
  repoPath?: string;
}

// Drag-and-drop: a ticket card carries this payload when dragged onto a column or workflow.
export const TICKET_DND_MIME = "application/x-hangar-ticket";
export interface TicketDragData {
  key: string;
  boardKey: string;
  status: string;
}

export type RunKind = "agent" | "skill";

export type RunState = "queued" | "starting" | "running" | "awaiting_input" | "done" | "error" | "stopped";

export interface RunEvent {
  seq: number;
  ts: number;
  kind: string;
  // event-specific fields (text, tool, input, sessionId, result, subtype, message, …)
  [k: string]: unknown;
}

export interface RunSummary {
  id: string;
  ticketKey: string;
  title?: string;
  ticketUrl?: string;
  prUrl?: string;
  agentName: string;
  kind?: "agent" | "skill";
  note?: string;
  model: string;
  cwd: string;
  state: RunState;
  sessionId?: string;
  phase?: string;
  result?: string;
  error?: string;
  costUsd?: number;
  startedAt: number;
  endedAt?: number;
  pendingCount: number;
  eventCount: number;
}

export const ACTIVE_STATES: RunState[] = ["queued", "starting", "running", "awaiting_input"];
export const isActive = (s: RunState) => ACTIVE_STATES.includes(s);

export type WorkflowStatus = "running" | "awaiting_input" | "done" | "error" | "stopped";

export interface WorkflowRunSummary {
  id: string;
  boardKey: string;
  workflowId: string;
  workflowName: string;
  ticketKey: string;
  ticketUrl?: string;
  ticketSummary?: string;
  steps: WorkflowStep[];
  stepIndex: number;
  runIds: string[];
  cwd: string;
  additionalDirectories: string[];
  branch?: string;
  status: WorkflowStatus;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export const WORKFLOW_ACTIVE: WorkflowStatus[] = ["running", "awaiting_input"];
export const isWorkflowActive = (s: WorkflowStatus) => WORKFLOW_ACTIVE.includes(s);
