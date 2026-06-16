import { randomUUID } from "crypto";
import { expandHome, getConfig, boardPaths } from "./config";
import { loadAgent, AgentDetail } from "./agents";
import { createWorktree, removeWorktree, Worktree } from "./worktree";
import { saveRunRecord, deleteRunRecord, loadRunRecords, RunRecord } from "./store";
import { Ticket } from "./types";
import { demoRunSeeds } from "./demo";

// "Only risky actions" approval model: reads AND file edits run automatically;
// everything else (shell commands, kill, and any other state-changing/unknown tool)
// goes through an interactive approve/deny prompt in the run panel.
const AUTO_ALLOW_TOOLS = [
  // read-only
  "Read",
  "Grep",
  "Glob",
  "LS",
  "WebFetch",
  "WebSearch",
  "NotebookRead",
  "TodoWrite",
  // file edits (the operator opted to auto-allow these)
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
];

export type RunState = "queued" | "starting" | "running" | "awaiting_input" | "done" | "error" | "stopped";
export type Decision = "allow" | "deny";

export interface RunEvent {
  seq: number;
  ts: number;
  kind: string;
  [k: string]: unknown;
}

export interface Run {
  id: string;
  ticketKey: string; // "" for standalone runs
  title?: string; // label for standalone runs (no ticket)
  ticketUrl?: string;
  prUrl?: string;
  agentName: string; // agent or skill name
  kind: "agent" | "skill";
  note?: string;
  parentRunId?: string; // set when this run was handed off from another
  model: string;
  cwd: string;
  additionalDirectories?: string[];
  branch?: string; // primary worktree branch, if isolated
  worktrees?: Worktree[]; // created worktrees, for cleanup
  state: RunState;
  sessionId?: string;
  phase?: string; // current step label, derived from the agent's/skill's TodoWrite list
  result?: string;
  error?: string;
  costUsd?: number;
  startedAt: number;
  endedAt?: number;
  events: RunEvent[];
  listeners: Set<(e: RunEvent) => void>;
  pending: Map<string, (d: Decision) => void>; // open permission requests
  stopRequested?: boolean;
  skipWorktree?: boolean; // workflow steps reuse the engine-owned worktree
  skillSource?: "user" | "repo"; // for rebuilding options on resume
  runtimeDirs?: string[]; // mapped additionalDirectories (worktree paths) — reused on resume
  inputOpen?: boolean; // the streaming-input queue is accepting messages
  // Observed by the workflow engine to advance steps on state changes. Idempotent.
  onState?: (run: Run, state: RunState) => void;
  // runtime handles (loosely typed to avoid importing ESM-only SDK types)
  query?: { interrupt: () => Promise<void> };
  input?: { push: (m: unknown) => void; close: () => void };
  questions: Map<string, (answer: string) => void>; // open AskUserQuestion prompts
}

const runs = new Map<string, Run>();
let seq = 0;

// Exclusive-runtime serialization: agents that need Docker/ports/tunnels run one
// at a time so host-global resources can't collide.
let activeExclusiveId: string | null = null;
const exclusiveQueue: Array<{ runId: string; launch: () => void }> = [];
let portCounter = 0;

function releaseExclusive(runId: string): void {
  if (activeExclusiveId !== runId) return;
  activeExclusiveId = null;
  const next = exclusiveQueue.shift();
  if (next) {
    activeExclusiveId = next.runId;
    next.launch();
  }
}

function emit(run: Run, kind: string, data: Record<string, unknown> = {}): void {
  const ev: RunEvent = { seq: seq++, ts: Date.now(), kind, ...data };
  run.events.push(ev);
  for (const l of run.listeners) {
    try {
      l(ev);
    } catch {
      /* ignore */
    }
  }
  const st = kind === "state" ? String((data as { state?: string }).state ?? "") : "";
  const terminal =
    kind === "result" || kind === "stopped" || kind === "error" || st === "done" || st === "error" || st === "stopped";
  persist(run, terminal);
}

function setState(run: Run, state: RunState): void {
  run.state = state;
  emit(run, "state", { state });
  notifyState(run, state);
}

/** Invoke the run's state observer (the workflow engine). Errors are swallowed. */
function notifyState(run: Run, state: RunState): void {
  try {
    run.onState?.(run, state);
  } catch {
    /* ignore */
  }
}

// ---- Disk persistence (survives server restarts) ----

function toRecord(run: Run): RunRecord {
  const { listeners, pending, query, input, onState, questions, ...rest } = run;
  return rest;
}

// Streaming emits hundreds of events; coalesce disk writes to ~1/sec per run, but flush
// terminal states immediately so a completed session is never lost on a fast restart.
const saveTimers = new Map<string, NodeJS.Timeout>();
function persist(run: Run, immediate = false): void {
  const t = saveTimers.get(run.id);
  if (immediate) {
    if (t) {
      clearTimeout(t);
      saveTimers.delete(run.id);
    }
    saveRunRecord(toRecord(run));
    return;
  }
  if (t) return; // a flush is already scheduled
  saveTimers.set(
    run.id,
    setTimeout(() => {
      saveTimers.delete(run.id);
      saveRunRecord(toRecord(run));
    }, 1000)
  );
}

/** Load persisted runs on startup; any that were mid-flight are marked stopped (their process is gone). */
export function loadPersistedRuns(): void {
  let maxSeq = -1;
  for (const rec of loadRunRecords()) {
    const run: Run = { ...rec, listeners: new Set(), pending: new Map(), questions: new Map() };
    for (const e of run.events) if (e.seq > maxSeq) maxSeq = e.seq;
    if (ACTIVE.includes(run.state)) {
      run.state = "stopped";
      run.endedAt = run.endedAt ?? Date.now();
      run.events.push({
        seq: ++maxSeq,
        ts: Date.now(),
        kind: "info",
        message: "Session ended when the server restarted — its output above is preserved.",
      });
      run.events.push({ seq: ++maxSeq, ts: Date.now(), kind: "stopped" });
      saveRunRecord(toRecord(run));
    }
    runs.set(run.id, run);
  }
  if (maxSeq >= seq) seq = maxSeq + 1; // avoid seq collisions with newly emitted events
}

function mapModel(m?: string): string | undefined {
  if (!m) return undefined;
  const x = m.toLowerCase();
  if (x === "opus") return "claude-opus-4-8";
  if (x === "sonnet") return "claude-sonnet-4-6";
  if (x === "haiku") return "claude-haiku-4-5";
  return m;
}

// Derive the run's "current phase" from a TodoWrite call: the in-progress todo (or the next
// unfinished one) is the current step. Most agents/skills drive their work through TodoWrite.
function updatePhase(run: Run, input: unknown): void {
  const todos = (input as { todos?: Array<{ content?: string; activeForm?: string; status?: string }> })?.todos;
  if (!Array.isArray(todos) || todos.length === 0) return;
  const current = todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status !== "completed");
  const total = todos.length;
  const done = todos.filter((t) => t.status === "completed").length;
  const label = current ? current.activeForm || current.content || "" : "All steps complete";
  if (!label || label === run.phase) return;
  run.phase = label;
  emit(run, "phase", { label, done, total });
}

function previewInput(tool: string, input: unknown): string {
  try {
    const obj = input as Record<string, unknown>;
    if (tool === "Bash" && typeof obj?.command === "string") return obj.command.slice(0, 400);
    const s = JSON.stringify(input);
    return s.length > 400 ? s.slice(0, 400) + "…" : s;
  } catch {
    return "";
  }
}

// Read-only shell utilities that are safe to auto-run. Anything not here (or any
// command with file-writing redirection / command substitution) prompts for approval.
const SAFE_BASH = new Set([
  "ls", "cd", "pwd", "cat", "bat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "ag",
  "ack", "find", "fd", "echo", "printf", "which", "type", "whereis", "file", "stat", "du", "df",
  "tree", "sort", "uniq", "cut", "tr", "comm", "join", "paste", "fold", "nl", "tac", "xxd", "od",
  "strings", "basename", "dirname", "realpath", "readlink", "date", "whoami", "id", "hostname",
  "uname", "jq", "yq", "column", "sha1sum", "sha256sum", "md5sum", "cksum", "true", "false",
  "test", "[", "seq", "expand", "diff", "cmp", "less", "more",
]);
const GIT_READ = new Set([
  "diff", "log", "show", "status", "blame", "rev-parse", "ls-files", "ls-tree", "cat-file",
  "describe", "shortlog", "whatchanged", "grep",
]);
const GH_READ = new Set(["pr view", "pr diff", "pr list", "pr checks", "pr status", "repo view", "issue view", "issue list"]);

function isSafeSegment(seg: string): boolean {
  const tokens = seg.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++; // skip VAR=val
  const c = tokens[i];
  if (!c) return false;
  const args = tokens.slice(i + 1);
  if (c === "git") {
    const sub = args.find((a) => !a.startsWith("-"));
    return !sub || GIT_READ.has(sub);
  }
  if (c === "gh") {
    const nf = args.filter((a) => !a.startsWith("-"));
    return GH_READ.has(`${nf[0] ?? ""} ${nf[1] ?? ""}`.trim());
  }
  if (c === "sed") return !args.some((a) => a === "-i" || a.startsWith("-i")); // sed -i writes
  return SAFE_BASH.has(c);
}

/** Conservative: a Bash command is "safe" only if every piece is a known read-only command. */
export function isSafeBashCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (cmd.includes("$(") || cmd.includes("`")) return false; // command substitution — unknown contents
  if (/>\s*(?!&)/.test(cmd)) return false; // file-writing redirection (2>&1 is fine)
  const segments = cmd
    .replace(/&&|\|\|/g, "\n")
    .split(/[\n;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.length > 0 && segments.every(isSafeSegment);
}

const PR_RE = /https?:\/\/github\.com\/[^\s)\]"'>]+\/pull\/\d+/i;
function detectPr(run: Run, text: string): void {
  if (run.prUrl || !text) return;
  const m = text.match(PR_RE);
  if (m) {
    run.prUrl = m[0];
    emit(run, "pr", { url: m[0] });
  }
}

function buildPrompt(opts: { ticket?: Ticket; note?: string; skillName?: string; cwd: string }): string {
  const { ticket, note, skillName, cwd } = opts;

  // Standalone (no ticket): the note IS the task.
  if (!ticket) {
    const lines = [];
    if (skillName) lines.push(`Use the "${skillName}" skill for the following request.`);
    lines.push(note?.trim() || "(no instructions provided)");
    lines.push(`Working directory: ${cwd}`);
    return lines.filter(Boolean).join("\n");
  }

  const lines = [
    skillName ? `Use the "${skillName}" skill to work the following Jira ticket.` : "Work the following Jira ticket.",
    `Ticket: ${ticket.key} — ${ticket.summary}`,
    `Status: ${ticket.status}${ticket.issuetype ? `   Type: ${ticket.issuetype}` : ""}`,
    ticket.assignee ? `Assignee: ${ticket.assignee}` : "",
    `URL: ${ticket.url}`,
    `Repo (working directory): ${cwd}`,
  ];
  if (note?.trim()) {
    lines.push("Operator note (additional context — does not replace the task):", note.trim());
  }
  lines.push("Investigate, then carry out the work end to end.");
  return lines.filter(Boolean).join("\n");
}

/** A push-driven async iterable of SDK user messages (streaming input mode). */
function createInputQueue() {
  const items: unknown[] = [];
  let waiting: ((r: IteratorResult<unknown>) => void) | null = null;
  let closed = false;
  return {
    push(msg: unknown) {
      if (closed) return;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: msg, done: false });
      } else {
        items.push(msg);
      }
    },
    close() {
      closed = true;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: undefined, done: true });
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length) {
          yield items.shift();
          continue;
        }
        if (closed) return;
        const r = await new Promise<IteratorResult<unknown>>((res) => (waiting = res));
        if (r.done) return;
        yield r.value;
      }
    },
  };
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function runToJson(run: Run, includeEvents = false) {
  const { listeners, events, pending, query, input, ...rest } = run;
  return includeEvents
    ? { ...rest, pendingCount: pending.size, events }
    : { ...rest, pendingCount: pending.size, eventCount: events.length };
}

const ACTIVE: RunState[] = ["queued", "starting", "running", "awaiting_input"];
export function listRuns() {
  return [...runs.values()]
    .sort((a, b) => {
      const aa = ACTIVE.includes(a.state) ? 0 : 1;
      const bb = ACTIVE.includes(b.state) ? 0 : 1;
      return aa - bb || b.startedAt - a.startedAt;
    })
    .map((r) => runToJson(r));
}

/**
 * Seed fictional sessions for demo mode (HANGAR_DEMO=1). In-memory only — never persisted,
 * so a restart re-seeds a clean set and nothing leaks into `.hangar/`. Idempotent.
 */
export function seedDemoRuns(): void {
  const now = Date.now();
  for (const seed of demoRunSeeds()) {
    if (runs.has(seed.id)) continue;
    const startedAt = now - seed.startedMinsAgo * 60_000;
    const endedAt = seed.endedMinsAgo !== undefined ? now - seed.endedMinsAgo * 60_000 : undefined;
    const events: RunEvent[] = seed.events.map((e, i) => ({
      ...e,
      seq: seq++,
      ts: Math.min(startedAt + i * 1000, endedAt ?? now),
    }));
    const sessionId = events.find((e) => e.kind === "system" && e.sessionId)?.sessionId as string | undefined;
    const result = [...events].reverse().find((e) => e.kind === "result" && e.subtype === "success")?.result as
      | string
      | undefined;
    const run: Run = {
      id: seed.id,
      ticketKey: seed.ticketKey,
      ticketUrl: seed.ticketUrl,
      agentName: seed.agentName,
      kind: seed.kind,
      note: seed.note,
      model: seed.model,
      cwd: seed.cwd,
      branch: seed.branch,
      state: seed.state as RunState,
      phase: seed.phase,
      prUrl: seed.prUrl,
      costUsd: seed.costUsd,
      sessionId,
      result,
      startedAt,
      endedAt,
      events,
      listeners: new Set(),
      pending: new Map(),
      questions: new Map(),
    };
    runs.set(run.id, run);
  }
}

export function resolvePermission(run: Run, requestId: string, decision: Decision): boolean {
  const resolver = run.pending.get(requestId);
  if (!resolver) return false;
  resolver(decision);
  return true;
}

async function cleanupWorktrees(run: Run): Promise<void> {
  for (const wt of run.worktrees ?? []) await removeWorktree(wt);
}

export async function deleteRun(id: string): Promise<boolean> {
  const run = runs.get(id);
  if (!run) return false;
  if (ACTIVE.includes(run.state)) await stopRun(run);
  await cleanupWorktrees(run);
  runs.delete(id);
  deleteRunRecord(id);
  return true;
}

/** Remove runs. scope 'finished' keeps active ones; 'all' stops and removes everything. */
export async function clearRuns(scope: "finished" | "all"): Promise<number> {
  let n = 0;
  for (const run of [...runs.values()]) {
    const active = ACTIVE.includes(run.state);
    if (scope === "finished" && active) continue;
    if (active) await stopRun(run);
    await cleanupWorktrees(run);
    runs.delete(run.id);
    deleteRunRecord(run.id);
    n++;
  }
  return n;
}

function dequeue(runId: string): void {
  const i = exclusiveQueue.findIndex((e) => e.runId === runId);
  if (i >= 0) exclusiveQueue.splice(i, 1);
}

export async function stopRun(run: Run): Promise<void> {
  // A queued run never launched — just drop it from the queue.
  if (run.state === "queued") {
    dequeue(run.id);
    run.state = "stopped";
    run.endedAt = Date.now();
    emit(run, "stopped", {});
    notifyState(run, run.state);
    return;
  }
  run.stopRequested = true;
  emit(run, "info", { message: "Stop requested by operator" });
  for (const [, resolver] of run.pending) resolver("deny");
  for (const [, resolver] of run.questions) resolver("(stopped by operator)");
  try {
    await run.query?.interrupt();
  } catch {
    /* ignore */
  }
  run.input?.close();
}

export interface StartOpts {
  kind: "agent" | "skill";
  name: string;
  note?: string;
  ticket?: Ticket; // omit for a standalone (task-less) run
  cwd?: string; // standalone working directory
  title?: string; // standalone label
  parentRunId?: string; // hand off from a finished run (inherit its repo/context)
  // Workflow engine: run in an explicit, already-prepared working tree.
  cwdOverride?: string; // explicit cwd (bypasses board/parent resolution)
  additionalDirsOverride?: string[];
  skipWorktree?: boolean; // don't create a worktree; run in cwd as-is
  branch?: string; // display-only branch label (the engine-owned worktree branch)
  skillSource?: "user" | "repo"; // when kind=skill: load project settings for repo skills
}

export function startRun(opts: StartOpts): Run {
  const cfg = getConfig();

  let cwd: string;
  let additionalDirectories: string[] = [];
  let ticketKey = "";
  let ticketUrl: string | undefined;
  let title: string | undefined;
  const parent = opts.parentRunId ? runs.get(opts.parentRunId) : undefined;

  if (opts.cwdOverride) {
    // Workflow step: run in an explicit, pre-prepared working tree.
    cwd = expandHome(opts.cwdOverride);
    additionalDirectories = (opts.additionalDirsOverride ?? []).map(expandHome);
    if (opts.ticket) {
      ticketKey = opts.ticket.key;
      ticketUrl = opts.ticket.url;
    } else {
      title = opts.title || `${opts.kind}: ${opts.name}`;
    }
  } else if (parent) {
    // Handoff: reuse the parent's working context; the note carries the prior result.
    cwd = parent.cwd;
    additionalDirectories = parent.additionalDirectories ?? [];
    ticketKey = parent.ticketKey;
    ticketUrl = parent.ticketUrl;
    title = parent.ticketKey ? undefined : `${opts.name} ← ${parent.agentName}`;
  } else if (opts.ticket) {
    const paths = boardPaths(cfg.boards.find((b) => b.key === opts.ticket!.boardKey));
    cwd = paths[0] ?? process.cwd();
    additionalDirectories = paths.slice(1);
    ticketKey = opts.ticket.key;
    ticketUrl = opts.ticket.url;
  } else {
    cwd = opts.cwd ? expandHome(opts.cwd) : process.cwd();
    title = opts.title || `${opts.kind}: ${opts.name}`;
  }

  const agent = opts.kind === "agent" ? loadAgent(cfg.agentsDir, opts.name) : null;
  const skillName = opts.kind === "skill" ? opts.name : undefined;
  const model = mapModel(agent?.model);

  const run: Run = {
    id: randomUUID(),
    ticketKey,
    title,
    ticketUrl,
    agentName: opts.name,
    kind: opts.kind,
    note: opts.note,
    parentRunId: opts.parentRunId,
    model: model ?? "(default)",
    cwd,
    additionalDirectories,
    branch: opts.branch,
    skipWorktree: opts.skipWorktree,
    skillSource: opts.skillSource,
    state: "starting",
    startedAt: Date.now(),
    events: [],
    listeners: new Set(),
    pending: new Map(),
    questions: new Map(),
  };
  runs.set(run.id, run);

  const ctx: DriveCtx = {
    agent,
    skillName,
    skillSource: opts.skillSource,
    model,
    note: opts.note,
    ticket: opts.ticket,
    additionalDirectories,
  };
  const launch = () => {
    drive(run, ctx)
      .catch((err) => {
        if (!run.endedAt) {
          run.state = "error";
          run.error = String(err?.message ?? err);
          run.endedAt = Date.now();
          emit(run, "error", { message: run.error });
          notifyState(run, run.state);
        }
      })
      .finally(() => releaseExclusive(run.id));
  };

  const exclusive = (cfg.exclusiveAgents ?? []).includes(opts.name);
  if (exclusive && activeExclusiveId) {
    run.state = "queued";
    emit(run, "state", { state: "queued" });
    emit(run, "info", { message: "Queued — waiting for the current exclusive run to finish." });
    exclusiveQueue.push({ runId: run.id, launch });
  } else {
    if (exclusive) activeExclusiveId = run.id;
    launch();
  }

  return run;
}

function requestPermission(run: Run, tool: string, input: Record<string, unknown>): Promise<unknown> {
  const requestId = randomUUID();
  setState(run, "awaiting_input");
  emit(run, "permission_request", { requestId, tool, input: previewInput(tool, input) });
  return new Promise((resolve) => {
    run.pending.set(requestId, (decision) => {
      run.pending.delete(requestId);
      emit(run, "permission_resolved", { requestId, decision });
      if (run.pending.size === 0 && run.state === "awaiting_input") setState(run, "running");
      if (decision === "allow") resolve({ behavior: "allow", updatedInput: input });
      else resolve({ behavior: "deny", message: "Denied by operator in Hangar." });
    });
  });
}

interface QuestionOption {
  label: string;
  description?: string;
}
interface ParsedQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

function parseQuestions(input: unknown): ParsedQuestion[] {
  const qs = (input as { questions?: unknown[] })?.questions;
  if (!Array.isArray(qs)) return [];
  return qs.map((raw) => {
    const q = raw as Record<string, unknown>;
    const opts = Array.isArray(q.options) ? q.options : [];
    return {
      question: String(q.question ?? ""),
      header: q.header ? String(q.header) : undefined,
      multiSelect: !!q.multiSelect,
      options: opts.map((o) => {
        const opt = o as Record<string, unknown>;
        return { label: String(opt.label ?? ""), description: opt.description ? String(opt.description) : undefined };
      }),
    };
  });
}

// The agent called AskUserQuestion — surface the options to the run panel and wait for the
// operator's selection. We deliver the answer back as the tool's deny message, which the model
// reads as the human's response and continues from (robust across SDK versions).
function requestQuestion(run: Run, input: Record<string, unknown>): Promise<unknown> {
  const requestId = randomUUID();
  setState(run, "awaiting_input");
  emit(run, "question", { requestId, questions: parseQuestions(input) });
  return new Promise((resolve) => {
    run.questions.set(requestId, (answer) => {
      run.questions.delete(requestId);
      emit(run, "question_resolved", { requestId, answer });
      if (run.questions.size === 0 && run.pending.size === 0 && run.state === "awaiting_input") setState(run, "running");
      resolve({ behavior: "deny", message: answer });
    });
  });
}

export function answerQuestion(run: Run, requestId: string, answer: string): boolean {
  const resolver = run.questions.get(requestId);
  if (!resolver) return false;
  resolver(answer);
  return true;
}

interface DriveCtx {
  agent: AgentDetail | null;
  skillName?: string;
  skillSource?: "user" | "repo";
  model?: string;
  note?: string;
  ticket?: Ticket;
  additionalDirectories?: string[];
}

interface OptionOpts {
  systemPrompt?: string;
  model?: string;
  skillName?: string;
  skillSource?: "user" | "repo";
  additionalDirectories: string[];
  resume?: string;
}

/** Build the SDK `query()` options. AskUserQuestion is routed through canUseTool in both modes. */
function buildOptions(run: Run, opts: OptionOpts): Record<string, unknown> {
  const composeProject = `hangar-${run.id.slice(0, 8)}`;
  const portOffset = (portCounter++ % 50) * 100;
  emit(run, "info", { message: `Runtime: COMPOSE_PROJECT_NAME=${composeProject}, HANGAR_PORT_OFFSET=${portOffset}` });

  const base: Record<string, unknown> = {
    ...(opts.model && opts.model !== "(default)" ? { model: opts.model } : {}),
    ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
    cwd: run.cwd,
    ...(opts.additionalDirectories.length ? { additionalDirectories: opts.additionalDirectories } : {}),
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: composeProject,
      HANGAR_RUN_ID: run.id,
      HANGAR_PORT_OFFSET: String(portOffset),
    },
    includePartialMessages: true,
    maxTurns: getConfig().maxTurns ?? 300,
    ...(typeof getConfig().maxBudgetUsd === "number" && getConfig().maxBudgetUsd! > 0
      ? { maxBudgetUsd: getConfig().maxBudgetUsd }
      : {}),
    // Skill runs load user settings (~/.claude); repo skills also load project settings (cwd/.claude).
    ...(opts.skillName ? { settingSources: opts.skillSource === "repo" ? ["user", "project"] : ["user"] } : {}),
    ...(opts.resume ? { resume: opts.resume } : {}),
  };

  // Two modes (Settings → Agent permissions):
  //  • bypass (default): unrestricted; canUseTool only intercepts AskUserQuestion.
  //  • gated: reads/edits + read-only shell auto-run; mutating shell prompts; AskUserQuestion prompts.
  const bypass = getConfig().bypassPermissions ?? true;
  emit(run, "mode", { bypass });

  if (bypass) {
    return {
      ...base,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
        if (toolName === "AskUserQuestion") return (await requestQuestion(run, toolInput)) as any;
        return { behavior: "allow" as const, updatedInput: toolInput };
      },
    };
  }
  return {
    ...base,
    permissionMode: "default",
    allowedTools: AUTO_ALLOW_TOOLS,
    canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
      if (toolName === "AskUserQuestion") return (await requestQuestion(run, toolInput)) as any;
      if (AUTO_ALLOW_TOOLS.includes(toolName)) return { behavior: "allow" as const, updatedInput: toolInput };
      if (toolName === "Bash" && isSafeBashCommand(String(toolInput.command ?? ""))) {
        return { behavior: "allow" as const, updatedInput: toolInput };
      }
      return (await requestPermission(run, toolName, toolInput)) as any;
    },
  };
}

/** Run one turn of the session (initial or resumed), streaming events into the run. */
async function streamTurn(run: Run, options: Record<string, unknown>, seedText: string): Promise<void> {
  // ESM-only package — dynamic import so the CommonJS server can load it.
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const input = createInputQueue();
  run.input = input;
  run.inputOpen = true;
  input.push({ type: "user", message: { role: "user", content: seedText }, parent_tool_use_id: null });

  const q = query({ prompt: input as AsyncIterable<any>, options: options as any });
  run.query = q as any;
  setState(run, "running");

  try {
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.type !== "stream_event") detectPr(run, JSON.stringify(msg)); // capture a PR URL if one appears
      if (msg.type === "system" && msg.subtype === "init") {
        run.sessionId = msg.session_id;
        emit(run, "system", { message: "Session initialized", sessionId: msg.session_id, model: msg.model });
      } else if (msg.type === "stream_event") {
        const ev = msg.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          emit(run, "assistant_delta", { text: ev.delta.text });
        }
      } else if (msg.type === "assistant") {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "tool_use") {
            emit(run, "tool_use", { tool: block.name, input: previewInput(block.name, block.input) });
            if (block.name === "TodoWrite") updatePhase(run, block.input);
          }
        }
      } else if (msg.type === "result") {
        if (run.stopRequested) break;
        run.sessionId = msg.session_id ?? run.sessionId;
        run.costUsd = msg.total_cost_usd;
        if (msg.subtype === "success") {
          run.state = "done";
          run.result = msg.result;
          emit(run, "result", { subtype: "success", result: msg.result, costUsd: msg.total_cost_usd });
        } else {
          run.state = "error";
          run.error = `Run ended: ${msg.subtype}`;
          emit(run, "result", { subtype: msg.subtype, costUsd: msg.total_cost_usd });
        }
        notifyState(run, run.state);
        run.inputOpen = false;
        input.close(); // end the turn
      }
    }
  } catch (err) {
    if (!run.stopRequested) throw err;
  }

  run.inputOpen = false;
  if (run.stopRequested) {
    run.state = "stopped";
    emit(run, "stopped", {});
    notifyState(run, run.state);
  } else if (run.state === "running" || run.state === "awaiting_input") {
    run.state = "done";
    emit(run, "state", { state: "done" });
    notifyState(run, run.state);
  }
  run.endedAt = Date.now();
  persist(run, true); // capture endedAt + the full final transcript
}

async function drive(run: Run, ctx: DriveCtx): Promise<void> {
  const { agent, skillName, model, note, ticket } = ctx;
  let additionalDirectories = ctx.additionalDirectories ?? [];
  emit(run, "info", {
    message: `Starting ${run.kind} "${run.agentName}" on ${ticket?.key ?? "ad-hoc run"}`,
    cwd: run.cwd,
    model: run.model,
  });

  // Isolate each run in its own git worktree + branch so parallel runs on the same
  // repo can't conflict. Falls back to running in place if a path isn't a git repo.
  // Workflow steps set skipWorktree: they already run in the engine-owned shared worktree.
  if (!run.skipWorktree && (getConfig().isolateRuns ?? true)) {
    const label = run.ticketKey || run.title || "adhoc";
    const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
    const primary = await createWorktree(run.cwd, label, run.id);
    if (primary) {
      run.worktrees = [primary];
      run.branch = primary.branch;
      run.cwd = primary.path;
      emit(run, "worktree", { repo: basename(primary.repoRoot), path: primary.path, branch: primary.branch });
    } else {
      emit(run, "info", { message: "Working dir isn't a git repo — running in place (no worktree)." });
    }
    const mapped: string[] = [];
    for (const d of additionalDirectories) {
      const wt = await createWorktree(d, label, run.id);
      if (wt) {
        (run.worktrees ??= []).push(wt);
        mapped.push(wt.path);
        emit(run, "worktree", { repo: basename(wt.repoRoot), path: wt.path, branch: wt.branch });
      } else {
        mapped.push(d);
      }
    }
    additionalDirectories = mapped;
  }
  run.runtimeDirs = additionalDirectories; // reused on resume

  const systemPrompt = agent?.body?.trim()
    ? `You are operating as the "${run.agentName}" agent.\n\n${agent.body.trim()}`
    : undefined;

  const options = buildOptions(run, { systemPrompt, model, skillName, skillSource: ctx.skillSource, additionalDirectories });
  await streamTurn(run, options, buildPrompt({ ticket, note, skillName, cwd: run.cwd }));
}

/** Continue a finished session with a follow-up message (SDK `resume`), reusing its worktree. */
async function resumeRun(run: Run, text: string): Promise<void> {
  run.stopRequested = false;
  run.endedAt = undefined;
  run.error = undefined;
  emit(run, "user_message", { text });

  const cfg = getConfig();
  const agent = run.kind === "agent" ? loadAgent(cfg.agentsDir, run.agentName) : null;
  const systemPrompt = agent?.body?.trim()
    ? `You are operating as the "${run.agentName}" agent.\n\n${agent.body.trim()}`
    : undefined;

  const options = buildOptions(run, {
    systemPrompt,
    model: run.model,
    skillName: run.kind === "skill" ? run.agentName : undefined,
    skillSource: run.skillSource,
    additionalDirectories: run.runtimeDirs ?? [],
    resume: run.sessionId,
  });
  await streamTurn(run, options, text);
}

/**
 * Send a follow-up from the operator: answer an open question, steer a running turn,
 * or resume a finished session. Returns which path was taken.
 */
export function sendMessage(run: Run, text: string): "answer" | "steer" | "resume" | "none" {
  const pendingQuestion = run.questions.keys().next().value as string | undefined;
  if (pendingQuestion) {
    answerQuestion(run, pendingQuestion, text);
    return "answer";
  }
  if (run.inputOpen && ACTIVE.includes(run.state)) {
    emit(run, "user_message", { text });
    run.input?.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
    return "steer";
  }
  if (run.sessionId) {
    resumeRun(run, text)
      .catch((err) => {
        if (!run.endedAt) {
          run.state = "error";
          run.error = String(err?.message ?? err);
          run.endedAt = Date.now();
          emit(run, "error", { message: run.error });
          notifyState(run, run.state);
        }
      })
      .finally(() => releaseExclusive(run.id));
    return "resume";
  }
  return "none";
}
