import fs from "fs";
import os from "os";
import path from "path";

// aiwf.ts shells out for install/uninstall/version — mock child_process so nothing runs for real.
// exec must carry util.promisify.custom so promisify(exec) returns { stdout, stderr } like the real impl.
jest.mock("child_process", () => {
  const { promisify } = jest.requireActual("util") as typeof import("util");
  const execFn = jest.fn();

  (execFn as any)[promisify.custom] = jest.fn(() => Promise.resolve({ stdout: "", stderr: "" }));
  return { execSync: jest.fn(), exec: execFn };
});
import { execSync, exec } from "child_process";
import { promisify } from "util";
const execSyncMock = execSync as unknown as jest.Mock;

const execCustomMock = (exec as any)[promisify.custom] as jest.Mock;

function mockExecResolve(stdout: string) {
  execCustomMock.mockResolvedValue({ stdout, stderr: "" });
}
function mockExecReject(err: Error & { stdout?: string; stderr?: string }) {
  execCustomMock.mockRejectedValue(err);
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

describe("TASK_WORKTREE_SKILLS", () => {
  it("includes code-producing, review, and delivery skills", () => {
    for (const s of ["feature", "fix", "review", "sec-review", "commit", "pr"]) {
      expect(aiwf.TASK_WORKTREE_SKILLS.has(s)).toBe(true);
    }
  });
  it("excludes planning and doc skills", () => {
    for (const s of ["prd", "spec", "roadmap", "architecture", "new-project", "autopilot", "factory"]) {
      expect(aiwf.TASK_WORKTREE_SKILLS.has(s)).toBe(false);
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
    // Clear any spec-state from prior tests
    aiwf.clearSpecState("p1", "SPEC-007");
  });
  afterEach(() => {
    fs.rmSync(path.join(REPO, "docs"), { recursive: true, force: true });
    aiwf.clearSpecState("p1", "SPEC-007");
  });

  it("returns null for planning skills (not in TASK_WORKTREE_SKILLS)", async () => {
    expect(await aiwf.resolveTaskWorktree(project, "SPEC-007", "spec")).toBeNull();
    expect(await aiwf.resolveTaskWorktree(project, "SPEC-007", "prd")).toBeNull();
    expect(await aiwf.resolveTaskWorktree(project, "SPEC-007", "roadmap")).toBeNull();
  });

  it("creates a worktree on first run with a semantic branch name", async () => {
    const file = path.join(specsDir, "007_standardize-agent-skill-selects.md");
    fs.writeFileSync(file, "## Trunk Metadata\n\n- **Type:** feat\n");
    const result = await aiwf.resolveTaskWorktree(project, "SPEC-007", "feature");
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/standardize-agent-skill-selects");
    // State was persisted
    expect(aiwf.getSpecState("p1", "SPEC-007")?.taskBranch).toBe("feat/standardize-agent-skill-selects");
  });

  it("reuses the stored worktree path on subsequent runs", async () => {
    aiwf.setSpecState("p1", "SPEC-007", { taskBranch: "feat/my-task", worktreePath: DATA });
    // DATA dir exists on disk — should reuse without calling createWorktree
    const { createWorktree: mockCreate } = jest.requireMock("../worktree");
    mockCreate.mockClear();
    const result = await aiwf.resolveTaskWorktree(project, "SPEC-007", "commit");
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/my-task");
    expect(result!.cwd).toBe(DATA);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("recreates the worktree on the existing branch when stored path is stale", async () => {
    aiwf.setSpecState("p1", "SPEC-007", { taskBranch: "feat/stale", worktreePath: "/tmp/gone-path-xyz" });
    const { createWorktree: mockCreate } = jest.requireMock("../worktree");
    mockCreate.mockClear();
    const result = await aiwf.resolveTaskWorktree(project, "SPEC-007", "commit");
    expect(result).not.toBeNull();
    expect(result!.branch).toBe("feat/stale");
    expect(mockCreate).toHaveBeenCalledWith(expect.any(String), "feat/stale", expect.any(String), {
      existingBranch: "feat/stale",
    });
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

    execSyncMock.mockReturnValue("aiwf v9.9\n");
    const ok = aiwf.detectAiwf();
    expect(ok.aiwfBin).toContain("aiwf");
    expect(ok.version).toBe("aiwf v9.9");
    expect(ok.installed).toBe(true);

    execSyncMock.mockImplementation(() => {
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
    mockExecResolve("removed");
    const { output } = await aiwf.uninstallAiwf();
    expect(output).toBe("removed");
  });

  it("uninstall throws a wrapped error when the launcher fails", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-"));
    fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    fs.writeFileSync(path.join(home, ".local", "bin", "aiwf"), "#!/bin/sh\n");
    jest.spyOn(os, "homedir").mockReturnValue(home);
    mockExecReject(Object.assign(new Error("boom"), { stderr: "bad" }));
    await expect(aiwf.uninstallAiwf()).rejects.toThrow(/aiwf uninstall failed/);
  });
});
