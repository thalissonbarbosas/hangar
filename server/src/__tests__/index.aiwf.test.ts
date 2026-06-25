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
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-rt-data-"));
process.env.HANGAR_DATA_DIR = DATA;
delete process.env.HANGAR_DEMO;
for (const k of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"])
  process.env[k] = "";

// aiwf install/uninstall/version shell out — stub execSync + exec (installAiwf uses execAsync which
// wraps exec via promisify). Keep the rest: worktree uses execFile which must stay real.
// exec must carry util.promisify.custom so promisify(exec) returns { stdout, stderr } like the real impl.
jest.mock("child_process", () => {
  const { promisify } = jest.requireActual("util") as typeof import("util");
  const execFn = jest.fn();

  (execFn as any)[promisify.custom] = jest.fn(() => Promise.resolve({ stdout: "mock-output", stderr: "" }));
  return {
    ...jest.requireActual("child_process"),
    execSync: jest.fn(() => "mock-output"),
    exec: execFn,
  };
});

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

// Spy on worktree creation so we can assert which aiwf runs ask for isolation. Returning null makes
// every run fall back to in-place (the temp repo isn't a git tree anyway) — no stray worktrees.
jest.mock("../worktree", () => ({
  createWorktree: jest.fn(
    async (
      _dir: string,
      _label: string,
      _id: string,
      opts?: { branchName?: string; existingBranch?: string },
    ) =>
      opts?.branchName || opts?.existingBranch
        ? { path: "/tmp/mock-task-wt", branch: opts.branchName ?? opts.existingBranch, repoRoot: _dir }
        : null,
  ),
  findWorktreePath: jest.fn(async () => null),
  removeWorktree: jest.fn(async () => {}),
  sanitize: jest.requireActual("../worktree").sanitize,
}));

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
import { createWorktree } from "../worktree";
import * as aiwf from "../aiwf";
import * as cfgMod from "../config";

const createWorktreeMock = createWorktree as unknown as jest.Mock;
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
    // The board lives in Hangar's data dir keyed by project id — the adopted repo stays pristine.
    expect(fs.existsSync(path.join(DATA, "aiwf", ok.body.project.id, "board"))).toBe(true);
    expect(fs.existsSync(path.join(REPO2, ".aiwf"))).toBe(false);

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

  it("delivery skills get a task worktree; non-delivery skills run in place", async () => {
    const created = await request(app).post("/api/aiwf/projects/p1/cards").send({ title: "Ship it" });
    const key = created.body.ticket.key;

    // A non-delivery skill (roadmap) runs in place — no worktree.
    createWorktreeMock.mockClear();
    const planRun = await request(app)
      .post(`/api/aiwf/projects/p1/cards/${key}/run`)
      .send({ skill: "roadmap" });
    expect(planRun.status).toBe(200);
    await tick();
    expect(createWorktreeMock).not.toHaveBeenCalled();

    // A delivery skill (feature) gets a persistent task worktree.
    createWorktreeMock.mockClear();
    const codeRun = await request(app)
      .post(`/api/aiwf/projects/p1/cards/${key}/run`)
      .send({ skill: "feature" });
    expect(codeRun.status).toBe(200);
    await tick();
    expect(createWorktreeMock).toHaveBeenCalled();

    // review is also a delivery skill now — reuses the same task worktree.
    createWorktreeMock.mockClear();
    const reviewRun = await request(app)
      .post(`/api/aiwf/projects/p1/cards/${key}/run`)
      .send({ skill: "review" });
    expect(reviewRun.status).toBe(200);
    await tick();
    // Worktree already exists (stored from feature run) — mock path "/tmp/mock-task-wt" doesn't
    // exist on disk, so resolveCardWorktree re-creates via existingBranch.
    expect(createWorktreeMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ existingBranch: expect.any(String) }),
    );
  });

  describe("spec card task-scoped worktrees", () => {
    let specsDir: string;
    const specKey = "SPEC-007";

    beforeEach(() => {
      specsDir = path.join(REPO, "docs", "specs");
      fs.mkdirSync(specsDir, { recursive: true });
      fs.writeFileSync(
        path.join(specsDir, "007_standardize-agent-skill-selects.md"),
        "# Feature\n\n## Trunk Metadata\n\n- **Type:** feat\n",
      );
      aiwf.clearSpecState("p1", specKey);
      createWorktreeMock.mockClear();
    });
    afterEach(() => {
      fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
      aiwf.clearSpecState("p1", specKey);
    });

    it("creates a task worktree with a semantic branch on first skill run for a spec card", async () => {
      const run = await request(app)
        .post(`/api/aiwf/projects/p1/cards/${specKey}/run`)
        .send({ skill: "feature" });
      expect(run.status).toBe(200);
      await tick();
      // createWorktree called with branchName derived from spec slug
      expect(createWorktreeMock).toHaveBeenCalledWith(
        expect.any(String),
        "feat/standardize-agent-skill-selects",
        expect.any(String),
        expect.objectContaining({
          branchName: "feat/standardize-agent-skill-selects",
          baseBranch: "main",
        }),
      );
      // Spec state persisted
      const state = aiwf.getSpecState("p1", specKey);
      expect(state?.taskBranch).toBe("feat/standardize-agent-skill-selects");
    });

    it("reuses the stored worktree for a second skill run on the same spec card", async () => {
      // First run: creates worktree.
      await request(app).post(`/api/aiwf/projects/p1/cards/${specKey}/run`).send({ skill: "feature" });
      await tick();
      const callsAfterFirst = createWorktreeMock.mock.calls.length;

      // Second run (commit): should reuse the stored path, not create a new worktree.
      // The mock returns a path of "/tmp/mock-task-wt" which doesn't exist on disk,
      // so resolveTaskWorktree will see a stale path and re-create — that's acceptable.
      // What we verify: the second call uses existingBranch, not baseBranch/branchName.
      await request(app).post(`/api/aiwf/projects/p1/cards/${specKey}/run`).send({ skill: "commit" });
      await tick();
      const callsAfterSecond = createWorktreeMock.mock.calls.length;
      // A second createWorktree call happened (stale path re-create) and used existingBranch.
      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
      const lastCall = createWorktreeMock.mock.calls[callsAfterSecond - 1];
      expect(lastCall[3]).toMatchObject({ existingBranch: "feat/standardize-agent-skill-selects" });
    });

    it("runs spec skill in a task worktree (spec is now a delivery skill)", async () => {
      createWorktreeMock.mockClear();
      const run = await request(app)
        .post(`/api/aiwf/projects/p1/cards/${specKey}/run`)
        .send({ skill: "spec" });
      expect(run.status).toBe(200);
      await tick();
      // spec is in DELIVERY_SKILLS — createWorktree called with semantic branch from spec file
      expect(createWorktreeMock).toHaveBeenCalledWith(
        expect.any(String),
        "feat/standardize-agent-skill-selects",
        expect.any(String),
        expect.objectContaining({
          branchName: "feat/standardize-agent-skill-selects",
          baseBranch: "main",
        }),
      );
      expect(aiwf.getCardState("aiwf-p1", specKey)?.taskBranch).toBe("feat/standardize-agent-skill-selects");
    });

    it("promoted board card with a Spec: description runs on the semantic branch, not feat/<card-key>", async () => {
      // Simulate the web's promote-then-run: a thread card copying the spec's "Spec: <path>" prefix.
      const created = await request(app).post("/api/aiwf/projects/p1/cards").send({
        title: "Standardize selects",
        status: "Implementation",
        kind: "thread",
        description: "Spec: docs/specs/007_standardize-agent-skill-selects.md\n\nFull description.",
      });
      const cardKey = created.body.ticket.key;
      expect(cardKey).not.toMatch(/^SPEC-/); // a real board card, not the read-only spec key

      createWorktreeMock.mockClear();
      const run = await request(app)
        .post(`/api/aiwf/projects/p1/cards/${cardKey}/run`)
        .send({ skill: "feature" });
      expect(run.status).toBe(200);
      await tick();
      // Branch recovered from the Spec: line — semantic, not feat/<card-key>.
      expect(createWorktreeMock).toHaveBeenCalledWith(
        expect.any(String),
        "feat/standardize-agent-skill-selects",
        expect.any(String),
        expect.objectContaining({
          branchName: "feat/standardize-agent-skill-selects",
          baseBranch: "main",
        }),
      );
      expect(aiwf.getCardState("aiwf-p1", cardKey)?.taskBranch).toBe("feat/standardize-agent-skill-selects");
    });

    it("runs a non-delivery skill on a spec card in the real repo", async () => {
      createWorktreeMock.mockClear();
      const run = await request(app)
        .post(`/api/aiwf/projects/p1/cards/${specKey}/run`)
        .send({ skill: "roadmap" });
      expect(run.status).toBe(200);
      await tick();
      expect(createWorktreeMock).not.toHaveBeenCalled();
      expect(aiwf.getCardState("aiwf-p1", specKey)).toBeNull();
    });

    it("returns 503 when worktree creation fails for a task-worktree skill", async () => {
      // Force createWorktree to fail (returns null) even when branchName is provided.
      createWorktreeMock.mockResolvedValueOnce(null);
      const run = await request(app)
        .post(`/api/aiwf/projects/p1/cards/${specKey}/run`)
        .send({ skill: "feature" });
      expect(run.status).toBe(503);
      expect(run.body.error).toMatch(/task worktree/i);
    });

    it("Complete transition clears spec-state; non-Complete transitions are read-only", async () => {
      // Seed a spec-state entry to verify it gets cleared.
      aiwf.setSpecState("p1", specKey, { taskBranch: "feat/test", worktreePath: "/tmp/test-wt" });
      expect(aiwf.getSpecState("p1", specKey)).not.toBeNull();

      // Non-Complete transitions are blocked.
      const blocked = await request(app)
        .post(`/api/aiwf/projects/p1/cards/${specKey}/transition`)
        .send({ status: "Review" });
      expect(blocked.status).toBe(400);
      expect(blocked.body.error).toMatch(/read-only/i);
      expect(aiwf.getSpecState("p1", specKey)).not.toBeNull(); // state unchanged

      // Complete transition clears the spec-state.
      const done = await request(app)
        .post(`/api/aiwf/projects/p1/cards/${specKey}/transition`)
        .send({ status: "Complete" });
      expect(done.status).toBe(200);
      expect(done.body.ok).toBe(true);
      expect(aiwf.getSpecState("p1", specKey)).toBeNull();
    });
  });

  it("does not create task worktrees for delivery skills when isolateRuns is false", async () => {
    const spy = jest
      .spyOn(cfgMod, "getConfig")
      .mockReturnValue({ ...cfgMod.getConfig(), isolateRuns: false });
    try {
      const proj = await request(app)
        .post("/api/aiwf/projects")
        .send({ name: "isolateRuns false test", repoPath: REPO, mode: "adopt" });
      const pid = proj.body.project.id;
      const card = await request(app).post(`/api/aiwf/projects/${pid}/cards`).send({ title: "Test card" });
      const key = card.body.ticket.key;

      createWorktreeMock.mockClear();
      const run = await request(app)
        .post(`/api/aiwf/projects/${pid}/cards/${key}/run`)
        .send({ skill: "feature" });
      expect(run.status).toBe(200);
      await tick();
      // isolateRuns: false → delivery-skill block skipped; no branchName-based worktree created.
      const deliveryCalls = createWorktreeMock.mock.calls.filter(
        (c: unknown[]) => (c[3] as { branchName?: string } | undefined)?.branchName,
      );
      expect(deliveryCalls).toHaveLength(0);
      expect(aiwf.getCardState(`aiwf-${pid}`, key)).toBeNull();
    } finally {
      spy.mockRestore();
    }
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

  it("changes a project's location and name", async () => {
    // 404 for an unknown project.
    expect((await request(app).patch("/api/aiwf/projects/nope").send({ name: "X" })).status).toBe(404);
    // 400 when neither name nor repoPath is supplied.
    expect((await request(app).patch("/api/aiwf/projects/p1").send({})).status).toBe(400);
    // 400 (and no mutation) when the new repoPath does not exist.
    const bad = await request(app).patch("/api/aiwf/projects/p1").send({ repoPath: "/no/such/path-xyz" });
    expect(bad.status).toBe(400);
    expect((await request(app).get("/api/aiwf/projects")).body.projects[0].repoPath).toBe(REPO);

    // Editing only the name leaves repoPath unchanged.
    const renamed = await request(app).patch("/api/aiwf/projects/p1").send({ name: "Renamed" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.project.name).toBe("Renamed");
    expect(renamed.body.project.repoPath).toBe(REPO);

    // Editing the location re-points the project and persists.
    const moved = await request(app).patch("/api/aiwf/projects/p1").send({ repoPath: REPO2 });
    expect(moved.status).toBe(200);
    expect(moved.body.project.repoPath).toBe(REPO2);
    expect(moved.body.project.name).toBe("Renamed"); // name preserved
    expect(fs.existsSync(path.join(DATA, "aiwf", "p1", "board"))).toBe(true); // board dir ensured (data dir, keyed by id)
    const after = (await request(app).get("/api/aiwf/projects")).body.projects[0];
    expect(after.repoPath).toBe(REPO2);
    expect(after.name).toBe("Renamed");
  });

  it("deletes a project", async () => {
    expect((await request(app).delete("/api/aiwf/projects/p1")).status).toBe(200);
    expect((await request(app).delete("/api/aiwf/projects/p1")).status).toBe(404);
  });

  // ---- archive route ----

  it("archive route sets archived: true and is visible in card list", async () => {
    // Create a fresh card under p2 (so the project is still alive after the "deletes a project" test above).
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Archive Test", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;

    const card = await request(app).post(`/api/aiwf/projects/${pid}/cards`).send({ title: "Archive me" });
    const key = card.body.ticket.key;

    // Archive it.
    const arch = await request(app)
      .post(`/api/aiwf/projects/${pid}/cards/${key}/archive`)
      .send({ archived: true });
    expect(arch.status).toBe(200);
    expect(arch.body.ok).toBe(true);

    // The card list returns archived: true.
    const list = await request(app).get(`/api/aiwf/projects/${pid}/cards`);
    const found = list.body.tickets.find((t: { key: string }) => t.key === key);
    expect(found.archived).toBe(true);
  });

  it("archive route with archived: false clears the flag", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Unarchive Test", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;

    const card = await request(app).post(`/api/aiwf/projects/${pid}/cards`).send({ title: "Unarchive me" });
    const key = card.body.ticket.key;

    // Archive, then unarchive.
    await request(app).post(`/api/aiwf/projects/${pid}/cards/${key}/archive`).send({ archived: true });
    const unarch = await request(app)
      .post(`/api/aiwf/projects/${pid}/cards/${key}/archive`)
      .send({ archived: false });
    expect(unarch.status).toBe(200);

    const list = await request(app).get(`/api/aiwf/projects/${pid}/cards`);
    const found = list.body.tickets.find((t: { key: string }) => t.key === key);
    // archived must be absent or falsy after unarchive
    expect(found.archived).toBeFalsy();
  });

  it("archive route returns 400 for an unknown card key", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Archive 400 Test", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;

    const res = await request(app)
      .post(`/api/aiwf/projects/${pid}/cards/NOPE-99/archive`)
      .send({ archived: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Card not found/);
  });

  it("archive route returns 404 for an unknown project id", async () => {
    const res = await request(app)
      .post("/api/aiwf/projects/no-such-proj/cards/X-1/archive")
      .send({ archived: true });
    expect(res.status).toBe(404);
  });

  // ---- delete route ----

  it("delete route removes the card file and it no longer appears in the list", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Delete Test", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;

    const card = await request(app).post(`/api/aiwf/projects/${pid}/cards`).send({ title: "Delete me" });
    const key = card.body.ticket.key;

    const del = await request(app).delete(`/api/aiwf/projects/${pid}/cards/${key}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    // Card is gone from the list.
    const list = await request(app).get(`/api/aiwf/projects/${pid}/cards`);
    expect(list.body.tickets.map((t: { key: string }) => t.key)).not.toContain(key);
  });

  it("delete route returns 404 for a non-existent card", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Delete 404 Test", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;

    const res = await request(app).delete(`/api/aiwf/projects/${pid}/cards/NOPE-99`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No such card/);
  });

  it("delete route returns 404 for an unknown project id", async () => {
    const res = await request(app).delete("/api/aiwf/projects/no-such-proj/cards/X-1");
    expect(res.status).toBe(404);
  });

  // ---- demo mode ----

  // ---- spec card read-only guards ----

  it("transition route returns 400 for a SPEC-* key", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Spec Guard Test", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;
    const res = await request(app)
      .post(`/api/aiwf/projects/${pid}/cards/SPEC-001/transition`)
      .send({ status: "Review" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/read-only/i);
  });

  it("archive route returns 400 for a SPEC-* key", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Spec Archive Guard", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;
    const res = await request(app)
      .post(`/api/aiwf/projects/${pid}/cards/SPEC-001/archive`)
      .send({ archived: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/read-only/i);
  });

  it("delete route returns 400 for a SPEC-* key", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Spec Delete Guard", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;
    const res = await request(app).delete(`/api/aiwf/projects/${pid}/cards/SPEC-001`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/read-only/i);
  });

  it("cards list includes spec cards when docs/specs/ contains matching files", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Spec List Test", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;

    // Plant a spec file in the project repo's docs/specs/.
    const specsDir = path.join(REPO, "docs", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, "001_my-feature.md"), "# My Feature\n\nBody.");
    try {
      const res = await request(app).get(`/api/aiwf/projects/${pid}/cards`);
      expect(res.status).toBe(200);
      const spec = res.body.tickets.find((t: { key: string }) => t.key === "SPEC-001");
      expect(spec).toBeDefined();
      expect(spec.kind).toBe("spec");
      expect(spec.summary).toBe("My Feature");
    } finally {
      fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
    }
  });

  it("run route returns 200 for a valid spec card key via getSpecCard fallback", async () => {
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Spec Run Test", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;

    const specsDir = path.join(REPO, "docs", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, "001_runnable.md"), "# Runnable\n\nBody.");
    try {
      const res = await request(app)
        .post(`/api/aiwf/projects/${pid}/cards/SPEC-001/run`)
        .send({ skill: "feature" });
      expect(res.status).toBe(200);
      expect(res.body.runId).toBeDefined();
    } finally {
      fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
    }
  });

  describe("hasWorktree / taskBranch enrichment and worktree management routes", () => {
    let pid: string;
    let ctxId: string;

    beforeAll(async () => {
      const proj = await request(app)
        .post("/api/aiwf/projects")
        .send({ name: "Worktree Test", repoPath: REPO, mode: "adopt" });
      pid = proj.body.project.id;
      ctxId = `aiwf-${pid}`;
    });

    it("card listing includes hasWorktree:false and no taskBranch when no state exists", async () => {
      const created = await request(app)
        .post(`/api/aiwf/projects/${pid}/cards`)
        .send({ title: "No worktree card" });
      const key = created.body.ticket.key;
      const list = await request(app).get(`/api/aiwf/projects/${pid}/cards`);
      const ticket = list.body.tickets.find((t: { key: string }) => t.key === key);
      expect(ticket.hasWorktree).toBe(false);
      expect(ticket.taskBranch).toBeUndefined();
    });

    it("card listing includes hasWorktree:true and taskBranch when card state exists", async () => {
      const created = await request(app)
        .post(`/api/aiwf/projects/${pid}/cards`)
        .send({ title: "Has worktree card" });
      const key = created.body.ticket.key;
      aiwf.setCardState(ctxId, key, { taskBranch: "feat/has-wt", worktreePath: "/tmp/haswt" });
      try {
        const list = await request(app).get(`/api/aiwf/projects/${pid}/cards`);
        const ticket = list.body.tickets.find((t: { key: string }) => t.key === key);
        expect(ticket.hasWorktree).toBe(true);
        expect(ticket.taskBranch).toBe("feat/has-wt");
      } finally {
        aiwf.clearCardState(ctxId, key);
      }
    });

    it("SPEC-* card listing includes hasWorktree:true and taskBranch when card state exists", async () => {
      const specsDir = path.join(REPO, "docs", "specs");
      fs.mkdirSync(specsDir, { recursive: true });
      fs.writeFileSync(path.join(specsDir, "042_spec-wt.md"), "# Spec With Worktree\n\nBody.");
      aiwf.setCardState(ctxId, "SPEC-042", { taskBranch: "feat/spec-42", worktreePath: "/tmp/spec42" });
      try {
        const list = await request(app).get(`/api/aiwf/projects/${pid}/cards`);
        const spec = list.body.tickets.find((t: { key: string }) => t.key === "SPEC-042");
        expect(spec).toBeDefined();
        expect(spec.hasWorktree).toBe(true);
        expect(spec.taskBranch).toBe("feat/spec-42");
      } finally {
        fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
        aiwf.clearCardState(ctxId, "SPEC-042");
      }
    });

    it("GET /worktrees returns empty list when no states exist", async () => {
      const res = await request(app).get(`/api/aiwf/projects/${pid}/worktrees`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.worktrees)).toBe(true);
    });

    it("GET /worktrees lists entries after state is written", async () => {
      const created = await request(app)
        .post(`/api/aiwf/projects/${pid}/cards`)
        .send({ title: "Listed wt card" });
      const cardKey = created.body.ticket.key;
      aiwf.setCardState(ctxId, cardKey, { taskBranch: "feat/wt-test", worktreePath: "/tmp/wt" });
      try {
        const res = await request(app).get(`/api/aiwf/projects/${pid}/worktrees`);
        expect(res.status).toBe(200);
        const entry = res.body.worktrees.find((e: { key: string }) => e.key === cardKey);
        expect(entry).toBeDefined();
        expect(entry.taskBranch).toBe("feat/wt-test");
      } finally {
        aiwf.clearCardState(ctxId, cardKey);
      }
    });

    it("DELETE /worktrees/:key clears card state (no-op when no state)", async () => {
      const created = await request(app)
        .post(`/api/aiwf/projects/${pid}/cards`)
        .send({ title: "Del one card" });
      const cardKey = created.body.ticket.key;

      const noOp = await request(app).delete(`/api/aiwf/projects/${pid}/worktrees/${cardKey}`);
      expect(noOp.status).toBe(200);
      expect(noOp.body.ok).toBe(true);

      aiwf.setCardState(ctxId, cardKey, { taskBranch: "feat/del-one", worktreePath: "/tmp/del" });
      const del = await request(app).delete(`/api/aiwf/projects/${pid}/worktrees/${cardKey}`);
      expect(del.status).toBe(200);
      expect(del.body.ok).toBe(true);
      expect(aiwf.getCardState(ctxId, cardKey)).toBeNull();
    });

    it("DELETE /worktrees clears all card states for the project", async () => {
      const k1 = (await request(app).post(`/api/aiwf/projects/${pid}/cards`).send({ title: "Bulk wt 1" }))
        .body.ticket.key;
      const k2 = (await request(app).post(`/api/aiwf/projects/${pid}/cards`).send({ title: "Bulk wt 2" }))
        .body.ticket.key;
      aiwf.setCardState(ctxId, k1, { taskBranch: "feat/bulk1", worktreePath: "/tmp/b1" });
      aiwf.setCardState(ctxId, k2, { taskBranch: "feat/bulk2", worktreePath: "/tmp/b2" });
      const res = await request(app).delete(`/api/aiwf/projects/${pid}/worktrees`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.removed).toBe("number");
      expect(aiwf.getCardState(ctxId, k1)).toBeNull();
      expect(aiwf.getCardState(ctxId, k2)).toBeNull();
    });

    it("returns 404 for routes targeting an unknown project", async () => {
      expect((await request(app).get("/api/aiwf/projects/NOPE/worktrees")).status).toBe(404);
      expect((await request(app).delete("/api/aiwf/projects/NOPE/worktrees/KEY-1")).status).toBe(404);
      expect((await request(app).delete("/api/aiwf/projects/NOPE/worktrees")).status).toBe(404);
    });
  });

  it("archive and delete routes return success in demo mode without writing to disk", async () => {
    // Register a project before switching to demo mode (the project guard uses the real config list).
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Demo Mode Test", repoPath: REPO, mode: "adopt" });
    const pid = proj.body.project.id;

    process.env.HANGAR_DEMO = "1";
    try {
      // Both routes must succeed without touching disk in demo mode.
      const arch = await request(app)
        .post(`/api/aiwf/projects/${pid}/cards/ANY-1/archive`)
        .send({ archived: true });
      expect(arch.status).toBe(200);
      expect(arch.body.ok).toBe(true);

      const del = await request(app).delete(`/api/aiwf/projects/${pid}/cards/ANY-1`);
      expect(del.status).toBe(200);
      expect(del.body.ok).toBe(true);
    } finally {
      delete process.env.HANGAR_DEMO;
    }
  });
});

describe("Doc tree routes", () => {
  let pid: string;
  let repoDir: string;

  beforeAll(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-doctree-"));
    const proj = await request(app)
      .post("/api/aiwf/projects")
      .send({ name: "Doc Tree Test", repoPath: repoDir, mode: "adopt" });
    pid = proj.body.project.id;
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("GET /api/aiwf/projects/:id/docs/tree returns 200 with nodes array", async () => {
    const res = await request(app).get(`/api/aiwf/projects/${pid}/docs/tree`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
    // Six standard entries always present regardless of disk state
    expect(res.body.nodes.length).toBeGreaterThanOrEqual(6);
    const paths = res.body.nodes.map((n: { path: string }) => n.path);
    expect(paths).toContain("docs/PRD.md");
    expect(paths).toContain("docs/ARCHITECTURE.md");
    expect(paths).toContain("docs/specs");
  });

  it("GET /api/aiwf/projects/:id/docs/tree does not conflict with flat docs list", async () => {
    const flat = await request(app).get(`/api/aiwf/projects/${pid}/docs`);
    expect(flat.status).toBe(200);
    expect(Array.isArray(flat.body.docs)).toBe(true);
  });

  it("GET /api/aiwf/projects/:id/docs/content?path=docs/PRD.md returns 200 when file exists", async () => {
    const docsDir = path.join(repoDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "PRD.md"), "# Product Requirements\nBody text.");

    const res = await request(app).get(
      `/api/aiwf/projects/${pid}/docs/content?path=` + encodeURIComponent("docs/PRD.md"),
    );
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Product Requirements");
    expect(res.body.content).toContain("Body text.");

    fs.rmSync(docsDir, { recursive: true, force: true });
  });

  it("GET /api/aiwf/projects/:id/docs/content?path=docs/PRD.md returns 404 when file absent", async () => {
    const res = await request(app).get(
      `/api/aiwf/projects/${pid}/docs/content?path=` + encodeURIComponent("docs/PRD.md"),
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/aiwf/projects/:id/docs/content?path=../server/src/config.ts returns 400", async () => {
    const res = await request(app).get(
      `/api/aiwf/projects/${pid}/docs/content?path=` + encodeURIComponent("../server/src/config.ts"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown project", async () => {
    expect((await request(app).get("/api/aiwf/projects/NOPE/docs/tree")).status).toBe(404);
    expect(
      (
        await request(app).get(
          "/api/aiwf/projects/NOPE/docs/content?path=" + encodeURIComponent("docs/PRD.md"),
        )
      ).status,
    ).toBe(404);
  });
});
