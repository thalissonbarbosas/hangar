import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { expandHome } from "./config";
import type { Run } from "./sessions";
import type { WorkflowRun } from "./workflows";

// Persisted runs + workflow runs survive server restarts: each is one JSON file under the
// data dir, so a finished session's transcript/result (and a workflow's progress) stays
// attached to its ticket after a restart.

const ROOT = path.resolve(__dirname, "..", "..");
// The runtime data dir (gitignored). Also the home for aiwf board cards (see aiwf.ts), so it's
// exported. Overridable via HANGAR_DATA_DIR — point dev + stable at one path to share boards.
export const DATA_DIR = process.env.HANGAR_DATA_DIR
  ? expandHome(process.env.HANGAR_DATA_DIR)
  : path.join(ROOT, ".hangar");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const WORKFLOWS_DIR = path.join(DATA_DIR, "workflows");
// Uploaded session attachments: each file lands in its own uuid subdir so identical filenames
// never collide. Stored as a path the agent reads directly (see sessions.ts formatAttachments).
const ATTACHMENTS_DIR = path.join(DATA_DIR, "attachments");

// Create the data dir and known subdirs upfront with restricted permissions (0700) so
// other OS users and backup tools cannot read transcript files (Threat 14). Existing
// installs are not retroactively changed — operators can run `chmod 700 .hangar/` manually.
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(RUNS_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(WORKFLOWS_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true, mode: 0o700 });

/** The serializable shape of a Run (drops the live-only handles). */
export type RunRecord = Omit<Run, "listeners" | "pending" | "query" | "input" | "onState" | "questions">;
/** A WorkflowRun is already fully serializable (no live handles). */
export type WorkflowRecord = WorkflowRun;

/** Atomically write JSON (tmp file + rename) so a crash mid-write can't corrupt it. */
function writeRecord(dir: string, id: string, record: unknown): void {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${id}.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, file);
  } catch {
    /* best-effort: persistence failure shouldn't break a live run */
  }
}

function deleteRecord(dir: string, id: string): void {
  try {
    fs.rmSync(path.join(dir, `${id}.json`), { force: true });
  } catch {
    /* ignore */
  }
}

function loadRecords<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  const out: T[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T);
    } catch {
      /* skip a corrupt file */
    }
  }
  return out;
}

export const saveRunRecord = (record: RunRecord): void => writeRecord(RUNS_DIR, record.id, record);
export const deleteRunRecord = (id: string): void => deleteRecord(RUNS_DIR, id);
export const loadRunRecords = (): RunRecord[] => loadRecords<RunRecord>(RUNS_DIR);

export const saveWorkflowRecord = (record: WorkflowRecord): void =>
  writeRecord(WORKFLOWS_DIR, record.id, record);
export const deleteWorkflowRecord = (id: string): void => deleteRecord(WORKFLOWS_DIR, id);
export const loadWorkflowRecords = (): WorkflowRecord[] => loadRecords<WorkflowRecord>(WORKFLOWS_DIR);

/**
 * Persist an uploaded attachment and return its saved absolute path. The client never controls
 * the destination: the dir is a fresh uuid and the filename is basename-only, so `../` or
 * absolute names in `name` cannot escape ATTACHMENTS_DIR.
 */
export function saveAttachment(name: string, bytes: Buffer): { path: string; name: string; size: number } {
  let safeName = path.basename(String(name ?? "")).trim();
  if (!safeName || safeName === "." || safeName === "..") safeName = "file";
  const dir = path.join(ATTACHMENTS_DIR, randomUUID());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = path.join(dir, safeName);
  fs.writeFileSync(dest, bytes);
  return { path: dest, name: safeName, size: bytes.length };
}

const TERMINAL_STATES = new Set(["done", "error", "stopped"]);

/**
 * Delete run JSON files older than `retentionDays` days.
 * Never deletes running or queued runs — only terminal states (done/error/stopped).
 * Called once at startup when `runRetentionDays` is configured.
 */
export function sweepOldRuns(retentionDays: number): void {
  if (!fs.existsSync(RUNS_DIR)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let swept = 0;
  for (const f of fs.readdirSync(RUNS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8")) as Partial<RunRecord>;
      // Skip active runs — never delete runs that might still be live.
      if (!record.state || !TERMINAL_STATES.has(record.state)) continue;
      // Use endedAt; skip if missing (shouldn't happen for terminal runs but be safe).
      const finishedAt = record.endedAt;
      if (typeof finishedAt !== "number" || finishedAt > cutoff) continue;
      fs.rmSync(path.join(RUNS_DIR, f), { force: true });
      swept++;
    } catch {
      /* skip corrupt or unreadable files */
    }
  }
  if (swept > 0)
    console.log(`[hangar] retention sweep: deleted ${swept} run(s) older than ${retentionDays}d`);
}
