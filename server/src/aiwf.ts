import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { execSync, exec as execRaw } from "child_process";
import { promisify } from "util";

const execAsync = promisify(execRaw);
import { expandHome, getConfig, getAiwfProjects } from "./config";
import { AiwfProject, AiwfHistoryEntry, Ticket } from "./types";
import { isDemo, demoAiwfCards } from "./demo";
import { createWorktree, findWorktreePath, sanitize } from "./worktree";
import { DATA_DIR } from "./store";

// ---------------------------------------------------------------------------
// AI Workflow (aiwf) connection: https://github.com/0xrafasec/ai-workflow
//
// aiwf is a Claude-native spec-driven-development toolkit installed into ~/.claude.
// Hangar already reads ~/.claude/skills, so once installed its skills appear in the
// fleet for free. This module adds (1) install detection/bootstrap and (2) a tiny
// markdown-card board. The board is runtime state (its status/history churn on every move and
// run), so cards live in Hangar's own data dir at <DATA_DIR>/aiwf/<projectId>/board/ — NOT in the
// project repo, which stays pristine. A task's durable criteria belong in a tracked docs/specs file.
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

// Code-producing implementation skills that mutate source directly in their own run. An aiwf run of
// one is isolated in its own git worktree + branch — like any other Hangar run — so parallel
// implementation runs (and the user's own working tree) can't clobber each other. Every other aiwf
// skill runs in place: planning/design/doc/review skills (plus spec/new-project) so their docs land
// in the real repo, and the self-delivering skills (commit, pr, and the autopilot/factory
// orchestrators, which spawn their own worktree subagents and open their own PRs) so their git work
// operates on the real repo, not a throwaway branch. See `skillNeedsWorktree`.
export const WORKTREE_SKILLS = new Set(["feature", "fix"]);

/** Whether an aiwf card run of `skill` should be isolated in its own git worktree. */
export function skillNeedsWorktree(skill: string): boolean {
  return WORKTREE_SKILLS.has(skill);
}

// Skills that run inside the spec card's task-scoped worktree (create it if absent, reuse if present).
// Planning/doc/bootstrap skills are excluded — they write to the real repo so their output is tracked.
// @deprecated — use DELIVERY_SKILLS for new code
export const TASK_WORKTREE_SKILLS = new Set([
  "feature",
  "fix", // code-producing: mutate source in isolation
  "review",
  "sec-review", // review the actual implementation, not the real repo
  "commit",
  "pr", // deliver from the task branch, not the real repo
]);

// Skills that form the implementation-and-ship chain. These get persistent task worktrees shared
// across all runs on the same card (Jira tickets + AIWF board cards + SPEC-* cards alike).
// Non-delivery skills (prd, roadmap, autopilot, …) keep the existing isolateRuns path so Docker
// environments and analysis agents are unaffected.
export const DELIVERY_SKILLS = new Set([
  "spec", // planning: writes the spec into the task branch
  "feature",
  "fix", // code: implements in isolation
  "review",
  "sec-review", // review: inspects the actual implementation
  "commit",
  "pr", // delivery: ships from the task branch
]);

// The roadmap skill is also asked to seed the board so the kanban fills in from the roadmap tasks.
// The board lives in Hangar's data dir (not the repo), so the skill is given the absolute path.
const roadmapSeedNote = (boardPath: string): string =>
  "When you produce the roadmap, ALSO write one Hangar board card per roadmap task as a markdown file " +
  `in ${boardPath} (create the directory if it doesn't exist). Each card file must have YAML frontmatter ` +
  "with: key (incrementing, e.g. DC-1), title, status: Planning, kind: thread — followed by the task " +
  "details as the markdown body.";

/** Compose the note for a project-level skill run: the user's note plus any skill-specific addendum. */
export function projectRunNote(skill: string, project: AiwfProject, userNote?: string): string | undefined {
  const parts: string[] = [];
  if (userNote?.trim()) parts.push(userNote.trim());
  if (skill === "roadmap") parts.push(roadmapSeedNote(boardDir(project)));
  return parts.length ? parts.join("\n\n") : undefined;
}

/** Bootstrap one-liner from the aiwf README. */
const BOOTSTRAP_CMD =
  "curl -fsSL https://raw.githubusercontent.com/0xrafasec/ai-workflow/main/bootstrap.sh | bash";

/** Upstream repo + author, surfaced in the UI for context. */
export const AIWF_REPO_URL = "https://github.com/0xrafasec/ai-workflow";
export const AIWF_AUTHOR = "0xrafasec";
export const AIWF_AUTHOR_URL = "https://github.com/0xrafasec";

// All skills shipped by aiwf — derived from SKILL_GROUPS so it's always in sync.
const ALL_AIWF_SKILLS = SKILL_GROUPS.flatMap((g) => g.skills);

export interface AiwfStatus {
  installed: boolean;
  aiwfBin: string | null; // path to the launcher, if found
  version: string | null;
  skillsFound: string[]; // which aiwf skills are present in ~/.claude/skills
}

function skillsRoot(): string {
  return expandHome(getConfig().skillsDir ?? "~/.claude/skills");
}

/** Detect whether aiwf is installed: the launcher and/or its core skills in ~/.claude/skills. */
export function detectAiwf(): AiwfStatus {
  // Demo mode: report a fully-installed toolkit so the connection shows its full UI, no real aiwf.
  if (isDemo())
    return { installed: true, aiwfBin: "(demo)", version: "demo", skillsFound: [...ALL_AIWF_SKILLS] };
  const binPath = path.join(os.homedir(), ".local", "bin", "aiwf");
  const aiwfBin = fs.existsSync(binPath) ? binPath : null;

  const root = skillsRoot();
  const skillsFound = fs.existsSync(root)
    ? ALL_AIWF_SKILLS.filter((s) => fs.existsSync(path.join(root, s, "SKILL.md")))
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

/** Run the aiwf bootstrap installer (non-blocking). Returns the refreshed status + captured output. */
export async function installAiwf(): Promise<{ status: AiwfStatus; output: string }> {
  if (isDemo()) return { status: detectAiwf(), output: "Demo mode — install is simulated." };
  try {
    const { stdout } = await execAsync(BOOTSTRAP_CMD, {
      encoding: "utf8",
      timeout: 300_000,
      shell: "/bin/bash",
    });
    return { status: detectAiwf(), output: stdout ?? "" };
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
export async function uninstallAiwf(): Promise<{ status: AiwfStatus; output: string }> {
  if (isDemo()) return { status: detectAiwf(), output: "Demo mode — uninstall is simulated." };
  const { aiwfBin } = detectAiwf();
  if (!aiwfBin) {
    throw new Error("aiwf launcher not found (~/.local/bin/aiwf) — nothing to uninstall.");
  }
  try {
    const { stdout } = await execAsync(`"${aiwfBin}" uninstall-all`, { encoding: "utf8", timeout: 120_000 });
    return { status: detectAiwf(), output: stdout ?? "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
    throw new Error(`aiwf uninstall failed: ${detail.slice(-500)}`, { cause: err });
  }
}

// ---- Card board (markdown files in Hangar's data dir, keyed by project) ----

/** The board directory for a project: <DATA_DIR>/aiwf/<projectId>/board (runtime, gitignored). */
export function boardDir(project: AiwfProject): string {
  return path.join(DATA_DIR, "aiwf", project.id, "board");
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
    // archived is omitted when false/absent so non-archived cards stay clean
    ...(fm.archived === "true" ? { archived: true } : {}),
  };
}

/** Read every card in a project's board dir (returns [] if the dir doesn't exist yet). */
export function listCards(project: AiwfProject): Ticket[] {
  if (isDemo()) return demoAiwfCards();
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
  if (isDemo()) {
    return {
      key: "AUR-demo",
      summary: input.title.trim(),
      status: input.status?.trim() || columnsFor(project)[0],
      assignee: null,
      assigneeAvatar: null,
      issuetype: null,
      priority: null,
      boardKey: project.id,
      source: "aiwf",
      kind: input.kind === "task" ? "task" : "thread",
      description: input.description,
      history: [],
    };
  }
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
  if (isDemo()) return; // demo board is read-only; nothing is persisted
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
 * Soft-archive or unarchive a card. Sets `archived: "true"` in frontmatter when archiving, or
 * deletes the key entirely when unarchiving (so `serializeCard` emits no value for non-archived).
 * Throws `Card not found: <key>` when the card is missing, mirroring `transitionCard`.
 */
export function setCardArchived(project: AiwfProject, key: string, archived: boolean): void {
  if (isDemo()) return; // demo board is read-only
  const file = findCardFile(project, key);
  if (!file) throw new Error(`Card not found: ${key}`);
  const { fm, description, history } = parseCardFile(fs.readFileSync(file, "utf8"));
  if (archived) {
    fm.archived = "true";
  } else {
    delete fm.archived; // omit the key so unarchived cards stay clean
  }
  fs.writeFileSync(file, serializeCard(fm, description, history));
}

// ---- Spec cards: read-only cards derived from docs/specs/ in the project repo ----
//
// Files created by /spec and /roadmap live in the project's docs/specs/ directory.
// Hangar surfaces them as read-only kind:"spec" Tickets so skills can be delegated
// to them from the board — no write operations ever touch the spec file itself.

/** The compact key for a spec, from its 3-digit numeric prefix: "006_aiwf-spec-tasks.md" → SPEC-006.
 *  Falls back to the (truncated) filename slug when there's no numeric prefix. */
function baseSpecKey(entryName: string): string {
  const m = entryName.match(/^(\d{3})_/);
  return m ? `SPEC-${m[1]}` : `SPEC-${entryName.replace(/\.md$/, "").slice(0, 20)}`;
}

/** Numeric value of a spec key's 3-digit prefix, for sorting. Non-numeric keys sort as 0. */
function specNum(key: string): number {
  const m = key.match(/^SPEC-(\d{3})/);
  return m ? Number(m[1]) : 0;
}

/** Parse a spec file and return a Ticket. relPath is relative to the project root.
 *  The caller supplies the (already disambiguated) key — see listSpecCards. */
function parseSpecFile(
  content: string,
  entryName: string,
  relPath: string,
  project: AiwfProject,
  key: string,
): Ticket {
  // Title: first "# " heading; strip common skill-generated prefixes so the summary is clean.
  const headingLine = content.split(/\r?\n/).find((l) => l.startsWith("# "));
  let summary = headingLine ? headingLine.slice(2).trim() : entryName.replace(/\.md$/, "");
  summary = summary.replace(/^(?:Spec\s+\d+\s*[—-]\s*|Feature:\s*|Phase\s+\d+:\s*)/i, "").trim() || summary;

  // Description: spec file path prepended so skills can resolve it by path.
  const description = `Spec: ${relPath}\n\n${content}`;

  return {
    key,
    summary,
    status: "Implementation", // the phase /spec belongs to; not used for column placement
    assignee: null,
    assigneeAvatar: null,
    issuetype: null,
    priority: null,
    boardKey: project.id,
    source: "aiwf",
    kind: "spec",
    description,
    history: [],
  };
}

/** Scan <project.repoPath>/docs/specs/ for NNN_*.md files and sliced NNN_slug/README.md entries.
 * Returns read-only Ticket objects. Returns [] in demo mode or if the directory doesn't exist. */
export function listSpecCards(project: AiwfProject): Ticket[] {
  if (isDemo()) return [];
  const specsDir = path.join(expandHome(project.repoPath), "docs", "specs");
  if (!fs.existsSync(specsDir)) return [];

  // Collect raw spec sources first so we can detect numeric-prefix collisions before keying.
  const sources: { entryName: string; relPath: string; content: string }[] = [];
  for (const entry of fs.readdirSync(specsDir, { withFileTypes: true })) {
    if (entry.isFile() && /^\d{3}_.*\.md$/.test(entry.name)) {
      // Single-file spec: docs/specs/NNN_slug.md
      const relPath = path.join("docs", "specs", entry.name);
      const content = fs.readFileSync(path.join(specsDir, entry.name), "utf8");
      sources.push({ entryName: entry.name, relPath, content });
    } else if (entry.isDirectory() && /^\d{3}_/.test(entry.name)) {
      // Sliced spec directory: docs/specs/NNN_slug/README.md
      const readme = path.join(specsDir, entry.name, "README.md");
      if (fs.existsSync(readme)) {
        const relPath = path.join("docs", "specs", entry.name, "README.md");
        const content = fs.readFileSync(readme, "utf8");
        sources.push({ entryName: entry.name, relPath, content });
      }
    }
  }

  // Two spec files can share a numeric prefix (e.g. 014_a.md and 014_b.md). They'd both key to
  // SPEC-014 and collide — duplicate React keys make the board render duplicate/stale spec rows.
  // Keep the compact SPEC-NNN key when a prefix is unique; otherwise fall back to the full filename
  // slug (SPEC-014_claude-session-ux) so every spec gets a stable, unique key.
  const baseCounts = new Map<string, number>();
  for (const s of sources)
    baseCounts.set(baseSpecKey(s.entryName), (baseCounts.get(baseSpecKey(s.entryName)) ?? 0) + 1);

  const cards = sources.map((s) => {
    const base = baseSpecKey(s.entryName);
    const key = (baseCounts.get(base) ?? 0) > 1 ? `SPEC-${s.entryName.replace(/\.md$/, "")}` : base;
    return parseSpecFile(s.content, s.entryName, s.relPath, project, key);
  });

  // Sort descending by numeric prefix (newest first); break ties by key so order is deterministic.
  return cards.sort((a, b) => specNum(b.key) - specNum(a.key) || a.key.localeCompare(b.key));
}

/** Find a single spec card by SPEC-NNN key. Returns null if not found. */
export function getSpecCard(project: AiwfProject, key: string): Ticket | null {
  if (!key.startsWith("SPEC-")) return null;
  return listSpecCards(project).find((c) => c.key === key) ?? null;
}

/**
 * Permanently remove a card file. Returns true if a file was removed, false if none was found.
 * Demo mode is handled in the route — this function is not called in demo mode.
 */
export function deleteCard(project: AiwfProject, key: string): boolean {
  const file = findCardFile(project, key);
  if (!file) return false;
  fs.unlinkSync(file);
  return true;
}

/**
 * Append a history entry to a card (called when a session against it finishes), and record the
 * skill as the card's most recent. When `prUrl` is a non-empty string, also writes it to the
 * card's `pr:` frontmatter so the link survives the run (restarts/reloads). An absent/empty
 * `prUrl` leaves any existing `pr:` untouched — never clears a known PR.
 * Resolves the project by id; no-op if it/the card is gone.
 */
export function appendCardHistory(
  projectId: string,
  key: string,
  entry: AiwfHistoryEntry,
  prUrl?: string,
): void {
  const project = getAiwfProjects().find((p) => p.id === projectId);
  if (!project) return;
  const file = findCardFile(project, key);
  if (!file) return;
  const { fm, description, history } = parseCardFile(fs.readFileSync(file, "utf8"));
  history.push(entry);
  if (entry.skill && entry.skill !== "task") fm.skill = entry.skill;
  if (prUrl?.trim()) fm.pr = prUrl.trim();
  fs.writeFileSync(file, serializeCard(fm, description, history));
}

// ---- Task-scoped worktrees for card runs ----
//
// Every card (Jira ticket, AIWF board card, SPEC-* card) that runs a DELIVERY_SKILLS skill gets a
// persistent git worktree on a semantic branch shared across all runs on that card. State is stored
// in <DATA_DIR>/card-state/<contextId>/<key>.json where:
//   contextId = "aiwf-<projectId>"  for AIWF board cards
//   contextId = "jira-<boardKey>"   for Jira board tickets
//
// Backward compat: reads from the old spec-state path when card-state is missing, so existing
// SPEC-* worktrees survive the upgrade without migration.

function cardStateDir(contextId: string): string {
  return path.join(DATA_DIR, "card-state", contextId);
}

// @deprecated — kept so the old spec-state path is still readable (e.g. during server upgrades).
function legacySpecStateDir(projectId: string): string {
  return path.join(DATA_DIR, "aiwf", projectId, "spec-state");
}

export interface CardState {
  taskBranch: string;
  worktreePath: string;
}

export function getCardState(contextId: string, key: string): CardState | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(cardStateDir(contextId), `${key}.json`), "utf8"));
  } catch {
    /* not found — try backward compat below */
  }
  // Backward compat: for AIWF contexts fall back to old spec-state path.
  if (contextId.startsWith("aiwf-")) {
    const projectId = contextId.slice(5); // "aiwf-".length === 5
    try {
      return JSON.parse(fs.readFileSync(path.join(legacySpecStateDir(projectId), `${key}.json`), "utf8"));
    } catch {
      /* not found */
    }
  }
  return null;
}

export function setCardState(contextId: string, key: string, state: CardState): void {
  const dir = cardStateDir(contextId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(state));
}

export function clearCardState(contextId: string, key: string): void {
  try {
    fs.unlinkSync(path.join(cardStateDir(contextId), `${key}.json`));
  } catch {
    /* best-effort */
  }
  // Also clear old spec-state file if present.
  if (contextId.startsWith("aiwf-")) {
    const projectId = contextId.slice(5); // "aiwf-".length === 5
    try {
      fs.unlinkSync(path.join(legacySpecStateDir(projectId), `${key}.json`));
    } catch {
      /* best-effort */
    }
  }
}

/** List all card states for a context (one entry per stored key). Returns [] if no state dir. */
export function listCardStates(contextId: string): Array<{ key: string } & CardState> {
  const dir = cardStateDir(contextId);
  if (!fs.existsSync(dir)) return [];
  const results: Array<{ key: string } & CardState> = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const state = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as CardState;
      results.push({ key: file.slice(0, -5), ...state }); // strip ".json"
    } catch {
      /* skip malformed files */
    }
  }
  return results;
}

// Backward-compat aliases — kept so existing callers (index.ts transition handler, tests) don't break.
export type SpecState = CardState;
export const getSpecState = (projectId: string, key: string): CardState | null =>
  getCardState(`aiwf-${projectId}`, key);
export const setSpecState = (projectId: string, key: string, state: CardState): void =>
  setCardState(`aiwf-${projectId}`, key, state);
export const clearSpecState = (projectId: string, key: string): void =>
  clearCardState(`aiwf-${projectId}`, key);

/**
 * Derive the git branch name for a spec's task worktree.
 * Reads the spec file's `## Trunk Metadata` block for the `Type` field; falls back to `feat`.
 * For sliced specs (`NNN_slug/`), uses the directory slug, not the slice filename.
 *
 * @param specAbsPath - absolute path to the spec file OR its parent directory (sliced spec).
 */
export function branchFromSpec(specAbsPath: string): string {
  const stat = (() => {
    try {
      return fs.statSync(specAbsPath);
    } catch {
      return null;
    }
  })();
  const isDir = stat?.isDirectory() ?? false;

  // Slug: strip NNN_ prefix and .md extension from the basename (or directory name).
  const base = path.basename(isDir ? specAbsPath : specAbsPath.replace(/\.md$/, ""));
  const slug = sanitize(base.replace(/^\d{3}_/, ""));

  // Read spec content to extract Trunk Metadata type.
  let content = "";
  try {
    const file = isDir ? path.join(specAbsPath, "README.md") : specAbsPath;
    content = fs.readFileSync(file, "utf8");
  } catch {
    /* can't read — use default type */
  }

  const typeMatch = content.match(/##\s+Trunk\s+Metadata[\s\S]*?\*\*Type:\*\*\s+(\w+)/i);
  const raw = typeMatch?.[1]?.toLowerCase() ?? "feat";
  const validTypes = ["feat", "fix", "refactor", "chore", "test", "docs", "perf", "security"];
  const prefix = validTypes.includes(raw) ? raw : "feat";

  return `${prefix}/${slug}`;
}

/** Absolute path to the spec file (or sliced spec directory) for a SPEC-NNN key. Returns null if not found.
 *  When both a file and a directory share the same NNN_ prefix, the directory (sliced spec) takes precedence. */
function specAbsPath(project: AiwfProject, key: string): string | null {
  const num = key.replace(/^SPEC-/, "");
  const specsDir = path.join(expandHome(project.repoPath), "docs", "specs");
  try {
    const entries = fs.readdirSync(specsDir, { withFileTypes: true });
    let filePath: string | null = null;
    for (const entry of entries) {
      if (!entry.name.startsWith(`${num}_`)) continue;
      const full = path.join(specsDir, entry.name);
      if (entry.isDirectory()) return full; // sliced spec wins immediately
      filePath = full;
    }
    return filePath;
  } catch {
    /* specs dir missing */
  }
  return null;
}

/** Resolve the absolute spec path from a promoted card's "Spec: <relPath>" description line.
 *  For sliced specs the relPath points at README.md; return the parent directory so
 *  branchFromSpec derives the directory slug (matching specAbsPath's sliced-spec behavior).
 *  Returns null when the line is absent, malformed, escapes repoPath, or does not exist. */
function specPathFromDescription(project: AiwfProject, description?: string): string | null {
  const m = (description ?? "").split("\n", 1)[0].match(/^Spec:\s+(.+\.md)\s*$/);
  if (!m) return null;
  const root = path.resolve(expandHome(project.repoPath));
  let abs = path.resolve(root, m[1].trim());
  // Containment guard: a crafted "Spec: ../../x.md" line must not escape the project repo.
  // (Card descriptions are operator-supplied via the create-card route — validate the boundary.)
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (path.basename(abs) === "README.md") abs = path.dirname(abs); // sliced spec → directory
  if (!fs.existsSync(abs)) return null;
  return abs;
}

/** Derive a branch name for a non-SPEC card from the skill and card key.
 *  fix/sec-review → fix/<key>, everything else → feat/<key>. */
function branchForCard(skill: string, cardKey: string): string {
  const prefix = skill === "fix" || skill === "sec-review" ? "fix" : "feat";
  return `${prefix}/${sanitize(cardKey.toLowerCase())}`;
}

/**
 * Resolve (or create) the persistent task worktree for any card type.
 *
 * - On first run: creates a worktree from `main` and stores state in card-state/.
 * - On subsequent runs: reuses the stored path; re-creates the worktree if the path is stale.
 * - Returns `{ cwd, branch }` on success, `null` on git error.
 *
 * @param stateContextId "aiwf-<projectId>" or "jira-<boardKey>"
 * @param specPath       absolute path to the spec file — non-null only for SPEC-* cards
 */
export async function resolveCardWorktree(
  stateContextId: string,
  cardKey: string,
  skill: string,
  repoRoot: string,
  specPath: string | null = null,
): Promise<{ cwd: string; branch: string } | null> {
  const existing = getCardState(stateContextId, cardKey);

  if (existing) {
    // Fast path: stored path still alive.
    if (fs.existsSync(existing.worktreePath)) {
      return { cwd: existing.worktreePath, branch: existing.taskBranch };
    }
    // Stale path — check via git before re-creating.
    const gitPath = await findWorktreePath(repoRoot, existing.taskBranch);
    if (gitPath && fs.existsSync(gitPath)) {
      setCardState(stateContextId, cardKey, { ...existing, worktreePath: gitPath });
      return { cwd: gitPath, branch: existing.taskBranch };
    }
    // Re-create on the existing branch.
    const wt = await createWorktree(repoRoot, existing.taskBranch, randomUUID(), {
      existingBranch: existing.taskBranch,
    });
    if (!wt) return null;
    setCardState(stateContextId, cardKey, { taskBranch: wt.branch, worktreePath: wt.path });
    return { cwd: wt.path, branch: wt.branch };
  }

  // First run — derive branch name and create from main.
  const taskBranch = specPath ? branchFromSpec(specPath) : branchForCard(skill, cardKey);
  const wt = await createWorktree(repoRoot, taskBranch, randomUUID(), {
    branchName: taskBranch,
    baseBranch: "main",
  });
  if (!wt) return null;
  setCardState(stateContextId, cardKey, { taskBranch: wt.branch, worktreePath: wt.path });
  return { cwd: wt.path, branch: wt.branch };
}

/**
 * Convenience wrapper for AIWF card runs: resolves the task worktree using the project context.
 * Returns null when the skill is not in DELIVERY_SKILLS (caller should run in the real repo).
 */
export async function resolveTaskWorktree(
  project: AiwfProject,
  cardKey: string,
  skill: string,
  description?: string,
): Promise<{ cwd: string; branch: string } | null> {
  if (!DELIVERY_SKILLS.has(skill)) return null;
  const repoRoot = expandHome(project.repoPath);
  // SPEC-* cards resolve their spec by key; promoted board cards recover the source spec from
  // their "Spec: <relPath>" description line so they keep the semantic feat/<spec-slug> branch.
  const specPath = cardKey.startsWith("SPEC-")
    ? specAbsPath(project, cardKey)
    : specPathFromDescription(project, description);
  return resolveCardWorktree(`aiwf-${project.id}`, cardKey, skill, repoRoot, specPath);
}
