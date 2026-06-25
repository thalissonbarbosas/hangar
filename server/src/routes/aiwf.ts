import { Router, Response } from "express";
import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import rateLimit from "express-rate-limit";
import { getConfig, expandHome, getAiwfProjects, saveAiwfProjects } from "../config";
import {
  detectAiwf,
  installAiwf,
  listCards,
  listSpecCards,
  createCard,
  transitionCard,
  setCardArchived,
  deleteCard,
  uninstallAiwf,
  getCard,
  getSpecCard,
  boardDir,
  columnsFor,
  projectRunNote,
  skillNeedsWorktree,
  resolveTaskWorktree,
  clearSpecState,
  getCardState,
  clearCardState,
  listCardStates,
  DELIVERY_SKILLS,
  DEFAULT_COLUMNS,
  COLUMN_SKILLS,
  SKILL_GROUPS,
  AIWF_REPO_URL,
  AIWF_AUTHOR,
  AIWF_AUTHOR_URL,
  listAiwfDocs,
  getAiwfDoc,
  listProjectDocs,
  getProjectDoc,
  listProjectDocTree,
  getProjectDocByPath,
} from "../aiwf";
import { skillExists, findSkill } from "../skills";
import { startRun, activeRunsInDir } from "../sessions";
import { isDemo } from "../demo";
import { AiwfProject } from "../types";
import { removeWorktree, currentBranch, checkoutBranch } from "../worktree";

// Limit session-spawning endpoints: 30 requests per minute per IP.
// Hangar is a single-operator tool; this guards against runaway loops or misconfigured clients.
const runCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sessions started — slow down and try again in a minute." },
});

export const aiwfRouter = Router();

// ---------------- AI Workflow connection (self-hosted, Claude-run) ----------------

// Install detection + the column/skill presets the UI renders from.
aiwfRouter.get("/api/aiwf/status", (_req, res) => {
  res.json({
    ...detectAiwf(),
    defaultColumns: DEFAULT_COLUMNS,
    columnSkills: COLUMN_SKILLS,
    skillGroups: SKILL_GROUPS,
    repoUrl: AIWF_REPO_URL,
    author: AIWF_AUTHOR,
    authorUrl: AIWF_AUTHOR_URL,
  });
});

// AIWF docs: list + fetch from ~/.local/share/ai-workflow/docs/
aiwfRouter.get("/api/aiwf/docs", (_req, res) => {
  res.json({ docs: listAiwfDocs() });
});

aiwfRouter.get("/api/aiwf/docs/:slug", (req, res) => {
  const { slug } = req.params;
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return res.status(400).json({ error: "Invalid slug" });
  const content = getAiwfDoc(slug);
  if (content === null) return res.status(404).json({ error: "Not found" });
  res.json({ content });
});

// Project docs: list + fetch from {repoPath}/docs/ (excluding docs/specs/)
aiwfRouter.get("/api/aiwf/projects/:id/docs", (req, res) => {
  const project = getAiwfProjects().find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "project_not_found" });
  res.json({ docs: listProjectDocs(project.repoPath) });
});

// Sidebar doc tree — must be registered before /:slug to avoid "tree"/"content" being caught as slugs
aiwfRouter.get("/api/aiwf/projects/:id/docs/tree", (req, res) => {
  const project = getAiwfProjects().find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "project_not_found" });
  res.json({ nodes: listProjectDocTree(project.repoPath) });
});

// Doc content by relative path (for sidebar DocPanel)
aiwfRouter.get("/api/aiwf/projects/:id/docs/content", (req, res) => {
  const project = getAiwfProjects().find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "project_not_found" });
  const relPath = String(req.query.path ?? "");
  const result = getProjectDocByPath(project.repoPath, relPath);
  if (result === null) {
    if (!relPath.startsWith("docs/") || relPath.includes("..")) {
      return res.status(400).json({ error: "Invalid path" });
    }
    return res.status(404).json({ error: "Not found" });
  }
  res.json(result);
});

aiwfRouter.get("/api/aiwf/projects/:id/docs/:slug", (req, res) => {
  const project = getAiwfProjects().find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "project_not_found" });
  const { slug } = req.params;
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return res.status(400).json({ error: "Invalid slug" });
  const content = getProjectDoc(project.repoPath, slug);
  if (content === null) return res.status(404).json({ error: "Not found" });
  res.json({ content });
});

// One-click install (the client confirms first). Runs the aiwf bootstrap script.
aiwfRouter.post("/api/aiwf/install", async (_req, res) => {
  try {
    const { status, output } = await installAiwf();
    res.json({ ...status, output: output.slice(-2000) });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Uninstall aiwf from ~/.claude (toolkit only — projects and their .aiwf/board cards are kept).
aiwfRouter.post("/api/aiwf/uninstall", async (_req, res) => {
  try {
    const { status, output } = await uninstallAiwf();
    res.json({ ...status, output: output.slice(-2000) });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

aiwfRouter.get("/api/aiwf/projects", (_req, res) => {
  res.json({ projects: getAiwfProjects().map((p) => ({ ...p, columns: columnsFor(p) })) });
});

// Register a project. mode "new" scaffolds it in place via the new-project skill.
aiwfRouter.post("/api/aiwf/projects", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const repoPathRaw = String(req.body?.repoPath ?? "").trim();
  const mode = req.body?.mode === "adopt" ? "adopt" : "new";
  if (!name || !repoPathRaw) return res.status(400).json({ error: "name and repoPath are required" });
  if (isDemo()) {
    // Demo mode: don't touch the filesystem or start a scaffold run — just echo a project back.
    const demo: AiwfProject = { id: randomUUID(), name, repoPath: repoPathRaw, createdAt: 0 };
    return res.json({ project: { ...demo, columns: columnsFor(demo) } });
  }
  const repoPath = expandHome(repoPathRaw);
  if (!existsSync(repoPath)) return res.status(400).json({ error: `Path does not exist: ${repoPath}` });

  const project: AiwfProject = { id: randomUUID(), name, repoPath: repoPathRaw, createdAt: Date.now() };
  saveAiwfProjects([...getAiwfProjects(), project]);
  mkdirSync(boardDir(project), { recursive: true }); // ensure the board dir exists

  let runId: string | undefined;
  if (mode === "new") {
    const cfg = getConfig();
    if (skillExists(cfg, "new-project")) {
      const run = startRun({
        kind: "skill",
        name: "new-project",
        note: `Scaffold a new project named "${name}" in this directory.`,
        cwd: repoPath,
        title: `${name}: scaffold`,
        skillSource: findSkill(cfg, "new-project")?.source,
        skipWorktree: true, // scaffold in the real repo, not a worktree
      });
      runId = run.id;
    }
  }
  res.json({ project: { ...project, columns: columnsFor(project) }, runId });
});

// Change a project's location (repoPath) and/or display name. The id is kept stable so the
// synthetic boardKey and any in-flight references survive; the board lives in Hangar's data dir
// keyed by id, so cards carry over unchanged — only future runs use the new path.
aiwfRouter.patch("/api/aiwf/projects/:id", (req, res) => {
  const existing = getAiwfProjects().find((p) => p.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "No such AI Workflow project" });

  const hasName = req.body?.name !== undefined;
  const hasRepoPath = req.body?.repoPath !== undefined;
  const name = hasName ? String(req.body.name).trim() : existing.name;
  const repoPathRaw = hasRepoPath ? String(req.body.repoPath).trim() : existing.repoPath;
  if (!hasName && !hasRepoPath) {
    return res.status(400).json({ error: "name or repoPath is required" });
  }
  if (!name || !repoPathRaw) return res.status(400).json({ error: "name and repoPath cannot be empty" });

  const updated: AiwfProject = { ...existing, name, repoPath: repoPathRaw };
  if (isDemo()) return res.json({ project: { ...updated, columns: columnsFor(updated) } });

  // Validate the (possibly new) location before persisting anything.
  if (hasRepoPath && repoPathRaw !== existing.repoPath) {
    const repoPath = expandHome(repoPathRaw);
    if (!existsSync(repoPath)) return res.status(400).json({ error: `Path does not exist: ${repoPath}` });
  }
  mkdirSync(boardDir(updated), { recursive: true }); // board dir is keyed by id; ensure it exists
  saveAiwfProjects(getAiwfProjects().map((p) => (p.id === updated.id ? updated : p)));
  res.json({ project: { ...updated, columns: columnsFor(updated) } });
});

aiwfRouter.delete("/api/aiwf/projects/:id", (req, res) => {
  if (!getAiwfProjects().some((p) => p.id === req.params.id)) {
    return res.status(404).json({ error: "No such AI Workflow project" });
  }
  saveAiwfProjects(getAiwfProjects().filter((p) => p.id !== req.params.id));
  res.json({ ok: true });
});

function requireAiwfProject(res: Response, id: string): AiwfProject | null {
  const p = getAiwfProjects().find((x) => x.id === id);
  if (!p) {
    res.status(404).json({ error: "No such AI Workflow project" });
    return null;
  }
  return p;
}

// The project's board cards (markdown files in <DATA_DIR>/aiwf/<projectId>/board) plus
// read-only spec cards sourced from <repoPath>/docs/specs/. Spec cards have kind:"spec".
// Both list functions handle demo mode internally (listSpecCards returns [] in demo mode).
aiwfRouter.get("/api/aiwf/projects/:id/cards", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const ctxId = `aiwf-${p.id}`;
  const enrich = (c: ReturnType<typeof listCards>[number]) => {
    const state = getCardState(ctxId, c.key);
    return { ...c, hasWorktree: state !== null, taskBranch: state?.taskBranch };
  };
  res.json({ tickets: [...listCards(p).map(enrich), ...listSpecCards(p).map(enrich)] });
});

aiwfRouter.get("/api/aiwf/projects/:id/cards/:key", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const card = getCard(p, req.params.key);
  if (!card) return res.status(404).json({ error: "Card not found" });
  const state = getCardState(`aiwf-${p.id}`, card.key);
  res.json({ ticket: { ...card, hasWorktree: state !== null, taskBranch: state?.taskBranch } });
});

// ---- AIWF worktree management routes ----

aiwfRouter.get("/api/aiwf/projects/:id/worktrees", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  res.json({ worktrees: listCardStates(`aiwf-${p.id}`) });
});

aiwfRouter.delete("/api/aiwf/projects/:id/worktrees/:key", async (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const contextId = `aiwf-${p.id}`;
  const state = getCardState(contextId, req.params.key);
  if (state) {
    await removeWorktree({
      path: state.worktreePath,
      branch: state.taskBranch,
      repoRoot: expandHome(p.repoPath),
    });
    clearCardState(contextId, req.params.key);
  }
  res.json({ ok: true });
});

aiwfRouter.delete("/api/aiwf/projects/:id/worktrees", async (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const contextId = `aiwf-${p.id}`;
  const states = listCardStates(contextId);
  // Best-effort: attempt each entry independently; continue on per-item failure.
  for (const s of states) {
    try {
      await removeWorktree({ path: s.worktreePath, branch: s.taskBranch, repoRoot: expandHome(p.repoPath) });
      clearCardState(contextId, s.key);
    } catch {
      /* ignore per-item errors */
    }
  }
  res.json({ ok: true, removed: states.length });
});

// ---- Branch checkout routes (run the task branch in the project root) ----

// Branch names accepted by the generic checkout endpoint. Rejects path-traversal (`..`, leading `/`)
// and shell-significant characters — the card-scoped endpoint uses the stored taskBranch and is
// implicitly safe. The branch is always passed as a positional argv to execFile (no shell).
const BRANCH_RE = /^[a-zA-Z0-9/_.-]{1,100}$/;

/** Build the 409 active-sessions payload if any run is live in `repoPath`, else null. */
function activeSessionGuard(
  repoPath: string,
): { error: string; message: string; runIds: string[]; titles: string[] } | null {
  const active = activeRunsInDir(repoPath);
  if (active.length === 0) return null;
  return {
    error: "active_sessions",
    message: `${active.length} session(s) are still running in this project. Stop them before switching branches.`,
    runIds: active.map((r) => r.id),
    titles: active.map((r) => r.title),
  };
}

/** Run `git checkout <branch>` in `repoPath`, sending the response. Translates a dirty-tree
 *  failure into 409 dirty_tree (with raw git stderr); any other failure into 500.
 *  Returns true on success so callers can run post-checkout cleanup only when it actually happened. */
async function runCheckout(res: Response, repoPath: string, branch: string): Promise<boolean> {
  let previousBranch = "";
  try {
    previousBranch = await currentBranch(repoPath);
  } catch {
    /* not fatal — proceed without a previousBranch value */
  }
  try {
    await checkoutBranch(repoPath, branch);
    res.json({ ok: true, branch, previousBranch });
    return true;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = `${e.stderr ?? ""}${e.message ?? ""}`;
    if (
      /local changes|would be overwritten|commit your changes|stash|overwritten by checkout/i.test(detail)
    ) {
      res.status(409).json({ error: "dirty_tree", message: (e.stderr || e.message || "").trim() });
    } else {
      res.status(500).json({ error: String(e.message ?? err) });
    }
    return false;
  }
}

// Current HEAD branch of the project root — lets the UI reflect actual state across refreshes.
aiwfRouter.get("/api/aiwf/projects/:id/branch", async (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  try {
    const branch = await currentBranch(expandHome(p.repoPath));
    res.json({ branch });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Check out a card's task branch in the project root (removing its worktree first to free the branch).
aiwfRouter.post("/api/aiwf/projects/:id/cards/:key/checkout", async (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const key = req.params.key;
  const contextId = `aiwf-${p.id}`;
  const state = getCardState(contextId, key);
  // A card "exists" if it has a board/spec file or a stored task-branch (worktree state).
  const card = getCard(p, key) ?? getSpecCard(p, key);
  if (!card && !state) return res.status(404).json({ error: "No such card" });
  if (!state?.taskBranch) return res.status(400).json({ error: "Card has no task branch" });

  const repoPath = expandHome(p.repoPath);
  const guard = activeSessionGuard(repoPath);
  if (guard) return res.status(409).json(guard);

  // Free the branch: git forbids checking out a branch already checked out in a worktree.
  // Removing the worktree is best-effort and reversible (the branch is preserved); the card
  // state is cleared only after a confirmed checkout so a failure (e.g. dirty tree) leaves the
  // card's worktree state recoverable rather than orphaned.
  if (state.worktreePath) {
    await removeWorktree({ path: state.worktreePath, branch: state.taskBranch, repoRoot: repoPath });
  }
  const ok = await runCheckout(res, repoPath, state.taskBranch);
  if (ok) clearCardState(contextId, key);
});

// Generic branch checkout on the project root (used by "Back to main").
aiwfRouter.post("/api/aiwf/projects/:id/checkout", async (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const branch = String(req.body?.branch ?? "").trim();
  if (!branch) return res.status(400).json({ error: "branch is required" });
  // Reject path traversal (`..`) and anything outside the strict charset before passing to git.
  if (!BRANCH_RE.test(branch) || branch.includes("..")) {
    return res.status(400).json({ error: "Invalid branch name" });
  }

  const repoPath = expandHome(p.repoPath);
  const guard = activeSessionGuard(repoPath);
  if (guard) return res.status(409).json(guard);
  await runCheckout(res, repoPath, branch);
});

aiwfRouter.post("/api/aiwf/projects/:id/cards", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const title = String(req.body?.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const ticket = createCard(p, {
      title,
      status: req.body?.status,
      kind: req.body?.kind === "task" ? "task" : "thread",
      skill: typeof req.body?.skill === "string" ? req.body.skill : undefined,
      description: req.body?.description,
    });
    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

aiwfRouter.post("/api/aiwf/projects/:id/cards/:key/transition", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  const status = String(req.body?.status ?? "").trim();
  if (!status) return res.status(400).json({ error: "status is required" });
  // Spec cards have no mutable board card file. Allow Complete transitions only — they clear the
  // task-branch state so the next code run on the card gets a fresh worktree.
  if (req.params.key.startsWith("SPEC-")) {
    if (status !== "Complete") return res.status(400).json({ error: "Spec cards are read-only." });
    clearSpecState(p.id, req.params.key);
    return res.json({ ok: true });
  }
  try {
    transitionCard(p, req.params.key, status);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Soft-archive or unarchive a card. Body: { archived: boolean } (defaults to true).
// Demo mode returns success without writing to disk.
aiwfRouter.post("/api/aiwf/projects/:id/cards/:key/archive", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  if (req.params.key.startsWith("SPEC-")) return res.status(400).json({ error: "Spec cards are read-only." });
  const archived = req.body?.archived !== false; // coerce: absent or true → true, explicit false → false
  if (isDemo()) return res.json({ ok: true });
  try {
    setCardArchived(p, req.params.key, archived);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Permanently remove a card file. Demo mode returns success without touching disk.
aiwfRouter.delete("/api/aiwf/projects/:id/cards/:key", (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  if (req.params.key.startsWith("SPEC-")) return res.status(400).json({ error: "Spec cards are read-only." });
  if (isDemo()) return res.json({ ok: true });
  const removed = deleteCard(p, req.params.key);
  if (!removed) return res.status(404).json({ error: "No such card" });
  res.json({ ok: true });
});

// Start a phase skill as an in-place session against a card. The card's current phase is
// recorded so the result lands in that phase of its history; the roadmap skill also seeds cards.
// Spec cards (kind:"spec") are read-only — the spec file is never written, but a normal session
// runs with the spec content as context; appendCardHistory no-ops because no board file exists.
aiwfRouter.post("/api/aiwf/projects/:id/cards/:key/run", runCreateLimiter, async (req, res) => {
  const p = requireAiwfProject(res, req.params.id);
  if (!p) return;
  if (isDemo()) return res.json({ runId: "demo" }); // no real sessions in demo
  // Check board cards first, then read-only spec cards.
  const card = getCard(p, req.params.key) ?? getSpecCard(p, req.params.key);
  if (!card) return res.status(404).json({ error: "No such card" });
  const skill = String(req.body?.skill ?? "").trim();
  const userNote = typeof req.body?.note === "string" ? req.body.note : undefined;
  if (!skill) return res.status(400).json({ error: "skill is required" });
  const cfg = getConfig();
  if (!skillExists(cfg, skill)) {
    return res.status(400).json({ error: `Skill "${skill}" not found — install AI Workflow first.` });
  }

  // Delivery skills get a persistent task worktree shared across all runs on this card (any kind:
  // spec, thread, task). Other skills keep the per-run isolateRuns path so analysis agents and
  // Docker environments are unaffected. When isolateRuns is false the block is skipped entirely
  // and every skill runs in the real repo.
  let cwdOverride = expandHome(p.repoPath);
  let skipWorktree = !skillNeedsWorktree(skill);
  let taskBranch: string | undefined;

  if ((cfg.isolateRuns ?? true) && DELIVERY_SKILLS.has(skill)) {
    const taskWt = await resolveTaskWorktree(p, card.key, skill, card.description);
    if (taskWt) {
      cwdOverride = taskWt.cwd;
      skipWorktree = true;
      taskBranch = taskWt.branch;
    } else {
      // createWorktree failed (e.g. branch already checked out). Abort rather than silently running
      // in the wrong directory.
      return res.status(503).json({
        error: "Could not create task worktree — branch may already be checked out. Check git worktree list.",
      });
    }
  }

  const run = startRun({
    kind: "skill",
    name: skill,
    note: projectRunNote(skill, p, userNote),
    ticket: card,
    cwdOverride,
    skipWorktree,
    ...(taskBranch ? { branch: taskBranch } : {}),
    skillSource: findSkill(cfg, skill)?.source,
    aiwfProjectId: p.id,
    aiwfPhase: card.status,
  });
  res.json({ runId: run.id });
});
