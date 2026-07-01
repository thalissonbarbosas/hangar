import { Agent, BoardConfig, Skill } from "./types";

/** Convert an HSL triple to a `#rrggbb` hex string (MDN algorithm). */
function hslToHex(hue: number, sat: number, light: number): string {
  const s = sat / 100;
  const l = light / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Deterministic per-project color. Distinct project keys get distinct, evenly
 * spread hues across the full color wheel instead of colliding onto a small
 * fixed palette. Multiplying the hash by 137 (coprime with 360) keeps even
 * near-identical keys far apart on the wheel. Saturation/lightness are tuned to
 * stay legible as text on both the light and dark themes.
 */
export function projectColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  const hue = (h * 137) % 360;
  return hslToHex(hue, 65, 55);
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
