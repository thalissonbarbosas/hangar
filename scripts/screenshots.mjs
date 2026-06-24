#!/usr/bin/env node
/**
 * Capture the eight README/docs screenshots from Hangar's demo mode.
 *
 * Usage:
 *   node scripts/screenshots.mjs             # starts the demo server automatically
 *   node scripts/screenshots.mjs --no-server # skip server start (only if already running with HANGAR_DEMO=1)
 *
 * One-time setup (installs the Chromium browser Playwright uses):
 *   npx playwright install chromium
 */

import { chromium } from "playwright";
import { spawn, execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "docs", "screenshots");
const WEB_PORT = process.env.WEB_PORT || 5180;
const SRV_PORT = process.env.PORT || 3001;
const BASE = `http://localhost:${WEB_PORT}`;
const NO_SERVER = process.argv.includes("--no-server");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isReady() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitReady(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReady()) return;
    await sleep(600);
  }
  throw new Error(`Demo server did not become ready within ${timeoutMs / 1000}s (${BASE})`);
}

function killPort(port) {
  // lsof -ti :<port> prints PIDs using that port; kill them so we can bind it.
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    if (pids) {
      pids.split("\n").forEach((pid) => {
        try {
          process.kill(Number(pid), "SIGTERM");
        } catch {}
      });
      console.log(`  killed :${port} (pid ${pids.replace(/\n/g, ", ")})`);
    }
  } catch {
    // lsof returns exit code 1 when nothing is found — not an error.
  }
}

async function startServer() {
  // Always clear both ports before spawning. A previous Ctrl+C often leaves
  // the Express backend alive on SRV_PORT even after Vite on WEB_PORT has
  // exited — the new demo Vite would then proxy to the old non-demo instance
  // and screenshots would show real data instead of the demo seed.
  killPort(WEB_PORT);
  killPort(SRV_PORT);
  await sleep(1200); // give the OS time to release both ports

  console.log(`Starting demo server (HANGAR_DEMO=1 npm run dev)…`);
  const child = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    env: { ...process.env, HANGAR_DEMO: "1", FORCE_COLOR: "0" },
    stdio: "pipe",
  });
  // Surface errors; suppress the verbose vite/tsx output.
  child.stderr.on("data", (d) => {
    const line = d.toString();
    if (line.includes("Error") || line.includes("EADDR")) process.stderr.write(line);
  });
  await waitReady();
  console.log("Server ready.\n");
  return child;
}

async function shot(page, name) {
  // Disable CSS animations so transitions don't partially-render in the screenshot.
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  await page.screenshot({ path: join(OUT, name) });
  console.log(`  ✓ ${name}`);
}

async function main() {
  const server = NO_SERVER ? null : await startServer();
  const browser = await chromium.launch();

  try {
    const ctx = await browser.newContext({
      colorScheme: "light", // match system light mode so screenshots look consistent
      viewport: { width: 1400, height: 900 },
    });
    const page = await ctx.newPage();

    // ── 1. Board (Jira connection, default view) ─────────────────────────────
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector(".column");
    await shot(page, "board.png");

    // ── 2. Sessions view ─────────────────────────────────────────────────────
    await page.click('[data-tip="Sessions"]');
    await page.waitForSelector(".sessions-view");
    await shot(page, "sessions.png");

    // ── 3. Done run panel (DEMO-106 — finished, has PR) ──────────────────────
    await page
      .locator(".session-row")
      .filter({ hasText: "DEMO-106" })
      .locator('button[title="Open session"]')
      .click();
    await page.waitForSelector(".run-overlay");
    await shot(page, "done.png");
    await page.click('button[title="Close"]');
    await page.waitForSelector(".run-overlay", { state: "detached" });

    // ── 4. Awaiting-input run panel (DEMO-103) ────────────────────────────────
    await page
      .locator(".session-row")
      .filter({ hasText: "DEMO-103" })
      .locator('button[title="Open session"]')
      .click();
    await page.waitForSelector(".run-overlay");
    await shot(page, "wait-input.png");
    await page.click('button[title="Close"]');
    await page.waitForSelector(".run-overlay", { state: "detached" });

    // ── 5. Running run panel (DEMO-104) ───────────────────────────────────────
    await page
      .locator(".session-row")
      .filter({ hasText: "DEMO-104" })
      .locator('button[title="Open session"]')
      .click();
    await page.waitForSelector(".run-overlay");
    await shot(page, "running.png");
    await page.click('button[title="Close"]');
    await page.waitForSelector(".run-overlay", { state: "detached" });

    // Close sessions overlay (same button toggles it)
    await page.click('[data-tip="Sessions"]');
    await page.waitForSelector(".sessions-view", { state: "detached" });

    // ── 6. Settings ──────────────────────────────────────────────────────────
    await page.click('[data-tip="Settings"]');
    await page.waitForSelector(".settings-area");
    await shot(page, "settings.png");
    await page.click('[data-tip="Back"]');
    await page.waitForSelector(".settings-area", { state: "detached" });

    // ── 7. AI Workflow board ──────────────────────────────────────────────────
    await page.locator(".conn-tab").filter({ hasText: "AI Workflow" }).click();
    await page.waitForSelector(".aiwf-board-area");
    await shot(page, "aiwf-board.png");

    // ── 8. New-item modal (+ button on first phase column) ───────────────────
    await page.locator(".col-add").first().click();
    await page.waitForSelector(".modal-overlay");
    await shot(page, "aiwf-new-item.png");

    console.log(`\nAll screenshots saved to docs/screenshots/`);
  } finally {
    await browser.close();
    if (server) {
      // Kill the whole process group so concurrently's children (tsx, vite) die too.
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
  }
}

main().catch((err) => {
  console.error("\nScreenshots failed:", err.message);
  process.exit(1);
});
