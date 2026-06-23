import fs from "fs";
import os from "os";
import path from "path";

// Demo mode so the app boots with a synthesized config + fake board and no Jira.
process.env.HANGAR_DEMO = "1";
process.env.HANGAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-idx-"));
// Force Jira "unconfigured" — set to empty BEFORE config.ts runs dotenv (which never overrides
// an already-present var), so the developer's real .env creds don't bleed into these tests.
for (const k of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"]) {
  process.env[k] = "";
}

// Mock the agents/skills loaders so /api/agents and /api/skills return controllable data
// without depending on the developer's ~/.claude contents, and so a run can start.
jest.mock("../agents", () => {
  const actual = jest.requireActual("../agents");
  return {
    ...actual,
    loadAgents: () => [{ name: "debugger", description: "d", tools: [], sourcePath: "x" }],
    loadAgent: (_dir: string, name: string) =>
      name === "debugger"
        ? { name, description: "d", tools: [], sourcePath: "x", body: "be a debugger" }
        : null,
  };
});
jest.mock("../skills", () => {
  const actual = jest.requireActual("../skills");
  return {
    ...actual,
    allSkills: () => [{ name: "deploy", description: "ship", sourcePath: "x", source: "user" }],
    findSkill: (_cfg: unknown, name: string) =>
      name === "deploy" ? { name, description: "ship", sourcePath: "x", source: "user" } : undefined,
    skillExists: (_cfg: unknown, name: string) => name === "deploy",
  };
});

// SDK mock: a finished session so a started run completes quickly without Claude. A run started
// with a "HOLD" note stays open (no result) so the SSE live-listener path can be exercised.
let sdkHold: (() => void) | null = null;
jest.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ prompt }: { prompt: AsyncIterable<unknown> }) => {
    async function* gen() {
      yield { type: "system", subtype: "init", session_id: "s", model: "m" };
      // Peek the seed prompt to decide whether to hold open.
      const it = (prompt as AsyncIterable<{ message?: { content?: string } }>)[Symbol.asyncIterator]();
      const first = await it.next();
      const seed = first.value?.message?.content ?? "";
      if (typeof seed === "string" && seed.includes("HOLD-RUN")) {
        await new Promise<void>((res) => (sdkHold = res));
        yield { type: "result", subtype: "success", result: "done", total_cost_usd: 0.01, session_id: "s" };
      } else {
        yield { type: "result", subtype: "success", result: "done", total_cost_usd: 0.01, session_id: "s" };
      }
    }
    return Object.assign(gen(), { interrupt: async () => sdkHold?.() });
  },
}));

// No real git worktrees.
jest.mock("../worktree", () => ({
  createWorktree: async () => null,
  removeWorktree: async () => {},
}));

import request from "supertest";
import { app } from "../index";

const demoTicket = {
  key: "DEMO-1",
  summary: "x",
  status: "To Do",
  assignee: null,
  assigneeAvatar: null,
  issuetype: "Bug",
  priority: "High",
  boardKey: "DEMO",
  url: "#",
};

describe("read endpoints", () => {
  it("GET /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.boards).toContain("DEMO");
  });

  it("GET /api/config", async () => {
    const res = await request(app).get("/api/config");
    expect(res.status).toBe(200);
    expect(res.body.boards[0].key).toBe("DEMO");
  });

  it("GET /api/settings/jira never returns a token", async () => {
    const res = await request(app).get("/api/settings/jira");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("configured");
    expect(res.body).not.toHaveProperty("token");
  });

  it("GET /api/agents", async () => {
    const res = await request(app).get("/api/agents");
    expect(res.body.agents).toEqual([{ name: "debugger", description: "d", tools: [], sourcePath: "x" }]);
  });

  it("GET /api/skills", async () => {
    const res = await request(app).get("/api/skills");
    expect(res.body.skills[0].name).toBe("deploy");
  });

  it("GET /api/tickets (demo) serves fictional tickets, filterable by board", async () => {
    const all = await request(app).get("/api/tickets");
    expect(all.body.tickets.length).toBeGreaterThan(0);
    const filtered = await request(app).get("/api/tickets?boards=NOPE");
    expect(filtered.body.tickets).toEqual([]);
  });
});

describe("config & jira settings writes", () => {
  it("PUT /api/config is a no-op in demo mode (returns current)", async () => {
    const res = await request(app).put("/api/config").send({ agentsDir: "x", boards: [] });
    expect(res.status).toBe(200);
    expect(res.body.boards[0].key).toBe("DEMO"); // demo config unchanged
  });

  it("PUT /api/settings/jira returns the (unchanged in demo) view", async () => {
    const res = await request(app).put("/api/settings/jira").send({ email: "a@b.com" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("configured");
  });
});

describe("jira routes require config (503) when unconfigured", () => {
  it("GET /api/jira/projects → 503", async () => {
    expect((await request(app).get("/api/jira/projects")).status).toBe(503);
  });
  it("GET /api/jira/statuses → 503", async () => {
    expect((await request(app).get("/api/jira/statuses?project=PP")).status).toBe(503);
  });
  it("POST /api/jira/test → ok:false when creds missing", async () => {
    const res = await request(app).post("/api/jira/test").send({});
    expect(res.body).toEqual({ ok: false, error: expect.stringMatching(/required/) });
  });
});

describe("ticket transition", () => {
  it("POST /api/tickets/:key/transition is ok in demo mode", async () => {
    const res = await request(app).post("/api/tickets/DEMO-1/transition").send({ status: "Done" });
    expect(res.body).toEqual({ ok: true });
  });
});

describe("ticket PR lookup", () => {
  it("GET /api/tickets/:key/pr returns null in demo mode (no Jira)", async () => {
    const res = await request(app).get("/api/tickets/DEMO-1/pr");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prUrl: null });
  });
});

describe("filesystem path check", () => {
  it("GET /api/fs/exists returns true for a real path and false for a missing one", async () => {
    const real = await request(app).get("/api/fs/exists?path=/tmp");
    expect(real.status).toBe(200);
    expect(real.body.exists).toBe(true);

    const missing = await request(app).get("/api/fs/exists?path=/this/does/not/exist/at/all");
    expect(missing.status).toBe(200);
    expect(missing.body.exists).toBe(false);
  });

  it("GET /api/fs/exists returns 400 when path is missing", async () => {
    const res = await request(app).get("/api/fs/exists");
    expect(res.status).toBe(400);
  });
});

describe("runs lifecycle", () => {
  it("rejects an unknown agent (404)", async () => {
    const res = await request(app)
      .post("/api/runs")
      .send({ kind: "agent", name: "ghost", ticket: demoTicket });
    expect(res.status).toBe(404);
  });

  it("rejects an unknown skill (404)", async () => {
    const res = await request(app).post("/api/runs").send({ kind: "skill", name: "ghost", note: "x" });
    expect(res.status).toBe(404);
  });

  it("rejects a missing parent run (404)", async () => {
    const res = await request(app)
      .post("/api/runs")
      .send({ kind: "agent", name: "debugger", parentRunId: "nope", note: "x" });
    expect(res.status).toBe(404);
  });

  it("requires a ticket or note (400)", async () => {
    const res = await request(app).post("/api/runs").send({ kind: "agent", name: "debugger" });
    expect(res.status).toBe(400);
  });

  it("starts a chat session with no name, resolving the agent to 'claude' (200)", async () => {
    const res = await request(app)
      .post("/api/runs")
      .send({ kind: "chat", cwd: "/tmp", title: "Demo — Claude", model: "opus" });
    expect(res.status).toBe(200);
    const runId = res.body.runId;
    expect(runId).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    const one = await request(app).get(`/api/runs/${runId}`);
    expect(one.body.agentName).toBe("claude");
    expect(one.body.kind).toBe("chat");
    expect(one.body.model).toBe("claude-opus-4-8");
  });

  it("accepts a chat session with an empty note (no 400)", async () => {
    const res = await request(app)
      .post("/api/runs")
      .send({ kind: "chat", cwd: "/tmp", title: "Demo — Claude", note: "" });
    expect(res.status).toBe(200);
  });

  it("starts a ticket run, lists it, fetches it, and streams it", async () => {
    const start = await request(app)
      .post("/api/runs")
      .send({ kind: "agent", name: "debugger", ticket: demoTicket });
    expect(start.status).toBe(200);
    const runId = start.body.runId;
    expect(runId).toBeTruthy();
    // give the mocked SDK turn a tick to finish
    await new Promise((r) => setTimeout(r, 20));

    const list = await request(app).get("/api/runs");
    expect(list.body.runs.some((r: { id: string }) => r.id === runId)).toBe(true);

    const one = await request(app).get(`/api/runs/${runId}`);
    expect(one.status).toBe(200);
    expect(one.body).toHaveProperty("events");

    expect((await request(app).get("/api/runs/ghost")).status).toBe(404);

    // SSE stream of a finished run: replays history then ends.
    const stream = await request(app).get(`/api/runs/${runId}/stream`);
    expect(stream.status).toBe(200);
    expect(stream.text).toContain("data:");
    expect((await request(app).get("/api/runs/ghost/stream")).status).toBe(404);
  });

  it("starts a standalone run, then stops it and deletes it", async () => {
    const start = await request(app)
      .post("/api/runs")
      .send({ kind: "agent", name: "debugger", note: "do a thing" });
    const runId = start.body.runId;
    await new Promise((r) => setTimeout(r, 20));
    expect((await request(app).post(`/api/runs/${runId}/stop`)).status).toBe(200);
    expect((await request(app).post("/api/runs/ghost/stop")).status).toBe(404);
    expect((await request(app).delete(`/api/runs/${runId}`)).status).toBe(200);
    expect((await request(app).delete("/api/runs/ghost")).status).toBe(404);
  });

  it("message route validates and reports no-session (409/400/404)", async () => {
    const start = await request(app).post("/api/runs").send({ kind: "agent", name: "debugger", note: "x" });
    const runId = start.body.runId;
    await new Promise((r) => setTimeout(r, 20));
    expect((await request(app).post(`/api/runs/${runId}/message`).send({})).status).toBe(400); // empty text
    expect((await request(app).post("/api/runs/ghost/message").send({ text: "hi" })).status).toBe(404);
    // finished run with a sessionId resumes (mode: resume)
    const ok = await request(app).post(`/api/runs/${runId}/message`).send({ text: "follow up" });
    expect(ok.body.mode).toBe("resume");
  });

  it("terminal route 404s an unknown run and opens a resumable session for a valid run", async () => {
    expect((await request(app).post("/api/runs/ghost/terminal")).status).toBe(404);
    const start = await request(app).post("/api/runs").send({ kind: "agent", name: "debugger", note: "x" });
    const runId = start.body.runId;
    await new Promise((r) => setTimeout(r, 20));
    // Demo config ships a `terminal` template, so a run with a session id resolves the resume
    // command (the actual spawn is guarded off in demo mode — see terminal.ts).
    const res = await request(app).post(`/api/runs/${runId}/terminal`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.command).toMatch(/claude --resume/);
  });

  it("permission route validates decision and unknown run/request", async () => {
    const start = await request(app).post("/api/runs").send({ kind: "agent", name: "debugger", note: "x" });
    const runId = start.body.runId;
    await new Promise((r) => setTimeout(r, 20));
    expect(
      (await request(app).post(`/api/runs/${runId}/permissions/abc`).send({ decision: "maybe" })).status,
    ).toBe(400);
    expect(
      (await request(app).post(`/api/runs/${runId}/permissions/abc`).send({ decision: "allow" })).status,
    ).toBe(409);
    expect(
      (await request(app).post("/api/runs/ghost/permissions/abc").send({ decision: "allow" })).status,
    ).toBe(404);
  });

  it("DELETE /api/runs clears finished runs", async () => {
    await request(app).post("/api/runs").send({ kind: "agent", name: "debugger", note: "x" });
    await new Promise((r) => setTimeout(r, 20));
    const res = await request(app).delete("/api/runs?scope=all");
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.cleared).toBe("number");
  });
});

describe("SSE live stream of an active run", () => {
  it("replays history then streams the final event live, ending the stream", async () => {
    const start = await request(app)
      .post("/api/runs")
      .send({ kind: "agent", name: "debugger", note: "HOLD-RUN please" });
    const runId = start.body.runId;
    await new Promise((r) => setTimeout(r, 20)); // let it reach running (held open)

    // Connect to the live stream, then release the held SDK so a "result" event arrives live.
    const streamPromise = request(app).get(`/api/runs/${runId}/stream`);
    await new Promise((r) => setTimeout(r, 20));
    sdkHold?.(); // unblock → SDK emits result → listener forwards it and ends the stream
    const res = await streamPromise;
    expect(res.status).toBe(200);
    expect(res.text).toContain("data:");
    expect(res.text).toContain("event: end");
  });
});

describe("workflow run routes", () => {
  it("requires a ticket (400)", async () => {
    const res = await request(app).post("/api/workflows/runs").send({ boardKey: "DEMO", workflowId: "x" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown board/workflow", async () => {
    const res = await request(app)
      .post("/api/workflows/runs")
      .send({ boardKey: "DEMO", workflowId: "ghost", ticket: demoTicket });
    expect(res.status).toBe(400); // demo board has no workflows
  });

  it("lists workflow runs and handles stop/delete 404s", async () => {
    expect((await request(app).get("/api/workflows/runs")).status).toBe(200);
    expect((await request(app).post("/api/workflows/runs/ghost/stop")).status).toBe(404);
    expect((await request(app).delete("/api/workflows/runs/ghost")).status).toBe(404);
    const clear = await request(app).delete("/api/workflows/runs?scope=all");
    expect(clear.body.ok).toBe(true);
  });
});

describe("AI Workflow connection (demo)", () => {
  it("reports the toolkit as installed and seeds a project + cards", async () => {
    const status = await request(app).get("/api/aiwf/status");
    expect(status.status).toBe(200);
    expect(status.body.installed).toBe(true);
    expect(status.body.version).toBe("demo");

    const projects = await request(app).get("/api/aiwf/projects");
    expect(projects.body.projects.map((p: { id: string }) => p.id)).toContain("demo-aiwf");

    const cards = await request(app).get("/api/aiwf/projects/demo-aiwf/cards");
    expect(cards.body.tickets.length).toBeGreaterThan(0);
    expect(cards.body.tickets[0].key).toMatch(/^AUR-/);
  });

  it("simulates mutations without touching the filesystem or starting real runs", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Tryout", repoPath: "/anything", mode: "new" });
    expect(proj.status).toBe(200);
    expect(proj.body.runId).toBeUndefined();

    const card = await request(app).post("/api/aiwf/projects/demo-aiwf/cards").send({ title: "Sketch" });
    expect(card.body.ticket.summary).toBe("Sketch");

    const moved = await request(app)
      .post("/api/aiwf/projects/demo-aiwf/cards/AUR-1/transition")
      .send({ status: "Review" });
    expect(moved.body.ok).toBe(true);

    const run = await request(app)
      .post("/api/aiwf/projects/demo-aiwf/cards/AUR-1/run")
      .send({ skill: "feature" });
    expect(run.body.runId).toBe("demo");

    expect((await request(app).post("/api/aiwf/install")).body.output).toMatch(/[Dd]emo/);
    expect((await request(app).post("/api/aiwf/uninstall")).body.output).toMatch(/[Dd]emo/);
    expect((await request(app).delete("/api/aiwf/projects/demo-aiwf")).status).toBe(200);
  });
});
