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

// Wire a temp project repo + skills dir + config BEFORE any module loads.
// Board cards live in the data dir (store.ts reads HANGAR_DATA_DIR at module-eval) — isolate to
// a temp dir so tests don't write into the real repo's .hangar. Must be set before aiwf is imported.
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-card-repo-"));
const SKILLS = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-card-skills-"));
const CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-card-cfg-"));
const CONFIG_PATH = path.join(CFG_DIR, "hangar.config.json");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-card-data-"));
process.env.HANGAR_DATA_DIR = DATA;
fs.writeFileSync(
  CONFIG_PATH,
  JSON.stringify({
    agentsDir: "~/.claude/agents",
    skillsDir: SKILLS,
    boards: [{ key: "X", name: "X", statuses: ["To Do"] }],
    aiWorkflow: { projects: [{ id: "card-proj", name: "Test Project", repoPath: REPO, createdAt: 0 }] },
  }),
);
process.env.CONFIG_PATH = CONFIG_PATH;
delete process.env.HANGAR_DEMO;
for (const k of ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"])
  process.env[k] = "";

// aiwf.ts now imports worktree.ts; mock it so we don't need a real git repo or execFile.
jest.mock("../worktree", () => ({
  createWorktree: jest.fn(async () => null),
  findWorktreePath: jest.fn(async () => null),
  sanitize: (s: string) =>
    s
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "run",
}));

import * as aiwf from "../aiwf";
import { AiwfProject } from "../types";

// The project registered in the config above — appendCardHistory resolves by id, so it must match.
const project: AiwfProject = { id: "card-proj", name: "Test Project", repoPath: REPO, createdAt: 0 };

function rmrf(p: string) {
  fs.rmSync(p, { recursive: true, force: true });
}

// Reset the board dir before each test so tests are independent.
beforeEach(() => {
  rmrf(aiwf.boardDir(project));
});

// ---- createCard ----

describe("createCard", () => {
  it("creates a .md file with correct frontmatter", () => {
    const card = aiwf.createCard(project, { title: "My Task", status: "Planning", kind: "thread" });

    expect(card.key).toMatch(/^TP-\d+$/); // "Test Project" -> TP
    expect(card.summary).toBe("My Task");
    expect(card.status).toBe("Planning");
    expect(card.kind).toBe("thread");
    expect(card.source).toBe("aiwf");
    expect(card.boardKey).toBe("card-proj");

    const dir = aiwf.boardDir(project);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain("title: My Task");
    expect(content).toContain("status: Planning");
    expect(content).toContain("kind: thread");
  });

  it("defaults to the first column and kind:thread when not specified", () => {
    const card = aiwf.createCard(project, { title: "Minimal" });
    expect(card.status).toBe(aiwf.DEFAULT_COLUMNS[0]);
    expect(card.kind).toBe("thread");
  });

  it("records kind:task when specified", () => {
    const card = aiwf.createCard(project, { title: "A task", kind: "task" });
    expect(card.kind).toBe("task");
  });

  it("increments the key number with each card", () => {
    const a = aiwf.createCard(project, { title: "First" });
    const b = aiwf.createCard(project, { title: "Second" });
    expect(a.key).toMatch(/-1$/);
    expect(b.key).toMatch(/-2$/);
  });

  it("stores the description as the card body", () => {
    aiwf.createCard(project, { title: "With body", description: "acceptance criteria" });
    expect(aiwf.getCard(project, "TP-1")!.description).toBe("acceptance criteria");
  });
});

// ---- listCards ----

describe("listCards", () => {
  it("returns [] when the board directory does not exist yet", () => {
    expect(aiwf.listCards(project)).toEqual([]);
  });

  it("returns the created card after createCard", () => {
    aiwf.createCard(project, { title: "Listed" });
    const cards = aiwf.listCards(project);
    expect(cards).toHaveLength(1);
    expect(cards[0].summary).toBe("Listed");
  });

  it("returns multiple cards sorted by key number", () => {
    aiwf.createCard(project, { title: "Alpha" });
    aiwf.createCard(project, { title: "Beta" });
    aiwf.createCard(project, { title: "Gamma" });
    const keys = aiwf.listCards(project).map((c) => c.key);
    expect(keys).toEqual(["TP-1", "TP-2", "TP-3"]);
  });
});

// ---- transitionCard ----

describe("transitionCard", () => {
  it("changes the status: field and persists it", () => {
    aiwf.createCard(project, { title: "Move me", status: "Planning" });
    aiwf.transitionCard(project, "TP-1", "Review");
    expect(aiwf.getCard(project, "TP-1")!.status).toBe("Review");
  });

  it("throws Card not found for an unknown key", () => {
    expect(() => aiwf.transitionCard(project, "NOPE-99", "Review")).toThrow(/Card not found/);
  });
});

// ---- appendCardHistory ----

describe("appendCardHistory", () => {
  it("appends an entry to the history block", () => {
    aiwf.createCard(project, { title: "Threaded" });
    aiwf.appendCardHistory("card-proj", "TP-1", { phase: "Planning", skill: "prd", at: 1 });
    const card = aiwf.getCard(project, "TP-1")!;
    expect(card.history).toHaveLength(1);
    expect(card.history?.[0].skill).toBe("prd");
  });

  it("accumulates multiple entries in order", () => {
    aiwf.createCard(project, { title: "Multi-step" });
    aiwf.appendCardHistory("card-proj", "TP-1", { phase: "Planning", skill: "prd", at: 1 });
    aiwf.appendCardHistory("card-proj", "TP-1", { phase: "Design", skill: "architecture", at: 2 });
    const card = aiwf.getCard(project, "TP-1")!;
    expect(card.history?.map((h) => h.skill)).toEqual(["prd", "architecture"]);
  });

  it("records the latest skill in frontmatter", () => {
    aiwf.createCard(project, { title: "Skill track" });
    aiwf.appendCardHistory("card-proj", "TP-1", { phase: "Planning", skill: "prd", at: 1 });
    aiwf.appendCardHistory("card-proj", "TP-1", { phase: "Design", skill: "architecture", at: 2 });
    expect(aiwf.getCard(project, "TP-1")!.skill).toBe("architecture");
  });

  it("is a no-op for an unknown project id", () => {
    expect(() =>
      aiwf.appendCardHistory("no-such-project", "TP-1", { phase: "x", skill: "y", at: 1 }),
    ).not.toThrow();
  });

  it("is a no-op for an unknown card key", () => {
    aiwf.createCard(project, { title: "Exists" });
    expect(() =>
      aiwf.appendCardHistory("card-proj", "TP-99", { phase: "x", skill: "y", at: 1 }),
    ).not.toThrow();
  });
});

// ---- setCardArchived ----

describe("setCardArchived", () => {
  it("sets archived: true in frontmatter", () => {
    aiwf.createCard(project, { title: "Archive me" });
    aiwf.setCardArchived(project, "TP-1", true);
    expect(aiwf.getCard(project, "TP-1")!.archived).toBe(true);

    const content = fs.readFileSync(path.join(aiwf.boardDir(project), "TP-1.md"), "utf8");
    expect(content).toContain("archived: true");
  });

  it("reflects the archived status in listCards", () => {
    aiwf.createCard(project, { title: "In list" });
    aiwf.setCardArchived(project, "TP-1", true);
    expect(aiwf.listCards(project)[0].archived).toBe(true);
  });

  it("removes the archived key entirely when unarchiving", () => {
    aiwf.createCard(project, { title: "Unarchive me" });
    aiwf.setCardArchived(project, "TP-1", true);
    aiwf.setCardArchived(project, "TP-1", false);
    const card = aiwf.getCard(project, "TP-1")!;
    // archived must be absent (undefined), not merely false.
    expect(card.archived).toBeUndefined();

    const content = fs.readFileSync(path.join(aiwf.boardDir(project), "TP-1.md"), "utf8");
    expect(content).not.toContain("archived:");
  });

  it("throws Card not found for an unknown key", () => {
    expect(() => aiwf.setCardArchived(project, "NOPE-99", true)).toThrow(/Card not found/);
  });
});
