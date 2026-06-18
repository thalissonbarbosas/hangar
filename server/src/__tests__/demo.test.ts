import {
  isDemo,
  demoBoard,
  demoConfig,
  demoTickets,
  demoRunSeeds,
  demoAiwfCards,
  DEMO_BOARD_KEY,
  DEMO_AIWF_PROJECT_ID,
} from "../demo";

describe("isDemo", () => {
  const original = process.env.HANGAR_DEMO;
  afterEach(() => {
    if (original === undefined) delete process.env.HANGAR_DEMO;
    else process.env.HANGAR_DEMO = original;
  });

  it("is true for truthy flag values", () => {
    for (const v of ["1", "true", "yes", "YES"]) {
      process.env.HANGAR_DEMO = v;
      expect(isDemo()).toBe(true);
    }
  });

  it("is false when unset or falsy", () => {
    delete process.env.HANGAR_DEMO;
    expect(isDemo()).toBe(false);
    process.env.HANGAR_DEMO = "0";
    expect(isDemo()).toBe(false);
  });
});

describe("demo config & tickets", () => {
  it("synthesizes a single DEMO board", () => {
    const cfg = demoConfig();
    expect(cfg.boards).toHaveLength(1);
    expect(cfg.boards[0].key).toBe(DEMO_BOARD_KEY);
    expect(cfg.agentsDir).toBeTruthy();
    expect(demoBoard().statuses).toEqual(["To Do", "In Progress", "In Review", "Done"]);
  });

  it("produces tickets that all belong to the demo board and its columns", () => {
    const tickets = demoTickets();
    const columns = new Set(demoBoard().statuses);
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.boardKey).toBe(DEMO_BOARD_KEY);
      expect(columns.has(t.status)).toBe(true);
    }
  });

  it("seeds runs covering the active, awaiting-input, and done states", () => {
    const seeds = demoRunSeeds();
    expect(seeds.length).toBeGreaterThan(0);
    const states = new Set(seeds.map((s) => s.state));
    expect(states).toEqual(new Set(["running", "awaiting_input", "done"]));
    for (const seed of seeds) {
      expect(seed.id).toBeTruthy();
      expect(seed.ticketKey).toMatch(/^DEMO-/);
      expect(seed.events.length).toBeGreaterThan(0);
    }
    // The finished run carries a cost and a PR link.
    const done = seeds.find((s) => s.state === "done");
    expect(done?.prUrl).toMatch(/\/pull\/\d+$/);
    expect(typeof done?.costUsd).toBe("number");
  });
});

describe("demo AI Workflow", () => {
  it("seeds one AI Workflow project in the config", () => {
    const projects = demoConfig().aiWorkflow?.projects ?? [];
    expect(projects.map((p) => p.id)).toContain(DEMO_AIWF_PROJECT_ID);
  });

  it("seeds cards spread across phases, all tagged to the demo project", () => {
    const cards = demoAiwfCards();
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(c.boardKey).toBe(DEMO_AIWF_PROJECT_ID);
      expect(c.source).toBe("aiwf");
    }
    // A spread of phases, at least one with history, at least one with a PR, both kinds present.
    expect(new Set(cards.map((c) => c.status)).size).toBeGreaterThan(2);
    expect(cards.some((c) => (c.history?.length ?? 0) > 0)).toBe(true);
    expect(cards.some((c) => c.prUrl)).toBe(true);
    expect(new Set(cards.map((c) => c.kind))).toEqual(new Set(["thread", "task"]));
  });
});
