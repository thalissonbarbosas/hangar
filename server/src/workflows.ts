import { randomUUID } from "crypto";
import { getConfig, boardPaths } from "./config";
import { createWorktree, removeWorktree, Worktree } from "./worktree";
import { findSkill } from "./skills";
import { startRun, getRun, stopRun, Run, RunState } from "./sessions";
import { saveWorkflowRecord, deleteWorkflowRecord, loadWorkflowRecords } from "./store";
import { Ticket, WorkflowStep } from "./types";

// A board workflow is a sequential pipeline of agent/skill steps run on one ticket.
// All steps share a single engine-owned git worktree so each step sees the previous
// step's changes; the workflow auto-advances when a step finishes successfully and
// goes "red" (awaiting_input/error/stopped) when a step can't proceed on its own.

export type WorkflowStatus = "running" | "awaiting_input" | "done" | "error" | "stopped";
const ACTIVE: WorkflowStatus[] = ["running", "awaiting_input"];

export interface WorkflowRun {
  id: string;
  boardKey: string;
  workflowId: string;
  workflowName: string;
  ticket: Ticket; // kept for prompt context on each step (omitted from JSON view)
  ticketKey: string;
  ticketUrl?: string;
  ticketSummary?: string;
  steps: WorkflowStep[]; // snapshot at start
  stepIndex: number; // current step (0-based)
  runIds: string[]; // run id per launched step
  worktrees: Worktree[]; // engine-owned, shared across steps (omitted from JSON view)
  cwd: string;
  additionalDirectories: string[];
  branch?: string;
  status: WorkflowStatus;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

const workflowRuns = new Map<string, WorkflowRun>();

export function getWorkflowRun(id: string): WorkflowRun | undefined {
  return workflowRuns.get(id);
}

export function workflowRunToJson(wf: WorkflowRun) {
  const { worktrees, ticket, ...rest } = wf;
  return rest;
}

export function listWorkflowRuns() {
  return [...workflowRuns.values()]
    .sort((a, b) => {
      const aa = ACTIVE.includes(a.status) ? 0 : 1;
      const bb = ACTIVE.includes(b.status) ? 0 : 1;
      return aa - bb || b.startedAt - a.startedAt;
    })
    .map(workflowRunToJson);
}

function skillSourceFor(name: string): "user" | "repo" {
  return findSkill(getConfig(), name)?.source ?? "user";
}

const STEP_RESULT_LIMIT = 2000;

/** Compose the per-step prompt note: workflow context + the prior step's result + the step's own note. */
function stepNote(wf: WorkflowRun, step: WorkflowStep, prev?: Run): string {
  const lines: string[] = [
    `You are step ${wf.stepIndex + 1} of ${wf.steps.length} in the "${wf.workflowName}" workflow for ticket ${wf.ticketKey}.`,
  ];
  if (prev?.result?.trim()) {
    const raw = prev.result.trim();
    const result = raw.length > STEP_RESULT_LIMIT ? raw.slice(0, STEP_RESULT_LIMIT) + "…" : raw;
    lines.push(`\nThe previous step (${prev.agentName}) finished with this result:`);
    lines.push(result);
    lines.push(`\nThe repository working tree already contains that step's changes — build on them.`);
  }
  if (step.note?.trim()) {
    lines.push(`\nThis step's instruction: ${step.note.trim()}`);
  }
  return lines.join("\n");
}

function launchStep(wf: WorkflowRun): void {
  const step = wf.steps[wf.stepIndex];
  const prev = wf.stepIndex > 0 ? getRun(wf.runIds[wf.stepIndex - 1]) : undefined;
  const run = startRun({
    kind: step.kind,
    name: step.name,
    note: stepNote(wf, step, prev),
    ticket: wf.ticket,
    cwdOverride: wf.cwd,
    additionalDirsOverride: wf.additionalDirectories,
    skipWorktree: true,
    branch: wf.branch,
    skillSource: step.kind === "skill" ? skillSourceFor(step.name) : undefined,
  });
  wf.runIds[wf.stepIndex] = run.id;
  run.onState = (r, state) => handleStepState(wf.id, r.id, state);
  saveWorkflowRecord(wf);
}

function handleStepState(wfId: string, runId: string, state: RunState): void {
  const wf = workflowRuns.get(wfId);
  if (!wf || !ACTIVE.includes(wf.status)) return; // already terminal
  if (runId !== wf.runIds[wf.stepIndex]) return; // event from a stale step

  switch (state) {
    case "awaiting_input":
      wf.status = "awaiting_input"; // red — needs the operator
      saveWorkflowRecord(wf);
      return;
    case "queued":
    case "starting":
    case "running":
      if (wf.status === "awaiting_input") {
        wf.status = "running"; // resumed
        saveWorkflowRecord(wf);
      }
      return;
    case "done":
      advance(wf);
      return;
    case "error":
      wf.status = "error";
      wf.endedAt = Date.now();
      saveWorkflowRecord(wf);
      return;
    case "stopped":
      wf.status = "stopped";
      wf.endedAt = Date.now();
      saveWorkflowRecord(wf);
      return;
  }
}

function advance(wf: WorkflowRun): void {
  wf.stepIndex++;
  if (wf.stepIndex >= wf.steps.length) {
    wf.status = "done";
    wf.endedAt = Date.now();
    saveWorkflowRecord(wf);
    return; // worktree persists until the workflow run is deleted (so its branch can be inspected/PR'd)
  }
  wf.status = "running";
  launchStep(wf); // persists the new step
}

export async function startWorkflow(
  boardKey: string,
  workflowId: string,
  ticket: Ticket,
): Promise<WorkflowRun> {
  const cfg = getConfig();
  const board = cfg.boards.find((b) => b.key === boardKey);
  if (!board) throw new Error(`Unknown board: ${boardKey}`);
  const wf = (board.workflows ?? []).find((w) => w.id === workflowId);
  if (!wf) throw new Error(`Unknown workflow: ${workflowId}`);
  if (!wf.steps.length) throw new Error("Workflow has no steps");

  const paths = boardPaths(board);
  let cwd = paths[0] ?? process.cwd();
  let additionalDirectories = paths.slice(1);
  const worktrees: Worktree[] = [];
  let branch: string | undefined;

  // One shared worktree for the whole pipeline so each step builds on the last.
  if (cfg.isolateRuns ?? true) {
    const label = `${ticket.key}-${wf.name}`;
    const ns = randomUUID(); // worktree tmp-dir namespace for this workflow
    const primary = await createWorktree(cwd, label, ns);
    if (primary) {
      worktrees.push(primary);
      cwd = primary.path;
      branch = primary.branch;
    }
    const mapped: string[] = [];
    for (const d of additionalDirectories) {
      const w = await createWorktree(d, label, ns);
      if (w) {
        worktrees.push(w);
        mapped.push(w.path);
      } else {
        mapped.push(d);
      }
    }
    additionalDirectories = mapped;
  }

  const wfRun: WorkflowRun = {
    id: randomUUID(),
    boardKey,
    workflowId,
    workflowName: wf.name,
    ticket,
    ticketKey: ticket.key,
    ticketUrl: ticket.url,
    ticketSummary: ticket.summary,
    steps: wf.steps,
    stepIndex: 0,
    runIds: [],
    worktrees,
    cwd,
    additionalDirectories,
    branch,
    status: "running",
    startedAt: Date.now(),
  };
  workflowRuns.set(wfRun.id, wfRun);
  launchStep(wfRun);
  return wfRun;
}

export async function stopWorkflowRun(id: string): Promise<boolean> {
  const wf = workflowRuns.get(id);
  if (!wf) return false;
  if (ACTIVE.includes(wf.status)) {
    const cur = getRun(wf.runIds[wf.stepIndex]);
    if (cur) await stopRun(cur); // emits "stopped" → handleStepState marks the workflow stopped
    if (ACTIVE.includes(wf.status)) {
      wf.status = "stopped";
      wf.endedAt = Date.now();
      saveWorkflowRecord(wf);
    }
  }
  return true;
}

async function cleanup(wf: WorkflowRun): Promise<void> {
  for (const wt of wf.worktrees) await removeWorktree(wt);
  wf.worktrees = [];
}

export async function deleteWorkflowRun(id: string): Promise<boolean> {
  const wf = workflowRuns.get(id);
  if (!wf) return false;
  if (ACTIVE.includes(wf.status)) await stopWorkflowRun(id);
  await cleanup(wf);
  workflowRuns.delete(id);
  deleteWorkflowRecord(id);
  return true;
}

/** Remove workflow runs. 'finished' keeps active ones; 'all' stops and removes everything. */
export async function clearWorkflowRuns(scope: "finished" | "all"): Promise<number> {
  let n = 0;
  for (const wf of [...workflowRuns.values()]) {
    const active = ACTIVE.includes(wf.status);
    if (scope === "finished" && active) continue;
    if (active) await stopWorkflowRun(wf.id);
    await cleanup(wf);
    workflowRuns.delete(wf.id);
    deleteWorkflowRecord(wf.id);
    n++;
  }
  return n;
}

/** Load persisted workflow runs on startup; any mid-flight are marked stopped (their steps' processes are gone). */
export function loadPersistedWorkflowRuns(): void {
  for (const wf of loadWorkflowRecords()) {
    if (ACTIVE.includes(wf.status)) {
      wf.status = "stopped";
      wf.endedAt = wf.endedAt ?? Date.now();
      saveWorkflowRecord(wf);
    }
    workflowRuns.set(wf.id, wf);
  }
}
