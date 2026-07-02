import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";

// Bootstrap a minimal config so the server boots without real Jira/config on disk.
const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "doc-rt-cfg-"));
const CONFIG_PATH = path.join(CFG_DIR, "hangar.config.json");
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({
    agentsDir: "~/.claude/agents",
    skillsDir: fs.mkdtempSync(path.join(os.tmpdir(), "doc-rt-skills-")),
    boards: [{ key: "X", name: "X", statuses: ["To Do"] }],
  }),
);
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.HANGAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "doc-rt-data-"));
delete process.env.HANGAR_DEMO;
for (const k of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"])
  process.env[k] = "";

jest.mock("../skills", () => {
  const actual = jest.requireActual("../skills");
  return { ...actual, allSkills: () => [], findSkill: () => undefined, skillExists: () => false };
});

const getRunMock = jest.fn();
const recoverRunMock = jest.fn();
jest.mock("../sessions", () => {
  const actual = jest.requireActual("../sessions");
  return {
    ...actual,
    getRun: (...a: unknown[]) => getRunMock(...a),
    recoverRun: (...a: unknown[]) => recoverRunMock(...a),
  };
});

import { app } from "../index";

describe("GET /api/doctor", () => {
  it("returns the health report with all checks and a recoverable list", async () => {
    const res = await request(app).get("/api/doctor");
    expect(res.status).toBe(200);
    const ids = res.body.checks.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["auth", "jira", "worktrees", "disk", "runs"]));
    expect(Array.isArray(res.body.recoverableSessions)).toBe(true);
    expect(typeof res.body.generatedAt).toBe("number");
    // Jira is unconfigured in this bootstrap → that check warns, never exposing a token.
    const jira = res.body.checks.find((c: { id: string }) => c.id === "jira");
    expect(jira.status).toBe("warn");
  });
});

describe("POST /api/doctor/sessions/:id/recover", () => {
  it("404s for an unknown run", async () => {
    getRunMock.mockReturnValue(undefined);
    const res = await request(app).post("/api/doctor/sessions/ghost/recover");
    expect(res.status).toBe(404);
  });

  it("409s when the run can't be recovered", async () => {
    getRunMock.mockReturnValue({ id: "r1" });
    recoverRunMock.mockReturnValue("not_recoverable");
    const res = await request(app).post("/api/doctor/sessions/r1/recover");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_recoverable");
  });

  it("200s with the run id when recovery starts", async () => {
    getRunMock.mockReturnValue({ id: "r1" });
    recoverRunMock.mockReturnValue("started");
    const res = await request(app).post("/api/doctor/sessions/r1/recover");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, runId: "r1" });
  });
});
