import fs from "fs";
import path from "path";
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

// Create the data dir and known subdirs upfront with restricted permissions (0700) so
// other OS users and backup tools cannot read transcript files (Threat 14). Existing
// installs are not retroactively changed — operators can run `chmod 700 .hangar/` manually.
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(RUNS_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(WORKFLOWS_DIR, { recursive: true, mode: 0o700 });

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
