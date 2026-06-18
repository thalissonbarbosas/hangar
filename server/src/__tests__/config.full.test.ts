import fs from "fs";
import os from "os";
import path from "path";

// config.ts reads CONFIG_PATH/HANGAR_DEMO at module-load and caches the config in a module
// singleton, so each test gets its own fresh module via jest.isolateModules + reset env.

function withTempConfig(json: unknown): { dir: string; configPath: string; envPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-cfg-"));
  const configPath = path.join(dir, "hangar.config.json");
  if (json !== undefined) fs.writeFileSync(configPath, JSON.stringify(json));
  return { dir, configPath, envPath: path.join(dir, ".env") };
}

const validConfig = {
  agentsDir: "~/.claude/agents",
  boards: [{ key: "PP", name: "PracticePal", statuses: ["To Do", "Done"] }],
};

function loadFresh(env: Record<string, string | undefined>) {
  let mod!: typeof import("../config");
  jest.isolateModules(() => {
    const saved = { ...process.env };
    // Set Jira keys to "" by default so dotenv (which never overrides a present var) can't
    // repopulate them from the developer's real repo .env and skew the "unconfigured" cases.
    const jiraKeys = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_MY_TICKETS_ONLY"];
    for (const k of ["CONFIG_PATH", "HANGAR_DEMO", "PORT", ...jiraKeys]) delete process.env[k];
    for (const k of jiraKeys) process.env[k] = "";
    Object.assign(process.env, env);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: re-require with fresh env per test
    mod = require("../config");
    // restore unrelated env keys but keep the ones we set for this module instance
    for (const k of Object.keys(process.env)) if (!(k in saved) && !(k in env)) delete process.env[k];
  });
  return mod;
}

describe("loadConfig / getConfig", () => {
  it("loads and validates a config file, sorting board workflows by name", () => {
    const { configPath } = withTempConfig({
      ...validConfig,
      boards: [
        {
          key: "PP",
          name: "PracticePal",
          statuses: ["To Do"],
          workflows: [
            { id: "b", name: "Zebra", steps: [] },
            { id: "a", name: "Alpha", steps: [] },
          ],
        },
      ],
    });
    const cfg = loadFresh({ CONFIG_PATH: configPath });
    const loaded = cfg.loadConfig();
    expect(loaded.boards[0].workflows?.map((w) => w.name)).toEqual(["Alpha", "Zebra"]);
    // getConfig returns the cached instance without re-reading
    expect(cfg.getConfig()).toBe(loaded);
  });

  it("throws when the config file is missing", () => {
    const cfg = loadFresh({ CONFIG_PATH: path.join(os.tmpdir(), "does-not-exist-xyz.json") });
    expect(() => cfg.loadConfig()).toThrow(/Config file not found/);
  });

  it("throws on an invalid config (no boards)", () => {
    const { configPath } = withTempConfig({ agentsDir: "~/x", boards: [] });
    const cfg = loadFresh({ CONFIG_PATH: configPath });
    expect(() => cfg.loadConfig()).toThrow(/at least one board/);
  });

  it("throws when a board is missing required fields", () => {
    const { configPath } = withTempConfig({
      agentsDir: "~/x",
      boards: [{ key: "", name: "", statuses: [] }],
    });
    const cfg = loadFresh({ CONFIG_PATH: configPath });
    expect(() => cfg.loadConfig()).toThrow(/Invalid board config/);
  });

  it("throws when agentsDir is missing", () => {
    const { configPath } = withTempConfig({ boards: [{ key: "PP", name: "PP", statuses: ["x"] }] });
    const cfg = loadFresh({ CONFIG_PATH: configPath });
    expect(() => cfg.loadConfig()).toThrow(/agentsDir/);
  });
});

describe("isDemo short-circuit", () => {
  it("synthesizes demo config and never reads the real file", () => {
    const cfg = loadFresh({ HANGAR_DEMO: "1", CONFIG_PATH: "/nonexistent.json" });
    const loaded = cfg.loadConfig();
    expect(loaded.boards[0].key).toBe("DEMO");
    // saveConfig is a no-op in demo mode
    expect(cfg.saveConfig({ ...validConfig })).toEqual(loaded);
    // saveJiraSettings is also a no-op
    expect(() => cfg.saveJiraSettings({ baseUrl: "x" })).not.toThrow();
  });
});

describe("saveConfig", () => {
  it("validates, cleans, writes to disk, and hot-swaps the in-memory config", () => {
    const { configPath } = withTempConfig(validConfig);
    const cfg = loadFresh({ CONFIG_PATH: configPath });
    cfg.loadConfig();
    const saved = cfg.saveConfig({
      agentsDir: "~/.claude/agents",
      skillsDir: "~/.claude/skills",
      bypassPermissions: false,
      isolateRuns: false,
      exclusiveAgents: ["  docker-agent  ", ""],
      maxTurns: 42.7,
      maxBudgetUsd: 5,
      terminal: "  open {{dir}} && {{command}}  ",
      boards: [
        {
          key: " PP ",
          name: " PracticePal ",
          statuses: [" To Do ", ""],
          repoPaths: [" ~/a ", ""],
          agents: [" debugger ", ""],
          workflows: [
            {
              id: "",
              name: " Build ",
              steps: [
                { name: " plan ", kind: "skill", note: " do it " },
                { name: "", kind: "agent" },
              ],
            },
            { id: "x", name: "", steps: [] },
          ],
        },
      ],
    });
    expect(saved.boards[0].key).toBe("PP");
    expect(saved.boards[0].name).toBe("PracticePal");
    expect(saved.boards[0].statuses).toEqual(["To Do"]);
    expect(saved.boards[0].repoPaths).toEqual(["~/a"]);
    expect(saved.boards[0].agents).toEqual(["debugger"]);
    expect(saved.bypassPermissions).toBe(false);
    expect(saved.isolateRuns).toBe(false);
    expect(saved.exclusiveAgents).toEqual(["docker-agent"]);
    expect(saved.maxTurns).toBe(42); // floored
    expect(saved.maxBudgetUsd).toBe(5);
    expect(saved.terminal).toBe("open {{dir}} && {{command}}"); // trimmed
    expect(saved.skillsDir).toBe("~/.claude/skills");
    // workflow cleaning: empty-name workflow dropped, empty step dropped, note trimmed
    const wf = saved.boards[0].workflows!;
    expect(wf).toHaveLength(1);
    expect(wf[0].name).toBe("Build");
    expect(wf[0].id).toBe("Build"); // empty id falls back to name
    expect(wf[0].steps).toEqual([{ name: "plan", kind: "skill", note: "do it" }]);
    // persisted to disk
    const onDisk = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(onDisk.boards[0].key).toBe("PP");
  });

  it("preserves prior settings when not explicitly provided, and clears numeric limits with 0", () => {
    const { configPath } = withTempConfig(validConfig);
    const cfg = loadFresh({ CONFIG_PATH: configPath });
    cfg.loadConfig();
    cfg.saveConfig({
      ...validConfig,
      skillsDir: "~/skills",
      bypassPermissions: true,
      isolateRuns: true,
      exclusiveAgents: ["e1"],
      maxTurns: 100,
      maxBudgetUsd: 10,
      terminal: "open {{dir}}",
    });
    // Now save again without those fields — they should be preserved (skillsDir, bypass, etc.)
    const second = cfg.saveConfig({ ...validConfig, maxTurns: 0, maxBudgetUsd: 0 });
    expect(second.skillsDir).toBe("~/skills");
    expect(second.bypassPermissions).toBe(true);
    expect(second.isolateRuns).toBe(true);
    expect(second.exclusiveAgents).toEqual(["e1"]);
    expect(second.maxTurns).toBeUndefined(); // 0 clears
    expect(second.maxBudgetUsd).toBeUndefined();
    expect(second.terminal).toBe("open {{dir}}"); // preserved when omitted
    // An empty-string terminal clears it.
    const third = cfg.saveConfig({ ...validConfig, terminal: "  " });
    expect(third.terminal).toBeUndefined();
  });

  it("rejects an invalid config", () => {
    const { configPath } = withTempConfig(validConfig);
    const cfg = loadFresh({ CONFIG_PATH: configPath });
    cfg.loadConfig();
    expect(() => cfg.saveConfig({ agentsDir: "x", boards: [] })).toThrow(/at least one board/);
  });
});

describe("Jira env helpers", () => {
  it("loadJiraEnv returns null when unconfigured", () => {
    const cfg = loadFresh({ CONFIG_PATH: "/x.json" });
    expect(cfg.loadJiraEnv()).toBeNull();
  });

  it("loadJiraEnv reads creds and trims trailing slashes; myTicketsOnly parses", () => {
    const cfg = loadFresh({
      CONFIG_PATH: "/x.json",
      JIRA_BASE_URL: "https://x.atlassian.net//",
      JIRA_EMAIL: "a@b.com",
      JIRA_API_TOKEN: "tok",
      JIRA_MY_TICKETS_ONLY: "TRUE",
    });
    const env = cfg.loadJiraEnv();
    expect(env).toEqual({
      baseUrl: "https://x.atlassian.net",
      email: "a@b.com",
      token: "tok",
      myTicketsOnly: true,
    });
  });

  it("jiraSettingsView never exposes the token", () => {
    const cfg = loadFresh({
      CONFIG_PATH: "/x.json",
      JIRA_BASE_URL: "https://x.atlassian.net",
      JIRA_EMAIL: "a@b.com",
      JIRA_API_TOKEN: "secret",
    });
    const view = cfg.jiraSettingsView();
    expect(view).toEqual({
      configured: true,
      baseUrl: "https://x.atlassian.net",
      email: "a@b.com",
      myTicketsOnly: false,
      hasToken: true,
    });
    expect(JSON.stringify(view)).not.toContain("secret");
  });

  it("jiraSettingsView reports unconfigured defaults", () => {
    const cfg = loadFresh({ CONFIG_PATH: "/x.json" });
    expect(cfg.jiraSettingsView()).toEqual({
      configured: false,
      baseUrl: "",
      email: "",
      myTicketsOnly: false,
      hasToken: false,
    });
  });
});

describe("saveJiraSettings / writeEnv", () => {
  // writeEnv targets the repo .env (resolved from ROOT). Back it up and restore so the test
  // never clobbers the developer's real file, while still exercising the real write+merge path.
  const ENV_PATH = path.resolve(__dirname, "..", "..", "..", ".env");
  let backup: string | null = null;
  beforeEach(() => {
    backup = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : null;
  });
  afterEach(() => {
    if (backup === null) fs.rmSync(ENV_PATH, { force: true });
    else fs.writeFileSync(ENV_PATH, backup);
  });

  it("merges into an existing .env, preserving other lines & comments, and updates process.env", () => {
    fs.writeFileSync(ENV_PATH, "# comment\nKEEP=1\nJIRA_EMAIL=old@b.com\n");
    const cfg = loadFresh({ CONFIG_PATH: "/x.json" });
    cfg.saveJiraSettings({
      baseUrl: "https://new.atlassian.net///",
      email: "new@b.com",
      token: "newtok",
      myTicketsOnly: true,
    });
    expect(process.env.JIRA_BASE_URL).toBe("https://new.atlassian.net");
    expect(process.env.JIRA_EMAIL).toBe("new@b.com");
    expect(process.env.JIRA_API_TOKEN).toBe("newtok");
    expect(process.env.JIRA_MY_TICKETS_ONLY).toBe("true");
    const written = fs.readFileSync(ENV_PATH, "utf8");
    expect(written).toContain("# comment");
    expect(written).toContain("KEEP=1");
    expect(written).toContain("JIRA_EMAIL=new@b.com"); // existing key updated in place
    expect(written).toContain("JIRA_BASE_URL=https://new.atlassian.net"); // new key appended
    expect(written.endsWith("\n")).toBe(true);
  });

  it("writes a fresh .env when none exists", () => {
    fs.rmSync(ENV_PATH, { force: true });
    const cfg = loadFresh({ CONFIG_PATH: "/x.json" });
    cfg.saveJiraSettings({ email: "fresh@b.com" });
    expect(fs.readFileSync(ENV_PATH, "utf8")).toContain("JIRA_EMAIL=fresh@b.com");
  });

  it("does not overwrite the token when an empty token is provided", () => {
    fs.writeFileSync(ENV_PATH, "JIRA_API_TOKEN=keepme\n");
    const cfg = loadFresh({ CONFIG_PATH: "/x.json", JIRA_API_TOKEN: "keepme" });
    cfg.saveJiraSettings({ email: "only-email@b.com", token: "" });
    expect(process.env.JIRA_EMAIL).toBe("only-email@b.com");
    expect(process.env.JIRA_API_TOKEN).toBe("keepme");
    expect(fs.readFileSync(ENV_PATH, "utf8")).toContain("JIRA_API_TOKEN=keepme");
  });
});

describe("PORT", () => {
  it("defaults to 3001 and honors the env override", () => {
    expect(loadFresh({ CONFIG_PATH: "/x.json" }).PORT).toBe(3001);
    expect(loadFresh({ CONFIG_PATH: "/x.json", PORT: "4567" }).PORT).toBe(4567);
  });
});
