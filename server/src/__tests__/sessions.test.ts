// ---- Mocks ----------------------------------------------------------------

// fs.existsSync — sessions.ts uses this to validate the working directory before spawning.
// Tests use fake paths that don't exist on disk, so we mock it to return true by default.
const existsSyncMock = jest.fn().mockReturnValue(true);
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
}));

// Controllable in-memory config swapped per test.
type Cfg = {
  agentsDir: string;
  boards: { key: string; name: string; statuses: string[]; repoPaths?: string[] }[];
  bypassPermissions?: boolean;
  isolateRuns?: boolean;
  exclusiveAgents?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
};
let mockCfg: Cfg;

jest.mock("../config", () => {
  const realPath = jest.requireActual("path");
  const realOs = jest.requireActual("os");
  const expandHome = (p: string) =>
    p === "~" ? realOs.homedir() : p.startsWith("~/") ? realPath.join(realOs.homedir(), p.slice(2)) : p;
  return {
    getConfig: () => mockCfg,
    expandHome,
    boardPaths: (board?: { repoPath?: string; repoPaths?: string[] }) => {
      if (!board) return [];
      const raw = board.repoPaths?.length ? board.repoPaths : board.repoPath ? [board.repoPath] : [];
      return raw.map(expandHome);
    },
  };
});

// Worktree mock — avoid real git.
const createWorktree = jest.fn();
const removeWorktree = jest.fn();
jest.mock("../worktree", () => ({
  createWorktree: (...a: unknown[]) => createWorktree(...a),
  removeWorktree: (...a: unknown[]) => removeWorktree(...a),
}));

// Agent loader mock.
const loadAgent = jest.fn();
jest.mock("../agents", () => ({ loadAgent: (...a: unknown[]) => loadAgent(...a) }));

// Store mock — in-memory, no real disk under the repo .hangar dir.
let storeRecords: Record<string, unknown>[] = [];
const savedRecords = new Map<string, Record<string, unknown>>();
jest.mock("../store", () => ({
  saveRunRecord: (r: Record<string, unknown>) => savedRecords.set(String(r.id), r),
  deleteRunRecord: (id: string) => savedRecords.delete(id),
  loadRunRecords: () => storeRecords,
}));

// SDK mock: query() returns an async iterable we control, plus an interrupt handle.
let sdkScript: unknown[] = [];
let holdOpen = false; // when true, the generator yields the script then waits (until interrupt)
let sdkThrow = false; // when true, the generator throws (simulates an SDK failure)
let lastQueryOptions: Record<string, unknown> | null = null;
let lastCanUseTool: ((tool: string, input: Record<string, unknown>) => Promise<unknown>) | null = null;
let releaseHold: (() => void) | null = null;
const interrupt = jest.fn(async () => {
  releaseHold?.();
});

jest.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    lastQueryOptions = options;
    lastCanUseTool = options.canUseTool as typeof lastCanUseTool;
    const hold = holdOpen;
    const shouldThrow = sdkThrow;
    async function* gen() {
      if (shouldThrow) throw new Error("sdk boom");
      for (const msg of sdkScript) yield msg;
      if (hold) await new Promise<void>((res) => (releaseHold = res));
    }
    const it = gen();
    return Object.assign(it, { interrupt });
  },
}));

import { Ticket } from "../types";
import * as sessions from "../sessions";

const ticket: Ticket = {
  key: "PP-1",
  summary: "Fix login",
  status: "To Do",
  assignee: "Alex",
  assigneeAvatar: null,
  issuetype: "Bug",
  priority: "High",
  boardKey: "PP",
  url: "https://x/browse/PP-1",
};

function baseCfg(over: Partial<Cfg> = {}): Cfg {
  return {
    agentsDir: "~/.claude/agents",
    boards: [{ key: "PP", name: "PracticePal", statuses: ["To Do"], repoPaths: ["/repo/a", "/repo/b"] }],
    bypassPermissions: true,
    isolateRuns: false,
    ...over,
  };
}

/** Resolve when the run reaches a terminal state. */
function waitForState(run: sessions.Run, ...states: sessions.RunState[]): Promise<void> {
  return new Promise((resolve) => {
    if (states.includes(run.state)) return resolve();
    run.listeners.add((e) => {
      if (e.kind === "state" && states.includes((e as unknown as { state: sessions.RunState }).state))
        resolve();
      if (["result", "error", "stopped"].includes(e.kind)) resolve();
    });
  });
}

const successScript = [
  { type: "system", subtype: "init", session_id: "sess-1", model: "claude-opus-4-8" },
  {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "hi" },
        {
          type: "tool_use",
          name: "TodoWrite",
          input: {
            todos: [
              { content: "Plan", status: "in_progress" },
              { content: "Do", status: "pending" },
            ],
          },
        },
      ],
    },
  },
  { type: "result", subtype: "success", result: "done", total_cost_usd: 0.01, session_id: "sess-1" },
];

beforeEach(() => {
  mockCfg = baseCfg();
  sdkScript = [...successScript];
  holdOpen = false;
  sdkThrow = false;
  releaseHold = null;
  lastQueryOptions = null;
  lastCanUseTool = null;
  existsSyncMock.mockReset().mockReturnValue(true); // fake paths don't exist on disk — assume valid
  createWorktree.mockReset().mockResolvedValue(null); // default: not a git repo → run in place
  removeWorktree.mockReset().mockResolvedValue(undefined);
  loadAgent.mockReset().mockReturnValue({
    name: "debugger",
    body: "Investigate carefully.",
    model: "opus",
    tools: [],
    description: "",
    sourcePath: "x",
  });
  interrupt.mockClear();
  storeRecords = [];
  savedRecords.clear();
});

afterEach(async () => {
  await sessions.clearRuns("all");
});

describe("pure helpers", () => {
  it("mapModel maps aliases and passes through", () => {
    expect(sessions.mapModel("opus")).toBe("claude-opus-4-8");
    expect(sessions.mapModel("SONNET")).toBe("claude-sonnet-4-6");
    expect(sessions.mapModel("haiku")).toBe("claude-haiku-4-5");
    expect(sessions.mapModel("full-id")).toBe("full-id");
    expect(sessions.mapModel(undefined)).toBeUndefined();
  });
});

describe("startRun — ticket-based, bypass mode, success", () => {
  it("streams events, derives phase, captures session/cost, ends done", async () => {
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(run, "done");
    expect(run.state).toBe("done");
    expect(run.sessionId).toBe("sess-1");
    expect(run.result).toBe("done");
    expect(run.costUsd).toBe(0.01);
    expect(run.cwd).toBe("/repo/a"); // first board path = cwd
    expect(run.additionalDirectories).toEqual(["/repo/b"]);
    expect(run.model).toBe("claude-opus-4-8");
    // phase derived from TodoWrite
    expect(run.events.some((e) => e.kind === "phase" && e.label === "Plan")).toBe(true);
    // complete assistant text emitted (not token-by-token)
    expect(run.events.some((e) => e.kind === "assistant_text" && e.text === "hi")).toBe(true);
    // no partial-token streaming
    expect(run.events.some((e) => e.kind === "assistant_delta")).toBe(false);
    // tool_use emitted
    expect(run.events.some((e) => e.kind === "tool_use" && e.tool === "TodoWrite")).toBe(true);
    // includePartialMessages is not set
    expect((lastQueryOptions as Record<string, unknown>).includePartialMessages).toBeUndefined();
    // system prompt built from agent body
    expect(String(lastQueryOptions!.systemPrompt)).toContain("Investigate carefully.");
    expect(lastQueryOptions!.permissionMode).toBe("bypassPermissions");
    // injected per-run env
    const env = lastQueryOptions!.env as Record<string, string>;
    expect(env.HANGAR_RUN_ID).toBe(run.id);
    expect(env.COMPOSE_PROJECT_NAME).toMatch(/^hangar-/);
  });
});

describe("startRun — standalone (no ticket)", () => {
  it("uses the provided cwd/title and the note as the task", async () => {
    const run = sessions.startRun({
      kind: "agent",
      name: "debugger",
      cwd: "/tmp/work",
      title: "Adhoc",
      note: "do X",
    });
    await waitForState(run, "done");
    expect(run.cwd).toBe("/tmp/work");
    expect(run.title).toBe("Adhoc");
    expect(run.ticketKey).toBe("");
  });

  it("defaults title for a skill run with no title", async () => {
    loadAgent.mockReturnValue(null);
    const run = sessions.startRun({ kind: "skill", name: "deploy", note: "ship", cwd: "/tmp/w" });
    await waitForState(run, "done");
    expect(run.title).toBe("skill: deploy");
    // skill runs set settingSources
    expect(lastQueryOptions!.settingSources).toEqual(["user"]);
  });
});

describe("worktree isolation", () => {
  it("creates worktrees for cwd + additional dirs when isolateRuns is on", async () => {
    mockCfg = baseCfg({ isolateRuns: true });
    createWorktree
      .mockResolvedValueOnce({ path: "/wt/a", branch: "hangar/PP-1-abc", repoRoot: "/repo/a" })
      .mockResolvedValueOnce({ path: "/wt/b", branch: "hangar/PP-1-def", repoRoot: "/repo/b" });
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(run, "done");
    expect(run.cwd).toBe("/wt/a");
    expect(run.branch).toBe("hangar/PP-1-abc");
    expect(run.worktrees).toHaveLength(2);
    expect(lastQueryOptions!.additionalDirectories).toEqual(["/wt/b"]);
  });

  it("falls back to running in place when cwd isn't a git repo", async () => {
    mockCfg = baseCfg({ isolateRuns: true });
    createWorktree.mockResolvedValue(null);
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(run, "done");
    expect(run.events.some((e) => e.kind === "info" && String(e.message).includes("running in place"))).toBe(
      true,
    );
  });
});

describe("gated permission mode", () => {
  it("auto-allows safe tools, prompts for a mutating Bash, and resolves allow", async () => {
    mockCfg = baseCfg({ bypassPermissions: false });
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s", model: "m" }]; // keep the turn open
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    expect(lastQueryOptions!.permissionMode).toBe("default");

    // Safe read tool auto-allows.
    expect(await lastCanUseTool!("Read", { file_path: "x" })).toEqual({
      behavior: "allow",
      updatedInput: { file_path: "x" },
    });
    // Safe bash auto-allows.
    expect(await lastCanUseTool!("Bash", { command: "ls -la" })).toMatchObject({ behavior: "allow" });

    // Mutating bash prompts: pending request created, state awaiting_input.
    const promise = lastCanUseTool!("Bash", { command: "rm -rf /tmp/x" });
    await new Promise((r) => setTimeout(r, 5));
    expect(run.state).toBe("awaiting_input");
    const reqEvent = run.events.find((e) => e.kind === "permission_request")!;
    const requestId = reqEvent.requestId as string;
    expect(sessions.resolvePermission(run, requestId, "allow")).toBe(true);
    expect(await promise).toMatchObject({ behavior: "allow" });
    expect(run.state).toBe("running"); // back to running after the only pending resolves
  });

  it("resolves deny and reports unknown request ids", async () => {
    mockCfg = baseCfg({ bypassPermissions: false });
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s", model: "m" }];
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    const promise = lastCanUseTool!("Bash", { command: "curl evil" });
    await new Promise((r) => setTimeout(r, 5));
    const requestId = run.events.find((e) => e.kind === "permission_request")!.requestId as string;
    expect(sessions.resolvePermission(run, "bogus", "allow")).toBe(false);
    sessions.resolvePermission(run, requestId, "deny");
    expect(await promise).toMatchObject({ behavior: "deny" });
  });
});

describe("AskUserQuestion handling", () => {
  it("surfaces the question, waits, and delivers the answer back", async () => {
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s", model: "m" }];
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    const promise = lastCanUseTool!("AskUserQuestion", {
      questions: [
        {
          question: "Bump?",
          header: "engines",
          multiSelect: false,
          options: [{ label: "Yes", description: "do it" }, { label: "No" }],
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(run.state).toBe("awaiting_input");
    expect(run.events.some((e) => e.kind === "question")).toBe(true);
    // sendMessage with an open question goes the "answer" path.
    expect(sessions.sendMessage(run, "Yes, bump to >=22")).toBe("answer");
    expect(await promise).toEqual({ behavior: "deny", message: "Yes, bump to >=22" });
    expect(run.state).toBe("running");
    // answerQuestion on an unknown id returns false
    expect(sessions.answerQuestion(run, "nope", "x")).toBe(false);
  });
});

describe("sendMessage — steer & resume", () => {
  it("steers a running turn by pushing into the input queue", async () => {
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s", model: "m" }]; // stays open (no result)
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    expect(run.inputOpen).toBe(true);
    expect(sessions.sendMessage(run, "also check logout")).toBe("steer");
    expect(run.events.some((e) => e.kind === "user_message" && e.text === "also check logout")).toBe(true);
  });

  it("resumes a finished session with the SDK resume option", async () => {
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(run, "done");
    sdkScript = [
      { type: "system", subtype: "init", session_id: "sess-1", model: "m" },
      { type: "result", subtype: "success", result: "more done", total_cost_usd: 0.02, session_id: "sess-1" },
    ];
    const resumed = new Promise<void>((res) => run.listeners.add((e) => e.kind === "result" && res()));
    expect(sessions.sendMessage(run, "follow up")).toBe("resume");
    await resumed;
    expect(lastQueryOptions!.resume).toBe("sess-1");
    expect(run.result).toBe("more done");
  });

  it("returns none when there's no open session and no sessionId", async () => {
    const run = sessions.startRun({ kind: "agent", name: "debugger", cwd: "/tmp", note: "x" });
    await waitForState(run, "done");
    run.sessionId = undefined; // simulate no resumable session
    expect(sessions.sendMessage(run, "hi")).toBe("none");
  });
});

describe("error path", () => {
  it("marks the run errored when a non-success result arrives", async () => {
    sdkScript = [
      { type: "system", subtype: "init", session_id: "s", model: "m" },
      { type: "result", subtype: "error_max_turns", total_cost_usd: 0.5, session_id: "s" },
    ];
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(run, "error", "done");
    expect(run.state).toBe("error");
    expect(run.error).toMatch(/error_max_turns/);
  });

  it("marks the run errored when the SDK throws", async () => {
    sdkThrow = true;
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(run, "error", "done");
    expect(run.state).toBe("error");
    expect(run.error).toMatch(/sdk boom/);
  });
});

describe("stopRun", () => {
  it("interrupts a running session and marks it stopped", async () => {
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s", model: "m" }];
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    await sessions.stopRun(run);
    expect(interrupt).toHaveBeenCalled();
    expect(run.stopRequested).toBe(true);
    expect(run.events.some((e) => e.kind === "info" && String(e.message).includes("Stop requested"))).toBe(
      true,
    );
  });
});

describe("listRuns / runToJson / getRun", () => {
  it("lists runs with active ones first and exposes pending/event counts", async () => {
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(run, "done");
    const list = sessions.listRuns();
    expect(list.length).toBe(1);
    expect(list[0]).toHaveProperty("eventCount");
    const withEvents = sessions.runToJson(sessions.getRun(run.id)!, true);
    expect(withEvents).toHaveProperty("events");
    expect(withEvents).toHaveProperty("pendingCount", 0);
  });
});

describe("deleteRun / clearRuns", () => {
  it("deleteRun stops an active run, cleans worktrees, removes it", async () => {
    mockCfg = baseCfg({ isolateRuns: true });
    createWorktree.mockResolvedValueOnce({ path: "/wt/a", branch: "b", repoRoot: "/repo/a" });
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s", model: "m" }];
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    expect(await sessions.deleteRun(run.id)).toBe(true);
    expect(removeWorktree).toHaveBeenCalled();
    expect(sessions.getRun(run.id)).toBeUndefined();
    expect(await sessions.deleteRun("ghost")).toBe(false);
  });

  it("clearRuns('finished') keeps active runs", async () => {
    const done = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(done, "done");
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s", model: "m" }];
    const active = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    const cleared = await sessions.clearRuns("finished");
    expect(cleared).toBe(1);
    expect(sessions.getRun(active.id)).toBeDefined();
    expect(sessions.getRun(done.id)).toBeUndefined();
  });
});

describe("seedDemoRuns & loadPersistedRuns", () => {
  it("seedDemoRuns loads fictional runs idempotently", () => {
    process.env.HANGAR_DEMO = "1";
    sessions.seedDemoRuns();
    sessions.seedDemoRuns(); // idempotent
    const list = sessions.listRuns();
    expect(list.find((r) => (r as { id: string }).id === "demo-run-done")).toBeDefined();
    delete process.env.HANGAR_DEMO;
  });
});

describe("exclusive queue", () => {
  it("queues a second exclusive run, then launches it when the first finishes", async () => {
    mockCfg = baseCfg({ exclusiveAgents: ["debugger"] });
    // First run holds the lock; keep it open until we manually finish.
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s1", model: "m" }];
    const first = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    expect(first.state).toBe("running");

    // Second exclusive run is queued (the first hasn't released).
    const second = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    expect(second.state).toBe("queued");
    expect(second.events.some((e) => e.kind === "info" && String(e.message).includes("Queued"))).toBe(true);

    // Finish the first; the queued one should launch (its drive() runs the default success script).
    sdkScript = [...successScript];
    await sessions.stopRun(first);
    await waitForState(second, "done", "running");
    await new Promise((r) => setTimeout(r, 10));
    expect(second.state === "running" || second.state === "done").toBe(true);
  });

  it("stopRun on a queued run just drops it from the queue", async () => {
    mockCfg = baseCfg({ exclusiveAgents: ["debugger"] });
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s1", model: "m" }];
    const first = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    const queued = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    expect(queued.state).toBe("queued");
    await sessions.stopRun(queued);
    expect(queued.state).toBe("stopped");
    await sessions.stopRun(first);
  });
});

describe("handoff (parentRunId)", () => {
  it("reuses the parent's working context", async () => {
    const parent = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(parent, "done");
    const child = sessions.startRun({ kind: "agent", name: "reviewer", parentRunId: parent.id });
    await waitForState(child, "done");
    expect(child.parentRunId).toBe(parent.id);
    expect(child.ticketKey).toBe("PP-1");
    expect(child.cwd).toBe(parent.cwd);
  });

  it("reuses the parent's worktree when the parent was isolated (no new branch created)", async () => {
    mockCfg = baseCfg({ isolateRuns: true });
    createWorktree
      .mockResolvedValueOnce({ path: "/wt/a", branch: "hangar/PP-1-abc", repoRoot: "/repo/a" })
      .mockResolvedValueOnce({ path: "/wt/b", branch: "hangar/PP-1-def", repoRoot: "/repo/b" });
    const parent = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(parent, "done");
    createWorktree.mockClear();

    const child = sessions.startRun({ kind: "agent", name: "reviewer", parentRunId: parent.id });
    await waitForState(child, "done");

    // No new worktree should have been created for the child.
    expect(createWorktree).not.toHaveBeenCalled();
    expect(child.skipWorktree).toBe(true);
    expect(child.branch).toBe("hangar/PP-1-abc");
    expect(child.cwd).toBe("/wt/a");
    // Additional dirs come from parent.runtimeDirs (the mapped worktree paths).
    expect(child.additionalDirectories).toEqual(["/wt/b"]);
  });
});

describe("missing working directory", () => {
  it("errors the run immediately when cwd doesn't exist", async () => {
    existsSyncMock.mockReturnValue(false);
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(run, "error");
    expect(run.state).toBe("error");
    expect(run.error).toMatch(/does not exist/);
  });
});

describe("cwdOverride (workflow step)", () => {
  it("runs in an explicit working tree without creating a worktree", async () => {
    mockCfg = baseCfg({ isolateRuns: true });
    const run = sessions.startRun({
      kind: "agent",
      name: "debugger",
      ticket,
      cwdOverride: "/engine/wt",
      additionalDirsOverride: ["/engine/wt2"],
      skipWorktree: true,
      branch: "hangar/engine",
    });
    await waitForState(run, "done");
    expect(run.cwd).toBe("/engine/wt");
    expect(createWorktree).not.toHaveBeenCalled();
    expect(run.branch).toBe("hangar/engine");
  });

  it("standalone cwdOverride with no ticket gets a default title", async () => {
    const run = sessions.startRun({
      kind: "skill",
      name: "deploy",
      cwdOverride: "/engine/wt",
      skipWorktree: true,
      note: "x",
    });
    await waitForState(run, "done");
    expect(run.title).toBe("skill: deploy");
  });
});

describe("buildOptions limits & bypass canUseTool", () => {
  it("passes maxTurns and maxBudgetUsd through, and auto-allows tools in bypass mode", async () => {
    mockCfg = baseCfg({ maxTurns: 50, maxBudgetUsd: 2 });
    holdOpen = true;
    sdkScript = [{ type: "system", subtype: "init", session_id: "s", model: "m" }];
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await new Promise((r) => setTimeout(r, 10));
    expect(lastQueryOptions!.maxTurns).toBe(50);
    expect(lastQueryOptions!.maxBudgetUsd).toBe(2);
    // bypass canUseTool: a normal tool auto-allows; AskUserQuestion routes to the prompt.
    expect(await lastCanUseTool!("Bash", { command: "rm x" })).toEqual({
      behavior: "allow",
      updatedInput: { command: "rm x" },
    });
    await sessions.stopRun(run);
  });
});

describe("detectPr", () => {
  it("captures a GitHub PR url that appears in the result text", async () => {
    sdkScript = [
      { type: "system", subtype: "init", session_id: "s", model: "m" },
      {
        type: "result",
        subtype: "success",
        result: "Opened https://github.com/acme/repo/pull/7",
        total_cost_usd: 0.01,
        session_id: "s",
      },
    ];
    const run = sessions.startRun({ kind: "agent", name: "debugger", ticket });
    await waitForState(run, "done");
    expect(run.prUrl).toBe("https://github.com/acme/repo/pull/7");
    expect(run.events.some((e) => e.kind === "pr")).toBe(true);
  });
});

describe("loadPersistedRuns", () => {
  it("restores saved runs and marks mid-flight ones stopped", () => {
    storeRecords = [
      {
        id: "persisted-active",
        ticketKey: "PP-9",
        agentName: "debugger",
        kind: "agent",
        model: "m",
        cwd: "/x",
        state: "running",
        startedAt: 1,
        events: [{ seq: 100, ts: 1, kind: "info" }],
      },
      {
        id: "persisted-done",
        ticketKey: "PP-8",
        agentName: "debugger",
        kind: "agent",
        model: "m",
        cwd: "/x",
        state: "done",
        startedAt: 1,
        events: [],
      },
    ];
    sessions.loadPersistedRuns();
    const active = sessions.getRun("persisted-active")!;
    expect(active.state).toBe("stopped"); // mid-flight → stopped on restart
    expect(active.events.some((e) => e.kind === "stopped")).toBe(true);
    expect(sessions.getRun("persisted-done")!.state).toBe("done");
  });
});
