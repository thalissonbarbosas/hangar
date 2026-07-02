import fs from "fs";
import os from "os";
import path from "path";

const mockDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-unit-data-"));
fs.writeFileSync(path.join(mockDataDir, "big.json"), "x".repeat(4096));

jest.mock("../store", () => ({ DATA_DIR: mockDataDir }));
jest.mock("../config", () => ({
  getConfig: jest.fn(() => ({ boards: [{ repoPath: "/repo" }] })),
  boardPaths: jest.fn((b: { repoPath?: string }) => (b.repoPath ? [b.repoPath] : [])),
  jiraSettingsView: jest.fn(() => ({ configured: false, baseUrl: "", email: "", hasToken: false })),
}));
jest.mock("../worktree", () => ({ countWorktreeOrphans: jest.fn(async () => 0) }));
jest.mock("../sessions", () => ({ listRuns: jest.fn(() => []), recoverableRuns: jest.fn(() => []) }));

import { runDiagnostics } from "../doctor";
import { jiraSettingsView } from "../config";
import { countWorktreeOrphans } from "../worktree";
import { listRuns } from "../sessions";

const jiraView = jiraSettingsView as jest.Mock;
const orphans = countWorktreeOrphans as jest.Mock;
const runsList = listRuns as jest.Mock;

function checkById(report: Awaited<ReturnType<typeof runDiagnostics>>, id: string) {
  return report.checks.find((c) => c.id === id)!;
}

describe("runDiagnostics", () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    jiraView.mockReturnValue({ configured: false, baseUrl: "", email: "", hasToken: false });
    orphans.mockResolvedValue(0);
    runsList.mockReturnValue([]);
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    jest.restoreAllMocks();
  });

  it("returns every check plus a recoverable list and a numeric generatedAt", async () => {
    const report = await runDiagnostics();
    const ids = report.checks.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["auth", "jira", "worktrees", "disk", "runs"]));
    expect(Array.isArray(report.recoverableSessions)).toBe(true);
    expect(typeof report.generatedAt).toBe("number");
  });

  it("auth is ok with ANTHROPIC_API_KEY set, without echoing the value", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-secret-value";
    const auth = checkById(await runDiagnostics(), "auth");
    expect(auth.status).toBe("ok");
    expect(auth.detail).not.toContain("sk-secret-value");
  });

  it("auth is an error when neither the key nor a host login exists", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    jest.spyOn(os, "homedir").mockReturnValue(mockDataDir); // no ~/.claude under here
    const auth = checkById(await runDiagnostics(), "auth");
    expect(auth.status).toBe("error");
    expect(auth.hint).toBeTruthy();
  });

  it("jira warns and names the missing pieces when unconfigured", async () => {
    const jira = checkById(await runDiagnostics(), "jira");
    expect(jira.status).toBe("warn");
    expect(jira.detail).toMatch(/base URL/);
  });

  it("jira is ok when fully configured", async () => {
    jiraView.mockReturnValue({ configured: true, baseUrl: "https://x", email: "a@b.c", hasToken: true });
    expect(checkById(await runDiagnostics(), "jira").status).toBe("ok");
  });

  it("worktrees warns with a count when orphans are present", async () => {
    orphans.mockResolvedValue(2);
    const wt = checkById(await runDiagnostics(), "worktrees");
    expect(wt.status).toBe("warn");
    expect(wt.detail).toContain("2");
  });

  it("disk reports a human-readable size and is ok for a small data dir", async () => {
    const disk = checkById(await runDiagnostics(), "disk");
    expect(disk.status).toBe("ok");
    expect(disk.detail).toMatch(/\d+(\.\d+)? (B|KB|MB)/);
  });

  it("runs summarizes stopped/errored counts", async () => {
    runsList.mockReturnValue([{ state: "stopped" }, { state: "error" }, { state: "done" }]);
    const runs = checkById(await runDiagnostics(), "runs");
    expect(runs.status).toBe("ok");
    expect(runs.detail).toContain("1 stopped");
    expect(runs.detail).toContain("1 errored");
  });

  it("turns a throwing check into an error row instead of failing the report", async () => {
    runsList.mockImplementation(() => {
      throw new Error("boom");
    });
    const runs = checkById(await runDiagnostics(), "runs");
    expect(runs.status).toBe("error");
    expect(runs.detail).toMatch(/boom/);
  });
});
