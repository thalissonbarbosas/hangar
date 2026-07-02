import { Router } from "express";
import { getUpdateStatus, applyUpdate, UpdateRefused } from "../update";

export const updateRouter = Router();

// Read-only git state for the repo root where the app runs.
updateRouter.get("/api/update/status", async (_req, res) => {
  res.json(await getUpdateStatus());
});

// Fast-forward git pull in place. Refuses on unsafe state (409) or in demo mode (403).
updateRouter.post("/api/update/pull", async (_req, res) => {
  try {
    res.json(await applyUpdate());
  } catch (err) {
    if (err instanceof UpdateRefused) {
      res.status(err.demo ? 403 : 409).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});
