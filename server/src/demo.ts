// Demo mode (HANGAR_DEMO=1): serve a fake board + seeded sessions so the app is fully
// explorable — and screenshot-able — without Jira credentials or real project data.
// All content here is fictional. Default-off; nothing below runs unless the flag is set.
import { BoardConfig, HangarConfig, Ticket } from "./types";

export const DEMO_BOARD_KEY = "DEMO";

export function isDemo(): boolean {
  const v = (process.env.HANGAR_DEMO ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** The fictional board demo mode presents (statuses match the demo tickets' columns). */
export function demoBoard(): BoardConfig {
  return {
    key: DEMO_BOARD_KEY,
    name: "My Project",
    statuses: ["To Do", "In Progress", "In Review", "Done"],
    repoPaths: ["~/demo/acme-web"],
  };
}

/** The fictional AI Workflow project demo mode presents. */
export const DEMO_AIWF_PROJECT_ID = "demo-aiwf";

/** A complete, file-free config used in demo mode so the app boots without hangar.config.json. */
export function demoConfig(): HangarConfig {
  return {
    agentsDir: "~/.claude/agents",
    boards: [demoBoard()],
    aiWorkflow: {
      projects: [{ id: DEMO_AIWF_PROJECT_ID, name: "Aurora", repoPath: "~/demo/aurora", createdAt: 0 }],
    },
    bypassPermissions: true,
    isolateRuns: true,
    // A terminal template so the demo's "Open in terminal" is live (the actual spawn is guarded
    // off in demo mode — see terminal.ts — so it's a harmless no-op).
    terminal:
      `osascript -e 'tell application "Terminal" to do script "cd \\"{{dir}}\\" && {{command}}"' ` +
      `-e 'tell application "Terminal" to activate'`,
  };
}

/**
 * Fictional AI Workflow cards, spread across the phase columns, with a little history — so the
 * AI Workflow connection shows a populated board in demo mode (no aiwf install or repo needed).
 */
export function demoAiwfCards(): Ticket[] {
  const card = (
    n: number,
    title: string,
    status: string,
    kind: "thread" | "task",
    extras: Partial<Ticket> = {},
  ): Ticket => ({
    key: `AUR-${n}`,
    summary: title,
    status,
    assignee: null,
    assigneeAvatar: null,
    issuetype: null,
    priority: null,
    boardKey: DEMO_AIWF_PROJECT_ID,
    source: "aiwf",
    kind,
    ...extras,
  });

  return [
    card(1, "Define the product brief", "Planning", "thread", {
      skill: "prd",
      history: [{ phase: "Planning", skill: "prd", at: 0, summary: "Drafted personas + scope" }],
    }),
    card(2, "Threat model the auth flow", "Planning", "task"),
    card(3, "Design the dashboard layout", "Design", "thread", { skill: "design" }),
    card(4, "Build the login endpoint", "Implementation", "thread", {
      skill: "feature",
      prUrl: "https://github.com/demo/aurora/pull/12",
      history: [
        { phase: "Planning", skill: "architecture", at: 0, summary: "Chose JWT + refresh tokens" },
        { phase: "Implementation", skill: "spec", at: 0 },
        { phase: "Implementation", skill: "feature", at: 0, summary: "Implemented /login + tests" },
      ],
    }),
    card(5, "Review the API error handling", "Review", "thread", { skill: "review" }),
    card(6, "Cut the first preview build", "Delivery", "thread", { skill: "pr" }),
    card(7, "Scaffold the project", "Complete", "thread", {
      skill: "new-project",
      history: [{ phase: "Implementation", skill: "new-project", at: 0, summary: "Bootstrapped the repo" }],
    }),
  ];
}

/** A fictional board's worth of tickets, spread across the example board's columns. */
export function demoTickets(): Ticket[] {
  const t = (
    n: number,
    summary: string,
    status: string,
    issuetype: string,
    priority: string,
    assignee: string | null,
  ): Ticket => ({
    key: `DEMO-${n}`,
    summary,
    status,
    assignee,
    assigneeAvatar: null, // null → the UI's first-letter avatar fallback
    issuetype,
    priority,
    boardKey: DEMO_BOARD_KEY,
    url: "#",
  });

  return [
    t(101, "Dark mode flickers on first paint", "To Do", "Bug", "High", "Robin Fields"),
    t(102, "Add CSV export to the reports page", "To Do", "Story", "Medium", null),
    t(103, "Upgrade to Node 22 in CI", "To Do", "Task", "Low", "Sam Ortega"),
    t(104, "Login throws 500 when email has trailing space", "In Progress", "Bug", "High", "Alex Chen"),
    t(105, "Paginate the activity feed", "In Progress", "Story", "Medium", "Robin Fields"),
    t(106, "Flaky checkout test on slow networks", "In Review", "Bug", "Medium", "Sam Ortega"),
    t(107, "Document the webhook payload", "In Review", "Task", "Low", "Alex Chen"),
    t(108, "Cache avatar lookups", "Done", "Story", "Medium", "Robin Fields"),
    t(109, "Fix typo in onboarding email", "Done", "Task", "Low", null),
  ];
}

/** A run event without the engine-assigned seq/ts (filled in when seeded). */
export interface DemoEvent {
  kind: string;
  [k: string]: unknown;
}

export interface DemoRunSeed {
  id: string;
  ticketKey: string;
  ticketUrl?: string;
  agentName: string;
  kind: "agent" | "skill";
  model: string;
  note?: string;
  state: string; // RunState — kept loose to avoid a circular type import
  phase?: string;
  costUsd?: number;
  prUrl?: string;
  branch?: string;
  cwd: string;
  startedMinsAgo: number;
  endedMinsAgo?: number;
  events: DemoEvent[];
}

const DEMO_CWD = "~/demo/acme-web";

/** Seeded sessions: one finished (with a PR), one mid-run, one awaiting an answer. */
export function demoRunSeeds(): DemoRunSeed[] {
  return [
    {
      id: "demo-run-done",
      ticketKey: "DEMO-106",
      ticketUrl: "#",
      agentName: "code-reviewer",
      kind: "agent",
      model: "sonnet",
      note: "Review the flaky checkout test and propose a fix.",
      state: "done",
      phase: "Done",
      costUsd: 0.142,
      prUrl: "https://github.com/acme/acme-web/pull/482",
      branch: "hangar/code-reviewer-9f3a1c2",
      cwd: DEMO_CWD,
      startedMinsAgo: 34,
      endedMinsAgo: 31,
      events: [
        { kind: "system", message: "session started", sessionId: "demo-sess-106" },
        { kind: "info", message: "Runtime: COMPOSE_PROJECT_NAME=hangar-9f3a1c2, HANGAR_PORT_OFFSET=300" },
        { kind: "worktree", repo: "acme-web", branch: "hangar/code-reviewer-9f3a1c2" },
        { kind: "assistant_delta", text: "Reading the failing test and the checkout flow it exercises.\n\n" },
        { kind: "tool_use", tool: "Read", input: "tests/checkout.spec.ts" },
        { kind: "tool_use", tool: "Read", input: "src/checkout/poll.ts" },
        { kind: "phase", label: "Reviewing", done: 1, total: 2 },
        {
          kind: "assistant_delta",
          text:
            "The test waits a fixed **2s** for the confirmation banner, but on a throttled network the " +
            "request can take longer — so it fails intermittently. The fix is to wait on the banner " +
            "selector instead of a timer.\n",
        },
        { kind: "tool_use", tool: "Edit", input: "tests/checkout.spec.ts" },
        { kind: "phase", label: "Done", done: 2, total: 2 },
        { kind: "pr", url: "https://github.com/acme/acme-web/pull/482" },
        {
          kind: "result",
          subtype: "success",
          result:
            "**Root cause:** the checkout test asserts on a hard-coded 2s timeout, which races the " +
            "network on slow connections.\n\n**Fix:** replaced the timer with an explicit " +
            "`waitFor(confirmationBanner)`, so the test is deterministic regardless of latency. " +
            "Opened PR #482.",
          costUsd: 0.142,
        },
        { kind: "state", state: "done" },
      ],
    },
    {
      id: "demo-run-active",
      ticketKey: "DEMO-104",
      ticketUrl: "#",
      agentName: "debugger",
      kind: "agent",
      model: "opus",
      note: "Reproduce and fix the login 500.",
      state: "running",
      phase: "Reproducing the failure",
      branch: "hangar/debugger-1b77e40",
      cwd: DEMO_CWD,
      startedMinsAgo: 2,
      events: [
        { kind: "system", message: "session started", sessionId: "demo-sess-104" },
        { kind: "info", message: "Runtime: COMPOSE_PROJECT_NAME=hangar-1b77e40, HANGAR_PORT_OFFSET=100" },
        { kind: "worktree", repo: "acme-web", branch: "hangar/debugger-1b77e40" },
        {
          kind: "assistant_delta",
          text:
            "Starting from the report: a 500 when the email has a trailing space. Let me find the " +
            "login handler and the validation it runs.\n\n",
        },
        { kind: "tool_use", tool: "Grep", input: 'pattern: "login", glob: "src/**/*.ts"' },
        { kind: "tool_use", tool: "Read", input: "src/auth/login.ts" },
        { kind: "phase", label: "Reproducing the failure", done: 1, total: 3 },
        {
          kind: "assistant_delta",
          text:
            'Found it — `findUserByEmail` is called with the raw input, so `"a@b.com "` misses the ' +
            "index and a downstream `.id` read throws. Writing a failing test before the fix.",
        },
        { kind: "tool_use", tool: "Write", input: "tests/auth/login.trailing-space.spec.ts" },
        { kind: "state", state: "running" },
      ],
    },
    {
      id: "demo-run-awaiting",
      ticketKey: "DEMO-103",
      ticketUrl: "#",
      agentName: "dev-shipper",
      kind: "agent",
      model: "sonnet",
      note: "Bump CI to Node 22 and open a PR.",
      state: "awaiting_input",
      phase: "Awaiting input",
      branch: "hangar/dev-shipper-c20ad4d",
      cwd: DEMO_CWD,
      startedMinsAgo: 5,
      events: [
        { kind: "system", message: "session started", sessionId: "demo-sess-103" },
        { kind: "worktree", repo: "acme-web", branch: "hangar/dev-shipper-c20ad4d" },
        { kind: "tool_use", tool: "Read", input: ".github/workflows/ci.yml" },
        { kind: "tool_use", tool: "Edit", input: ".github/workflows/ci.yml" },
        {
          kind: "assistant_delta",
          text: "CI now targets Node 22. Two engines fields in package.json also reference Node 18.",
        },
        {
          kind: "question",
          requestId: "demo-q-1",
          questions: [
            {
              question: 'package.json pins "engines.node": ">=18". Bump it to >=22 to match CI?',
              header: "engines",
              options: [
                { label: "Yes, bump to >=22", description: "Keep package.json and CI in lockstep." },
                { label: "Leave at >=18", description: "CI runs 22 but the package still allows 18." },
              ],
            },
            {
              question: "Which CI jobs should run on the Node 22 matrix?",
              header: "ci matrix",
              multiSelect: true,
              options: [
                { label: "lint", description: "ESLint + Prettier check." },
                { label: "typecheck", description: "tsc --noEmit across server + web." },
                { label: "test", description: "Jest server suite." },
              ],
            },
          ],
        },
        { kind: "state", state: "awaiting_input" },
      ],
    },
  ];
}
