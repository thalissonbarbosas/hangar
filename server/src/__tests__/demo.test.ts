import { isDemo, demoBoard, demoConfig, demoTickets, DEMO_BOARD_KEY } from "../demo";

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
});
