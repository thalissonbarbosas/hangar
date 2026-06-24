import { Router } from "express";
import {
  loadJiraEnv,
  getConfig,
  saveConfig,
  jiraSettingsView,
  saveJiraSettings,
  boardPaths,
} from "../config";
import { HangarConfig } from "../types";

export const configRouter = Router();

configRouter.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    jiraConfigured: loadJiraEnv() !== null,
    boards: getConfig().boards.map((b) => b.key),
  });
});

// Full board config (keys, names, statuses, repo paths) + agents dir.
// Each board gets resolvedPaths: the home-expanded versions of its repoPaths, so the
// client can match repo skills to the board without knowing the home directory.
configRouter.get("/api/config", (_req, res) => {
  const cfg = getConfig();
  res.json({
    ...cfg,
    boards: cfg.boards.map((b) => ({ ...b, resolvedPaths: boardPaths(b) })),
  });
});

// Save board config (from the Settings UI).
configRouter.put("/api/config", (req, res) => {
  try {
    res.json(saveConfig(req.body as HangarConfig));
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Non-secret Jira settings view (never returns the token).
configRouter.get("/api/settings/jira", (_req, res) => {
  res.json(jiraSettingsView());
});

// Save Jira settings to .env. Blank token = keep the existing one.
configRouter.put("/api/settings/jira", (req, res) => {
  try {
    saveJiraSettings(req.body ?? {});
    res.json(jiraSettingsView());
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
  }
});
