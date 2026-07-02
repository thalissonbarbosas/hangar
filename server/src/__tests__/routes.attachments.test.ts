import express from "express";
import request from "supertest";

// Exercises the attachment upload endpoint and the attachments field on the run/message routes.
// All collaborators are mocked so the router is tested in isolation (no real disk/sessions).

type AnyFn = (...x: unknown[]) => unknown;

const saveAttachment = jest.fn();
jest.mock("../store", () => ({ saveAttachment: (...a: unknown[]) => (saveAttachment as AnyFn)(...a) }));

const startRun = jest.fn(() => ({ id: "run-1" }));
const sendMessage = jest.fn(() => "steer");
const getRun = jest.fn();
jest.mock("../sessions", () => ({
  startRun: (...a: unknown[]) => (startRun as AnyFn)(...a),
  sendMessage: (...a: unknown[]) => (sendMessage as AnyFn)(...a),
  getRun: (...a: unknown[]) => (getRun as AnyFn)(...a),
  restartRun: jest.fn(),
  listRuns: jest.fn(() => []),
  runToJson: jest.fn((r: unknown) => r),
  resolvePermission: jest.fn(),
  stopRun: jest.fn(),
  deleteRun: jest.fn(),
  clearRuns: jest.fn(),
}));

const loadAgent = jest.fn(() => ({ name: "debugger" }));
jest.mock("../agents", () => ({ loadAgent: (...a: unknown[]) => (loadAgent as AnyFn)(...a) }));
jest.mock("../skills", () => ({ skillExists: jest.fn(() => true), findSkill: jest.fn(() => undefined) }));
jest.mock("../config", () => ({
  getConfig: () => ({ agentsDir: "~/.claude/agents", boards: [], isolateRuns: false }),
  expandHome: (p: string) => p,
  boardPaths: () => [],
}));
jest.mock("../terminal", () => ({ openInTerminal: jest.fn(), TerminalError: class extends Error {} }));
jest.mock("../aiwf", () => ({ DELIVERY_SKILLS: new Set<string>(), resolveCardWorktree: jest.fn() }));

import { runsRouter } from "../routes/runs";

// Mirror index.ts: skip the small global JSON parser for the upload route so its own 40 MB
// parser takes effect (otherwise the global ~100kb limit would 413 a real file).
function makeApp() {
  const app = express();
  const jsonParser = express.json();
  app.use((req, res, next) => (req.path === "/api/attachments" ? next() : jsonParser(req, res, next)));
  app.use(runsRouter);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe("POST /api/attachments", () => {
  it("saves an uploaded file and returns its path", async () => {
    saveAttachment.mockReturnValueOnce({
      path: "/data/attachments/abc/report.pdf",
      name: "report.pdf",
      size: 5,
    });
    const contentBase64 = Buffer.from("hello").toString("base64");
    const res = await request(makeApp()).post("/api/attachments").send({ name: "report.pdf", contentBase64 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ path: "/data/attachments/abc/report.pdf", name: "report.pdf", size: 5 });
    const [name, bytes] = saveAttachment.mock.calls[0];
    expect(name).toBe("report.pdf");
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect((bytes as Buffer).toString()).toBe("hello");
  });

  it("400s when name or contentBase64 is missing", async () => {
    const a = await request(makeApp()).post("/api/attachments").send({ name: "x.txt" });
    expect(a.status).toBe(400);
    const b = await request(makeApp()).post("/api/attachments").send({ contentBase64: "eA==" });
    expect(b.status).toBe(400);
    expect(saveAttachment).not.toHaveBeenCalled();
  });

  it("400s when the decoded file exceeds the 25 MB cap", async () => {
    const contentBase64 = Buffer.alloc(26 * 1024 * 1024).toString("base64");
    const res = await request(makeApp()).post("/api/attachments").send({ name: "big.bin", contentBase64 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/25 MB/);
    expect(saveAttachment).not.toHaveBeenCalled();
  });
});

describe("attachments on POST /api/runs/:id/message", () => {
  it("accepts attachments with empty text and forwards them to sendMessage", async () => {
    getRun.mockReturnValueOnce({ id: "run-1" });
    const res = await request(makeApp())
      .post("/api/runs/run-1/message")
      .send({ text: "", attachments: ["/p/a.txt", "/p/b.txt"] });
    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith({ id: "run-1" }, "", ["/p/a.txt", "/p/b.txt"]);
  });

  it("400s when neither text nor attachments are provided", async () => {
    getRun.mockReturnValueOnce({ id: "run-1" });
    const res = await request(makeApp()).post("/api/runs/run-1/message").send({});
    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("drops blank/non-string attachment entries", async () => {
    getRun.mockReturnValueOnce({ id: "run-1" });
    await request(makeApp())
      .post("/api/runs/run-1/message")
      .send({ text: "hi", attachments: ["/p/a.txt", "", 42, "  "] });
    expect(sendMessage).toHaveBeenCalledWith({ id: "run-1" }, "hi", ["/p/a.txt"]);
  });
});

describe("attachments on POST /api/runs", () => {
  it("forwards attachments to startRun for a standalone run", async () => {
    const res = await request(makeApp())
      .post("/api/runs")
      .send({ name: "debugger", kind: "agent", note: "do X", attachments: ["/p/a.txt"] });
    expect(res.status).toBe(200);
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ attachments: ["/p/a.txt"] }));
  });
});
