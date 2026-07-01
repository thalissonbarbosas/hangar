import { Agent, BoardConfig, Skill } from "./types";

const PROJ_COLORS = ["#4f7cff", "#10b981", "#e08e0b", "#ec4899", "#8b5cf6", "#0ea5e9", "#f43f5e", "#14b8a6"];

export function projectColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  return PROJ_COLORS[h % PROJ_COLORS.length];
}

/**
 * Collapse entries that share a `name` down to a single representative, preserving order.
 * Board agent/skill access is name-based (see `filterByBoard`, and `board.skills`/`board.agents`
 * store plain names), so two same-named entries are indistinguishable downstream. Rendering both
 * as separate checkboxes made a single name-keyed selection look like it toggled several rows at
 * once. Dedupe so each name maps to exactly one control.
 */
export function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (seen.has(it.name)) return false;
    seen.add(it.name);
    return true;
  });
}

/** Return the display project key for a skill: "aiwf", a repo name, or null for ungrouped user skills. */
export function skillProject(s: { aiwf?: boolean; repo?: string }): string | null {
  if (s.aiwf) return "aiwf";
  if (s.repo) return s.repo;
  return null;
}

/**
 * Apply the same board-scoped agent/skill filtering used in Board.tsx.
 * Pass board=null to get back the original unfiltered lists unchanged.
 */
export function filterByBoard(
  board: BoardConfig | null,
  agents: Agent[],
  skills: Skill[],
): { agents: Agent[]; skills: Skill[] } {
  if (!board) return { agents, skills };
  const filteredAgents = board.agents?.length ? agents.filter((a) => board.agents!.includes(a.name)) : agents;
  const pathFiltered = board.resolvedPaths?.length
    ? skills.filter((s) => s.source !== "repo" || board.resolvedPaths!.includes(s.repoPath ?? ""))
    : skills;
  const filteredSkills = board.skills?.length
    ? pathFiltered.filter((s) => board.skills!.includes(s.name))
    : pathFiltered;
  return { agents: filteredAgents, skills: filteredSkills };
}
