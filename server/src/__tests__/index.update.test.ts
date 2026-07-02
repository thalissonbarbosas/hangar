import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";

// Bootstrap a minimal config so the server boots without real Jira/config on disk.
const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "upd-rt-cfg-"));
const CONFIG_PATH = path.join(CFG_DIR, "hangar.config.json");
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({
    agentsDir: "~/.claude/agents",
    skillsDir: fs.mkdtempSync(path.join(os.tmpdir(), "upd-rt-skills-")),
    boards: [{ key: "X", name: "X", statuses: ["To Do"] }],
  }),
);
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.HANGAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "upd-rt-data-"));
delete process.env.HANGAR_DEMO;
for (const k of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"])
  process.env[k] = "";

const getUpdateStatus = jest.fn();
const applyUpdate = jest.fn();
jest.mock("../update", () => {
  const actual = jest.requireActual("../update");
  return {
    ...actual,
    getUpdateStatus: () => getUpdateStatus(),
    applyUpdate: () => applyUpdate(),
  };
});

jest.mock("../skills", () => {
  const actual = jest.requireActual("../skills");
  return { ...actual, allSkills: () => [], findSkill: () => undefined, skillExists: () => false };
});

import { app } from "../index";
import { UpdateRefused } from "../update";

describe("GET /api/update/status", () => {
  it("returns the update status", async () => {
    getUpdateStatus.mockResolvedValue({ git: true, behind: 2, version: "1.2.3" });
    const res = await request(app).get("/api/update/status");
    expect(res.status).toBe(200);
    expect(res.body.behind).toBe(2);
  });
});

describe("POST /api/update/pull", () => {
  it("returns the result on success", async () => {
    applyUpdate.mockResolvedValue({ ok: true, fromCommit: "a", toCommit: "b", changedFiles: 1 });
    const res = await request(app).post("/api/update/pull");
    expect(res.status).toBe(200);
    expect(res.body.toCommit).toBe("b");
  });

  it("maps a refusal to 409", async () => {
    applyUpdate.mockRejectedValue(new UpdateRefused("working tree has uncommitted changes"));
    const res = await request(app).post("/api/update/pull");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/uncommitted/);
  });

  it("maps demo-mode refusal to 403", async () => {
    applyUpdate.mockRejectedValue(new UpdateRefused("unavailable in demo mode", true));
    const res = await request(app).post("/api/update/pull");
    expect(res.status).toBe(403);
  });

  it("maps an unexpected error to 500", async () => {
    applyUpdate.mockRejectedValue(new Error("boom"));
    const res = await request(app).post("/api/update/pull");
    expect(res.status).toBe(500);
  });
});
