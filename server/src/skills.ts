import fs from "fs";
import path from "path";
import { expandHome, boardPaths } from "./config";
import { HangarConfig, Skill } from "./types";

function frontmatter(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** User-scoped skills: each is a folder with a SKILL.md (name + description frontmatter). */
export function loadSkills(skillsDir: string): Skill[] {
  const dir = expandHome(skillsDir);
  if (!fs.existsSync(dir)) return [];
  const out: Skill[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourcePath = path.join(dir, entry.name, "SKILL.md");
    if (!fs.existsSync(sourcePath)) continue;
    const fm = frontmatter(fs.readFileSync(sourcePath, "utf8"));
    out.push({
      name: fm.name || entry.name,
      description: fm.description || "",
      model: fm.model || undefined,
      sourcePath,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Repo-scoped skills under `<repoPath>/.claude/skills`, flagged with the repo basename. */
export function loadRepoSkills(repoPath: string): Skill[] {
  const root = expandHome(repoPath);
  const repo = path.basename(root.replace(/[\\/]+$/, ""));
  return loadSkills(path.join(root, ".claude", "skills")).map((s) => ({
    ...s,
    source: "repo" as const,
    repo,
    repoPath: root,
  }));
}

/**
 * Every skill available across the install: user-scoped skills plus the repo skills for each
 * unique codebase path across all boards, ordered by name (user before repo on ties).
 */
export function allSkills(cfg: HangarConfig): Skill[] {
  const user: Skill[] = loadSkills(cfg.skillsDir ?? "~/.claude/skills").map((s) => ({
    ...s,
    source: "user" as const,
  }));

  const seen = new Set<string>();
  const repoSkills: Skill[] = [];
  for (const b of cfg.boards) {
    for (const p of boardPaths(b)) {
      if (seen.has(p)) continue;
      seen.add(p);
      repoSkills.push(...loadRepoSkills(p));
    }
  }
  return [...user, ...repoSkills].sort(
    (a, b) => a.name.localeCompare(b.name) || (a.source ?? "").localeCompare(b.source ?? ""),
  );
}

/** Find a skill by name across user + repo skills (first match). */
export function findSkill(cfg: HangarConfig, name: string): Skill | undefined {
  return allSkills(cfg).find((s) => s.name === name);
}

export function skillExists(cfg: HangarConfig, name: string): boolean {
  return !!findSkill(cfg, name);
}
