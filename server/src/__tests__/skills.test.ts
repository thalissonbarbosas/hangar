import fs from "fs";
import os from "os";
import path from "path";
import { loadSkills, loadRepoSkills, allSkills, findSkill, skillExists } from "../skills";
import { HangarConfig } from "../types";

function makeSkill(dir: string, folder: string, frontmatter: string | null): void {
  const skillDir = path.join(dir, folder);
  fs.mkdirSync(skillDir, { recursive: true });
  if (frontmatter !== null) fs.writeFileSync(path.join(skillDir, "SKILL.md"), frontmatter);
}

describe("loadSkills", () => {
  it("parses each folder's SKILL.md frontmatter, sorted by name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-skills-"));
    makeSkill(dir, "zebra", "---\nname: zebra-skill\ndescription: Z thing\n---\nbody");
    makeSkill(dir, "alpha", "---\nname: alpha-skill\ndescription: A thing\n---\nbody");
    makeSkill(dir, "no-fm", "no frontmatter here"); // name falls back to folder
    makeSkill(dir, "no-skill-md", null); // folder without SKILL.md is skipped
    fs.writeFileSync(path.join(dir, "loose.txt"), "not a dir"); // non-dir ignored

    const skills = loadSkills(dir);
    expect(skills.map((s) => s.name)).toEqual(["alpha-skill", "no-fm", "zebra-skill"]);
    expect(skills.find((s) => s.name === "alpha-skill")!.description).toBe("A thing");
    expect(skills.find((s) => s.name === "no-fm")!.description).toBe("");
  });

  it("returns [] for a missing dir", () => {
    expect(loadSkills(path.join(os.tmpdir(), "no-skills-xyz"))).toEqual([]);
  });
});

describe("loadRepoSkills", () => {
  it("flags skills with source=repo and the repo basename", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-repo-"));
    const skillsRoot = path.join(repo, ".claude", "skills");
    makeSkill(skillsRoot, "deploy", "---\nname: deploy\ndescription: ship it\n---\nbody");
    const skills = loadRepoSkills(repo);
    expect(skills).toHaveLength(1);
    expect(skills[0].source).toBe("repo");
    expect(skills[0].repo).toBe(path.basename(repo));
    expect(skills[0].repoPath).toBe(repo);
  });
});

describe("allSkills / findSkill / skillExists", () => {
  it("merges user + repo skills, dedupes board paths, and sorts", () => {
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-user-"));
    makeSkill(userDir, "u", "---\nname: shared\ndescription: user version\n---\nbody");
    makeSkill(userDir, "only-user", "---\nname: only-user\ndescription: x\n---\nbody");

    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-repo2-"));
    makeSkill(
      path.join(repo, ".claude", "skills"),
      "r",
      "---\nname: shared\ndescription: repo version\n---\nbody",
    );

    const cfg: HangarConfig = {
      agentsDir: "~/x",
      skillsDir: userDir,
      // two boards reference the same repo path — it should be loaded once (seen set)
      boards: [
        { key: "A", name: "A", statuses: ["x"], repoPaths: [repo] },
        { key: "B", name: "B", statuses: ["x"], repoPath: repo },
      ],
    };

    const skills = allSkills(cfg);
    // shared appears twice (user + repo); user sorts before repo on a name tie
    const shared = skills.filter((s) => s.name === "shared");
    expect(shared).toHaveLength(2);
    expect(shared[0].source).toBe("repo"); // "repo" < "user" lexicographically
    expect(skills.map((s) => s.name)).toEqual(["only-user", "shared", "shared"]);

    // findSkill finds the first match by name
    expect(findSkill(cfg, "only-user")?.source).toBe("user");
    expect(skillExists(cfg, "only-user")).toBe(true);
    expect(skillExists(cfg, "ghost")).toBe(false);
  });

  it("defaults skillsDir to ~/.claude/skills when unset", () => {
    const cfg: HangarConfig = { agentsDir: "~/x", boards: [{ key: "A", name: "A", statuses: ["x"] }] };
    // Just assert it doesn't throw and returns an array (the home dir may or may not have skills).
    expect(Array.isArray(allSkills(cfg))).toBe(true);
  });
});
