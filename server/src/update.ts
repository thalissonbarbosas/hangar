import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { repoRoot } from "./config";
import { isDemo } from "./demo";

// All git calls go through execFile with an explicit args array — never a shell string — so
// nothing can be interpolated as a command. Mirrors the pattern in worktree.ts.
const exec = promisify(execFile);

export interface UpdateStatus {
  git: boolean;
  branch: string | null;
  upstream: string | null;
  currentCommit: string | null;
  version: string | null;
  behind: number;
  ahead: number;
  dirty: boolean;
  fetchedAt: string;
  fetchError: string | null;
}

export interface UpdateResult {
  ok: boolean;
  fromCommit: string;
  toCommit: string;
  changedFiles: number;
  depsChanged: boolean;
  restartExpected: boolean;
}

// Refusal reasons surface to the client as 409; demo mode as 403.
export class UpdateRefused extends Error {
  constructor(
    message: string,
    readonly demo = false,
  ) {
    super(message);
    this.name = "UpdateRefused";
  }
}

async function git(args: string[], timeout = 15000): Promise<string> {
  const { stdout } = await exec("git", ["-C", repoRoot(), ...args], { timeout });
  return stdout.trim();
}

async function tryGit(args: string[]): Promise<string | null> {
  try {
    return await git(args);
  } catch {
    return null;
  }
}

function readVersion(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

async function isGitRepo(): Promise<boolean> {
  return (await tryGit(["rev-parse", "--is-inside-work-tree"])) === "true";
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const fetchedAt = new Date().toISOString();
  if (isDemo()) {
    return {
      git: false,
      branch: null,
      upstream: null,
      currentCommit: null,
      version: readVersion(),
      behind: 0,
      ahead: 0,
      dirty: false,
      fetchedAt,
      fetchError: "unavailable in demo mode",
    };
  }
  if (!(await isGitRepo())) {
    return {
      git: false,
      branch: null,
      upstream: null,
      currentCommit: null,
      version: readVersion(),
      behind: 0,
      ahead: 0,
      dirty: false,
      fetchedAt,
      fetchError: null,
    };
  }

  let fetchError: string | null = null;
  try {
    await git(["fetch", "--quiet"]);
  } catch (err) {
    fetchError = String(err instanceof Error ? err.message : err);
  }

  const branch = await tryGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentCommit = await tryGit(["rev-parse", "--short", "HEAD"]);
  const upstream = await tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const ahead = upstream ? Number((await tryGit(["rev-list", "--count", "@{u}..HEAD"])) ?? 0) : 0;
  const behind = upstream ? Number((await tryGit(["rev-list", "--count", "HEAD..@{u}"])) ?? 0) : 0;
  const dirty = ((await tryGit(["status", "--porcelain"])) ?? "").length > 0;

  return {
    git: true,
    branch,
    upstream,
    currentCommit,
    version: readVersion(),
    behind,
    ahead,
    dirty,
    fetchedAt,
    fetchError,
  };
}

export async function applyUpdate(): Promise<UpdateResult> {
  if (isDemo()) throw new UpdateRefused("unavailable in demo mode", true);

  const status = await getUpdateStatus();
  if (!status.git) throw new UpdateRefused("not a git working tree");
  if (status.dirty) throw new UpdateRefused("working tree has uncommitted changes — commit or stash first");
  if (!status.upstream) throw new UpdateRefused("current branch has no upstream to pull from");
  if (status.behind === 0) throw new UpdateRefused("already up to date");
  if (status.ahead > 0) throw new UpdateRefused("branch has diverged from upstream — cannot fast-forward");

  const fromCommit = (await tryGit(["rev-parse", "--short", "HEAD"])) ?? "";
  try {
    await git(["pull", "--ff-only"], 120000);
  } catch (err) {
    throw new UpdateRefused(`git pull failed: ${String(err instanceof Error ? err.message : err)}`);
  }
  const toCommit = (await tryGit(["rev-parse", "--short", "HEAD"])) ?? "";

  const diff = fromCommit
    ? ((await tryGit(["diff", "--name-only", `${fromCommit}..${toCommit}`])) ?? "")
    : "";
  const changed = diff.split("\n").filter(Boolean);

  return {
    ok: true,
    fromCommit,
    toCommit,
    changedFiles: changed.length,
    depsChanged: changed.some((f) => f.endsWith("package-lock.json")),
    restartExpected: changed.some((f) => f.startsWith("server/")),
  };
}
