import fs from "fs";
import path from "path";
import { expandHome } from "./config";
import { Agent } from "./types";

/**
 * Minimal YAML-frontmatter parser for .claude/agents/*.md.
 * Returns the flat key:value frontmatter (name, description, model, tools)
 * and the markdown body (the agent's system prompt).
 */
function parseAgentFile(content: string): { fm: Record<string, string>; body: string } {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { fm: {}, body: content };
  const fm: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      i++;
      break;
    }
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm: fm, body: lines.slice(i).join("\n").trim() };
}

function toAgent(sourcePath: string, fm: Record<string, string>): Agent {
  return {
    name: fm.name || path.basename(sourcePath).replace(/\.md$/, ""),
    description: fm.description || "",
    model: fm.model || undefined,
    tools: fm.tools ? fm.tools.split(",").map((t) => t.trim()).filter(Boolean) : [],
    sourcePath,
  };
}

export function loadAgents(agentsDir: string): Agent[] {
  const dir = expandHome(agentsDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const sourcePath = path.join(dir, f);
      return toAgent(sourcePath, parseAgentFile(fs.readFileSync(sourcePath, "utf8")).fm);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AgentDetail extends Agent {
  body: string; // the markdown body used as the session's system prompt
}

/** Load one agent (frontmatter + body) by its `name`. */
export function loadAgent(agentsDir: string, name: string): AgentDetail | null {
  const dir = expandHome(agentsDir);
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const sourcePath = path.join(dir, f);
    const { fm, body } = parseAgentFile(fs.readFileSync(sourcePath, "utf8"));
    const agent = toAgent(sourcePath, fm);
    if (agent.name === name) return { ...agent, body };
  }
  return null;
}
