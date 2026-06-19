import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { createWorktree, removeWorktree, findWorktreePath } from "../worktree";

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-wt-"));
  const run = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  run(["init", "-b", "main"]);
  run(["config", "user.email", "t@example.com"]);
  run(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "hello");
  run(["add", "-A"]);
  run(["commit", "-m", "init"]);
  return dir;
}

describe("createWorktree / removeWorktree", () => {
  it("creates an isolated worktree on a fresh hangar/ branch and removes it", async () => {
    const repo = initRepo();
    const runId = randomUUID();
    const wt = await createWorktree(repo, "PP-123 fix login!", runId);
    expect(wt).not.toBeNull();
    expect(wt!.branch).toMatch(/^hangar\/PP-123-fix-login-/);
    expect(fs.existsSync(wt!.path)).toBe(true);
    expect(fs.existsSync(path.join(wt!.path, "README.md"))).toBe(true);
    expect(fs.realpathSync(wt!.repoRoot)).toBe(fs.realpathSync(repo));

    await removeWorktree(wt!);
    expect(fs.existsSync(wt!.path)).toBe(false);
  });

  it("returns null for a non-git directory", async () => {
    const notGit = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-nogit-"));
    expect(await createWorktree(notGit, "label", randomUUID())).toBeNull();
  });

  it("sanitizes empty/odd labels to a usable branch name", async () => {
    const repo = initRepo();
    const wt = await createWorktree(repo, "!!!", randomUUID());
    expect(wt!.branch).toMatch(/^hangar\/run-/); // sanitize() falls back to "run"
    await removeWorktree(wt!);
  });

  it("removeWorktree on an already-gone worktree is best-effort (no throw)", async () => {
    const repo = initRepo();
    const wt = await createWorktree(repo, "x", randomUUID());
    await removeWorktree(wt!);
    await expect(removeWorktree(wt!)).resolves.toBeUndefined();
  });

  it("opts.branchName overrides the auto-generated hangar/<label>-<id> name", async () => {
    const repo = initRepo();
    const wt = await createWorktree(repo, "label", randomUUID(), { branchName: "feat/my-task" });
    expect(wt).not.toBeNull();
    expect(wt!.branch).toBe("feat/my-task");
    await removeWorktree(wt!);
  });

  it("opts.baseBranch bases the new branch on the given ref instead of HEAD", async () => {
    const repo = initRepo();
    const run = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
    // Diverge HEAD from main: switch to a new branch, add a commit with extra.txt there.
    run(["checkout", "-b", "extra-branch"]);
    fs.writeFileSync(path.join(repo, "extra.txt"), "extra");
    run(["add", "-A"]);
    run(["commit", "-m", "extra"]);
    // HEAD is now on extra-branch (has extra.txt); main still only has README.md.
    const wt = await createWorktree(repo, "task", randomUUID(), {
      branchName: "feat/based-on-main",
      baseBranch: "main",
    });
    expect(wt).not.toBeNull();
    expect(fs.existsSync(path.join(wt!.path, "extra.txt"))).toBe(false);
    await removeWorktree(wt!);
  });

  it("opts.existingBranch checks out an existing branch without -b", async () => {
    const repo = initRepo();
    const run = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
    run(["branch", "feat/existing-branch"]);
    const wt = await createWorktree(repo, "task", randomUUID(), {
      existingBranch: "feat/existing-branch",
    });
    expect(wt).not.toBeNull();
    expect(wt!.branch).toBe("feat/existing-branch");
    await removeWorktree(wt!);
  });
});

describe("findWorktreePath", () => {
  it("finds the path for a registered worktree branch", async () => {
    const repo = initRepo();
    const wt = await createWorktree(repo, "task", randomUUID(), { branchName: "feat/find-me" });
    const found = await findWorktreePath(repo, "feat/find-me");
    expect(found).not.toBeNull();
    expect(fs.realpathSync(found!)).toBe(fs.realpathSync(wt!.path));
    await removeWorktree(wt!);
  });

  it("returns null for a branch with no registered worktree", async () => {
    const repo = initRepo();
    expect(await findWorktreePath(repo, "feat/no-such-branch")).toBeNull();
  });

  it("returns null for a non-git directory", async () => {
    const notGit = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-fwt-"));
    expect(await findWorktreePath(notGit, "main")).toBeNull();
  });
});
