import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { expandHome, getConfig, getAiwfProjects } from "./config";
import { AiwfProject, AiwfHistoryEntry, Ticket } from "./types";

// ---------------------------------------------------------------------------
// AI Workflow (aiwf) connection: https://github.com/0xrafasec/ai-workflow
//
// aiwf is a Claude-native spec-driven-development toolkit installed into ~/.claude.
// Hangar already reads ~/.claude/skills, so once installed its skills appear in the
// fleet for free. This module adds (1) install detection/bootstrap and (2) a tiny
// markdown-card board stored inside each project repo at <repoPath>/.aiwf/board/.
// ---------------------------------------------------------------------------

// The aiwf lifecycle phases, each with the skills the ai-workflow repo organizes under it.
// These ARE the board columns — the board mirrors the methodology, not a generic kanban.
export const SKILL_GROUPS: { phase: string; skills: string[] }[] = [
  {
    phase: "Planning",
    skills: ["prd", "architecture", "tdd", "security", "adr", "rfc", "roadmap", "issues"],
  },
  { phase: "Design", skills: ["design", "verify-design"] },
  { phase: "Implementation", skills: ["spec", "feature", "fix", "autopilot", "factory", "new-project"] },
  { phase: "Review", skills: ["review", "sec-review"] },
  { phase: "Delivery", skills: ["commit", "pr"] },
];

/** Board columns = the phases, plus a terminal Complete column (history / done). */
export const DEFAULT_COLUMNS = [...SKILL_GROUPS.map((g) => g.phase), "Complete"];

/** Skills offered per phase column (Complete has none — it's terminal). */
export const COLUMN_SKILLS: Record<string, string[]> = Object.fromEntries(
  SKILL_GROUPS.map((g) => [g.phase, g.skills]),
);

// The roadmap skill is also asked to seed the board so the kanban fills in from the roadmap tasks.
const ROADMAP_SEED_NOTE =
  "When you produce the roadmap, ALSO write one Hangar board card per roadmap task as a markdown file " +
  "under .aiwf/board/ in this repo. Each card file must have YAML frontmatter with: key (incrementing, " +
  "e.g. DC-1), title, status: Planning, kind: thread — followed by the task details as the markdown body.";

/** Compose the note for a project-level skill run: the user's note plus any skill-specific addendum. */
export function projectRunNote(skill: string, userNote?: string): string | undefined {
  const parts: string[] = [];
  if (userNote?.trim()) parts.push(userNote.trim());
  if (skill === "roadmap") parts.push(ROADMAP_SEED_NOTE);
  return parts.length ? parts.join("\n\n") : undefined;
}

/** Bootstrap one-liner from the aiwf README. */
const BOOTSTRAP_CMD =
  "curl -fsSL https://raw.githubusercontent.com/0xrafasec/ai-workflow/main/bootstrap.sh | bash";

/** Upstream repo + author, surfaced in the UI for context. */
export const AIWF_REPO_URL = "https://github.com/0xrafasec/ai-workflow";
export const AIWF_AUTHOR = "0xrafasec";
export const AIWF_AUTHOR_URL = "https://github.com/0xrafasec";

// Core skill folders aiwf installs — their presence in ~/.claude/skills means aiwf is set up.
const CORE_AIWF_SKILLS = ["prd", "spec", "roadmap", "feature", "review"];

export interface AiwfStatus {
  installed: boolean;
  aiwfBin: string | null; // path to the launcher, if found
  version: string | null;
  skillsFound: string[]; // which core aiwf skills are present in ~/.claude/skills
}

function skillsRoot(): string {
  return expandHome(getConfig().skillsDir ?? "~/.claude/skills");
}

/** Detect whether aiwf is installed: the launcher and/or its core skills in ~/.claude/skills. */
export function detectAiwf(): AiwfStatus {
  const binPath = path.join(os.homedir(), ".local", "bin", "aiwf");
  const aiwfBin = fs.existsSync(binPath) ? binPath : null;

  const root = skillsRoot();
  const skillsFound = fs.existsSync(root)
    ? CORE_AIWF_SKILLS.filter((s) => fs.existsSync(path.join(root, s, "SKILL.md")))
    : [];

  let version: string | null = null;
  if (aiwfBin) {
    try {
      version = execSync(`"${aiwfBin}" version`, { encoding: "utf8", timeout: 5000 }).trim() || null;
    } catch {
      /* launcher present but version failed — ignore */
    }
  }

  // Installed if the core skills are available (what Hangar actually needs) or the launcher exists.
  const installed = skillsFound.length >= 3 || aiwfBin !== null;
  return { installed, aiwfBin, version, skillsFound };
}

/** Run the aiwf bootstrap installer (blocking). Returns the refreshed status + captured output. */
export function installAiwf(): { status: AiwfStatus; output: string } {
  try {
    const output = execSync(BOOTSTRAP_CMD, { encoding: "utf8", timeout: 300_000, shell: "/bin/bash" });
    return { status: detectAiwf(), output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
    throw new Error(`aiwf install failed: ${detail.slice(-500)}`, { cause: err });
  }
}

/**
 * Uninstall aiwf from ~/.claude / ~/.local/bin via its launcher (`aiwf uninstall-all`).
 * This removes the toolkit only — it never touches a project repo or its .aiwf/board cards.
 */
export function uninstallAiwf(): { status: AiwfStatus; output: string } {
  const { aiwfBin } = detectAiwf();
  if (!aiwfBin) {
    throw new Error("aiwf launcher not found (~/.local/bin/aiwf) — nothing to uninstall.");
  }
  try {
    const output = execSync(`"${aiwfBin}" uninstall-all`, { encoding: "utf8", timeout: 120_000 });
    return { status: detectAiwf(), output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
    throw new Error(`aiwf uninstall failed: ${detail.slice(-500)}`, { cause: err });
  }
}

// ---- Card board (markdown files inside the project repo) ----

/** The board directory for a project: <repoPath>/.aiwf/board */
export function boardDir(project: AiwfProject): string {
  return path.join(expandHome(project.repoPath), ".aiwf", "board");
}

export function columnsFor(project: AiwfProject): string[] {
  return project.columns?.length ? project.columns : DEFAULT_COLUMNS;
}

// History is stored as a JSON block in the card body so it round-trips robustly.
const HIST_OPEN = "<!--HANGAR_HISTORY";
const HIST_CLOSE = "HANGAR_HISTORY-->";

/** Parse a card file into frontmatter, the human description, and the history log. */
function parseCardFile(content: string): {
  fm: Record<string, string>;
  description: string;
  history: AiwfHistoryEntry[];
} {
  const lines = content.split(/\r?\n/);
  let body = content.trim();
  const fm: Record<string, string> = {};
  if (lines[0]?.trim() === "---") {
    let i = 1;
    for (; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        i++;
        break;
      }
      const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m) fm[m[1]] = m[2].trim();
    }
    body = lines.slice(i).join("\n").trim();
  }

  let history: AiwfHistoryEntry[] = [];
  let description = body;
  const start = body.indexOf(HIST_OPEN);
  if (start >= 0) {
    const end = body.indexOf(HIST_CLOSE, start);
    const json = body.slice(start + HIST_OPEN.length, end >= 0 ? end : undefined).trim();
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) history = parsed;
    } catch {
      /* ignore malformed history */
    }
    description = body.slice(0, start).trim();
  }
  return { fm, description, history };
}

/** Serialize frontmatter + description + history block back to a card file. */
function serializeCard(fm: Record<string, string>, description: string, history: AiwfHistoryEntry[]): string {
  const front = Object.keys(fm)
    .filter((k) => fm[k] !== undefined && fm[k] !== "")
    .map((k) => `${k}: ${fm[k]}`)
    .join("\n");
  let out = `---\n${front}\n---\n\n${description.trim()}\n`;
  if (history.length) out += `\n${HIST_OPEN}\n${JSON.stringify(history, null, 2)}\n${HIST_CLOSE}\n`;
  return out;
}

function cardToTicket(
  project: AiwfProject,
  fm: Record<string, string>,
  description: string,
  history: AiwfHistoryEntry[],
  file: string,
): Ticket {
  const key = fm.key || file.replace(/\.md$/, "");
  return {
    key,
    summary: fm.title || fm.summary || key,
    status: fm.status || columnsFor(project)[0],
    assignee: fm.assignee || null,
    assigneeAvatar: null,
    issuetype: fm.issuetype || null,
    priority: fm.priority || null,
    boardKey: project.id,
    source: "aiwf",
    description: description || undefined,
    prUrl: fm.pr || undefined,
    kind: fm.kind === "task" ? "task" : "thread",
    skill: fm.skill || undefined,
    history,
  };
}

/** Read every card in a project's board dir (returns [] if the dir doesn't exist yet). */
export function listCards(project: AiwfProject): Ticket[] {
  const dir = boardDir(project);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { fm, description, history } = parseCardFile(fs.readFileSync(path.join(dir, f), "utf8"));
      return cardToTicket(project, fm, description, history, f);
    })
    .sort((a, b) => keyNum(a.key) - keyNum(b.key));
}

function keyNum(key: string): number {
  const m = key.match(/-(\d+)$/);
  return m ? Number(m[1]) : 0;
}

/** A stable card-key prefix derived from the project name (e.g. "Dynamic Core" -> "DC"). */
function projectPrefix(project: AiwfProject): string {
  const words = project.name
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const prefix = words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] ?? "card").slice(0, 3);
  return prefix.toUpperCase().slice(0, 5) || "CARD";
}

function findCardFile(project: AiwfProject, key: string): string | null {
  const dir = boardDir(project);
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const { fm } = parseCardFile(fs.readFileSync(path.join(dir, f), "utf8"));
    if ((fm.key || f.replace(/\.md$/, "")) === key) return path.join(dir, f);
  }
  return null;
}

export interface NewCardInput {
  title: string;
  status?: string; // the phase column to create it in
  kind?: "thread" | "task";
  skill?: string;
  description?: string;
}

/** Create a new card file, returning the resulting Ticket. */
export function createCard(project: AiwfProject, input: NewCardInput): Ticket {
  const dir = boardDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const next = listCards(project).reduce((max, t) => Math.max(max, keyNum(t.key)), 0) + 1;
  const key = `${projectPrefix(project)}-${next}`;
  const fm: Record<string, string> = {
    key,
    title: input.title.trim(),
    status: input.status?.trim() || columnsFor(project)[0],
    kind: input.kind === "task" ? "task" : "thread",
    ...(input.skill ? { skill: input.skill } : {}),
  };
  fs.writeFileSync(path.join(dir, `${key}.md`), serializeCard(fm, input.description ?? "", []));
  return cardToTicket(project, fm, input.description ?? "", [], `${key}.md`);
}

/** Move a card to a new phase column (rewrites its `status:` frontmatter). */
export function transitionCard(project: AiwfProject, key: string, status: string): void {
  const file = findCardFile(project, key);
  if (!file) throw new Error(`Card not found: ${key}`);
  const { fm, description, history } = parseCardFile(fs.readFileSync(file, "utf8"));
  fm.status = status;
  fs.writeFileSync(file, serializeCard(fm, description, history));
}

/** Get one card as a Ticket (used when starting a run against it). */
export function getCard(project: AiwfProject, key: string): Ticket | null {
  const file = findCardFile(project, key);
  if (!file) return null;
  const { fm, description, history } = parseCardFile(fs.readFileSync(file, "utf8"));
  return cardToTicket(project, fm, description, history, path.basename(file));
}

/**
 * Append a history entry to a card (called when a session against it finishes), and record the
 * skill as the card's most recent. Resolves the project by id; no-op if it/the card is gone.
 */
export function appendCardHistory(projectId: string, key: string, entry: AiwfHistoryEntry): void {
  const project = getAiwfProjects().find((p) => p.id === projectId);
  if (!project) return;
  const file = findCardFile(project, key);
  if (!file) return;
  const { fm, description, history } = parseCardFile(fs.readFileSync(file, "utf8"));
  history.push(entry);
  if (entry.skill && entry.skill !== "task") fm.skill = entry.skill;
  fs.writeFileSync(file, serializeCard(fm, description, history));
}
