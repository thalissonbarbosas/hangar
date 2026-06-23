import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// A real git repo as the project root so the checkout routes exercise real `git checkout`,
// `git rev-parse`, and worktree removal — no child_process mocking here.
function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "checkout-repo-"));
  const run = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  run(["init", "-b", "main"]);
  run(["config", "user.email", "t@example.com"]);
  run(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "file.txt"), "a\n");
  run(["add", "-A"]);
  run(["commit", "-m", "init"]);
  return dir;
}

const REPO = initRepo();
const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "checkout-cfg-"));
const CONFIG_PATH = path.join(CFG_DIR, "hangar.config.json");
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({
    agentsDir: "~/.claude/agents",
    skillsDir: fs.mkdtempSync(path.join(os.tmpdir(), "checkout-skills-")),
    boards: [{ key: "X", name: "X", statuses: ["To Do"] }],
    aiWorkflow: { projects: [{ id: "p1", name: "Demo Project", repoPath: REPO, createdAt: 0 }] },
  }),
);
process.env.CONFIG_PATH = CONFIG_PATH;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "checkout-data-"));
process.env.HANGAR_DATA_DIR = DATA;
delete process.env.HANGAR_DEMO;
for (const k of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"])
  process.env[k] = "";

// Skills/agents resolve trivially — the checkout routes don't use them, but index.ts loads both.
jest.mock("../skills", () => ({
  allSkills: () => [],
  findSkill: () => null,
  skillExists: () => true,
}));
jest.mock("../agents", () => ({ loadAgents: () => [], loadAgent: () => null }));

// Mock only the active-session guard so we can drive the 409 branch deterministically.
// Everything else in ../sessions (and ../worktree) stays real.
const activeRunsInDir = jest.fn<{ id: string; title: string }[], [string]>(() => []);
jest.mock("../sessions", () => ({
  ...jest.requireActual("../sessions"),
  activeRunsInDir: (...a: [string]) => activeRunsInDir(...a),
}));

import request from "supertest";
import { app } from "../index";
import * as aiwf from "../aiwf";

const git = (args: string[]) => execFileSync("git", ["-C", REPO, ...args], { stdio: "pipe" });
const headBranch = () => git(["rev-parse", "--abbrev-ref", "HEAD"]).toString().trim();

beforeEach(() => {
  activeRunsInDir.mockReset();
  activeRunsInDir.mockReturnValue([]);
  // Reset the repo to a clean main between tests.
  git(["checkout", "-f", "main"]);
  git(["clean", "-fd"]);
});

describe("AIWF branch checkout routes", () => {
  it("GET /branch returns the current HEAD branch", async () => {
    const res = await request(app).get("/api/aiwf/projects/p1/branch");
    expect(res.status).toBe(200);
    expect(res.body.branch).toBe("main");
  });

  it("GET /branch 404s for an unknown project", async () => {
    expect((await request(app).get("/api/aiwf/projects/nope/branch")).status).toBe(404);
  });

  it("POST cards/:key/checkout switches HEAD to the task branch and removes the worktree", async () => {
    // resolveCardWorktree creates the branch + worktree, mirroring a delivery-skill run.
    const wt = await aiwf.resolveCardWorktree("aiwf-p1", "AUR-1", "feature", REPO);
    expect(wt).not.toBeNull();
    expect(aiwf.getCardState("aiwf-p1", "AUR-1")).not.toBeNull();

    const res = await request(app).post("/api/aiwf/projects/p1/cards/AUR-1/checkout");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.branch).toBe(wt!.branch);
    expect(res.body.previousBranch).toBe("main");
    expect(headBranch()).toBe(wt!.branch);
    // Worktree freed: card state cleared, branch preserved.
    expect(aiwf.getCardState("aiwf-p1", "AUR-1")).toBeNull();
    expect(git(["rev-parse", "--verify", wt!.branch]).toString().trim()).toBeTruthy();
  });

  it("POST cards/:key/checkout returns 400 when the card has no task branch", async () => {
    const created = await request(app).post("/api/aiwf/projects/p1/cards").send({ title: "No branch yet" });
    const res = await request(app).post(`/api/aiwf/projects/p1/cards/${created.body.ticket.key}/checkout`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no task branch/i);
  });

  it("POST cards/:key/checkout returns 404 for an unknown card with no state", async () => {
    expect((await request(app).post("/api/aiwf/projects/p1/cards/NOPE-1/checkout")).status).toBe(404);
  });

  it("POST cards/:key/checkout returns 409 active_sessions with runIds when a run is live", async () => {
    git(["branch", "feat/guarded"]);
    aiwf.setCardState("aiwf-p1", "AUR-9", {
      taskBranch: "feat/guarded",
      worktreePath: path.join(DATA, "no-such-wt"),
    });
    activeRunsInDir.mockReturnValue([{ id: "run-1", title: "Build auth" }]);

    const res = await request(app).post("/api/aiwf/projects/p1/cards/AUR-9/checkout");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("active_sessions");
    expect(res.body.runIds).toEqual(["run-1"]);
    expect(res.body.titles).toEqual(["Build auth"]);
    expect(headBranch()).toBe("main"); // checkout did not proceed
    aiwf.clearCardState("aiwf-p1", "AUR-9");
  });

  it("POST cards/:key/checkout proceeds when only inactive (done) runs exist", async () => {
    git(["branch", "feat/done-only"]);
    aiwf.setCardState("aiwf-p1", "AUR-8", { taskBranch: "feat/done-only", worktreePath: "" });
    activeRunsInDir.mockReturnValue([]); // guard scans only ACTIVE_STATES → done runs ignored

    const res = await request(app).post("/api/aiwf/projects/p1/cards/AUR-8/checkout");
    expect(res.status).toBe(200);
    expect(headBranch()).toBe("feat/done-only");
  });

  it("POST /checkout switches to an arbitrary branch and back to main", async () => {
    git(["branch", "feat/generic"]);
    const toBranch = await request(app)
      .post("/api/aiwf/projects/p1/checkout")
      .send({ branch: "feat/generic" });
    expect(toBranch.status).toBe(200);
    expect(toBranch.body.branch).toBe("feat/generic");
    expect(headBranch()).toBe("feat/generic");

    const back = await request(app).post("/api/aiwf/projects/p1/checkout").send({ branch: "main" });
    expect(back.status).toBe(200);
    expect(headBranch()).toBe("main");
  });

  it("POST /checkout rejects a path-traversal branch name with 400", async () => {
    const res = await request(app).post("/api/aiwf/projects/p1/checkout").send({ branch: "../../etc" });
    expect(res.status).toBe(400);
    expect(headBranch()).toBe("main");
  });

  it("POST /checkout returns 400 when branch is missing", async () => {
    expect((await request(app).post("/api/aiwf/projects/p1/checkout").send({})).status).toBe(400);
  });

  it("POST /checkout returns 409 dirty_tree with git stderr when uncommitted changes block checkout", async () => {
    // A branch whose file.txt differs from a dirty working-tree edit on main → checkout is refused.
    git(["checkout", "-b", "feat/diverged"]);
    fs.writeFileSync(path.join(REPO, "file.txt"), "b\n");
    git(["commit", "-am", "diverge"]);
    git(["checkout", "main"]);
    fs.writeFileSync(path.join(REPO, "file.txt"), "dirty\n"); // uncommitted, conflicting

    const res = await request(app).post("/api/aiwf/projects/p1/checkout").send({ branch: "feat/diverged" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("dirty_tree");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(headBranch()).toBe("main"); // still on main
  });

  it("POST /checkout 409 active_sessions before running git", async () => {
    activeRunsInDir.mockReturnValue([{ id: "r2", title: "Live run" }]);
    const res = await request(app).post("/api/aiwf/projects/p1/checkout").send({ branch: "main" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("active_sessions");
    expect(res.body.runIds).toEqual(["r2"]);
  });
});
