export interface AiwfDoc {
  slug: string; // filename without .md, e.g. "REFERENCE"
  title: string; // first # heading or formatSpecName fallback
}

export interface SpecSlice {
  filename: string; // e.g. "001_remove-spec-section.md"
  title: string; // parsed from first # heading
  content: string; // full markdown
}

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
  skills?: string[]; // skill names enabled for this board; undefined/empty = all skills
  workflows?: WorkflowConfig[]; // board pipelines
}

/** A self-hosted project driven by the AI Workflow (aiwf) connection — no Jira. */
export interface AiwfProject {
  id: string; // stable id (used as the synthetic boardKey for its cards)
  name: string; // display name
  repoPath: string; // project root (stays pristine; cards live in Hangar's data dir, keyed by id)
  columns?: string[]; // kanban columns; undefined = the default dev columns
  createdAt: number;
}

export interface HangarConfig {
  agentsDir: string;
  skillsDir?: string; // user-scoped skills; defaults to ~/.claude/skills
  boards: BoardConfig[];
  /** AI Workflow connection: self-hosted projects whose board lives inside the repo. */
  aiWorkflow?: { projects: AiwfProject[] };
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
  /**
   * Command template for "Open in terminal" — launches the operator's terminal at a run's
   * working dir, resuming its Claude session. Placeholders: `{{dir}}` (the run's cwd) and
   * `{{command}}` (the resume command). Unset = the action warns instead of launching.
   */
  terminal?: string;
  /** Auto-delete finished runs older than this many days. Undefined = keep forever (GDPR opt-in). */
  runRetentionDays?: number;
}

export interface Skill {
  name: string;
  description: string;
  sourcePath: string;
  source?: "user" | "repo"; // default "user"
  repo?: string; // repo basename, for repo skills (the "(eyeconic)" flag)
  repoPath?: string; // expanded repo root, so a run can target it
  model?: string; // optional model from frontmatter, e.g. "opus" | "sonnet" | "haiku"
  aiwf?: boolean; // client-side: true when skill is from the AI Workflow toolkit
}

export interface Agent {
  name: string;
  description: string;
  model?: string; // "opus" | "sonnet" | "haiku" | full id
  tools: string[];
  sourcePath: string;
}

/** One session/task recorded against an aiwf card, building the project's history. */
export interface AiwfHistoryEntry {
  phase: string; // the column/phase the work happened in
  skill: string; // the skill that ran (or "task" for a manual entry)
  at: number; // epoch ms
  runId?: string;
  summary?: string; // short excerpt of the session result
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
  url?: string; // browse URL (Jira). Absent for self-hosted aiwf cards.
  source?: "jira" | "aiwf"; // origin of the ticket; defaults to Jira when absent
  description?: string; // free-text body (aiwf card body); fed into the agent prompt
  prUrl?: string; // pull-request URL, if known (aiwf cards read it from frontmatter)
  kind?: "thread" | "task" | "spec"; // aiwf: a work thread, manual task, or read-only spec card from docs/specs/
  skill?: string; // aiwf: the most recent skill run on this card
  history?: AiwfHistoryEntry[]; // aiwf: sessions/tasks recorded against this card
  archived?: boolean; // aiwf: soft-hidden from the active board columns (reversible)
  completedAt?: number; // aiwf: epoch ms the card entered the terminal Complete column
  hasWorktree?: boolean; // aiwf: true when a task-scoped worktree exists for this card
  taskBranch?: string; // aiwf: the task-branch name when hasWorktree is true
  specChildren?: SpecSlice[]; // aiwf: slice files inside a directory spec (undefined for single-file specs)
}

export type DoctorStatus = "ok" | "warn" | "error";

/** One read-only environment health check surfaced in the Doctor settings section. */
export interface DoctorCheck {
  id: string; // stable key, e.g. "auth", "worktrees", "disk"
  label: string; // human title
  status: DoctorStatus;
  detail: string; // one-line finding
  hint?: string; // optional remediation guidance
}

/** A stopped/errored run that still carries a Claude sessionId and can be brought back. */
export interface RecoverableSession {
  id: string;
  title: string; // ticketKey || title || agentName
  ticketKey?: string;
  agentName: string;
  kind: "agent" | "skill" | "chat";
  state: "stopped" | "error";
  cwd: string;
  cwdExists: boolean; // false ⇒ unrecoverable (worktree pruned)
  endedAt?: number;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  recoverableSessions: RecoverableSession[];
  generatedAt: number; // epoch ms
}

export interface AiwfDocTreeNode {
  /** Relative path from the project root — e.g. "docs/ARCHITECTURE.md" */
  path: string;
  /** Display title: first `# ` heading if file exists, otherwise formatSpecName fallback */
  title: string;
  /** doc = single .md file | folder = directory | spec = single-file spec card | spec-dir = sliced spec */
  type: "doc" | "folder" | "spec" | "spec-dir";
  /** Whether the file/directory exists on disk right now */
  exists: boolean;
  /** AIWF phase this doc is associated with (Planning, Design, Implementation, etc.) */
  phase?: string;
  /** Populated for folders and spec-dirs */
  children?: AiwfDocTreeNode[];
}
