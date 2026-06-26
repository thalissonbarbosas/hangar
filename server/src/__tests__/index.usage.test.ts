import fs from "fs";
import os from "os";
import path from "path";

// ---------------------------------------------------------------------------
// Test environment bootstrap (must happen before any module is imported)
// ---------------------------------------------------------------------------
const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "usage-rt-cfg-"));
const CONFIG_PATH = path.join(CFG_DIR, "hangar.config.json");
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({
    agentsDir: "~/.claude/agents",
    skillsDir: fs.mkdtempSync(path.join(os.tmpdir(), "usage-rt-skills-")),
    boards: [{ key: "X", name: "X", statuses: ["To Do"] }],
  }),
);
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.HANGAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "usage-rt-data-"));
delete process.env.HANGAR_DEMO;
for (const k of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"])
  process.env[k] = "";

// ---------------------------------------------------------------------------
// child_process mock — wraps execFile so execFileAsync (which uses
// promisify.custom) is a fully controllable jest.fn() per test.
// All three usage endpoints now go through execFileAsync.
// ---------------------------------------------------------------------------
jest.mock("child_process", () => {
  const { promisify } = jest.requireActual("util") as typeof import("util");

  const execFileFn = jest.fn();
  (execFileFn as any)[promisify.custom] = jest.fn();

  return {
    ...jest.requireActual("child_process"),
    execFile: execFileFn,
  };
});

// Minimal skill / agent / worktree stubs so the server boots cleanly.
jest.mock("../skills", () => {
  const actual = jest.requireActual("../skills");
  return { ...actual, allSkills: () => [], findSkill: () => undefined, skillExists: () => false };
});
jest.mock("../agents", () => {
  const actual = jest.requireActual("../agents");
  return { ...actual, loadAgents: () => [], loadAgent: () => null };
});
jest.mock("../worktree", () => ({
  createWorktree: jest.fn(async () => null),
  removeWorktree: jest.fn(async () => {}),
  pruneWorktrees: jest.fn(async () => {}),
  currentBranch: jest.fn(async () => "main"),
  checkoutBranch: jest.fn(async () => {}),
  findWorktreePath: jest.fn(async () => null),
  sanitize: jest.fn((s: string) => s),
}));

import request from "supertest";
import { execFile } from "child_process";
import { promisify } from "util";
import { app } from "../index";

// Grab the jest.fn() that execFileAsync delegates to (all three endpoints use it).
const execFileMock = (execFile as any)[promisify.custom] as jest.Mock;

beforeEach(() => {
  execFileMock.mockReset();
});

// ---------------------------------------------------------------------------
// GET /api/usage/status
// ---------------------------------------------------------------------------
describe("GET /api/usage/status", () => {
  it("returns installed:true with trimmed version when ccusage is found", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "20.0.14\n", stderr: "" });
    const res = await request(app).get("/api/usage/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ installed: true, version: "20.0.14" });
  });

  it("returns installed:false when ccusage is not in PATH (ENOENT)", async () => {
    const err = Object.assign(new Error("not found"), { code: "ENOENT" });
    execFileMock.mockRejectedValueOnce(err);
    const res = await request(app).get("/api/usage/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ installed: false, version: null });
  });

  it("returns installed:false for any other execFile error", async () => {
    execFileMock.mockRejectedValueOnce(new Error("timeout"));
    const res = await request(app).get("/api/usage/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ installed: false, version: null });
  });
});

// ---------------------------------------------------------------------------
// GET /api/usage/data
// ---------------------------------------------------------------------------
describe("GET /api/usage/data", () => {
  const dailySample = { daily: [{ period: "2026-06-25", totalCost: 22.72 }] };

  it("calls ccusage daily --json --no-color and returns parsed JSON", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: JSON.stringify(dailySample), stderr: "" });
    const res = await request(app).get("/api/usage/data?mode=daily");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(dailySample);
    expect(execFileMock).toHaveBeenCalledWith(
      "ccusage",
      ["daily", "--json", "--no-color"],
      expect.any(Object),
    );
  });

  it("appends --since when provided", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: JSON.stringify(dailySample), stderr: "" });
    await request(app).get("/api/usage/data?mode=daily&since=2026-01-01");
    expect(execFileMock).toHaveBeenCalledWith(
      "ccusage",
      ["daily", "--json", "--no-color", "--since", "2026-01-01"],
      expect.any(Object),
    );
  });

  it("appends --until when provided", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: JSON.stringify(dailySample), stderr: "" });
    await request(app).get("/api/usage/data?mode=daily&until=2026-06-30");
    expect(execFileMock).toHaveBeenCalledWith(
      "ccusage",
      ["daily", "--json", "--no-color", "--until", "2026-06-30"],
      expect.any(Object),
    );
  });

  it("appends --active for blocks mode with active=true", async () => {
    const blocksSample = { blocks: [] };
    execFileMock.mockResolvedValueOnce({ stdout: JSON.stringify(blocksSample), stderr: "" });
    await request(app).get("/api/usage/data?mode=blocks&active=true");
    expect(execFileMock).toHaveBeenCalledWith(
      "ccusage",
      ["blocks", "--json", "--no-color", "--active"],
      expect.any(Object),
    );
  });

  it("appends --recent for blocks mode with recent=true", async () => {
    const blocksSample = { blocks: [] };
    execFileMock.mockResolvedValueOnce({ stdout: JSON.stringify(blocksSample), stderr: "" });
    await request(app).get("/api/usage/data?mode=blocks&recent=true");
    expect(execFileMock).toHaveBeenCalledWith(
      "ccusage",
      ["blocks", "--json", "--no-color", "--recent"],
      expect.any(Object),
    );
  });

  it("does NOT forward --active or --recent for non-blocks modes", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: JSON.stringify(dailySample), stderr: "" });
    await request(app).get("/api/usage/data?mode=daily&active=true&recent=true");
    const calledArgs: string[] = execFileMock.mock.calls[0][1];
    expect(calledArgs).not.toContain("--active");
    expect(calledArgs).not.toContain("--recent");
  });

  it("returns 400 for an invalid mode", async () => {
    const res = await request(app).get("/api/usage/data?mode=invalid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid mode/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed since date", async () => {
    const res = await request(app).get("/api/usage/data?mode=daily&since=not-a-date");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid since/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a since date with invalid month (13)", async () => {
    const res = await request(app).get("/api/usage/data?mode=daily&since=2026-13-01");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid since/);
  });

  it("returns 400 for a malformed until date", async () => {
    const res = await request(app).get("/api/usage/data?mode=daily&until=bad");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid until/);
  });

  it("returns 503 when ccusage binary is absent (ENOENT)", async () => {
    const err = Object.assign(new Error("not found"), { code: "ENOENT" });
    execFileMock.mockRejectedValueOnce(err);
    const res = await request(app).get("/api/usage/data?mode=daily");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/ccusage not installed/);
  });

  it("returns 500 on a non-ENOENT ccusage failure", async () => {
    execFileMock.mockRejectedValueOnce(new Error("ccusage exited with code 1"));
    const res = await request(app).get("/api/usage/data?mode=daily");
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/usage/install
// ---------------------------------------------------------------------------
describe("POST /api/usage/install", () => {
  it("returns ok:true with install output on success", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "added 1 package\n", stderr: "" });
    const res = await request(app).post("/api/usage/install");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, output: "added 1 package\n" });
    // Verify it uses execFileAsync with a fixed args array (no shell interpolation)
    expect(execFileMock).toHaveBeenCalledWith("npm", ["install", "-g", "ccusage"], expect.any(Object));
  });

  it("returns 500 with error message on install failure", async () => {
    execFileMock.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    const res = await request(app).post("/api/usage/install");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/EACCES/);
    expect(res.body.raw).toBeDefined();
  });
});
