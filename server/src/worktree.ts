import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const exec = promisify(execFile);

export interface Worktree {
  path: string;
  branch: string;
  repoRoot: string;
}

/** Resolve the git repo root containing `dir`, or null if it isn't a git working tree. */
async function gitRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "run";
}

/**
 * Create an isolated git worktree of the repo containing `dir`, on a fresh branch.
 * Returns null if `dir` isn't a git repo or the worktree couldn't be created
 * (caller should fall back to running in place).
 */
export async function createWorktree(dir: string, label: string, runId: string): Promise<Worktree | null> {
  const root = await gitRoot(dir);
  if (!root) return null;
  const wtPath = path.join(os.tmpdir(), "hangar-worktrees", runId, path.basename(root));
  const branch = `hangar/${sanitize(label)}-${runId.slice(0, 8)}`;
  try {
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    await exec("git", ["-C", root, "worktree", "add", "-b", branch, wtPath]);
    return { path: wtPath, branch, repoRoot: root };
  } catch {
    return null;
  }
}

export async function removeWorktree(wt: Worktree): Promise<void> {
  try {
    await exec("git", ["-C", wt.repoRoot, "worktree", "remove", "--force", wt.path]);
  } catch {
    // best effort — leave it for `git worktree prune`
  }
}
