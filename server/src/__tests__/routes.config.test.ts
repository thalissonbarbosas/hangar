import express from "express";
import request from "supertest";

// In demo mode saves are guarded, so index.test.ts never hits the 400 catch
// branches of the config write routes. Mock the config module to force saves to
// throw and cover those error paths.

const loadJiraEnv = jest.fn(() => null);
const getConfig = jest.fn(() => ({ boards: [] }));
const saveConfig = jest.fn();
const jiraSettingsView = jest.fn(() => ({ baseUrl: "https://x.atlassian.net", email: "a@b.com" }));
const saveJiraSettings = jest.fn();
const boardPaths = jest.fn(() => []);
type AnyFn = (...x: unknown[]) => unknown;

jest.mock("../config", () => ({
  loadJiraEnv: (...a: unknown[]) => (loadJiraEnv as AnyFn)(...a),
  getConfig: (...a: unknown[]) => (getConfig as AnyFn)(...a),
  saveConfig: (...a: unknown[]) => (saveConfig as AnyFn)(...a),
  jiraSettingsView: (...a: unknown[]) => (jiraSettingsView as AnyFn)(...a),
  saveJiraSettings: (...a: unknown[]) => (saveJiraSettings as AnyFn)(...a),
  boardPaths: (...a: unknown[]) => (boardPaths as AnyFn)(...a),
}));

import { configRouter } from "../routes/config";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(configRouter);
  return app;
}

describe("config write routes — error branches", () => {
  it("PUT /api/config returns 400 with the error message when saveConfig throws", async () => {
    saveConfig.mockImplementationOnce(() => {
      throw new Error("bad board config");
    });
    const res = await request(makeApp()).put("/api/config").send({ boards: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad board config" });
  });

  it("PUT /api/config stringifies a non-Error thrown value", async () => {
    saveConfig.mockImplementationOnce(() => {
      throw "boom";
    });
    const res = await request(makeApp()).put("/api/config").send({ boards: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "boom" });
  });

  it("PUT /api/settings/jira returns 400 with the error message when the save throws", async () => {
    saveJiraSettings.mockImplementationOnce(() => {
      throw new Error("invalid base url");
    });
    const res = await request(makeApp()).put("/api/settings/jira").send({ baseUrl: "not-a-url" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid base url" });
  });

  it("PUT /api/settings/jira stringifies a non-Error thrown value", async () => {
    saveJiraSettings.mockImplementationOnce(() => {
      throw "boom";
    });
    const res = await request(makeApp()).put("/api/settings/jira").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "boom" });
  });

  it("PUT /api/settings/jira defaults a missing body to an empty object", async () => {
    const app = express();
    app.use(configRouter);
    const res = await request(app).put("/api/settings/jira");
    expect(res.status).toBe(200);
    expect(saveJiraSettings).toHaveBeenCalledWith({});
  });
});
