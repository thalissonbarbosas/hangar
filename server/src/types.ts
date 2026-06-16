export interface WorkflowStep {
  name: string; // agent or skill name
  kind: "agent" | "skill";
  note?: string; // optional per-step instruction
}

export interface WorkflowConfig {
  id: string; // stable id (generated client-side)
  name: string; // display name
  steps: WorkflowStep[]; // ordered pipeline
}

export interface BoardConfig {
  key: string; // Jira project key, e.g. "PP"
  name: string; // display name, e.g. "PracticePal"
  statuses: string[]; // column order, dev -> release band
  repoPath?: string; // legacy single path (still honored)
  repoPaths?: string[]; // codebase paths: first is cwd, the rest are additionalDirectories
  agents?: string[]; // agent names enabled for this board; undefined/empty = all agents
  workflows?: WorkflowConfig[]; // board pipelines
}

export interface HangarConfig {
  agentsDir: string;
  skillsDir?: string; // user-scoped skills; defaults to ~/.claude/skills
  boards: BoardConfig[];
  /** When true (default), agent sessions run fully unrestricted (no approval prompts). */
  bypassPermissions?: boolean;
  /** When true (default), each run executes in its own git worktree + branch. */
  isolateRuns?: boolean;
  /** Agent/skill names that need exclusive runtime (Docker/ports/tunnels) — run one at a time. */
  exclusiveAgents?: string[];
  /** Max agentic turns per run (default 300). */
  maxTurns?: number;
  /** Optional spend ceiling per run, USD. Unset/0 = no cap. */
  maxBudgetUsd?: number;
}

export interface Skill {
  name: string;
  description: string;
  sourcePath: string;
  source?: "user" | "repo"; // default "user"
  repo?: string; // repo basename, for repo skills (the "(eyeconic)" flag)
  repoPath?: string; // expanded repo root, so a run can target it
}

export interface Agent {
  name: string;
  description: string;
  model?: string; // "opus" | "sonnet" | "haiku" | full id
  tools: string[];
  sourcePath: string;
}

export interface Ticket {
  key: string; // e.g. "PP-123"
  summary: string;
  status: string;
  assignee: string | null;
  assigneeAvatar: string | null; // Jira avatar URL (24x24), if any
  issuetype: string | null;
  priority: string | null;
  boardKey: string; // which board (project) this ticket belongs to
  url: string; // browse URL
}
