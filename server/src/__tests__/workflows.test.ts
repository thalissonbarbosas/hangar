import { Ticket } from "../types";
import type { Run, RunState } from "../sessions";

// ---- Mocks ----------------------------------------------------------------

type Cfg = {
  agentsDir: string;
  boards: {
    key: string;
    name: string;
    statuses: string[];
    repoPaths?: string[];
    workflows?: {
      id: string;
      name: string;
      steps: { name: string; kind: "agent" | "skill"; note?: string }[];
    }[];
  }[];
  isolateRuns?: boolean;
};
let mockCfg: Cfg;
jest.mock("../config", () => ({
  getConfig: () => mockCfg,
  boardPaths: (b?: { repoPaths?: string[]; repoPath?: string }) =>
    b?.repoPaths?.length ? b.repoPaths : b?.repoPath ? [b.repoPath] : [],
}));

const createWorktree = jest.fn();
const removeWorktree = jest.fn();
jest.mock("../worktree", () => ({
  createWorktree: (...a: unknown[]) => createWorktree(...a),
  removeWorktree: (...a: unknown[]) => removeWorktree(...a),
}));

jest.mock("../skills", () => ({ findSkill: () => ({ source: "user" }) }));

// Persistence captured in-memory.
const saved: unknown[] = [];
const deleted: string[] = [];
jest.mock("../store", () => ({
  saveWorkflowRecord: (r: unknown) => saved.push(r),
  deleteWorkflowRecord: (id: string) => deleted.push(id),
  loadWorkflowRecords: () => loadRecordsImpl(),
}));
let loadRecordsImpl: () => unknown[] = () => [];

// Sessions mock: startRun returns a fake Run; we capture onState to drive step transitions.
const fakeRuns = new Map<string, Run>();
const startRun = jest.fn((opts: Record<string, unknown>) => {
  const id = `run-${fakeRuns.size + 1}`;
  const run = { id, agentName: String(opts.name), result: "", onState: undefined } as unknown as Run;
  fakeRuns.set(id, run);
  return run;
});
const getRun = jest.fn((id: string) => fakeRuns.get(id));
const stopRun = jest.fn(async (run: Run) => {
  run.onState?.(run, "stopped");
});
jest.mock("../sessions", () => ({
  startRun: (...a: unknown[]) => (startRun as (...x: unknown[]) => unknown)(...a),
  getRun: (...a: unknown[]) => (getRun as (...x: unknown[]) => unknown)(...a),
  stopRun: (...a: unknown[]) => (stopRun as (...x: unknown[]) => unknown)(...a),
}));

import * as workflows from "../workflows";

const ticket: Ticket = {
  key: "PP-1",
  summary: "Fix login",
  status: "To Do",
  assignee: null,
  assigneeAvatar: null,
  issuetype: "Bug",
  priority: "High",
  boardKey: "PP",
  url: "https://x/browse/PP-1",
};

function cfgWith(steps: { name: string; kind: "agent" | "skill"; note?: string }[], isolate = false): Cfg {
  return {
    agentsDir: "~/x",
    isolateRuns: isolate,
    boards: [
      {
        key: "PP",
        name: "PracticePal",
        statuses: ["To Do"],
        repoPaths: ["/repo/a"],
        workflows: [{ id: "wf1", name: "Build & Ship", steps }],
      },
    ],
  };
}

/** Drive the current step's run to a state (invokes the onState observer the engine registered). */
function emitStep(wf: workflows.WorkflowRun, state: RunState, result = ""): void {
  const runId = wf.runIds[wf.stepIndex];
  const run = fakeRuns.get(runId);
  if (!run) return; // workflow already past its last step
  run.result = result;
  run.onState?.(run, state);
}

beforeEach(() => {
  mockCfg = cfgWith([
    { name: "debugger", kind: "agent" },
    { name: "deploy", kind: "skill", note: "ship it" },
  ]);
  saved.length = 0;
  deleted.length = 0;
  loadRecordsImpl = () => [];
  fakeRuns.clear();
  startRun.mockClear();
  getRun.mockClear();
  stopRun.mockClear();
  createWorktree.mockReset().mockResolvedValue(null);
  removeWorktree.mockReset().mockResolvedValue(undefined);
});

// workflowRuns is a module-level singleton — clear it so counts don't leak between tests.
afterEach(async () => {
  await workflows.clearWorkflowRuns("all");
});

describe("startWorkflow", () => {
  it("validates board/workflow/steps", async () => {
    await expect(workflows.startWorkflow("NOPE", "wf1", ticket)).rejects.toThrow(/Unknown board/);
    await expect(workflows.startWorkflow("PP", "ghost", ticket)).rejects.toThrow(/Unknown workflow/);
    mockCfg = cfgWith([]);
    await expect(workflows.startWorkflow("PP", "wf1", ticket)).rejects.toThrow(/no steps/);
  });

  it("launches the first step and persists", async () => {
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    expect(wf.status).toBe("running");
    expect(wf.stepIndex).toBe(0);
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(startRun.mock.calls[0][0]).toMatchObject({ kind: "agent", name: "debugger", skipWorktree: true });
    expect(saved.length).toBeGreaterThan(0);
  });

  it("creates a shared worktree when isolateRuns is on", async () => {
    mockCfg = cfgWith([{ name: "debugger", kind: "agent" }], true);
    createWorktree.mockResolvedValueOnce({ path: "/wt", branch: "hangar/eng", repoRoot: "/repo/a" });
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    expect(wf.cwd).toBe("/wt");
    expect(wf.branch).toBe("hangar/eng");
    expect(wf.worktrees).toHaveLength(1);
  });

  it("maps each additional dir to a worktree, falling back when not a git repo", async () => {
    mockCfg = cfgWith([{ name: "debugger", kind: "agent" }], true);
    mockCfg.boards[0].repoPaths = ["/repo/a", "/repo/b", "/repo/c"];
    createWorktree
      .mockResolvedValueOnce({ path: "/wt/a", branch: "b", repoRoot: "/repo/a" }) // primary
      .mockResolvedValueOnce({ path: "/wt/b", branch: "b2", repoRoot: "/repo/b" }) // additional → worktree
      .mockResolvedValueOnce(null); // additional → not a git repo, kept as-is
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    expect(wf.additionalDirectories).toEqual(["/wt/b", "/repo/c"]);
    expect(wf.worktrees).toHaveLength(2);
  });

  it("starts a skill step (skillSourceFor) without throwing", async () => {
    mockCfg = cfgWith([{ name: "deploy", kind: "skill" }]);
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    expect(startRun.mock.calls[0][0]).toMatchObject({ kind: "skill", name: "deploy", skillSource: "user" });
    expect(wf.status).toBe("running");
  });
});

describe("step advancement", () => {
  it("advances to the next step on 'done', then completes after the last step", async () => {
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    emitStep(wf, "done", "step 1 result");
    expect(wf.stepIndex).toBe(1);
    expect(wf.status).toBe("running");
    expect(startRun).toHaveBeenCalledTimes(2);
    // The second step's note carries the prior step's result.
    expect(String(startRun.mock.calls[1][0].note)).toContain("step 1 result");

    emitStep(wf, "done", "step 2 result");
    expect(wf.stepIndex).toBe(2);
    expect(wf.status).toBe("done");
    expect(wf.endedAt).toBeDefined();
  });

  it("goes awaiting_input (red) and back to running when the step resumes", async () => {
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    emitStep(wf, "awaiting_input");
    expect(wf.status).toBe("awaiting_input");
    emitStep(wf, "running");
    expect(wf.status).toBe("running");
  });

  it("marks the workflow errored on a step error", async () => {
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    emitStep(wf, "error");
    expect(wf.status).toBe("error");
    expect(wf.endedAt).toBeDefined();
  });

  it("marks the workflow stopped on a step stopped", async () => {
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    emitStep(wf, "stopped");
    expect(wf.status).toBe("stopped");
  });

  it("ignores state events from a stale step or after terminal", async () => {
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    emitStep(wf, "done", "r1"); // now on step 2
    const staleRun = fakeRuns.get(wf.runIds[0])!;
    staleRun.onState?.(staleRun, "error"); // stale: belongs to step 0, ignored
    expect(wf.status).toBe("running");
    emitStep(wf, "done", "r2"); // complete
    expect(wf.status).toBe("done");
    emitStep(wf, "error"); // after terminal — ignored (would throw if not guarded; status stays done)
    expect(wf.status).toBe("done");
  });
});

describe("list / get / stop / delete / clear", () => {
  it("lists active workflows first and getWorkflowRun fetches by id", async () => {
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    expect(workflows.getWorkflowRun(wf.id)).toBe(wf);
    const list = workflows.listWorkflowRuns();
    expect(list[0]).not.toHaveProperty("worktrees"); // JSON view omits live handles
    expect(list[0]).not.toHaveProperty("ticket");
    expect(list[0]).toMatchObject({ id: wf.id, status: "running" });
  });

  it("stopWorkflowRun stops the current step's run", async () => {
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    expect(await workflows.stopWorkflowRun(wf.id)).toBe(true);
    expect(stopRun).toHaveBeenCalled();
    expect(wf.status).toBe("stopped"); // stopRun's mock emits "stopped"
    expect(await workflows.stopWorkflowRun("ghost")).toBe(false);
  });

  it("stopWorkflowRun forces stopped even if no current run", async () => {
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    getRun.mockReturnValueOnce(undefined); // no current run found
    await workflows.stopWorkflowRun(wf.id);
    expect(wf.status).toBe("stopped");
  });

  it("deleteWorkflowRun stops, cleans worktrees, removes", async () => {
    mockCfg = cfgWith([{ name: "debugger", kind: "agent" }], true);
    createWorktree.mockResolvedValueOnce({ path: "/wt", branch: "b", repoRoot: "/repo/a" });
    const wf = await workflows.startWorkflow("PP", "wf1", ticket);
    expect(await workflows.deleteWorkflowRun(wf.id)).toBe(true);
    expect(removeWorktree).toHaveBeenCalled();
    expect(workflows.getWorkflowRun(wf.id)).toBeUndefined();
    expect(deleted).toContain(wf.id);
    expect(await workflows.deleteWorkflowRun("ghost")).toBe(false);
  });

  it("clearWorkflowRuns('finished') keeps active; 'all' removes everything", async () => {
    const active = await workflows.startWorkflow("PP", "wf1", ticket);
    const finished = await workflows.startWorkflow("PP", "wf1", ticket);
    emitStep(finished, "done", "r1");
    emitStep(finished, "done", "r2"); // → done
    expect(await workflows.clearWorkflowRuns("finished")).toBe(1);
    expect(workflows.getWorkflowRun(active.id)).toBeDefined();
    expect(workflows.getWorkflowRun(finished.id)).toBeUndefined();
    expect(await workflows.clearWorkflowRuns("all")).toBe(1);
    expect(workflows.getWorkflowRun(active.id)).toBeUndefined();
  });
});

describe("loadPersistedWorkflowRuns", () => {
  it("marks mid-flight workflows stopped on load", () => {
    loadRecordsImpl = () => [
      {
        id: "wf-a",
        boardKey: "PP",
        status: "running",
        startedAt: 1,
        steps: [],
        runIds: [],
        stepIndex: 0,
        worktrees: [],
      },
      {
        id: "wf-b",
        boardKey: "PP",
        status: "done",
        startedAt: 1,
        steps: [],
        runIds: [],
        stepIndex: 0,
        worktrees: [],
      },
    ];
    workflows.loadPersistedWorkflowRuns();
    expect(workflows.getWorkflowRun("wf-a")!.status).toBe("stopped");
    expect(workflows.getWorkflowRun("wf-b")!.status).toBe("done");
  });
});
