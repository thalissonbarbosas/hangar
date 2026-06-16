import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { createWorktree, removeWorktree } from "../worktree";

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
});
