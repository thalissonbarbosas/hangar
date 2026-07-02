import express from "express";
import request from "supertest";
import type { Ticket } from "../types";

// The demo board has no workflows, so index.test.ts only exercises the error/404
// branches of these routes. Here we mock the workflows module to drive the happy
// paths (successful start/stop/delete) that were otherwise uncovered.

const startWorkflow = jest.fn();
const listWorkflowRuns = jest.fn(() => [] as unknown[]);
const stopWorkflowRun = jest.fn();
const deleteWorkflowRun = jest.fn();
const clearWorkflowRuns = jest.fn();
type AnyFn = (...x: unknown[]) => unknown;

jest.mock("../workflows", () => ({
  startWorkflow: (...a: unknown[]) => (startWorkflow as AnyFn)(...a),
  listWorkflowRuns: (...a: unknown[]) => (listWorkflowRuns as AnyFn)(...a),
  stopWorkflowRun: (...a: unknown[]) => (stopWorkflowRun as AnyFn)(...a),
  deleteWorkflowRun: (...a: unknown[]) => (deleteWorkflowRun as AnyFn)(...a),
  clearWorkflowRuns: (...a: unknown[]) => (clearWorkflowRuns as AnyFn)(...a),
}));

import { workflowsRouter } from "../routes/workflows";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(workflowsRouter);
  return app;
}

const ticket: Ticket = {
  key: "PP-1",
  summary: "Fix login",
  status: "To Do",
  assignee: null,
  assigneeAvatar: null,
  issuetype: null,
  priority: null,
  boardKey: "PP",
};

describe("workflow routes — happy paths", () => {
  it("POST /api/workflows/runs returns the new run id", async () => {
    startWorkflow.mockResolvedValueOnce({ id: "wf-42" });
    const res = await request(makeApp())
      .post("/api/workflows/runs")
      .send({ boardKey: "PP", workflowId: "triage", ticket });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workflowRunId: "wf-42" });
    expect(startWorkflow).toHaveBeenCalledWith("PP", "triage", ticket);
  });

  it("POST /api/workflows/runs/:id/stop returns ok when the run exists", async () => {
    stopWorkflowRun.mockResolvedValueOnce(true);
    const res = await request(makeApp()).post("/api/workflows/runs/wf-42/stop");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(stopWorkflowRun).toHaveBeenCalledWith("wf-42");
  });

  it("DELETE /api/workflows/runs/:id returns ok when the run exists", async () => {
    deleteWorkflowRun.mockResolvedValueOnce(true);
    const res = await request(makeApp()).delete("/api/workflows/runs/wf-42");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(deleteWorkflowRun).toHaveBeenCalledWith("wf-42");
  });

  it("DELETE /api/workflows/runs defaults to the finished scope", async () => {
    clearWorkflowRuns.mockResolvedValueOnce(3);
    const res = await request(makeApp()).delete("/api/workflows/runs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, cleared: 3 });
    expect(clearWorkflowRuns).toHaveBeenCalledWith("finished");
  });
});
