import fs from "fs";
import os from "os";
import path from "path";

// aiwf.ts shells out for install/uninstall/version — mock child_process so nothing runs for real.
jest.mock("child_process", () => ({ execSync: jest.fn() }));
import { execSync } from "child_process";
const execSyncMock = execSync as unknown as jest.Mock;

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
  it("install returns the captured output + refreshed status", () => {
    jest.spyOn(os, "homedir").mockReturnValue(fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-")));
    execSyncMock.mockReturnValue("bootstrapped");
    const { output, status } = aiwf.installAiwf();
    expect(output).toBe("bootstrapped");
    expect(status.installed).toBe(false); // nothing actually linked in this temp home
  });

  it("install throws a wrapped error on failure", () => {
    execSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("curl failed"), { stdout: "out", stderr: "err" });
    });
    expect(() => aiwf.installAiwf()).toThrow(/aiwf install failed/);
  });

  it("uninstall refuses when the launcher is absent", () => {
    jest.spyOn(os, "homedir").mockReturnValue(fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-")));
    expect(() => aiwf.uninstallAiwf()).toThrow(/nothing to uninstall/);
  });

  it("uninstall runs the launcher and returns refreshed status", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-"));
    fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    fs.writeFileSync(path.join(home, ".local", "bin", "aiwf"), "#!/bin/sh\n");
    jest.spyOn(os, "homedir").mockReturnValue(home);
    execSyncMock.mockReturnValue("removed");
    expect(aiwf.uninstallAiwf().output).toBe("removed");
  });

  it("uninstall throws a wrapped error when the launcher fails", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aiwf-home-"));
    fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    fs.writeFileSync(path.join(home, ".local", "bin", "aiwf"), "#!/bin/sh\n");
    jest.spyOn(os, "homedir").mockReturnValue(home);
    execSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("boom"), { stderr: "bad" });
    });
    expect(() => aiwf.uninstallAiwf()).toThrow(/aiwf uninstall failed/);
  });
});
