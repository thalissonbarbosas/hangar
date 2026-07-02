import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// repoRoot() is fixed to the real repo at module load, so mock config to point it at a
// temp git repo per test. The `mock` prefix is required for jest.mock factory references.
let mockRoot = "";
jest.mock("../config", () => ({ repoRoot: () => mockRoot }));

import { getUpdateStatus, applyUpdate, UpdateRefused } from "../update";

const git = (dir: string, args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });

function writePkg(dir: string, version: string) {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "hangar", version }));
}

function initOrigin(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upd-origin-"));
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writePkg(dir, "1.0.0");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

function clone(origin: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upd-clone-"));
  execFileSync("git", ["clone", "-q", origin, dir], { stdio: "ignore" });
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  return dir;
}

function commitInOrigin(origin: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(origin, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  git(origin, ["add", "-A"]);
  git(origin, ["commit", "-m", "update"]);
}

beforeEach(() => {
  delete process.env.HANGAR_DEMO;
});

describe("getUpdateStatus", () => {
  it("returns git:false for a non-git directory", async () => {
    mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "upd-nogit-"));
    const s = await getUpdateStatus();
    expect(s.git).toBe(false);
    expect(s.behind).toBe(0);
  });

  it("reports behind count and version against an upstream", async () => {
    const origin = initOrigin();
    const cl = clone(origin);
    commitInOrigin(origin, { "docs/x.md": "hi" });
    mockRoot = cl;
    const s = await getUpdateStatus();
    expect(s.git).toBe(true);
    expect(s.behind).toBe(1);
    expect(s.ahead).toBe(0);
    expect(s.dirty).toBe(false);
    expect(s.version).toBe("1.0.0");
    expect(s.upstream).toBe("origin/main");
    expect(s.fetchError).toBeNull();
  });

  it("flags a dirty working tree", async () => {
    const cl = clone(initOrigin());
    fs.writeFileSync(path.join(cl, "dirty.txt"), "x");
    mockRoot = cl;
    expect((await getUpdateStatus()).dirty).toBe(true);
  });

  it("sets fetchError when the remote is unreachable", async () => {
    const origin = initOrigin();
    const cl = clone(origin);
    fs.rmSync(origin, { recursive: true, force: true });
    mockRoot = cl;
    const s = await getUpdateStatus();
    expect(s.git).toBe(true);
    expect(s.fetchError).not.toBeNull();
    expect(s.currentCommit).not.toBeNull();
  });

  it("returns git:false in demo mode without spawning git", async () => {
    process.env.HANGAR_DEMO = "1";
    mockRoot = clone(initOrigin());
    const s = await getUpdateStatus();
    expect(s.git).toBe(false);
    expect(s.fetchError).toBe("unavailable in demo mode");
  });
});

describe("applyUpdate", () => {
  it("fast-forwards and reports changed files, deps, and restart", async () => {
    const origin = initOrigin();
    const cl = clone(origin);
    commitInOrigin(origin, { "package-lock.json": "{}", "server/src/x.ts": "export {};" });
    mockRoot = cl;
    const r = await applyUpdate();
    expect(r.ok).toBe(true);
    expect(r.changedFiles).toBeGreaterThan(0);
    expect(r.depsChanged).toBe(true);
    expect(r.restartExpected).toBe(true);
    expect(r.fromCommit).not.toBe(r.toCommit);
  });

  it("does not flag deps/restart for unrelated changes", async () => {
    const origin = initOrigin();
    const cl = clone(origin);
    commitInOrigin(origin, { "docs/y.md": "y" });
    mockRoot = cl;
    const r = await applyUpdate();
    expect(r.depsChanged).toBe(false);
    expect(r.restartExpected).toBe(false);
  });

  it("refuses a dirty tree and leaves it untouched", async () => {
    const origin = initOrigin();
    const cl = clone(origin);
    commitInOrigin(origin, { "docs/z.md": "z" });
    fs.writeFileSync(path.join(cl, "dirty.txt"), "x");
    mockRoot = cl;
    await expect(applyUpdate()).rejects.toThrow(UpdateRefused);
    expect(fs.existsSync(path.join(cl, "dirty.txt"))).toBe(true);
  });

  it("refuses when there is nothing to pull", async () => {
    mockRoot = clone(initOrigin());
    await expect(applyUpdate()).rejects.toThrow(/up to date/);
  });

  it("refuses when the branch has no upstream", async () => {
    mockRoot = initOrigin();
    await expect(applyUpdate()).rejects.toThrow(/upstream/);
  });

  it("refuses in demo mode", async () => {
    process.env.HANGAR_DEMO = "1";
    mockRoot = clone(initOrigin());
    await expect(applyUpdate()).rejects.toMatchObject({ demo: true });
  });
});
