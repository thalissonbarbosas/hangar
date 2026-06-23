import fs from "fs";
import os from "os";
import path from "path";

// Non-demo mode with a real (temp) config file + configured Jira creds, and a mocked global.fetch,
// so we can exercise index.ts's Jira-backed routes and their error branches.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-idxj-"));
const configPath = path.join(tmpDir, "hangar.config.json");
fs.writeFileSync(
  configPath,
  JSON.stringify({
    agentsDir: "~/.claude/agents",
    boards: [{ key: "PP", name: "PracticePal", statuses: ["To Do", "In Progress"], repoPaths: ["/repo/a"] }],
  }),
);

process.env.CONFIG_PATH = configPath;
process.env.HANGAR_DATA_DIR = path.join(tmpDir, "data");
delete process.env.HANGAR_DEMO;
process.env.JIRA_BASE_URL = "https://x.atlassian.net";
process.env.JIRA_EMAIL = "a@b.com";
process.env.JIRA_API_TOKEN = "tok";

jest.mock("../agents", () => {
  const actual = jest.requireActual("../agents");
  return { ...actual, loadAgents: jest.fn(() => []), loadAgent: jest.fn(() => null) };
});
jest.mock("../skills", () => {
  const actual = jest.requireActual("../skills");
  return {
    ...actual,
    allSkills: jest.fn(() => []),
    findSkill: jest.fn(() => undefined),
    skillExists: jest.fn(() => false),
  };
});
jest.mock("../worktree", () => ({
  createWorktree: jest.fn(async () => null),
  removeWorktree: jest.fn(async () => {}),
  sanitize: jest.requireActual("../worktree").sanitize,
}));

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}
function errResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}), text: async () => "boom" } as Response;
}

import request from "supertest";
import { app } from "../index";
import { createWorktree } from "../worktree";
import * as aiwf from "../aiwf";
import * as skillsMod from "../skills";
import * as cfgMod from "../config";
import * as agentsMod from "../agents";

const createWorktreeMock = createWorktree as unknown as jest.Mock;

describe("health reports configured Jira", () => {
  it("GET /api/health → jiraConfigured true", async () => {
    const res = await request(app).get("/api/health");
    expect(res.body.jiraConfigured).toBe(true);
  });
});

describe("jira discovery routes (configured)", () => {
  it("GET /api/jira/projects returns projects", async () => {
    fetchMock.mockResolvedValue(okJson({ values: [{ key: "PP", name: "PracticePal" }] }));
    const res = await request(app).get("/api/jira/projects");
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([{ key: "PP", name: "PracticePal" }]);
  });

  it("GET /api/jira/projects → 502 on Jira error", async () => {
    fetchMock.mockResolvedValue(errResponse(500));
    expect((await request(app).get("/api/jira/projects")).status).toBe(502);
  });

  it("GET /api/jira/statuses requires the project param (400)", async () => {
    expect((await request(app).get("/api/jira/statuses")).status).toBe(400);
  });

  it("GET /api/jira/statuses returns statuses", async () => {
    fetchMock.mockResolvedValue(okJson([{ statuses: [{ name: "To Do" }, { name: "Done" }] }]));
    const res = await request(app).get("/api/jira/statuses?project=PP");
    expect(res.body.statuses).toEqual(["To Do", "Done"]);
  });

  it("GET /api/jira/statuses → 502 on error", async () => {
    fetchMock.mockResolvedValue(errResponse(403));
    expect((await request(app).get("/api/jira/statuses?project=PP")).status).toBe(502);
  });

  it("POST /api/jira/test → ok true with creds from body", async () => {
    fetchMock.mockResolvedValue(okJson({ displayName: "Alex" }));
    const res = await request(app)
      .post("/api/jira/test")
      .send({ baseUrl: "https://y/", email: "e", token: "t" });
    expect(res.body).toEqual({ ok: true, displayName: "Alex" });
  });

  it("POST /api/jira/test → ok false on connection error", async () => {
    fetchMock.mockResolvedValue(errResponse(401));
    const res = await request(app).post("/api/jira/test").send({});
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/Jira 401/);
  });
});

describe("tickets (configured)", () => {
  it("GET /api/tickets fetches from Jira", async () => {
    fetchMock.mockResolvedValue(okJson({ issues: [{ key: "PP-1", fields: { summary: "s" } }] }));
    const res = await request(app).get("/api/tickets");
    expect(res.status).toBe(200);
    expect(res.body.tickets[0].key).toBe("PP-1");
  });

  it("GET /api/tickets → 400 for no matching boards", async () => {
    const res = await request(app).get("/api/tickets?boards=NOPE");
    expect(res.status).toBe(400);
  });

  it("GET /api/tickets → 502 on Jira error", async () => {
    fetchMock.mockResolvedValue(errResponse(500));
    expect((await request(app).get("/api/tickets?boards=PP")).status).toBe(502);
  });
});

describe("transition (configured)", () => {
  it("requires a status (400)", async () => {
    const res = await request(app).post("/api/tickets/PP-1/transition").send({});
    expect(res.status).toBe(400);
  });

  it("transitions successfully", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ transitions: [{ id: "1", name: "Go", to: { name: "Done" } }] }))
      .mockResolvedValueOnce(okJson({}));
    const res = await request(app).post("/api/tickets/PP-1/transition").send({ status: "Done" });
    expect(res.body).toEqual({ ok: true });
  });

  it("→ 502 when no legal transition", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ transitions: [] }));
    expect((await request(app).post("/api/tickets/PP-1/transition").send({ status: "X" })).status).toBe(502);
  });
});

describe("config write errors", () => {
  it("PUT /api/config → 400 on invalid config", async () => {
    const res = await request(app).put("/api/config").send({ agentsDir: "x", boards: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/board/);
  });
});

// Delivery-skill task-worktree wiring on the Jira /api/runs route.
// Skills return 404 in this file's global mock, so we temporarily override skillExists here.
describe("POST /api/runs — delivery skill task worktrees for Jira tickets", () => {
  const ticket = { key: "PP-1", boardKey: "PP", summary: "Test ticket", source: "jira" };

  const skillExistsMock = skillsMod.skillExists as jest.Mock;
  const findSkillMock = skillsMod.findSkill as jest.Mock;
  const loadAgentMock = agentsMod.loadAgent as jest.Mock;

  beforeEach(() => {
    createWorktreeMock.mockClear();
    // The board "PP" has repoPaths: ["/repo/a"] — resolveCardWorktree will try to create a worktree.
    // Override skillExists so delivery skill runs are not rejected.
    skillExistsMock.mockReturnValue(true);
    findSkillMock.mockReturnValue({ name: "feature", description: "", sourcePath: "", source: "user" });
    aiwf.clearCardState("jira-PP", "PP-1");
  });
  afterEach(() => {
    jest.restoreAllMocks();
    // Reset jest.fn() mocks back to their factory defaults.
    skillExistsMock.mockReturnValue(false);
    findSkillMock.mockReturnValue(undefined);
    loadAgentMock.mockReturnValue(null);
    aiwf.clearCardState("jira-PP", "PP-1");
  });

  it("creates a task worktree on first delivery skill run for a Jira ticket", async () => {
    createWorktreeMock.mockResolvedValueOnce({
      path: "/tmp/mock-jira-wt",
      branch: "feat/pp-1",
      repoRoot: "/repo/a",
    });
    const res = await request(app).post("/api/runs").send({ ticket, name: "feature", kind: "skill" });
    expect(res.status).toBe(200);
    expect(typeof res.body.runId).toBe("string");
    expect(createWorktreeMock).toHaveBeenCalledWith(
      "/repo/a",
      "feat/pp-1",
      expect.any(String),
      expect.objectContaining({ branchName: "feat/pp-1", baseBranch: "main" }),
    );
    expect(aiwf.getCardState("jira-PP", "PP-1")?.taskBranch).toBe("feat/pp-1");
  });

  it("reuses the stored worktree on a second delivery skill run", async () => {
    // Seed state with a path that exists on disk (tmpDir from the outer scope does exist).
    aiwf.setCardState("jira-PP", "PP-1", { taskBranch: "feat/pp-1", worktreePath: tmpDir });
    const res = await request(app).post("/api/runs").send({ ticket, name: "commit", kind: "skill" });
    expect(res.status).toBe(200);
    // Stored path exists → no createWorktree call.
    expect(createWorktreeMock).not.toHaveBeenCalled();
  });

  it("falls through to isolateRuns path when worktree creation fails", async () => {
    // createWorktree returns null (git error) → run proceeds without task worktree.
    createWorktreeMock.mockResolvedValueOnce(null);
    const res = await request(app).post("/api/runs").send({ ticket, name: "feature", kind: "skill" });
    expect(res.status).toBe(200); // does not 503 — falls through gracefully
    expect(aiwf.getCardState("jira-PP", "PP-1")).toBeNull();
  });

  it("does not create a task worktree for non-delivery skills", async () => {
    findSkillMock.mockReturnValue({ name: "roadmap", description: "", sourcePath: "", source: "user" });
    const res = await request(app).post("/api/runs").send({ ticket, name: "roadmap", kind: "skill" });
    expect(res.status).toBe(200);
    // createWorktree not called via delivery path (may be called by isolateRuns, but not with branchName).
    const deliveryCalls = createWorktreeMock.mock.calls.filter(
      (c: unknown[]) => (c[3] as { branchName?: string } | undefined)?.branchName,
    );
    expect(deliveryCalls).toHaveLength(0);
    expect(aiwf.getCardState("jira-PP", "PP-1")).toBeNull();
  });

  it("does not create a task worktree when isolateRuns is false", async () => {
    const spy = jest
      .spyOn(cfgMod, "getConfig")
      .mockReturnValue({ ...cfgMod.getConfig(), isolateRuns: false });
    try {
      createWorktreeMock.mockClear();
      const res = await request(app).post("/api/runs").send({ ticket, name: "feature", kind: "skill" });
      expect(res.status).toBe(200);
      // isolateRuns: false → delivery-path block skipped; no branchName-based createWorktree call.
      const deliveryCalls = createWorktreeMock.mock.calls.filter(
        (c: unknown[]) => (c[3] as { branchName?: string } | undefined)?.branchName,
      );
      expect(deliveryCalls).toHaveLength(0);
      expect(aiwf.getCardState("jira-PP", "PP-1")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("does not create a task worktree for an agent run on a Jira ticket", async () => {
    loadAgentMock.mockReturnValueOnce({
      name: "my-agent",
      description: "test agent",
      tools: [],
      sourcePath: "/tmp/my-agent.md",
      body: "",
    });
    createWorktreeMock.mockClear();
    const res = await request(app).post("/api/runs").send({ ticket, name: "my-agent", kind: "agent" });
    expect(res.status).toBe(200);
    // Agent kind bypasses the delivery-skill block entirely.
    const deliveryCalls = createWorktreeMock.mock.calls.filter(
      (c: unknown[]) => (c[3] as { branchName?: string } | undefined)?.branchName,
    );
    expect(deliveryCalls).toHaveLength(0);
    expect(aiwf.getCardState("jira-PP", "PP-1")).toBeNull();
  });
});

describe("Jira worktree management routes", () => {
  const boardKey = "PP";
  const cardKey = "PP-42";
  const ctxId = `jira-${boardKey}`;
  afterEach(() => aiwf.clearCardState(ctxId, cardKey));

  it("GET /api/jira/boards/:boardKey/worktrees returns empty list when no state exists", async () => {
    const res = await request(app).get(`/api/jira/boards/${boardKey}/worktrees`);
    expect(res.status).toBe(200);
    expect(res.body.worktrees).toEqual([]);
  });

  it("GET /api/jira/boards/:boardKey/worktrees lists entries after state is written", async () => {
    aiwf.setCardState(ctxId, cardKey, { taskBranch: "feat/pp-42", worktreePath: "/tmp/wt42" });
    const res = await request(app).get(`/api/jira/boards/${boardKey}/worktrees`);
    expect(res.status).toBe(200);
    const entry = res.body.worktrees.find((e: { key: string }) => e.key === cardKey);
    expect(entry).toBeDefined();
    expect(entry.taskBranch).toBe("feat/pp-42");
  });

  it("DELETE /api/jira/boards/:boardKey/worktrees/:cardKey clears card state (no-op when absent)", async () => {
    const noOp = await request(app).delete(`/api/jira/boards/${boardKey}/worktrees/${cardKey}`);
    expect(noOp.status).toBe(200);
    expect(noOp.body.ok).toBe(true);

    aiwf.setCardState(ctxId, cardKey, { taskBranch: "feat/del-pp", worktreePath: "/tmp/dpp" });
    const del = await request(app).delete(`/api/jira/boards/${boardKey}/worktrees/${cardKey}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    expect(aiwf.getCardState(ctxId, cardKey)).toBeNull();
  });

  it("DELETE /api/jira/boards/:boardKey/worktrees clears all states for the board", async () => {
    const key2 = "PP-43";
    aiwf.setCardState(ctxId, cardKey, { taskBranch: "feat/b1", worktreePath: "/tmp/b1" });
    aiwf.setCardState(ctxId, key2, { taskBranch: "feat/b2", worktreePath: "/tmp/b2" });
    try {
      const res = await request(app).delete(`/api/jira/boards/${boardKey}/worktrees`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.removed).toBeGreaterThanOrEqual(2);
      expect(aiwf.getCardState(ctxId, cardKey)).toBeNull();
      expect(aiwf.getCardState(ctxId, key2)).toBeNull();
    } finally {
      aiwf.clearCardState(ctxId, key2);
    }
  });

  it("returns 404 for an unknown board key", async () => {
    expect((await request(app).get("/api/jira/boards/NOPE/worktrees")).status).toBe(404);
    expect((await request(app).delete("/api/jira/boards/NOPE/worktrees/KEY-1")).status).toBe(404);
    expect((await request(app).delete("/api/jira/boards/NOPE/worktrees")).status).toBe(404);
  });
});
