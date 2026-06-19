import { spawn } from "child_process";
import { existsSync } from "fs";
import { getConfig } from "../config";
import { isDemo } from "../demo";
import {
  resumeCommand,
  renderTerminalCommand,
  buildTerminalCommand,
  openInTerminal,
  TerminalError,
} from "../terminal";

jest.mock("../config", () => ({ getConfig: jest.fn() }));
jest.mock("../demo", () => ({ isDemo: jest.fn() }));
jest.mock("fs", () => ({ existsSync: jest.fn() }));
jest.mock("child_process", () => ({ spawn: jest.fn() }));

const mockConfig = getConfig as jest.Mock;
const mockIsDemo = isDemo as jest.Mock;
const mockExists = existsSync as jest.Mock;
const mockSpawn = spawn as jest.Mock;

// A finished run with a resumable session, in an existing worktree.
const run = (over: Record<string, unknown> = {}) =>
  ({ id: "r1", sessionId: "abc-123", cwd: "/tmp/wt", ...over }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsDemo.mockReturnValue(false);
  mockExists.mockReturnValue(true);
  mockConfig.mockReturnValue({ terminal: "open {{dir}} && {{command}}" });
  mockSpawn.mockReturnValue({ on: jest.fn(), unref: jest.fn() });
});

describe("resumeCommand", () => {
  it("builds the claude resume command", () => {
    expect(resumeCommand("abc-123")).toBe("claude --resume abc-123");
  });
});

describe("renderTerminalCommand", () => {
  it("substitutes {{dir}} and {{command}}, including repeats and whitespace", () => {
    const out = renderTerminalCommand("cd {{dir}}; {{ command }}; echo {{dir}}", "/x", "go");
    expect(out).toBe("cd '/x'; go; echo '/x'");
  });

  it("shell-quotes dir with spaces", () => {
    const out = renderTerminalCommand("cd {{dir}}", "/my projects/repo", "");
    expect(out).toBe("cd '/my projects/repo'");
  });

  it("shell-quotes dir containing a single quote", () => {
    const out = renderTerminalCommand("cd {{dir}}", "/it's/here", "");
    expect(out).toBe("cd '/it'\\''s/here'");
  });
});

describe("buildTerminalCommand", () => {
  it("renders the configured template for a valid run", () => {
    expect(buildTerminalCommand(run())).toBe("open '/tmp/wt' && claude --resume abc-123");
  });

  it("throws when no terminal is configured", () => {
    mockConfig.mockReturnValue({});
    expect(() => buildTerminalCommand(run())).toThrow(TerminalError);
    expect(() => buildTerminalCommand(run())).toThrow(/No terminal configured/);
  });

  it("throws when the run has no session id", () => {
    expect(() => buildTerminalCommand(run({ sessionId: undefined }))).toThrow(/resumable/);
  });

  it("throws when the session id is malformed (no command injection)", () => {
    expect(() => buildTerminalCommand(run({ sessionId: "a; rm -rf /" }))).toThrow(/resumable/);
  });

  it("throws when the working directory no longer exists", () => {
    mockExists.mockReturnValue(false);
    expect(() => buildTerminalCommand(run())).toThrow(/no longer exists/);
  });
});

describe("openInTerminal", () => {
  it("spawns the rendered command via the shell, detached, and unrefs it", () => {
    process.env.SHELL = "/bin/zsh";
    const cmd = openInTerminal(run());
    expect(cmd).toBe("open '/tmp/wt' && claude --resume abc-123");
    expect(mockSpawn).toHaveBeenCalledWith("/bin/zsh", ["-c", cmd], {
      detached: true,
      stdio: "ignore",
    });
    expect(mockSpawn.mock.results[0].value.unref).toHaveBeenCalled();
  });

  it("does not spawn in demo mode", () => {
    mockIsDemo.mockReturnValue(true);
    expect(openInTerminal(run())).toBe("open '/tmp/wt' && claude --resume abc-123");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("does not spawn when validation fails", () => {
    mockConfig.mockReturnValue({});
    expect(() => openInTerminal(run())).toThrow(TerminalError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
