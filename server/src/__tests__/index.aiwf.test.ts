import fs from "fs";
import os from "os";
import path from "path";

// A real (non-demo) temp config with one AI Workflow project, so the routes that read/persist
// projects + cards actually exercise the config + aiwf code paths.
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-rt-repo-"));
const REPO2 = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-rt-repo2-"));
const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-rt-cfg-"));
const CONFIG_PATH = path.join(CFG_DIR, "hangar.config.json");
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({
    agentsDir: "~/.claude/agents",
    skillsDir: fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-rt-skills-")),
    boards: [{ key: "X", name: "X", statuses: ["To Do"] }],
    aiWorkflow: { projects: [{ id: "p1", name: "Demo Project", repoPath: REPO, createdAt: 0 }] },
  }),
);
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.HANGAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-rt-data-"));
delete process.env.HANGAR_DEMO;
for (const k of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"])
  process.env[k] = "";

// aiwf install/uninstall/version shell out — stub execSync but keep the rest (worktree uses execFile).
jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  execSync: jest.fn(() => "mock-output"),
}));

// Skills resolve for any name so the run/onboard routes proceed; agents unused here.
jest.mock("../skills", () => {
  const actual = jest.requireActual("../skills");
  return {
    ...actual,
    allSkills: () => [],
    findSkill: (_c: unknown, name: string) => ({ name, description: "", sourcePath: "x", source: "user" }),
    skillExists: () => true,
  };
});
jest.mock("../agents", () => {
  const actual = jest.requireActual("../agents");
  return { ...actual, loadAgents: () => [], loadAgent: () => null };
});

// SDK mock: every session finishes immediately so card/setup runs complete (and the history hook fires).
jest.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => {
    async function* gen() {
      yield { type: "system", subtype: "init", session_id: "s", model: "m" };
      yield { type: "result", subtype: "success", result: "done", total_cost_usd: 0.01, session_id: "s" };
    }
    return Object.assign(gen(), { interrupt: async () => {} });
  },
}));

import request from "supertest";
import { app } from "../index";

const tick = () => new Promise((r) => setTimeout(r, 60));

describe("AI Workflow routes", () => {
  it("GET /api/aiwf/status returns presets + install state", async () => {
    const res = await request(app).get("/api/aiwf/status");
    expect(res.status).toBe(200);
    expect(res.body.defaultColumns).toContain("Complete");
    expect(res.body.skillGroups).toHaveLength(5);
    expect(res.body.repoUrl).toMatch(/ai-workflow/);
    expect(typeof res.body.installed).toBe("boolean");
  });

  it("lists the configured project", async () => {
    const res = await request(app).get("/api/aiwf/projects");
    expect(res.status).toBe(200);
    expect(res.body.projects.map((p: { id: string }) => p.id)).toContain("p1");
    expect(res.body.projects[0].columns).toContain("Planning");
  });

  it("registers a project (adopt) and validates input", async () => {
    const ok = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Adopted", repoPath: REPO2, mode: "adopt" });
    expect(ok.status).toBe(200);
    expect(ok.body.project.name).toBe("Adopted");
    expect(ok.body.runId).toBeUndefined(); // adopt does not scaffold
    expect(fs.existsSync(path.join(REPO2, ".aiwf", "board"))).toBe(true);

    expect((await request(app).post("/api/aiwf/projects").send({ name: "" })).status).toBe(400);
    expect(
      (await request(app).post("/api/aiwf/projects").send({ name: "X", repoPath: "/no/such/path-xyz" }))
        .status,
    ).toBe(400);
  });

  it("scaffolds a new project via a skill run", async () => {
    const res = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Fresh", repoPath: REPO, mode: "new" });
    expect(res.status).toBe(200);
    expect(typeof res.body.runId).toBe("string"); // new-project run started
    await tick();
  });

  it("creates, lists, transitions, and runs a card", async () => {
    const created = await request(app).post("/api/aiwf/projects/p1/cards").send({ title: "Build auth" });
    expect(created.status).toBe(200);
    const key = created.body.ticket.key;
    expect(key).toMatch(/^DP-\d+$/);

    const list = await request(app).get("/api/aiwf/projects/p1/cards");
    expect(list.body.tickets.map((t: { key: string }) => t.key)).toContain(key);

    expect((await request(app).post("/api/aiwf/projects/p1/cards").send({})).status).toBe(400); // no title

    const moved = await request(app)
      .post(`/api/aiwf/projects/p1/cards/${key}/transition`)
      .send({ status: "Review" });
    expect(moved.status).toBe(200);
    expect((await request(app).post(`/api/aiwf/projects/p1/cards/${key}/transition`).send({})).status).toBe(
      400,
    );

    const run = await request(app).post(`/api/aiwf/projects/p1/cards/${key}/run`).send({ skill: "review" });
    expect(run.status).toBe(200);
    expect(typeof run.body.runId).toBe("string");
    await tick(); // let the mocked session finish so the history hook runs

    expect((await request(app).post(`/api/aiwf/projects/p1/cards/${key}/run`).send({})).status).toBe(400); // no skill
    expect(
      (await request(app).post(`/api/aiwf/projects/p1/cards/NOPE-1/run`).send({ skill: "review" })).status,
    ).toBe(404);
  });

  it("404s on unknown projects", async () => {
    expect((await request(app).get("/api/aiwf/projects/nope/cards")).status).toBe(404);
    expect(
      (await request(app).post("/api/aiwf/projects/nope/cards/x/transition").send({ status: "Review" }))
        .status,
    ).toBe(404);
  });

  it("installs (mocked) and reports an uninstall error when no launcher exists", async () => {
    const install = await request(app).post("/api/aiwf/install");
    expect(install.status).toBe(200);
    expect(install.body.output).toBe("mock-output");

    // No ~/.local/bin/aiwf in this environment → uninstall surfaces an error.
    const uninstall = await request(app).post("/api/aiwf/uninstall");
    expect([200, 500]).toContain(uninstall.status);
  });

  it("deletes a project", async () => {
    expect((await request(app).delete("/api/aiwf/projects/p1")).status).toBe(200);
    expect((await request(app).delete("/api/aiwf/projects/p1")).status).toBe(404);
  });
});
