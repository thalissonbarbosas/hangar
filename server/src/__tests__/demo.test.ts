import { isDemo, demoBoard, demoConfig, demoTickets, demoRunSeeds, DEMO_BOARD_KEY } from "../demo";

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
