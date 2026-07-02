import { chromium } from "playwright";
import { spawn, execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "docs", "screenshots", "han38");
// Kills and boots its own server on these ports; override WEB_PORT/PORT to avoid killing a dev server already on 5180/3001.
const WEB_PORT = process.env.WEB_PORT || 5180;
const SRV_PORT = process.env.PORT || 3001;
const BASE = `http://localhost:${WEB_PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isReady() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}
async function waitReady(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReady()) return;
    await sleep(600);
  }
  throw new Error(`Demo server not ready (${BASE})`);
}
function killPort(port) {
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    if (pids)
      pids.split("\n").forEach((pid) => {
        try {
          process.kill(Number(pid), "SIGTERM");
        } catch {}
      });
  } catch {}
}
async function startServer() {
  killPort(WEB_PORT);
  killPort(SRV_PORT);
  await sleep(1200);
  const child = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    env: { ...process.env, HANGAR_DEMO: "1", FORCE_COLOR: "0" },
    stdio: "pipe",
  });
  child.stderr.on("data", () => {});
  await waitReady();
  return child;
}

const errors = [];

async function setThemes(page, appTheme, sessionTheme) {
  await page.evaluate(
    ([a, s]) => {
      localStorage.setItem("hangar-theme", a);
      localStorage.setItem("hangar-session-theme", s);
    },
    [appTheme, sessionTheme],
  );
  await page.reload({ waitUntil: "networkidle" });
}

async function openSession(page, key) {
  await page.click('[data-tip="Sessions"]');
  await page.waitForSelector(".sessions-view");
  await page.locator(".session-row").filter({ hasText: key }).locator('button[title="Open session"]').click();
  await page.waitForSelector(".run-overlay");
  await sleep(300);
}
async function closeSession(page) {
  await page.click('button[title="Close"]');
  await page.waitForSelector(".run-overlay", { state: "detached" });
  await page.click('[data-tip="Sessions"]');
  await page.waitForSelector(".sessions-view", { state: "detached" });
}
async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name) });
  console.log(`  ✓ ${name}`);
}

async function main() {
  execSync(`mkdir -p ${OUT}`);
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const scheme of ["dark", "light"]) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await ctx.newPage();
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`[${scheme}] ${m.text()}`);
      });
      page.on("pageerror", (e) => errors.push(`[${scheme}] pageerror ${e.message}`));
      await page.goto(BASE, { waitUntil: "networkidle" });
      await setThemes(page, scheme, "terminal");

      // DEMO-106: done session with markdown result body (tests code-block colors)
      await openSession(page, "DEMO-106");
      await shot(page, `terminal-${scheme}-done.png`);
      await closeSession(page);

      // DEMO-103: awaiting input (question/permission card + composer)
      await openSession(page, "DEMO-103");
      await shot(page, `terminal-${scheme}-awaiting.png`);
      await closeSession(page);

      // mobile
      await page.setViewportSize({ width: 390, height: 844 });
      await openSession(page, "DEMO-106");
      await shot(page, `terminal-${scheme}-done-mobile.png`);
      await closeSession(page);

      await ctx.close();
    }

    // Classic sanity (dark)
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    await setThemes(page, "dark", "classic");
    await openSession(page, "DEMO-106");
    await shot(page, `classic-dark-done.png`);
    await ctx.close();

    console.log("\nConsole errors:", errors.length ? "\n" + errors.join("\n") : "none");
  } finally {
    await browser.close();
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}
main().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
