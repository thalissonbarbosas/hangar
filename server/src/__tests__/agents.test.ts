import fs from "fs";
import os from "os";
import path from "path";
import { loadAgents, loadAgent } from "../agents";

function tempAgentsDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hangar-agents-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const debuggerMd = `---
name: debugger
description: Finds and fixes bugs
model: opus
tools: Read, Grep, Bash
---
You are the debugger agent. Investigate carefully.`;

const reviewerMd = `---
description: Reviews code
---
Review the diff.`;

describe("loadAgents", () => {
  it("parses frontmatter for each .md file, sorted by name", () => {
    const dir = tempAgentsDir({
      "zeta.md": debuggerMd, // name from frontmatter wins over filename
      "reviewer.md": reviewerMd, // no name → falls back to filename
      "notes.txt": "ignored",
    });
    const agents = loadAgents(dir);
    expect(agents.map((a) => a.name)).toEqual(["debugger", "reviewer"]);
    const dbg = agents.find((a) => a.name === "debugger")!;
    expect(dbg.description).toBe("Finds and fixes bugs");
    expect(dbg.model).toBe("opus");
    expect(dbg.tools).toEqual(["Read", "Grep", "Bash"]);
    const rev = agents.find((a) => a.name === "reviewer")!;
    expect(rev.name).toBe("reviewer"); // from filename
    expect(rev.model).toBeUndefined();
    expect(rev.tools).toEqual([]);
  });

  it("returns [] when the dir doesn't exist", () => {
    expect(loadAgents(path.join(os.tmpdir(), "no-such-agents-dir-xyz"))).toEqual([]);
  });

  it("handles a file with no frontmatter (whole content is the body)", () => {
    const dir = tempAgentsDir({ "plain.md": "Just a body, no frontmatter." });
    const agents = loadAgents(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("plain");
  });
});

describe("loadAgent", () => {
  it("returns the agent with its body for a matching name", () => {
    const dir = tempAgentsDir({ "debugger.md": debuggerMd });
    const detail = loadAgent(dir, "debugger");
    expect(detail).not.toBeNull();
    expect(detail!.body).toContain("You are the debugger agent.");
    expect(detail!.model).toBe("opus");
  });

  it("returns null for an unknown name", () => {
    const dir = tempAgentsDir({ "debugger.md": debuggerMd });
    expect(loadAgent(dir, "ghost")).toBeNull();
  });

  it("returns null when the dir doesn't exist", () => {
    expect(loadAgent(path.join(os.tmpdir(), "no-dir-xyz"), "x")).toBeNull();
  });
});
