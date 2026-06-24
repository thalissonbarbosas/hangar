#!/usr/bin/env node
/**
 * Capture validation screenshots in both light and dark mode from demo mode.
 * Saves to docs/screenshots/validation/{light,dark}/ — gitignored, not committed.
 *
 * Usage:
 *   node scripts/validate-screenshots.mjs             # starts demo server automatically
 *   node scripts/validate-screenshots.mjs --no-server # server already running with HANGAR_DEMO=1
 *
 * One-time setup: npx playwright install chromium
 */

import { chromium } from "playwright";
import { spawn, execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "docs", "screenshots", "validation");
const WEB_PORT = process.env.WEB_PORT || 5180;
const SRV_PORT = process.env.PORT || 3001;
const BASE = `http://localhost:${WEB_PORT}`;
const NO_SERVER = process.argv.includes("--no-server");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function killPort(port) {
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
  } catch {}
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

async function startServer() {
  killPort(WEB_PORT);
  killPort(SRV_PORT);
  await sleep(1200);
  console.log("Starting demo server (HANGAR_DEMO=1 npm run dev)…");
  const child = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    env: { ...process.env, HANGAR_DEMO: "1", FORCE_COLOR: "0" },
    stdio: "pipe",
  });
  child.stderr.on("data", (d) => {
    const line = d.toString();
    if (line.includes("Error") || line.includes("EADDR")) process.stderr.write(line);
  });
  await waitReady();
  console.log("Server ready.\n");
  return child;
}

async function shot(page, name) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  await page.screenshot({ path: join(OUT, name) });
  console.log(`  ✓ ${name}`);
}

async function captureTheme(browser, theme) {
  mkdirSync(join(OUT, theme), { recursive: true });

  const ctx = await browser.newContext({
    colorScheme: theme,
    viewport: { width: 1400, height: 900 },
  });
  // Set theme in localStorage before every navigation so the React hook picks it up.
  await ctx.addInitScript(`localStorage.setItem('theme', '${theme}')`);
  const page = await ctx.newPage();

  // Board
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".column");
  await shot(page, `${theme}/board.png`);

  // Sessions view
  await page.click('[data-tip="Sessions"]');
  await page.waitForSelector(".sessions-view");
  await shot(page, `${theme}/sessions.png`);
  await page.click('[data-tip="Sessions"]');
  await page.waitForSelector(".sessions-view", { state: "detached" });

  // Settings
  await page.click('[data-tip="Settings"]');
  await page.waitForSelector(".settings-area");
  await shot(page, `${theme}/settings.png`);

  await ctx.close();
}

async function main() {
  const server = NO_SERVER ? null : await startServer();
  const browser = await chromium.launch();

  try {
    mkdirSync(OUT, { recursive: true });
    for (const theme of ["light", "dark"]) {
      console.log(`Capturing ${theme} mode…`);
      await captureTheme(browser, theme);
    }
    console.log(`\nScreenshots saved to docs/screenshots/validation/`);
    console.log("  light: board.png  sessions.png  settings.png");
    console.log("  dark:  board.png  sessions.png  settings.png");
  } finally {
    await browser.close();
    if (server) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGTERM");
      }
    }
  }
}

main().catch((err) => {
  console.error("\nValidation screenshots failed:", err.message);
  process.exit(1);
});
