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

export function sanitize(s: string): string {
  return (
    s
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "run"
  );
}

export interface CreateWorktreeOpts {
  /** Branch to base from instead of HEAD (e.g. "main"). */
  baseBranch?: string;
  /** Check out an existing branch instead of creating a new one (omits -b). */
  existingBranch?: string;
  /** Override the auto-generated hangar/<label>-<id> branch name. Ignored when existingBranch is set. */
  branchName?: string;
  /**
   * Root directory the worktree is created under (as `<baseDir>/<runId>/<repo>`).
   * Defaults to the OS temp dir, which is fine for ephemeral per-run worktrees but gets
   * purged by the OS (e.g. macOS `$TMPDIR` cleanup). Persistent task worktrees must pass a
   * durable location (under Hangar's data dir) so untracked working-tree files — e.g. a spec
   * written by `/spec` but not yet committed — survive and are reused by later runs on the
   * same task instead of being lost when the worktree is recreated from the branch. (HAN-11)
   */
  baseDir?: string;
}

/**
 * Create an isolated git worktree of the repo containing `dir`, on a fresh branch.
 * Returns null if `dir` isn't a git repo or the worktree couldn't be created
 * (caller should fall back to running in place).
 */
export async function createWorktree(
  dir: string,
  label: string,
  runId: string,
  opts?: CreateWorktreeOpts,
): Promise<Worktree | null> {
  const root = await gitRoot(dir);
  if (!root) return null;
  const baseDir = opts?.baseDir ?? path.join(os.tmpdir(), "hangar-worktrees");
  const wtPath = path.join(baseDir, runId, path.basename(root));

  let branch: string;
  let gitArgs: string[];

  if (opts?.existingBranch) {
    branch = opts.existingBranch;
    gitArgs = ["-C", root, "worktree", "add", wtPath, branch];
  } else {
    branch = opts?.branchName ?? `hangar/${sanitize(label)}-${runId.slice(0, 8)}`;
    gitArgs = ["-C", root, "worktree", "add", "-b", branch, wtPath];
    if (opts?.baseBranch) gitArgs.push(opts.baseBranch);
  }

  try {
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    await exec("git", gitArgs);
    return { path: wtPath, branch, repoRoot: root };
  } catch {
    return null;
  }
}

/**
 * Find the worktree path for a given branch by parsing `git worktree list --porcelain`.
 * Returns null if the branch has no registered worktree or the repo root can't be resolved.
 */
export async function findWorktreePath(repoRoot: string, branch: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["-C", repoRoot, "worktree", "list", "--porcelain"]);
    for (const block of stdout.trim().split(/\n\n+/)) {
      const wtMatch = block.match(/^worktree (.+)$/m);
      const branchMatch = block.match(/^branch refs\/heads\/(.+)$/m);
      if (wtMatch && branchMatch && branchMatch[1] === branch) return wtMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

/** Current HEAD branch of the git repo at `repoRoot`. Throws if it isn't a git repo or git fails. */
export async function currentBranch(repoRoot: string): Promise<string> {
  const { stdout } = await exec("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

/**
 * Check out `branch` in `repoRoot` (the project root, not a worktree).
 * Throws on failure — callers inspect the rejection's `stderr` to distinguish a dirty tree
 * (uncommitted changes) from other git errors. The branch is passed as a positional argument
 * to execFile, so there is no shell interpolation.
 */
export async function checkoutBranch(repoRoot: string, branch: string): Promise<void> {
  await exec("git", ["-C", repoRoot, "checkout", branch]);
}

export async function removeWorktree(wt: Worktree): Promise<void> {
  try {
    await exec("git", ["-C", wt.repoRoot, "worktree", "remove", "--force", wt.path]);
  } catch {
    // best effort — leave it for `git worktree prune`
  }
}

/** Run `git worktree prune` in the repo containing `dir` to remove stale worktree entries.
 *  Best-effort — errors are swallowed. */
export async function pruneWorktrees(dir: string): Promise<void> {
  try {
    const root = await gitRoot(dir);
    if (root) await exec("git", ["-C", root, "worktree", "prune"]);
  } catch {
    /* best effort */
  }
}
