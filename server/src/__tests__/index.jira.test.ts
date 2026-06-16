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
  return { ...actual, loadAgents: () => [], loadAgent: () => null };
});
jest.mock("../skills", () => {
  const actual = jest.requireActual("../skills");
  return { ...actual, allSkills: () => [], findSkill: () => undefined, skillExists: () => false };
});
jest.mock("../worktree", () => ({ createWorktree: async () => null, removeWorktree: async () => {} }));

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
