const PROJ_COLORS = ["#4f7cff", "#10b981", "#e08e0b", "#ec4899", "#8b5cf6", "#0ea5e9", "#f43f5e", "#14b8a6"];

export function projectColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  return PROJ_COLORS[h % PROJ_COLORS.length];
}

/** Return the display project key for a skill: "aiwf", a repo name, or null for ungrouped user skills. */
export function skillProject(s: { aiwf?: boolean; repo?: string }): string | null {
  if (s.aiwf) return "aiwf";
  if (s.repo) return s.repo;
  return null;
}
