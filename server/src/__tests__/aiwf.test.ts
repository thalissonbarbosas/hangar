import fs from "fs";
import os from "os";
import path from "path";

// aiwf.ts shells out for install/uninstall/version — mock child_process so nothing runs for real.
// exec must carry util.promisify.custom so promisify(exec) returns { stdout, stderr } like the real impl.
jest.mock("child_process", () => {
  const { promisify } = jest.requireActual("util") as typeof import("util");
  const execFn = jest.fn();
  const execFileFn = jest.fn();

  (execFn as any)[promisify.custom] = jest.fn(() => Promise.resolve({ stdout: "", stderr: "" }));
  (execFileFn as any)[promisify.custom] = jest.fn(() => Promise.resolve({ stdout: "", stderr: "" }));
  return { execSync: jest.fn(), execFileSync: jest.fn(), exec: execFn, execFile: execFileFn };
});
import { execSync, execFileSync, exec, execFile } from "child_process";
import { promisify } from "util";
const execSyncMock = execSync as unknown as jest.Mock;
const execFileSyncMock = execFileSync as unknown as jest.Mock;

const execCustomMock = (exec as any)[promisify.custom] as jest.Mock;
const execFileCustomMock = (execFile as any)[promisify.custom] as jest.Mock;

function mockExecResolve(stdout: string) {
  execCustomMock.mockResolvedValue({ stdout, stderr: "" });
}
function mockExecReject(err: Error & { stdout?: string; stderr?: string }) {
  execCustomMock.mockRejectedValue(err);
}
function mockExecFileResolve(stdout: string) {
  execFileCustomMock.mockResolvedValue({ stdout, stderr: "" });
}
function mockExecFileReject(err: Error & { stdout?: string; stderr?: string }) {
  execFileCustomMock.mockRejectedValue(err);
}

// Wire a temp project repo + skills dir + config BEFORE config.ts loads (it reads CONFIG_PATH at
// module-eval and lazy-loads on first getConfig). appendCardHistory/detectAiwf read from this config.
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-repo-"));
const SKILLS = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-skills-"));
const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-cfg-"));
const CONFIG_PATH = path.join(CFG_DIR, "hangar.config.json");
// Board cards live in the data dir (store.ts reads HANGAR_DATA_DIR at module-eval) — isolate it to
// a temp dir so tests don't write into the real repo's .hangar. Must be set before aiwf is imported.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-data-"));
process.env.HANGAR_DATA_DIR = DATA;
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({
    agentsDir: "~/.claude/agents",
    skillsDir: SKILLS,
    boards: [{ key: "X", name: "X", statuses: ["To Do"] }],
    aiWorkflow: { projects: [{ id: "p1", name: "Demo Project", repoPath: REPO, createdAt: 0 }] },
  }),
);
process.env.CONFIG_PATH = CONFIG_PATH;
delete process.env.HANGAR_DEMO;
for (const k of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"])
  process.env[k] = "";

import * as aiwf from "../aiwf";
import { AiwfProject } from "../types";

// Mock worktree functions used by resolveTaskWorktree — real git not available in unit tests.
// Inline sanitize to avoid loading the real worktree.ts (which needs execFile from child_process).
jest.mock("../worktree", () => ({
  createWorktree: jest.fn(
    async (
      _dir: string,
      _label: string,
      _id: string,
      opts?: { branchName?: string; existingBranch?: string },
    ) => ({
      path: "/tmp/mock-wt",
      branch: opts?.branchName ?? opts?.existingBranch ?? "feat/mock",
      repoRoot: "/tmp/mock-repo",
    }),
  ),
  findWorktreePath: jest.fn(async () => null),
  sanitize: (s: string) =>
    s
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "run",
}));

const project: AiwfProject = { id: "p1", name: "Demo Project", repoPath: REPO, createdAt: 0 };

function rmrf(p: string) {
  fs.rmSync(p, { recursive: true, force: true });
}
function makeSkill(name: string) {
  const dir = path.join(SKILLS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\nbody`);
}

beforeEach(() => {
  execSyncMock.mockReset();
  execCustomMock.mockReset();
  rmrf(aiwf.boardDir(project)); // fresh board each test
  for (const e of fs.readdirSync(SKILLS)) rmrf(path.join(SKILLS, e)); // fresh skills each test
});
afterEach(() => jest.restoreAllMocks());

describe("constants", () => {
  it("columns are the phases plus a terminal Complete", () => {
    expect(aiwf.DEFAULT_COLUMNS).toEqual([
      "Planning",
      "Design",
      "Implementation",
      "Review",
      "Delivery",
      "Complete",
    ]);
    // COLUMN_SKILLS is keyed by the working phases only (Complete has no skills).
    expect(Object.keys(aiwf.COLUMN_SKILLS)).toEqual(aiwf.SKILL_GROUPS.map((g) => g.phase));
    expect(aiwf.COLUMN_SKILLS.Complete).toBeUndefined();
    expect(aiwf.COLUMN_SKILLS.Planning).toContain("prd");
  });
});

describe("listSpecCards / getSpecCard", () => {
  let specsDir: string;
  beforeEach(() => {
    specsDir = path.join(REPO, "docs", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
  });

  it("parses a single-file spec: key, summary (heading stripped), kind, source, status, description prefix", () => {
    fs.writeFileSync(path.join(specsDir, "001_foo.md"), "# Spec 001 — Foo\n\nBody text.");
    const cards = aiwf.listSpecCards(project);
    expect(cards).toHaveLength(1);
    expect(cards[0].key).toBe("SPEC-001");
    expect(cards[0].summary).toBe("Foo");
    expect(cards[0].kind).toBe("spec");
    expect(cards[0].source).toBe("aiwf");
    expect(cards[0].status).toBe("Implementation");
    expect(cards[0].description).toMatch(/^Spec: docs[/\\]specs[/\\]001_foo\.md/);
  });

  it("parses a sliced spec directory (README.md inside NNN_dir/)", () => {
    const dir = path.join(specsDir, "006_bar");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "# Feature: Bar\n\nContent.");
    const cards = aiwf.listSpecCards(project);
    expect(cards).toHaveLength(1);
    expect(cards[0].key).toBe("SPEC-006");
    expect(cards[0].summary).toBe("Bar");
  });

  it("ignores slice files inside a spec directory (not top-level entries)", () => {
    const dir = path.join(specsDir, "006_bar");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "# Bar\n");
    fs.writeFileSync(path.join(dir, "001_slice-a.md"), "# Slice A\n");
    const cards = aiwf.listSpecCards(project);
    expect(cards).toHaveLength(1);
    expect(cards[0].key).toBe("SPEC-006");
  });

  it("returns [] when docs/specs/ does not exist", () => {
    fs.rmSync(specsDir, { recursive: true, force: true });
    expect(aiwf.listSpecCards(project)).toEqual([]);
  });

  it("returns [] in demo mode", () => {
    process.env.HANGAR_DEMO = "1";
    try {
      fs.writeFileSync(path.join(specsDir, "001_foo.md"), "# Foo\n");
      expect(aiwf.listSpecCards(project)).toEqual([]);
    } finally {
      delete process.env.HANGAR_DEMO;
    }
  });

  it("getSpecCard returns the matching card for a known SPEC-NNN key", () => {
    fs.writeFileSync(path.join(specsDir, "001_foo.md"), "# Foo\n");
    expect(aiwf.getSpecCard(project, "SPEC-001")).not.toBeNull();
    expect(aiwf.getSpecCard(project, "SPEC-001")?.key).toBe("SPEC-001");
  });

  it("getSpecCard returns null for an unknown key or non-SPEC prefix", () => {
    fs.writeFileSync(path.join(specsDir, "001_foo.md"), "# Foo\n");
    expect(aiwf.getSpecCard(project, "SPEC-999")).toBeNull();
    expect(aiwf.getSpecCard(project, "X-1")).toBeNull();
  });

  it("returns specs sorted descending by numeric prefix (newest spec first)", () => {
    fs.writeFileSync(path.join(specsDir, "001_alpha.md"), "# Alpha\n");
    fs.writeFileSync(path.join(specsDir, "003_gamma.md"), "# Gamma\n");
    fs.writeFileSync(path.join(specsDir, "002_beta.md"), "# Beta\n");
    const cards = aiwf.listSpecCards(project);
    expect(cards.map((c) => c.key)).toEqual(["SPEC-003", "SPEC-002", "SPEC-001"]);
  });

  it("disambiguates two specs sharing a numeric prefix so keys stay unique", () => {
    fs.writeFileSync(path.join(specsDir, "014_alpha.md"), "# Alpha\n");
    fs.writeFileSync(path.join(specsDir, "014_beta.md"), "# Beta\n");
    const cards = aiwf.listSpecCards(project);
    const keys = cards.map((c) => c.key);
    // Both belong to prefix 014 but must be distinct (no duplicate React keys on the board).
    expect(new Set(keys).size).toBe(2);
    expect(keys).toEqual(["SPEC-014_alpha", "SPEC-014_beta"]);
    // Each disambiguated key still resolves back to its own card.
    expect(aiwf.getSpecCard(project, "SPEC-014_alpha")?.summary).toBe("Alpha");
    expect(aiwf.getSpecCard(project, "SPEC-014_beta")?.summary).toBe("Beta");
  });

  it("keeps the compact SPEC-NNN key when a numeric prefix is unique", () => {
    fs.writeFileSync(path.join(specsDir, "014_alpha.md"), "# Alpha\n");
    fs.writeFileSync(path.join(specsDir, "015_beta.md"), "# Beta\n");
    const cards = aiwf.listSpecCards(project);
    expect(cards.map((c) => c.key)).toEqual(["SPEC-015", "SPEC-014"]);
  });
});

describe("skillNeedsWorktree", () => {
  it("isolates source-editing implementation skills in a worktree", () => {
    for (const s of ["feature", "fix"]) {
      expect(aiwf.skillNeedsWorktree(s)).toBe(true);
    }
    expect(aiwf.WORKTREE_SKILLS.has("feature")).toBe(true);
  });
  it("runs doc, review, and self-delivering skills in place (no worktree)", () => {
    // planning/design/doc/review/delivery + the autopilot/factory orchestrators (they spawn their own
    // worktree subagents and open their own PRs, so an outer worktree would only fragment their git).
    for (const s of [
      "prd",
      "architecture",
      "roadmap",
      "spec",
      "new-project",
      "review",
      "commit",
      "pr",
      "autopilot",
      "factory",
    ]) {
      expect(aiwf.skillNeedsWorktree(s)).toBe(false);
    }
  });
});

describe("DELIVERY_SKILLS", () => {
  it("includes spec, code-producing, review, and delivery skills", () => {
    for (const s of ["spec", "feature", "fix", "review", "sec-review", "commit", "pr"]) {
      expect(aiwf.DELIVERY_SKILLS.has(s)).toBe(true);
    }
  });
  it("excludes planning, doc, and bootstrap skills", () => {
    for (const s of ["prd", "roadmap", "architecture", "new-project", "autopilot", "factory"]) {
      expect(aiwf.DELIVERY_SKILLS.has(s)).toBe(false);
    }
  });
});

describe("branchFromSpec", () => {
  let specsDir: string;
  beforeEach(() => {
    specsDir = path.join(REPO, "docs", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
  });

  it("derives feat/<slug> from a file with Type: feat in Trunk Metadata", () => {
    const file = path.join(specsDir, "007_standardize-agent-skill-selects.md");
    fs.writeFileSync(file, "# Feature\n\n## Trunk Metadata\n\n- **Type:** feat\n");
    expect(aiwf.branchFromSpec(file)).toBe("feat/standardize-agent-skill-selects");
  });

  it("derives fix/<slug> when Type is fix", () => {
    const file = path.join(specsDir, "006_fix-overflow.md");
    fs.writeFileSync(file, "# Fix\n\n## Trunk Metadata\n\n- **Type:** fix\n");
    expect(aiwf.branchFromSpec(file)).toBe("fix/fix-overflow");
  });

  it("falls back to feat/<slug> when Trunk Metadata is missing", () => {
    const file = path.join(specsDir, "008_no-metadata.md");
    fs.writeFileSync(file, "# No metadata here\n\nJust a spec.\n");
    expect(aiwf.branchFromSpec(file)).toBe("feat/no-metadata");
  });

  it("falls back to feat/<slug> for an unrecognized type", () => {
    const file = path.join(specsDir, "009_weird.md");
    fs.writeFileSync(file, "## Trunk Metadata\n\n- **Type:** unknown-type\n");
    expect(aiwf.branchFromSpec(file)).toBe("feat/weird");
  });

  it("uses directory slug for a sliced spec directory", () => {
    const dir = path.join(specsDir, "010_task-scoped-worktrees");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "# Feature\n\n## Trunk Metadata\n\n- **Type:** feat\n");
    expect(aiwf.branchFromSpec(dir)).toBe("feat/task-scoped-worktrees");
  });
});

describe("getSpecState / setSpecState / clearSpecState", () => {
  it("returns null when no state file exists", () => {
    expect(aiwf.getSpecState("p1", "SPEC-999")).toBeNull();
  });

  it("round-trips state through the data dir", () => {
    const state: aiwf.SpecState = { taskBranch: "feat/my-task", worktreePath: "/tmp/wt" };
    aiwf.setSpecState("p1", "SPEC-007", state);
    expect(aiwf.getSpecState("p1", "SPEC-007")).toEqual(state);
  });

  it("clearSpecState removes the file and does not throw if already absent", () => {
    aiwf.setSpecState("p1", "SPEC-001", { taskBranch: "feat/x", worktreePath: "/tmp/x" });
    aiwf.clearSpecState("p1", "SPEC-001");
    expect(aiwf.getSpecState("p1", "SPEC-001")).toBeNull();
    expect(() => aiwf.clearSpecState("p1", "SPEC-001")).not.toThrow(); // idempotent
  });
});

describe("resolveTaskWorktree", () => {
  let specsDir: string;
  beforeEach(() => {
    specsDir = path.join(REPO, "docs", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
    aiwf.clearCardState("aiwf-p1", "SPEC-007");
  });
  afterEach(() => {
    fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
    aiwf.clearCardState("aiwf-p1", "SPEC-007");
  });

  it("returns null for non-delivery skills (prd, roadmap)", async () => {
    expect(await aiwf.resolveTaskWorktree(project, "SPEC-007", "prd")).toBeNull();
    expect(await aiwf.resolveTaskWorktree(project, "SPEC-007", "roadmap")).toBeNull();
  });

  it("creates a worktree for spec skill (now a delivery skill)", async () => {
    const file = path.join(specsDir, "007_standardize-agent-skill-selects.md");
    fs.writeFileSync(file, "## Trunk Metadata\n\n- **Type:** feat\n");
    const result = await aiwf.resolveTaskWorktree(project, "SPEC-007", "spec");
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/standardize-agent-skill-selects");
  });

  it("creates a worktree on first run with a semantic branch name", async () => {
    const file = path.join(specsDir, "007_standardize-agent-skill-selects.md");
    fs.writeFileSync(file, "## Trunk Metadata\n\n- **Type:** feat\n");
    const result = await aiwf.resolveTaskWorktree(project, "SPEC-007", "feature");
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/standardize-agent-skill-selects");
    expect(aiwf.getCardState("aiwf-p1", "SPEC-007")?.taskBranch).toBe("feat/standardize-agent-skill-selects");
  });

  it("reuses the stored worktree path on subsequent runs", async () => {
    aiwf.setCardState("aiwf-p1", "SPEC-007", { taskBranch: "feat/my-task", worktreePath: DATA });
    const { createWorktree: mockCreate } = jest.requireMock("../worktree");
    mockCreate.mockClear();
    const result = await aiwf.resolveTaskWorktree(project, "SPEC-007", "commit");
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/my-task");
    expect(result!.cwd).toBe(DATA);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("recreates the worktree on the existing branch when stored path is stale", async () => {
    aiwf.setCardState("aiwf-p1", "SPEC-007", {
      taskBranch: "feat/stale",
      worktreePath: "/tmp/gone-path-xyz",
    });
    const { createWorktree: mockCreate } = jest.requireMock("../worktree");
    mockCreate.mockClear();
    const result = await aiwf.resolveTaskWorktree(project, "SPEC-007", "commit");
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/stale");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.any(String),
      "feat/stale",
      expect.any(String),
      expect.objectContaining({ existingBranch: "feat/stale" }),
    );
  });
});

describe("resolveTaskWorktree — promoted board card branch preservation", () => {
  let specsDir: string;
  const cardKey = "DC-7";
  beforeEach(() => {
    specsDir = path.join(REPO, "docs", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
    aiwf.clearCardState("aiwf-p1", cardKey);
  });
  afterEach(() => {
    fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
    aiwf.clearCardState("aiwf-p1", cardKey);
  });

  it("recovers the semantic branch from a promoted card's Spec: line (not feat/<card-key>)", async () => {
    const file = path.join(specsDir, "014_foo.md");
    fs.writeFileSync(file, "## Trunk Metadata\n\n- **Type:** feat\n");
    const result = await aiwf.resolveTaskWorktree(
      project,
      cardKey,
      "feature",
      "Spec: docs/specs/014_foo.md\n\nFull description here.",
    );
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/foo");
  });

  it("normalizes a sliced-spec README.md to the directory slug", async () => {
    const dir = path.join(specsDir, "006_bar");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "## Trunk Metadata\n\n- **Type:** feat\n");
    const result = await aiwf.resolveTaskWorktree(
      project,
      cardKey,
      "feature",
      "Spec: docs/specs/006_bar/README.md\nmore",
    );
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/bar");
  });

  it("falls back to feat/<card-key> for a delivery skill when the description has no Spec: line", async () => {
    const result = await aiwf.resolveTaskWorktree(project, cardKey, "feature", "Just a thread, no spec.");
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/dc-7");
  });

  it("falls back to fix/<card-key> for the fix skill when the description has no Spec: line", async () => {
    const result = await aiwf.resolveTaskWorktree(project, cardKey, "fix", undefined);
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("fix/dc-7");
  });

  it("ignores a Spec: line that escapes the repo root (path traversal), falling back to feat/<card-key>", async () => {
    // A traversal target outside REPO must not be resolved; branch falls back to the card key.
    const result = await aiwf.resolveTaskWorktree(
      project,
      cardKey,
      "feature",
      "Spec: ../../../../../../etc/hosts.md\n",
    );
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/dc-7"); // not derived from the escaped path
  });

  it("returns null for a non-delivery skill even with a Spec: line", async () => {
    // Short-circuits on DELIVERY_SKILLS before any filesystem lookup — no spec file needed.
    expect(
      await aiwf.resolveTaskWorktree(project, cardKey, "prd", "Spec: docs/specs/014_foo.md\n"),
    ).toBeNull();
  });
});

describe("resolveCardWorktree", () => {
  const contextId = "jira-HAN";
  const cardKey = "HAN-8";

  beforeEach(() => aiwf.clearCardState(contextId, cardKey));
  afterEach(() => aiwf.clearCardState(contextId, cardKey));

  it("derives feat/<key> for a non-fix first delivery skill", async () => {
    const result = await aiwf.resolveCardWorktree(contextId, cardKey, "feature", REPO);
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/han-8");
    expect(aiwf.getCardState(contextId, cardKey)?.taskBranch).toBe("feat/han-8");
  });

  it("derives fix/<key> when first skill is fix", async () => {
    const result = await aiwf.resolveCardWorktree(contextId, cardKey, "fix", REPO);
    expect(result!.branch).toBe("fix/han-8");
  });

  it("derives fix/<key> when first skill is sec-review", async () => {
    const result = await aiwf.resolveCardWorktree(contextId, cardKey, "sec-review", REPO);
    expect(result!.branch).toBe("fix/han-8");
  });

  it("derives feat/<key> for spec skill", async () => {
    const result = await aiwf.resolveCardWorktree(contextId, cardKey, "spec", REPO);
    expect(result!.branch).toBe("feat/han-8");
  });

  it("sanitizes the card key to lowercase", async () => {
    const result = await aiwf.resolveCardWorktree("jira-PP", "PP-1234", "feature", REPO);
    expect(result!.branch).toBe("feat/pp-1234");
    aiwf.clearCardState("jira-PP", "PP-1234");
  });

  it("reuses stored state on subsequent runs", async () => {
    aiwf.setCardState(contextId, cardKey, { taskBranch: "feat/han-8", worktreePath: DATA });
    const { createWorktree: mockCreate } = jest.requireMock("../worktree");
    mockCreate.mockClear();
    const result = await aiwf.resolveCardWorktree(contextId, cardKey, "commit", REPO);
    expect(result!.cwd).toBe(DATA);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates the task worktree under a durable data-dir location, not the OS temp dir (HAN-11)", async () => {
    const { createWorktree: mockCreate } = jest.requireMock("../worktree");
    mockCreate.mockClear();
    await aiwf.resolveCardWorktree(contextId, cardKey, "feature", REPO);
    const opts = mockCreate.mock.calls[0][3];
    expect(opts.baseDir).toBe(path.join(DATA, "worktrees"));
  });

  it("warns and recreates from the branch under the durable dir when the prior worktree is gone (HAN-11)", async () => {
    // Stored path is gone and git has no registered worktree (findWorktreePath mock returns null).
    aiwf.setCardState(contextId, cardKey, {
      taskBranch: "feat/han-8",
      worktreePath: "/tmp/hangar-gone-xyz",
    });
    const { createWorktree: mockCreate } = jest.requireMock("../worktree");
    mockCreate.mockClear();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = await aiwf.resolveCardWorktree(contextId, cardKey, "commit", REPO);
    expect(result!.branch).toBe("feat/han-8");
    const opts = mockCreate.mock.calls[0][3];
    expect(opts.existingBranch).toBe("feat/han-8");
    expect(opts.baseDir).toBe(path.join(DATA, "worktrees"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not carried over"));
    warn.mockRestore();
  });

  it("reads old spec-state path as backward compat for aiwf context", async () => {
    // Write a legacy spec-state file
    const legacyDir = path.join(DATA, "aiwf", "p1", "spec-state");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "SPEC-099.json"),
      JSON.stringify({ taskBranch: "feat/legacy", worktreePath: DATA }),
    );
    const result = await aiwf.resolveCardWorktree("aiwf-p1", "SPEC-099", "commit", REPO);
    expect(result!.branch).toBe("feat/legacy");
    // Cleanup
    fs.rmSync(path.join(legacyDir, "SPEC-099.json"), { force: true });
  });

  it("uses branchFromSpec when specPath is provided", async () => {
    const specsDir = path.join(REPO, "docs", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
    const file = path.join(specsDir, "007_standardize-agent-skill-selects.md");
    fs.writeFileSync(file, "## Trunk Metadata\n\n- **Type:** feat\n");
    const result = await aiwf.resolveCardWorktree("aiwf-p1", "SPEC-007", "feature", REPO, file);
    expect(result!.branch).toBe("feat/standardize-agent-skill-selects");
    aiwf.clearCardState("aiwf-p1", "SPEC-007");
    fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
  });
});

describe("getCardState / setCardState / clearCardState", () => {
  it("returns null when no state file exists", () => {
    expect(aiwf.getCardState("jira-HAN", "HAN-999")).toBeNull();
  });
  it("round-trips state through the data dir", () => {
    const state = { taskBranch: "feat/han-1", worktreePath: "/tmp/wt" };
    aiwf.setCardState("jira-HAN", "HAN-1", state);
    expect(aiwf.getCardState("jira-HAN", "HAN-1")).toEqual(state);
    aiwf.clearCardState("jira-HAN", "HAN-1");
  });
  it("clearCardState is idempotent", () => {
    expect(() => aiwf.clearCardState("jira-HAN", "HAN-NEVER")).not.toThrow();
  });
});

describe("listCardStates", () => {
  const ctxId = "aiwf-list-test";
  afterEach(() => {
    aiwf.clearCardState(ctxId, "KEY-1");
    aiwf.clearCardState(ctxId, "KEY-2");
    aiwf.clearCardState(ctxId, "KEY-3");
  });

  it("returns empty array when no state files exist", () => {
    expect(aiwf.listCardStates(ctxId)).toEqual([]);
  });

  it("lists all card states with their keys", () => {
    aiwf.setCardState(ctxId, "KEY-1", { taskBranch: "feat/key-1", worktreePath: "/tmp/wt1" });
    aiwf.setCardState(ctxId, "KEY-2", { taskBranch: "fix/key-2", worktreePath: "/tmp/wt2" });
    const entries = aiwf.listCardStates(ctxId);
    expect(entries).toHaveLength(2);
    const e1 = entries.find((e) => e.key === "KEY-1");
    const e2 = entries.find((e) => e.key === "KEY-2");
    expect(e1).toEqual({ key: "KEY-1", taskBranch: "feat/key-1", worktreePath: "/tmp/wt1" });
    expect(e2).toEqual({ key: "KEY-2", taskBranch: "fix/key-2", worktreePath: "/tmp/wt2" });
  });

  it("excludes keys cleared after listing", () => {
    aiwf.setCardState(ctxId, "KEY-3", { taskBranch: "feat/k3", worktreePath: "/tmp/wt3" });
    expect(aiwf.listCardStates(ctxId)).toHaveLength(1);
    aiwf.clearCardState(ctxId, "KEY-3");
    expect(aiwf.listCardStates(ctxId)).toHaveLength(0);
  });
});

describe("projectRunNote", () => {
  it("returns undefined with no note and a non-roadmap skill", () => {
    expect(aiwf.projectRunNote("feature", project)).toBeUndefined();
  });
  it("passes through the user note", () => {
    expect(aiwf.projectRunNote("feature", project, "  do the thing  ")).toBe("do the thing");
  });
  it("appends the board-seed instruction (with the data-dir board path) for the roadmap skill", () => {
    const note = aiwf.projectRunNote("roadmap", project, "scope it");
    expect(note).toContain("scope it");
    expect(note).toContain(aiwf.boardDir(project));
    expect(aiwf.projectRunNote("roadmap", project)).toContain(aiwf.boardDir(project));
  });
});

describe("columnsFor / boardDir", () => {
  it("uses the project's columns when set, else the defaults", () => {
    expect(aiwf.columnsFor(project)).toEqual(aiwf.DEFAULT_COLUMNS);
    expect(aiwf.columnsFor({ ...project, columns: ["A", "B"] })).toEqual(["A", "B"]);
  });
  it("points at <DATA_DIR>/aiwf/<projectId>/board", () => {
    expect(aiwf.boardDir(project)).toBe(path.join(DATA, "aiwf", "p1", "board"));
  });
});

describe("card store", () => {
  it("returns [] when the board dir does not exist", () => {
    expect(aiwf.listCards(project)).toEqual([]);
  });

  it("creates cards with incrementing keys and a derived prefix, defaulting to the first column", () => {
    const a = aiwf.createCard(project, { title: "First" });
    const b = aiwf.createCard(project, { title: "Second", status: "Implementation", kind: "task" });
    expect(a.key).toBe("DP-1"); // "Demo Project" -> DP
    expect(a.status).toBe("Planning"); // default first column
    expect(a.kind).toBe("thread");
    expect(b.key).toBe("DP-2");
    expect(b.status).toBe("Implementation");
    expect(b.kind).toBe("task");

    const cards = aiwf.listCards(project);
    expect(cards.map((c) => c.key)).toEqual(["DP-1", "DP-2"]); // sorted by key number
    expect(cards[0].source).toBe("aiwf");
  });

  it("stores the description as the card body and round-trips it", () => {
    aiwf.createCard(project, { title: "Has body", description: "acceptance criteria" });
    expect(aiwf.getCard(project, "DP-1")?.description).toBe("acceptance criteria");
  });

  it("transitions a card to a new phase and rejects an unknown card", () => {
    aiwf.createCard(project, { title: "Move me" });
    aiwf.transitionCard(project, "DP-1", "Review");
    expect(aiwf.getCard(project, "DP-1")?.status).toBe("Review");
    expect(() => aiwf.transitionCard(project, "NOPE-9", "Review")).toThrow(/Card not found/);
  });

  it("getCard returns null for a missing card", () => {
    expect(aiwf.getCard(project, "DP-99")).toBeNull();
  });

  it("appends history entries (and records the latest skill), persisted across reads", () => {
    aiwf.createCard(project, { title: "Threaded" });
    aiwf.appendCardHistory("p1", "DP-1", { phase: "Planning", skill: "prd", at: 1 });
    aiwf.appendCardHistory("p1", "DP-1", {
      phase: "Planning",
      skill: "architecture",
      at: 2,
      summary: "did it",
    });
    const card = aiwf.getCard(project, "DP-1")!;
    expect(card.history?.map((h) => h.skill)).toEqual(["prd", "architecture"]);
    expect(card.skill).toBe("architecture"); // latest skill recorded in frontmatter
    expect(card.history?.[1].summary).toBe("did it");
  });

  it("appendCardHistory is a no-op for an unknown project or card", () => {
    expect(() => aiwf.appendCardHistory("nope", "DP-1", { phase: "x", skill: "y", at: 1 })).not.toThrow();
    expect(() => aiwf.appendCardHistory("p1", "DP-404", { phase: "x", skill: "y", at: 1 })).not.toThrow();
  });

  it("appendCardHistory persists prUrl to the card's pr: frontmatter when supplied", () => {
    aiwf.createCard(project, { title: "With PR" });
    aiwf.appendCardHistory(
      "p1",
      "DP-1",
      { phase: "Delivery", skill: "pr", at: 1 },
      "https://github.com/me/repo/pull/42",
    );
    const card = aiwf.getCard(project, "DP-1")!;
    expect(card.prUrl).toBe("https://github.com/me/repo/pull/42");
    // also visible via listCards
    expect(aiwf.listCards(project)[0].prUrl).toBe("https://github.com/me/repo/pull/42");
  });

  it("appendCardHistory trims whitespace from prUrl before writing", () => {
    aiwf.createCard(project, { title: "PR trim" });
    aiwf.appendCardHistory(
      "p1",
      "DP-1",
      { phase: "Delivery", skill: "pr", at: 1 },
      "  https://github.com/me/repo/pull/7  ",
    );
    expect(aiwf.getCard(project, "DP-1")!.prUrl).toBe("https://github.com/me/repo/pull/7");
  });

  it("appendCardHistory does not add or clear pr: when prUrl is absent or empty", () => {
    aiwf.createCard(project, { title: "No PR" });
    // no prUrl supplied — pr: is not added
    aiwf.appendCardHistory("p1", "DP-1", { phase: "Planning", skill: "prd", at: 1 });
    expect(aiwf.getCard(project, "DP-1")!.prUrl).toBeUndefined();
    // empty string — existing pr: is not cleared
    aiwf.appendCardHistory(
      "p1",
      "DP-1",
      { phase: "Delivery", skill: "pr", at: 2 },
      "https://github.com/me/repo/pull/1",
    );
    aiwf.appendCardHistory("p1", "DP-1", { phase: "Delivery", skill: "pr", at: 3 }, "");
    expect(aiwf.getCard(project, "DP-1")!.prUrl).toBe("https://github.com/me/repo/pull/1");
  });

  it("appendCardHistory still appends history and updates skill when prUrl is supplied", () => {
    aiwf.createCard(project, { title: "History + PR" });
    aiwf.appendCardHistory(
      "p1",
      "DP-1",
      { phase: "Delivery", skill: "pr", at: 1, summary: "opened PR" },
      "https://github.com/me/repo/pull/99",
    );
    const card = aiwf.getCard(project, "DP-1")!;
    expect(card.history?.length).toBe(1);
    expect(card.history?.[0].summary).toBe("opened PR");
    expect(card.skill).toBe("pr");
    expect(card.prUrl).toBe("https://github.com/me/repo/pull/99");
  });

  it("ignores a malformed history block, keeping the description", () => {
    fs.mkdirSync(aiwf.boardDir(project), { recursive: true });
    fs.writeFileSync(
      path.join(aiwf.boardDir(project), "DP-1.md"),
      "---\nkey: DP-1\ntitle: Broken\nstatus: Planning\n---\n\nthe body\n\n<!--HANGAR_HISTORY\n{not json}\nHANGAR_HISTORY-->\n",
    );
    const card = aiwf.getCard(project, "DP-1")!;
    expect(card.history).toEqual([]);
    expect(card.description).toBe("the body");
  });

  it("setCardArchived sets archived: true on the card and is reflected in listCards", () => {
    aiwf.createCard(project, { title: "Archive me" });
    aiwf.setCardArchived(project, "DP-1", true);
    const card = aiwf.getCard(project, "DP-1")!;
    expect(card.archived).toBe(true);
    expect(aiwf.listCards(project)[0].archived).toBe(true);
  });

  it("setCardArchived with false removes the archived key (unarchive)", () => {
    aiwf.createCard(project, { title: "Unarchive me" });
    aiwf.setCardArchived(project, "DP-1", true);
    aiwf.setCardArchived(project, "DP-1", false);
    const card = aiwf.getCard(project, "DP-1")!;
    // archived key must be absent after unarchive, not merely false
    expect(card.archived).toBeUndefined();
    // verify the file does not contain 'archived:' at all
    const dir = aiwf.boardDir(project);
    const content = fs.readFileSync(path.join(dir, "DP-1.md"), "utf8");
    expect(content).not.toContain("archived:");
  });

  it("setCardArchived throws for a missing card key, mirroring transitionCard", () => {
    expect(() => aiwf.setCardArchived(project, "DP-99", true)).toThrow(/Card not found/);
  });

  it("deleteCard removes the card file and returns true; returns false when not found", () => {
    aiwf.createCard(project, { title: "Delete me" });
    expect(aiwf.getCard(project, "DP-1")).not.toBeNull();
    const removed = aiwf.deleteCard(project, "DP-1");
    expect(removed).toBe(true);
    expect(aiwf.getCard(project, "DP-1")).toBeNull();
    expect(aiwf.listCards(project)).toHaveLength(0);
    // second call: file is gone
    expect(aiwf.deleteCard(project, "DP-1")).toBe(false);
  });
});

describe("detectAiwf", () => {
  it("reports core skills found in the skills dir and 'installed' at >= 3", () => {
    jest.spyOn(os, "homedir").mockReturnValue(fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-")));
    makeSkill("prd");
    makeSkill("spec");
    expect(aiwf.detectAiwf().installed).toBe(false); // only 2 core skills, no launcher
    makeSkill("roadmap");
    const s = aiwf.detectAiwf();
    expect(s.installed).toBe(true);
    expect(s.skillsFound).toEqual(expect.arrayContaining(["prd", "spec", "roadmap"]));
    expect(s.aiwfBin).toBeNull();
  });

  it("finds the launcher and reads its version, tolerating a version failure", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-"));
    fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    fs.writeFileSync(path.join(home, ".local", "bin", "aiwf"), "#!/bin/sh\n");
    jest.spyOn(os, "homedir").mockReturnValue(home);

    execFileSyncMock.mockReturnValue("aiwf v9.9\n");
    const ok = aiwf.detectAiwf();
    expect(ok.aiwfBin).toContain("aiwf");
    expect(ok.version).toBe("aiwf v9.9");
    expect(ok.installed).toBe(true);

    execFileSyncMock.mockImplementation(() => {
      throw new Error("no version");
    });
    expect(aiwf.detectAiwf().version).toBeNull();
  });
});

describe("installAiwf / uninstallAiwf", () => {
  it("install returns the captured output + refreshed status", async () => {
    jest.spyOn(os, "homedir").mockReturnValue(fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-")));
    mockExecResolve("bootstrapped");
    const { output, status } = await aiwf.installAiwf();
    expect(output).toBe("bootstrapped");
    expect(status.installed).toBe(false); // nothing actually linked in this temp home
  });

  it("install throws a wrapped error on failure", async () => {
    mockExecReject(Object.assign(new Error("curl failed"), { stdout: "out", stderr: "err" }));
    await expect(aiwf.installAiwf()).rejects.toThrow(/aiwf install failed/);
  });

  it("uninstall refuses when the launcher is absent", async () => {
    jest.spyOn(os, "homedir").mockReturnValue(fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-")));
    await expect(aiwf.uninstallAiwf()).rejects.toThrow(/nothing to uninstall/);
  });

  it("uninstall runs the launcher and returns refreshed status", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-"));
    fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    fs.writeFileSync(path.join(home, ".local", "bin", "aiwf"), "#!/bin/sh\n");
    jest.spyOn(os, "homedir").mockReturnValue(home);
    mockExecFileResolve("removed");
    const { output } = await aiwf.uninstallAiwf();
    expect(output).toBe("removed");
  });

  it("uninstall throws a wrapped error when the launcher fails", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-"));
    fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    fs.writeFileSync(path.join(home, ".local", "bin", "aiwf"), "#!/bin/sh\n");
    jest.spyOn(os, "homedir").mockReturnValue(home);
    mockExecFileReject(Object.assign(new Error("boom"), { stderr: "bad" }));
    await expect(aiwf.uninstallAiwf()).rejects.toThrow(/aiwf uninstall failed/);
  });
});

describe("listProjectDocTree", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doctree-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns all six standard entries with correct types, phases, and exists: false when docs/ is absent", () => {
    const nodes = aiwf.listProjectDocTree(tmp);
    expect(nodes.map((n) => n.path)).toEqual([
      "docs/PRD.md",
      "docs/ARCHITECTURE.md",
      "docs/THREAT_MODEL.md",
      "docs/design/DESIGN_SYSTEM.md",
      "docs/roadmap",
      "docs/specs",
    ]);
    expect(nodes.every((n) => !n.exists)).toBe(true);
    expect(nodes.find((n) => n.path === "docs/PRD.md")?.phase).toBe("Planning");
    expect(nodes.find((n) => n.path === "docs/design/DESIGN_SYSTEM.md")?.phase).toBe("Design");
    expect(nodes.find((n) => n.path === "docs/specs")?.phase).toBe("Implementation");
    expect(nodes.find((n) => n.path === "docs/roadmap")?.type).toBe("folder");
    expect(nodes.find((n) => n.path === "docs/specs")?.type).toBe("folder");
  });

  it("docs/PRD.md has exists: true when file is present and exists: false when absent", () => {
    const docs = path.join(tmp, "docs");
    fs.mkdirSync(docs, { recursive: true });

    // absent case
    expect(aiwf.listProjectDocTree(tmp).find((n) => n.path === "docs/PRD.md")?.exists).toBe(false);

    // present case
    fs.writeFileSync(path.join(docs, "PRD.md"), "# Product Requirements\nBody");
    expect(aiwf.listProjectDocTree(tmp).find((n) => n.path === "docs/PRD.md")?.exists).toBe(true);
    expect(aiwf.listProjectDocTree(tmp).find((n) => n.path === "docs/PRD.md")?.title).toBe(
      "Product Requirements",
    );
  });

  it("roadmap folder children are sorted by filename ascending", () => {
    const roadmap = path.join(tmp, "docs", "roadmap");
    fs.mkdirSync(roadmap, { recursive: true });
    fs.writeFileSync(path.join(roadmap, "003_c.md"), "# C\n");
    fs.writeFileSync(path.join(roadmap, "001_a.md"), "# A\n");
    fs.writeFileSync(path.join(roadmap, "002_b.md"), "# B\n");

    const node = aiwf.listProjectDocTree(tmp).find((n) => n.path === "docs/roadmap")!;
    expect(node.exists).toBe(true);
    expect(node.children?.map((c) => c.path)).toEqual([
      "docs/roadmap/001_a.md",
      "docs/roadmap/002_b.md",
      "docs/roadmap/003_c.md",
    ]);
  });

  it("specs folder children use spec/spec-dir types from listSpecCards", () => {
    const specsDir = path.join(tmp, "docs", "specs");
    fs.mkdirSync(specsDir, { recursive: true });
    // single-file spec
    fs.writeFileSync(path.join(specsDir, "001_foo.md"), "# Foo\n");
    // sliced spec dir
    const dir = path.join(specsDir, "002_bar");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "# Bar\n");
    fs.writeFileSync(path.join(dir, "001_slice-a.md"), "# Slice A\n");

    const specsNode = aiwf.listProjectDocTree(tmp).find((n) => n.path === "docs/specs")!;
    expect(specsNode.exists).toBe(true);
    // listSpecCards returns descending numeric order so 002 before 001
    const barNode = specsNode.children?.find((c) => c.type === "spec-dir");
    const fooNode = specsNode.children?.find((c) => c.type === "spec");
    expect(barNode).toBeDefined();
    expect(fooNode).toBeDefined();
    expect(barNode?.children).toHaveLength(1);
    expect(barNode?.children?.[0].title).toBe("Slice A");
  });

  it("appends extra root-level docs/*.md files not in the standard set", () => {
    const docs = path.join(tmp, "docs");
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, "EXTRA.md"), "# Extra\n");

    const nodes = aiwf.listProjectDocTree(tmp);
    const extra = nodes.find((n) => n.path === "docs/EXTRA.md");
    expect(extra).toBeDefined();
    expect(extra?.type).toBe("doc");
    expect(extra?.exists).toBe(true);
    // standard entries stay in their fixed positions
    expect(nodes[0].path).toBe("docs/PRD.md");
  });
});

describe("getProjectDocByPath", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docbypath-"));
    fs.mkdirSync(path.join(tmp, "docs"), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null for path traversal via ../", () => {
    expect(aiwf.getProjectDocByPath(tmp, "../etc/passwd")).toBeNull();
  });

  it("returns null for docs/../../server/src/config.ts", () => {
    expect(aiwf.getProjectDocByPath(tmp, "docs/../../server/src/config.ts")).toBeNull();
  });

  it("returns null for path not starting with docs/", () => {
    expect(aiwf.getProjectDocByPath(tmp, "notdocs/README.md")).toBeNull();
  });

  it("returns null when the file does not exist", () => {
    expect(aiwf.getProjectDocByPath(tmp, "docs/MISSING.md")).toBeNull();
  });

  it("returns content and title for a valid path", () => {
    const docs = path.join(tmp, "docs");
    fs.writeFileSync(path.join(docs, "ARCHITECTURE.md"), "# Architecture\nContent here.");
    const result = aiwf.getProjectDocByPath(tmp, "docs/ARCHITECTURE.md");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Architecture");
    expect(result!.content).toContain("Content here.");
  });

  it("returns content for a file in a subdirectory", () => {
    const design = path.join(tmp, "docs", "design");
    fs.mkdirSync(design, { recursive: true });
    fs.writeFileSync(path.join(design, "DESIGN_SYSTEM.md"), "# Design System\nTokens.");
    const result = aiwf.getProjectDocByPath(tmp, "docs/design/DESIGN_SYSTEM.md");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Design System");
  });
});
