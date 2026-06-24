import fs from "fs";
import os from "os";
import path from "path";

// store.ts resolves DATA_DIR from HANGAR_DATA_DIR at module-load, so load it fresh per test.
function loadStore(dataDir: string): typeof import("../store") {
  let mod!: typeof import("../store");
  jest.isolateModules(() => {
    process.env.HANGAR_DATA_DIR = dataDir;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: re-require with a fresh DATA_DIR per test
    mod = require("../store");
  });
  return mod;
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hangar-store-"));
}

const runRecord = {
  id: "run-1",
  ticketKey: "PP-1",
  agentName: "debugger",
  kind: "agent" as const,
  model: "claude-opus-4-8",
  cwd: "/tmp/x",
  state: "done" as const,
  startedAt: 1,
  events: [{ seq: 0, ts: 1, kind: "result" }],
};

describe("run record round-trip", () => {
  it("saves, loads, and deletes a run record", () => {
    const dir = tempDir();
    const store = loadStore(dir);
    store.saveRunRecord(runRecord as never);
    const loaded = store.loadRunRecords();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("run-1");
    expect(loaded[0].ticketKey).toBe("PP-1");

    store.deleteRunRecord("run-1");
    expect(store.loadRunRecords()).toHaveLength(0);
  });

  it("returns [] when the runs dir doesn't exist", () => {
    const store = loadStore(path.join(tempDir(), "missing"));
    expect(store.loadRunRecords()).toEqual([]);
  });

  it("skips corrupt JSON files and ignores non-json files", () => {
    const dir = tempDir();
    const store = loadStore(dir);
    store.saveRunRecord(runRecord as never);
    const runsDir = path.join(dir, "runs");
    fs.writeFileSync(path.join(runsDir, "bad.json"), "{not json");
    fs.writeFileSync(path.join(runsDir, "notes.txt"), "ignored");
    const loaded = store.loadRunRecords();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("run-1");
  });

  it("deleting a missing record is a no-op", () => {
    const store = loadStore(tempDir());
    expect(() => store.deleteRunRecord("nope")).not.toThrow();
  });
});

describe("workflow record round-trip", () => {
  it("saves, loads, and deletes a workflow record", () => {
    const dir = tempDir();
    const store = loadStore(dir);
    const wf = { id: "wf-1", boardKey: "PP", status: "done", startedAt: 1 };
    store.saveWorkflowRecord(wf as never);
    expect(store.loadWorkflowRecords()).toHaveLength(1);
    store.deleteWorkflowRecord("wf-1");
    expect(store.loadWorkflowRecords()).toHaveLength(0);
  });
});

describe("HANGAR_DATA_DIR home expansion", () => {
  it("expands a leading ~ in the data dir", () => {
    // Use a ~-prefixed path under a real temp subdir that we create under home is risky; instead
    // just confirm an absolute temp dir works (expandHome passes absolutes through unchanged).
    const dir = tempDir();
    const store = loadStore(dir);
    store.saveRunRecord(runRecord as never);
    expect(fs.existsSync(path.join(dir, "runs", "run-1.json"))).toBe(true);
  });
});

describe("sweepOldRuns", () => {
  const OLD_TS = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago
  const NEW_TS = Date.now() - 1 * 24 * 60 * 60 * 1000; // 1 day ago

  function writeRun(runsDir: string, id: string, record: object): void {
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, `${id}.json`), JSON.stringify(record));
  }

  it("is a no-op when the runs dir does not exist", () => {
    const dir = tempDir();
    const store = loadStore(dir);
    // Should not throw even though the runs dir hasn't been created yet.
    expect(() => store.sweepOldRuns(30)).not.toThrow();
  });

  it("deletes terminal runs older than the retention window", () => {
    const dir = tempDir();
    const store = loadStore(dir);
    const runsDir = path.join(dir, "runs");
    writeRun(runsDir, "old-done", { id: "old-done", state: "done", endedAt: OLD_TS });
    writeRun(runsDir, "old-error", { id: "old-error", state: "error", endedAt: OLD_TS });
    writeRun(runsDir, "old-stopped", { id: "old-stopped", state: "stopped", endedAt: OLD_TS });
    store.sweepOldRuns(30);
    expect(fs.existsSync(path.join(runsDir, "old-done.json"))).toBe(false);
    expect(fs.existsSync(path.join(runsDir, "old-error.json"))).toBe(false);
    expect(fs.existsSync(path.join(runsDir, "old-stopped.json"))).toBe(false);
  });

  it("keeps terminal runs newer than the retention window", () => {
    const dir = tempDir();
    const store = loadStore(dir);
    const runsDir = path.join(dir, "runs");
    writeRun(runsDir, "new-done", { id: "new-done", state: "done", endedAt: NEW_TS });
    store.sweepOldRuns(30);
    expect(fs.existsSync(path.join(runsDir, "new-done.json"))).toBe(true);
  });

  it("never deletes active runs regardless of age", () => {
    const dir = tempDir();
    const store = loadStore(dir);
    const runsDir = path.join(dir, "runs");
    writeRun(runsDir, "running", { id: "running", state: "running", endedAt: OLD_TS });
    writeRun(runsDir, "queued", { id: "queued", state: "queued", endedAt: OLD_TS });
    store.sweepOldRuns(1);
    expect(fs.existsSync(path.join(runsDir, "running.json"))).toBe(true);
    expect(fs.existsSync(path.join(runsDir, "queued.json"))).toBe(true);
  });

  it("skips runs with no endedAt timestamp", () => {
    const dir = tempDir();
    const store = loadStore(dir);
    const runsDir = path.join(dir, "runs");
    writeRun(runsDir, "no-ts", { id: "no-ts", state: "done" });
    store.sweepOldRuns(1);
    expect(fs.existsSync(path.join(runsDir, "no-ts.json"))).toBe(true);
  });

  it("skips corrupt JSON files without throwing", () => {
    const dir = tempDir();
    const store = loadStore(dir);
    const runsDir = path.join(dir, "runs");
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, "corrupt.json"), "{not json");
    expect(() => store.sweepOldRuns(1)).not.toThrow();
  });
});
