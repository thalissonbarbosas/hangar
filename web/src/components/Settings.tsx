import { useEffect, useMemo, useState } from "react";
import {
  Plug,
  Columns3,
  Zap,
  Save,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  Download,
  Check,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  GitBranch,
  Boxes,
  Bot,
  Sparkles,
  Gauge,
  Users,
  TerminalSquare,
  Palette,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { api } from "../api";
import {
  Agent,
  BoardConfig,
  FullConfig,
  isActive,
  Skill,
  UpdateResult,
  UpdateStatus,
  WorkflowConfig,
  WorkflowStep,
} from "../types";
import { SessionTheme } from "../useSessionTheme";
import { ClassicPreview, TerminalPreview } from "./SessionThemePreviews";
import { dedupeByName, projectColor, skillProject } from "../utils";

type Saved = "idle" | "saving" | "saved" | "error";

type SectionKey =
  | "jira"
  | "boards"
  | "agents"
  | "board-skills"
  | "workflows"
  | "permissions"
  | "isolation"
  | "runtime"
  | "limits"
  | "terminal"
  | "appearance"
  | "update";

type SectionItem = { key: SectionKey; label: string; icon: typeof Plug };

// Sections are grouped by domain so the nav reads as labelled categories rather than one flat list.
const SECTION_GROUPS: { label: string; items: SectionItem[] }[] = [
  { label: "Connection", items: [{ key: "jira", label: "Jira connection", icon: Plug }] },
  {
    label: "Boards",
    items: [
      { key: "boards", label: "Boards & columns", icon: Columns3 },
      { key: "agents", label: "Board agents", icon: Users },
      { key: "board-skills", label: "Board skills", icon: Sparkles },
      { key: "workflows", label: "Workflows", icon: WorkflowIcon },
    ],
  },
  {
    label: "Runs",
    items: [
      { key: "permissions", label: "Agent permissions", icon: ShieldAlert },
      { key: "isolation", label: "Run isolation", icon: GitBranch },
      { key: "runtime", label: "Exclusive runtime", icon: Boxes },
      { key: "limits", label: "Run limits", icon: Gauge },
    ],
  },
  { label: "Appearance", items: [{ key: "appearance", label: "Session theme", icon: Palette }] },
  {
    label: "System",
    items: [
      { key: "terminal", label: "Terminal", icon: TerminalSquare },
      { key: "update", label: "Updates", icon: Download },
    ],
  },
];

export function Settings({
  onSaved,
  sessionTheme,
  onSessionThemeChange,
}: {
  onSaved: () => void;
  sessionTheme: SessionTheme;
  onSessionThemeChange: (t: SessionTheme) => void;
}) {
  const [section, setSection] = useState<SectionKey>("jira");

  return (
    <div className="settings-tabbed">
      <nav className="settings-nav">
        {SECTION_GROUPS.map((group) => (
          <div className="settings-nav-group" key={group.label}>
            <div className="settings-nav-group-label">{group.label}</div>
            {group.items.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  className={`settings-nav-item${section === s.key ? " on" : ""}`}
                  onClick={() => setSection(s.key)}
                >
                  <Icon size={16} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="settings-panel">
        {/* Re-mounting per tab keeps each section's config fetch fresh (no stale clobbering). */}
        {section === "jira" && <JiraSection />}
        {section === "boards" && <BoardsSection onSaved={onSaved} />}
        {section === "agents" && <AgentAccessSection onSaved={onSaved} />}
        {section === "board-skills" && <BoardSkillsSection onSaved={onSaved} />}
        {section === "workflows" && <WorkflowsSection onSaved={onSaved} />}
        {section === "permissions" && <PermissionsSection onSaved={onSaved} />}
        {section === "isolation" && <IsolationSection onSaved={onSaved} />}
        {section === "runtime" && <RuntimeSection onSaved={onSaved} />}
        {section === "limits" && <LimitsSection onSaved={onSaved} />}
        {section === "terminal" && <TerminalSection onSaved={onSaved} />}
        {section === "appearance" && (
          <AppearanceSection sessionTheme={sessionTheme} onChange={onSessionThemeChange} />
        )}
        {section === "update" && <UpdateSection />}
      </div>
    </div>
  );
}

/* ---------------- Session theme (Classic vs Terminal) ---------------- */

const SESSION_THEMES: { key: SessionTheme; title: string; desc: string }[] = [
  {
    key: "terminal",
    title: "Terminal",
    desc: "Monospace console. Prompt-prefixed lines, echoed tool calls, flat dark surface.",
  },
  {
    key: "classic",
    title: "Classic",
    desc: "Chat-style feed. Proportional text, soft cards and tool chips.",
  },
];

function AppearanceSection({
  sessionTheme,
  onChange,
}: {
  sessionTheme: SessionTheme;
  onChange: (t: SessionTheme) => void;
}) {
  return (
    <section className="card-panel">
      <h2>
        <Palette size={17} /> Session theme
      </h2>
      <p className="hint">
        Choose how the live session stream renders. This is a per-browser preference and is independent of the
        app-wide light/dark toggle.
      </p>
      <div className="session-theme-picker">
        {SESSION_THEMES.map((t) => (
          <button
            key={t.key}
            className={`session-theme-card${sessionTheme === t.key ? " on" : ""}`}
            aria-pressed={sessionTheme === t.key}
            onClick={() => onChange(t.key)}
          >
            <div className="session-theme-preview" data-preview={t.key} aria-hidden="true">
              {t.key === "terminal" ? <TerminalPreview /> : <ClassicPreview />}
            </div>
            <div className="session-theme-title">
              {t.title}
              {sessionTheme === t.key && <Check size={14} />}
            </div>
            <div className="session-theme-desc">{t.desc}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Run limits ---------------- */

function LimitsSection({ onSaved }: { onSaved: () => void }) {
  const [turns, setTurns] = useState("");
  const [budget, setBudget] = useState("");
  const [saved, setSaved] = useState<Saved>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.config().then((c) => {
      setTurns(c.maxTurns ? String(c.maxTurns) : "");
      setBudget(c.maxBudgetUsd ? String(c.maxBudgetUsd) : "");
    });
  }, []);

  async function save() {
    setSaved("saving");
    setMsg(null);
    const tn = Number(turns);
    const bd = Number(budget);
    const maxTurns = turns.trim() && !isNaN(tn) ? Math.max(1, Math.floor(tn)) : 0; // 0 = back to default
    const maxBudgetUsd = budget.trim() && !isNaN(bd) ? Math.max(0, bd) : 0; // 0 = no cap
    try {
      const latest = await api.config();
      await api.saveConfig({ ...latest, maxTurns, maxBudgetUsd });
      setSaved("saved");
      onSaved();
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  return (
    <section className="card-panel">
      <h2>
        <Gauge size={17} /> Run limits
      </h2>
      <div className="field">
        <label>Max turns per run</label>
        <input
          type="number"
          min={1}
          placeholder="300 (default)"
          value={turns}
          onChange={(e) => setTurns(e.target.value)}
          onBlur={save}
        />
      </div>
      <div className="field">
        <label>Max spend per run (USD)</label>
        <input
          type="number"
          min={0}
          step="0.5"
          placeholder="no cap"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          onBlur={save}
        />
      </div>
      <p className="hint">
        Long replicate-fix-test agents can exceed the default — raise turns for them. The spend cap is a
        safety net for unrestricted (bypass) mode: a run stops if it crosses it. Leave blank for defaults (300
        turns, no cap).
      </p>
      <div className="row">
        {saved === "saving" && <span className="hint">Saving…</span>}
        {saved === "saved" && (
          <span className="ok">
            <Check size={14} /> Saved
          </span>
        )}
        {msg && (
          <span className="bad">
            <AlertCircle size={14} /> {msg}
          </span>
        )}
      </div>
    </section>
  );
}

/* ---------------- Terminal ("Open in terminal") ---------------- */

// Ready-made templates for the common macOS terminals. The server substitutes {{dir}} (the run's
// working directory) and {{command}} (the resume command) before running the result via the shell.
const TERMINAL_PRESETS: { label: string; template: string }[] = [
  {
    label: "macOS Terminal",
    template:
      `osascript -e 'tell application "Terminal" to do script "cd \\"{{dir}}\\" && {{command}}"' ` +
      `-e 'tell application "Terminal" to activate'`,
  },
  {
    label: "iTerm2",
    template:
      `osascript -e 'tell application "iTerm" to create window with default profile ` +
      `command "/bin/zsh -lc \\"cd \\\\\\"{{dir}}\\\\\\" && {{command}}; exec /bin/zsh\\""'`,
  },
  {
    label: "Ghostty",
    template: `open -na Ghostty --args --working-directory="{{dir}}" -e {{command}}`,
  },
  {
    // Warp has no scripting API or CLI flag to open at a directory and run a command (the launch-
    // config `commands` don't fire over the warp:// URI), so we drive it via System Events: focus a
    // new window, then type `cd "<dir>" && <command>` and press Return. This needs Accessibility
    // permission for your shell/terminal (System Settings → Privacy & Security → Accessibility).
    label: "Warp",
    template:
      `osascript -e 'tell application "Warp" to activate' ` +
      `-e 'delay 0.3' ` +
      `-e 'tell application "System Events" to keystroke "n" using command down' ` +
      `-e 'delay 0.3' ` +
      `-e 'tell application "System Events" to keystroke "cd \\"{{dir}}\\" && {{command}}"' ` +
      `-e 'tell application "System Events" to key code 36'`,
  },
];

function TerminalSection({ onSaved }: { onSaved: () => void }) {
  const [template, setTemplate] = useState("");
  const [saved, setSaved] = useState<Saved>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.config().then((c) => setTemplate(c.terminal ?? ""));
  }, []);

  async function save(next: string) {
    setSaved("saving");
    setMsg(null);
    try {
      const latest = await api.config(); // merge so we don't clobber other settings
      await api.saveConfig({ ...latest, terminal: next.trim() });
      setSaved("saved");
      onSaved();
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  return (
    <section className="card-panel">
      <h2>
        <TerminalSquare size={17} /> Terminal
      </h2>
      <p className="hint">
        Set the command that <b>Open in terminal</b> (in the Sessions view) runs to resume a session in your
        terminal. Pick a preset, then tweak if needed. Two placeholders are substituted:{" "}
        <code>{"{{dir}}"}</code> (the session's working directory) and <code>{"{{command}}"}</code> (e.g.{" "}
        <code>claude --resume &lt;id&gt;</code>). The result runs via your shell.
      </p>
      <div className="field">
        <label>Preset</label>
        <select
          value=""
          onChange={(e) => {
            const preset = TERMINAL_PRESETS.find((p) => p.label === e.target.value);
            if (preset) {
              setTemplate(preset.template);
              save(preset.template);
            }
          }}
        >
          <option value="">Choose a terminal…</option>
          {TERMINAL_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Command template</label>
        <textarea
          className="note-input"
          rows={3}
          placeholder="leave blank to disable Open in terminal"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          onBlur={(e) => save(e.target.value)}
        />
      </div>
      <div className="row">
        {saved === "saving" && <span className="hint">Saving…</span>}
        {saved === "saved" && (
          <span className="ok">
            <Check size={14} /> Saved
          </span>
        )}
        {msg && (
          <span className="bad">
            <AlertCircle size={14} /> {msg}
          </span>
        )}
      </div>
    </section>
  );
}

/* ---------------- Updates ---------------- */

function UpdateSection() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      setStatus(await api.updateStatus());
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const canUpdate =
    !!status && status.git && status.behind > 0 && status.ahead === 0 && !status.dirty && !status.fetchError;

  async function update() {
    if (!canUpdate) return;
    // Sessions persist to .hangar/ (untouched by git) — but the restart marks active runs stopped.
    let active = 0;
    try {
      const { runs } = await api.runs();
      active = runs.filter((r) => isActive(r.state)).length;
    } catch {
      // Non-fatal — proceed with a generic warning if we can't count runs.
    }
    const warn = active
      ? `${active} session(s) are active. Updating restarts the server — active runs will be marked stopped (their transcripts are kept). Continue?`
      : "Update will git-pull the latest code and restart the server. Continue?";
    if (!window.confirm(warn)) return;

    setBusy(true);
    setMsg(null);
    setResult(null);
    try {
      const res = await api.applyUpdate();
      setResult(res);
      setTimeout(() => void refresh(), 1500);
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-panel">
      <h2>
        <Download size={17} /> Updates
      </h2>
      <p className="hint">
        Pull the latest Hangar code into the directory where the app is running. Your sessions live under{" "}
        <code>.hangar/</code> and are never touched by the update — after the server restarts, all session
        records are restored (any that were running are marked stopped, with transcripts kept). The pull is
        fast-forward only and refuses if you have uncommitted changes.
      </p>

      {loading && <p className="hint">Checking…</p>}

      {status && !loading && (
        <>
          <div className="field">
            <label>Version</label>
            <span>
              {status.version ?? "unknown"}
              {status.branch && (
                <>
                  {" "}
                  <span className="hint">
                    ({status.branch}
                    {status.currentCommit ? ` @ ${status.currentCommit}` : ""})
                  </span>
                </>
              )}
            </span>
          </div>

          {!status.git && (
            <p className="hint">
              {status.fetchError ?? "Not a git checkout — in-app updates are unavailable."}
            </p>
          )}

          {status.git && (
            <>
              {status.fetchError && (
                <p className="bad">
                  <AlertCircle size={14} /> Couldn't reach the remote: {status.fetchError}
                </p>
              )}
              {status.dirty && (
                <p className="bad">
                  <AlertCircle size={14} /> Working tree has uncommitted changes — commit or stash before
                  updating.
                </p>
              )}
              {!status.fetchError && status.behind === 0 && status.ahead === 0 && (
                <p className="ok">
                  <Check size={14} /> Up to date.
                </p>
              )}
              {status.behind > 0 && (
                <p className="hint">
                  {status.behind} commit(s) behind {status.upstream}.
                </p>
              )}
              {status.ahead > 0 && (
                <p className="hint">
                  {status.ahead} local commit(s) ahead — cannot fast-forward automatically.
                </p>
              )}
            </>
          )}

          <div className="row">
            <button className="btn" onClick={() => void refresh()} disabled={busy}>
              Check for updates
            </button>
            <button className="btn" onClick={() => void update()} disabled={!canUpdate || busy}>
              {busy ? "Updating…" : "Update now"}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="row">
          <span className="ok">
            <Check size={14} /> Updated {result.fromCommit} → {result.toCommit} ({result.changedFiles}{" "}
            file(s)).
          </span>
        </div>
      )}
      {result?.restartExpected && <p className="hint">Server is restarting to load the new code…</p>}
      {result?.depsChanged && (
        <p className="bad">
          <AlertCircle size={14} /> Dependencies changed — run <code>npm run install:all</code> and restart.
        </p>
      )}
      {msg && (
        <p className="bad">
          <AlertCircle size={14} /> {msg}
        </p>
      )}
    </section>
  );
}

/* ---------------- Exclusive runtime ---------------- */

function RuntimeSection({ onSaved }: { onSaved: () => void }) {
  const [exclusive, setExclusive] = useState<string[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [saved, setSaved] = useState<Saved>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.config(), api.agents(), api.skills(), api.aiwfStatus()]).then(([c, a, s, ast]) => {
      setExclusive(c.exclusiveAgents ?? []);
      const found = new Set(ast.skillGroups?.flatMap((g: { skills: string[] }) => g.skills) ?? []);
      const enriched = s.skills.map((sk) => (found.has(sk.name) ? { ...sk, aiwf: true } : sk));
      enriched.sort((a, b) => {
        const pa = skillProject(a) ?? "￿";
        const pb = skillProject(b) ?? "￿";
        if (pa !== pb) return pa.localeCompare(pb);
        return a.name.localeCompare(b.name);
      });
      // Exclusive runtime is name-based (matched by name in sessions), so collapse
      // same-named agents/skills to one checkbox each.
      setAgents(dedupeByName(a.agents));
      setSkills(dedupeByName(enriched));
    });
  }, []);

  async function toggle(name: string) {
    const next = exclusive.includes(name) ? exclusive.filter((n) => n !== name) : [...exclusive, name];
    setExclusive(next);
    setSaved("saving");
    setMsg(null);
    try {
      const latest = await api.config();
      await api.saveConfig({ ...latest, exclusiveAgents: next });
      setSaved("saved");
      onSaved();
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  return (
    <section className="card-panel">
      <h2>
        <Boxes size={17} /> Exclusive runtime
      </h2>
      <p className="hint">
        Check agents/skills that boot Docker, bind fixed ports, or use a shared tunnel. These run{" "}
        <b>one at a time</b> (others queue) so host resources can't collide. Every run also gets a unique{" "}
        <code>COMPOSE_PROJECT_NAME</code> + <code>HANGAR_PORT_OFFSET</code> in its env.
      </p>

      <div className="exclusive-group-label">
        <Bot size={12} /> Agents
      </div>
      <div className="exclusive-list">
        {agents.map((a) => (
          <label className="exclusive-item" key={`agent:${a.name}`}>
            <input type="checkbox" checked={exclusive.includes(a.name)} onChange={() => toggle(a.name)} />
            <Bot size={12} />
            <span className="mono">{a.name}</span>
            {a.model && <span className="model-chip">{a.model}</span>}
          </label>
        ))}
        {agents.length === 0 && <span className="hint">No agents found.</span>}
      </div>

      <div className="exclusive-group-label">
        <Sparkles size={12} /> Skills
      </div>
      <div className="exclusive-list">
        {skills.map((s) => {
          const proj = skillProject(s);
          const pc = proj ? projectColor(proj) : undefined;
          return (
            <label className="exclusive-item" key={`skill:${s.name}:${s.repo ?? ""}`}>
              <input type="checkbox" checked={exclusive.includes(s.name)} onChange={() => toggle(s.name)} />
              <Sparkles size={12} />
              <span className="mono">{s.name}</span>
              {proj && pc && (
                <span className="proj-chip" style={{ color: pc, background: `${pc}20` }}>
                  ({proj})
                </span>
              )}
              {s.model && <span className="model-chip">{s.model}</span>}
            </label>
          );
        })}
        {skills.length === 0 && <span className="hint">No skills found.</span>}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {saved === "saving" && <span className="hint">Saving…</span>}
        {saved === "saved" && (
          <span className="ok">
            <Check size={14} /> Saved
          </span>
        )}
        {msg && (
          <span className="bad">
            <AlertCircle size={14} /> {msg}
          </span>
        )}
      </div>
    </section>
  );
}

/* ---------------- Run isolation ---------------- */

function IsolationSection({ onSaved }: { onSaved: () => void }) {
  const [isolate, setIsolate] = useState(true);
  const [saved, setSaved] = useState<Saved>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.config().then((c) => setIsolate(c.isolateRuns ?? true));
  }, []);

  async function setMode(next: boolean) {
    setIsolate(next);
    setSaved("saving");
    setMsg(null);
    try {
      const latest = await api.config();
      await api.saveConfig({ ...latest, isolateRuns: next });
      setSaved("saved");
      onSaved();
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  return (
    <section className="card-panel">
      <h2>
        <GitBranch size={17} /> Run isolation
      </h2>
      <label className="switch-row">
        <input type="checkbox" checked={isolate} onChange={(e) => setMode(e.target.checked)} />
        <span>
          <b>Git worktree per run</b> — each session gets its own branch and checkout, so multiple agents on
          the same repo don't conflict.
        </span>
      </label>
      <div className="hint-box">
        <GitBranch size={15} />
        <span>
          When on, a run in a git repo executes in a temp worktree on a <code>hangar/…</code>
          branch (shown in the run panel). Non-git paths run in place. When off, all runs share the repo
          directory — avoid dispatching two writers at once.
        </span>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {saved === "saving" && <span className="hint">Saving…</span>}
        {saved === "saved" && (
          <span className="ok">
            <Check size={14} /> Saved
          </span>
        )}
        {msg && (
          <span className="bad">
            <AlertCircle size={14} /> {msg}
          </span>
        )}
      </div>
    </section>
  );
}

/* ---------------- Agent permissions ---------------- */

function PermissionsSection({ onSaved }: { onSaved: () => void }) {
  const [bypass, setBypass] = useState(true);
  const [saved, setSaved] = useState<Saved>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.config().then((c) => setBypass(c.bypassPermissions ?? false));
  }, []);

  async function setMode(next: boolean) {
    setBypass(next);
    setSaved("saving");
    setMsg(null);
    try {
      const latest = await api.config(); // merge so we don't clobber board edits
      await api.saveConfig({ ...latest, bypassPermissions: next });
      setSaved("saved");
      onSaved();
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  return (
    <section className="card-panel">
      <h2>{bypass ? <ShieldAlert size={17} /> : <ShieldCheck size={17} />} Agent permissions</h2>
      <label className="switch-row">
        <input type="checkbox" checked={bypass} onChange={(e) => setMode(e.target.checked)} />
        <span>
          <b>Unrestricted mode</b> — the agent runs every tool without asking, like{" "}
          <code>claude --dangerously-skip-permissions</code>.
        </span>
      </label>
      {bypass ? (
        <div className="warn-box">
          <ShieldAlert size={15} />
          <span>
            Unrestricted mode: agents run without approval prompts, like{" "}
            <code>--dangerously-skip-permissions</code>. Only use with repos you fully trust.
          </span>
        </div>
      ) : (
        <div className="hint-box">
          <ShieldCheck size={15} />
          <span>
            Gated mode: reads, file edits, and read-only shell run automatically; mutating shell commands
            pause for Allow / Deny.
          </span>
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        {saved === "saving" && <span className="hint">Saving…</span>}
        {saved === "saved" && (
          <span className="ok">
            <Check size={14} /> Saved
          </span>
        )}
        {msg && (
          <span className="bad">
            <AlertCircle size={14} /> {msg}
          </span>
        )}
      </div>
    </section>
  );
}

/* ---------------- Jira connection ---------------- */

function JiraSection() {
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [myOnly, setMyOnly] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [saved, setSaved] = useState<Saved>("idle");
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.jiraSettings().then((s) => {
      setBaseUrl(s.baseUrl);
      setEmail(s.email);
      setMyOnly(s.myTicketsOnly);
      setHasToken(s.hasToken);
    });
  }, []);

  async function save() {
    setSaved("saving");
    setMsg(null);
    try {
      const s = await api.saveJiraSettings({
        baseUrl,
        email,
        token: token || undefined,
        myTicketsOnly: myOnly,
      });
      setHasToken(s.hasToken);
      setToken("");
      setSaved("saved");
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  async function runTest() {
    setTest({ ok: true, text: "Testing…" });
    const r = await api.testJira({ baseUrl, email, token: token || undefined });
    setTest(
      r.ok ? { ok: true, text: `Connected as ${r.displayName}` } : { ok: false, text: r.error ?? "Failed" },
    );
  }

  return (
    <section className="card-panel">
      <h2>
        <Plug size={17} /> Jira connection
      </h2>
      <div className="field">
        <label>Base URL</label>
        <input
          value={baseUrl}
          placeholder="https://your-domain.atlassian.net"
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label>API token</label>
        <input
          type="password"
          value={token}
          placeholder={hasToken ? "•••••• (saved — leave blank to keep)" : "paste API token"}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={myOnly} onChange={(e) => setMyOnly(e.target.checked)} />
        Only my tickets (assignee = me)
      </label>
      <div className="row">
        <button className="btn" onClick={save} disabled={saved === "saving"}>
          <Save size={15} />
          {saved === "saving" ? "Saving…" : "Save connection"}
        </button>
        <button className="btn-ghost" onClick={runTest}>
          <Zap size={15} />
          Test
        </button>
        {saved === "saved" && (
          <span className="ok">
            <Check size={14} /> Saved
          </span>
        )}
        {test &&
          (test.ok ? (
            <span className="ok">
              <Check size={14} /> {test.text}
            </span>
          ) : (
            <span className="bad">
              <AlertCircle size={14} /> {test.text}
            </span>
          ))}
      </div>
      {msg && (
        <div className="bad">
          <AlertCircle size={14} /> {msg}
        </div>
      )}
    </section>
  );
}

/* ---------------- Boards editor ---------------- */

function BoardsSection({ onSaved }: { onSaved: () => void }) {
  const [agentsDir, setAgentsDir] = useState("~/.claude/agents");
  const [boards, setBoards] = useState<BoardConfig[]>([]);
  const [saved, setSaved] = useState<Saved>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ key: string; name: string }[] | null>(null);

  useEffect(() => {
    api.config().then((c) => {
      setAgentsDir(c.agentsDir);
      setBoards(c.boards);
    });
  }, []);

  function patch(i: number, p: Partial<BoardConfig>) {
    setBoards((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
  }
  function addBoard() {
    setBoards((bs) => [...bs, { key: "", name: "", statuses: [] }]);
  }
  function removeBoard(i: number) {
    setBoards((bs) => bs.filter((_, idx) => idx !== i));
  }

  async function loadProjects() {
    setMsg(null);
    try {
      const r = await api.jiraProjects();
      setProjects(r.projects);
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  }

  async function pullStatuses(i: number, key: string) {
    setMsg(null);
    try {
      const r = await api.jiraStatuses(key);
      patch(i, { statuses: r.statuses });
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  }

  async function save() {
    setSaved("saving");
    setMsg(null);
    const cfg: FullConfig = { agentsDir, boards };
    try {
      const out = await api.saveConfig(cfg);
      setBoards(out.boards);
      setAgentsDir(out.agentsDir);
      setSaved("saved");
      onSaved();
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  return (
    <section className="card-panel">
      <h2>
        <Columns3 size={17} /> Boards &amp; agents
      </h2>
      <div className="field">
        <label>Agents directory</label>
        <input value={agentsDir} onChange={(e) => setAgentsDir(e.target.value)} />
      </div>

      {boards.map((b, i) => (
        <div className="board-edit" key={i}>
          <div className="board-edit-head">
            <input
              className="key-input"
              placeholder="KEY"
              value={b.key}
              onChange={(e) => patch(i, { key: e.target.value.toUpperCase() })}
            />
            <input
              className="name-input"
              placeholder="Display name"
              value={b.name}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <button className="btn-ghost danger" onClick={() => removeBoard(i)} title="Remove board">
              <Trash2 size={15} />
            </button>
          </div>
          <PathsEditor
            paths={b.repoPaths ?? (b.repoPath ? [b.repoPath] : [])}
            onChange={(paths) => patch(i, { repoPaths: paths, repoPath: undefined })}
          />
          <StatusEditor
            statuses={b.statuses}
            onChange={(statuses) => patch(i, { statuses })}
            canPull={!!b.key}
            onPull={() => pullStatuses(i, b.key)}
          />
        </div>
      ))}

      <div className="row">
        <button className="btn-ghost" onClick={addBoard}>
          <Plus size={15} /> Add board
        </button>
        <button className="btn-ghost" onClick={loadProjects}>
          <Download size={15} /> Pull projects from Jira
        </button>
      </div>

      {projects && (
        <div className="projects-pick">
          <div className="hint">Click a project to add it as a board:</div>
          <div className="project-list">
            {projects.map((p) => (
              <button
                key={p.key}
                className="chip"
                onClick={() => setBoards((bs) => [...bs, { key: p.key, name: p.name, statuses: [] }])}
              >
                {p.key} — {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row save-row">
        <button className="btn" onClick={save} disabled={saved === "saving"}>
          <Save size={15} />
          {saved === "saving" ? "Saving…" : "Save boards"}
        </button>
        {saved === "saved" && (
          <span className="ok">
            <Check size={14} /> Saved
          </span>
        )}
      </div>
      {msg && (
        <div className="bad">
          <AlertCircle size={14} /> {msg}
        </div>
      )}
    </section>
  );
}

/* ---------------- Board agents (which agents are available per board) ---------------- */

function BoardPicker({
  boards,
  sel,
  onSelect,
}: {
  boards: BoardConfig[];
  sel: number;
  onSelect: (i: number) => void;
}) {
  if (boards.length === 0) return <p className="hint">No boards yet — add one in “Boards &amp; columns”.</p>;
  return (
    <div className="field">
      <label>Board</label>
      <select value={sel} onChange={(e) => onSelect(Number(e.target.value))}>
        {boards.map((b, i) => (
          <option key={b.key || i} value={i}>
            {b.name || b.key || `Board ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function SaveStatus({ saved, msg }: { saved: Saved; msg: string | null }) {
  return (
    <div className="row" style={{ marginTop: 10 }}>
      {saved === "saving" && <span className="hint">Saving…</span>}
      {saved === "saved" && (
        <span className="ok">
          <Check size={14} /> Saved
        </span>
      )}
      {msg && (
        <span className="bad">
          <AlertCircle size={14} /> {msg}
        </span>
      )}
    </div>
  );
}

function AgentAccessSection({ onSaved }: { onSaved: () => void }) {
  const [boards, setBoards] = useState<BoardConfig[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sel, setSel] = useState(0);
  const [saved, setSaved] = useState<Saved>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.config(), api.agents()]).then(([c, a]) => {
      setBoards(c.boards);
      // Board agents are name-based, so same-named agents would render as separate
      // checkboxes that all share one selection — collapse them to one row per name.
      setAgents(dedupeByName(a.agents));
    });
  }, []);

  const board = boards[sel];
  const enabled = (name: string) => !board?.agents?.length || board.agents.includes(name);

  async function setAgentsFor(list: string[]) {
    // Normalize "everything selected" back to [] (= all available).
    const next = list.length === agents.length ? [] : list;
    const nextBoards = boards.map((b, i) => (i === sel ? { ...b, agents: next } : b));
    setBoards(nextBoards);
    setSaved("saving");
    setMsg(null);
    try {
      const latest = await api.config();
      const merged = latest.boards.map((b) => {
        const edited = nextBoards.find((x) => x.key === b.key);
        return edited ? { ...b, agents: edited.agents } : b;
      });
      const out = await api.saveConfig({ ...latest, boards: merged });
      setBoards(out.boards);
      setSaved("saved");
      onSaved();
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  function toggle(name: string) {
    const cur = board?.agents?.length ? board.agents : agents.map((a) => a.name); // empty = all
    const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    setAgentsFor(next);
  }

  return (
    <section className="card-panel">
      <h2>
        <Users size={17} /> Board agents
      </h2>
      <p className="hint">
        Choose which agents appear in this board's <b>Assign</b> menu. With none checked, <b>all</b> agents
        are available (the default).
      </p>
      <BoardPicker boards={boards} sel={sel} onSelect={setSel} />
      {board && (
        <div className="exclusive-list">
          {agents.map((a) => (
            <label className="exclusive-item" key={a.name} title={a.description}>
              <input type="checkbox" checked={enabled(a.name)} onChange={() => toggle(a.name)} />
              <Bot size={12} />
              <span className="mono">{a.name}</span>
              {a.model && <span className="model-chip">{a.model}</span>}
            </label>
          ))}
          {agents.length === 0 && <span className="hint">No agents found.</span>}
        </div>
      )}
      <SaveStatus saved={saved} msg={msg} />
    </section>
  );
}

/* ---------------- Board skills (which skills are available per board) ---------------- */

function BoardSkillsSection({ onSaved }: { onSaved: () => void }) {
  const [boards, setBoards] = useState<BoardConfig[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sel, setSel] = useState(0);
  const [saved, setSaved] = useState<Saved>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.config(), api.skills(), api.aiwfStatus()]).then(([c, s, ast]) => {
      setBoards(c.boards);
      const found = new Set(ast.skillGroups?.flatMap((g: { skills: string[] }) => g.skills) ?? []);
      const enriched = s.skills.map((sk) => (found.has(sk.name) ? { ...sk, aiwf: true } : sk));
      enriched.sort((a, b) => {
        const pa = skillProject(a) ?? "￿";
        const pb = skillProject(b) ?? "￿";
        if (pa !== pb) return pa.localeCompare(pb);
        return a.name.localeCompare(b.name);
      });
      // Board skills are name-based, so same-named skills would render as separate
      // checkboxes that all share one selection — collapse them to one row per name.
      setSkills(dedupeByName(enriched));
    });
  }, []);

  const board = boards[sel];
  const enabled = (name: string) => !board?.skills?.length || board.skills.includes(name);

  async function setSkillsFor(list: string[]) {
    const next = list.length === skills.length ? [] : list;
    const nextBoards = boards.map((b, i) => (i === sel ? { ...b, skills: next } : b));
    setBoards(nextBoards);
    setSaved("saving");
    setMsg(null);
    try {
      const latest = await api.config();
      const merged = latest.boards.map((b) => {
        const edited = nextBoards.find((x) => x.key === b.key);
        return edited ? { ...b, skills: edited.skills } : b;
      });
      const out = await api.saveConfig({ ...latest, boards: merged });
      setBoards(out.boards);
      setSaved("saved");
      onSaved();
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  function toggle(name: string) {
    const cur = board?.skills?.length ? board.skills : skills.map((s) => s.name);
    const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    setSkillsFor(next);
  }

  return (
    <section className="card-panel">
      <h2>
        <Sparkles size={17} /> Board skills
      </h2>
      <p className="hint">
        Choose which skills appear in this board's <b>Assign</b> menu. With none checked, <b>all</b> skills
        are available (the default).
      </p>
      <BoardPicker boards={boards} sel={sel} onSelect={setSel} />
      {board && (
        <div className="exclusive-list">
          {skills.map((s) => {
            const proj = skillProject(s);
            const pc = proj ? projectColor(proj) : undefined;
            return (
              <label className="exclusive-item" key={`${s.name}:${s.repo ?? ""}`} title={s.description}>
                <input type="checkbox" checked={enabled(s.name)} onChange={() => toggle(s.name)} />
                <Sparkles size={12} />
                <span className="mono">{s.name}</span>
                {proj && pc && (
                  <span className="proj-chip" style={{ color: pc, background: `${pc}20` }}>
                    ({proj})
                  </span>
                )}
                {s.model && <span className="model-chip">{s.model}</span>}
              </label>
            );
          })}
          {skills.length === 0 && <span className="hint">No skills found.</span>}
        </div>
      )}
      <SaveStatus saved={saved} msg={msg} />
    </section>
  );
}

/* ---------------- Workflows (ordered agent/skill pipelines per board) ---------------- */

function WorkflowsSection({ onSaved }: { onSaved: () => void }) {
  const [boards, setBoards] = useState<BoardConfig[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sel, setSel] = useState(0);
  const [saved, setSaved] = useState<Saved>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.config(), api.agents(), api.skills()]).then(([c, a, s]) => {
      setBoards(c.boards);
      setAgents(a.agents);
      setSkills(s.skills);
    });
  }, []);

  const board = boards[sel];
  const workflows = board?.workflows ?? [];
  // Agents selectable in steps respect the board's agent allow-list.
  const boardAgents = board?.agents?.length ? agents.filter((a) => board.agents!.includes(a.name)) : agents;

  // Edits stay local; only the explicit Save button persists (and re-syncs from the server),
  // so adding a workflow / typing a name never triggers a round-trip that could drop a draft.
  function setWorkflowsFor(list: WorkflowConfig[]) {
    setBoards((bs) => bs.map((b, i) => (i === sel ? { ...b, workflows: list } : b)));
    if (saved === "saved") setSaved("idle");
  }

  function patchWorkflow(id: string, p: Partial<WorkflowConfig>) {
    setWorkflowsFor(workflows.map((w) => (w.id === id ? { ...w, ...p } : w)));
  }
  function addWorkflow() {
    setWorkflowsFor([...workflows, { id: crypto.randomUUID(), name: "New workflow", steps: [] }]);
  }
  function removeWorkflow(id: string) {
    setWorkflowsFor(workflows.filter((w) => w.id !== id));
  }

  async function save() {
    setSaved("saving");
    setMsg(null);
    const editedBoards = boards;
    try {
      const latest = await api.config();
      const merged = latest.boards.map((b) => {
        const edited = editedBoards.find((x) => x.key === b.key);
        return edited ? { ...b, workflows: edited.workflows ?? [] } : b;
      });
      const out = await api.saveConfig({ ...latest, boards: merged });
      setBoards(out.boards);
      setSaved("saved");
      onSaved();
    } catch (e) {
      setSaved("error");
      setMsg(String((e as Error).message ?? e));
    }
  }

  return (
    <section className="card-panel">
      <h2>
        <WorkflowIcon size={17} /> Workflows
      </h2>
      <p className="hint">
        A workflow is an ordered pipeline of agent/skill steps. Putting a ticket into a workflow (from the
        card's <b>Assign</b> menu) runs each step in turn, auto-advancing when a step finishes — all steps
        share one worktree, so each builds on the last. A step that pauses for approval or errors turns the
        workflow <b>red</b>.
      </p>
      <BoardPicker boards={boards} sel={sel} onSelect={setSel} />

      {board &&
        workflows.map((w) => (
          <div className="board-edit" key={w.id}>
            <div className="board-edit-head">
              <input
                className="name-input"
                placeholder="Workflow name"
                value={w.name}
                onChange={(e) => patchWorkflow(w.id, { name: e.target.value })}
              />
              <button
                className="btn-ghost danger"
                onClick={() => removeWorkflow(w.id)}
                title="Remove workflow"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <StepsEditor
              steps={w.steps}
              agents={boardAgents}
              skills={skills}
              onChange={(steps) => patchWorkflow(w.id, { steps })}
            />
          </div>
        ))}

      {board && (
        <div className="row save-row">
          <button className="btn-ghost" onClick={addWorkflow}>
            <Plus size={15} /> Add workflow
          </button>
          <button className="btn" onClick={save} disabled={saved === "saving"}>
            <Save size={15} />
            {saved === "saving" ? "Saving…" : "Save workflows"}
          </button>
          {saved === "saved" && (
            <span className="ok">
              <Check size={14} /> Saved
            </span>
          )}
        </div>
      )}
      {msg && (
        <div className="bad">
          <AlertCircle size={14} /> {msg}
        </div>
      )}
    </section>
  );
}

function StepsEditor({
  steps,
  agents,
  skills,
  onChange,
}: {
  steps: WorkflowStep[];
  agents: Agent[];
  skills: Skill[];
  onChange: (s: WorkflowStep[]) => void;
}) {
  const [pick, setPick] = useState("");
  const agentByName = useMemo(() => new Map(agents.map((a) => [a.name, a])), [agents]);
  const skillByName = useMemo(() => new Map(skills.map((sk) => [sk.name, sk])), [skills]);

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function add() {
    if (!pick) return;
    const [kind, ...rest] = pick.split(":");
    const name = rest.join(":");
    onChange([...steps, { name, kind: kind === "skill" ? "skill" : "agent" }]);
    setPick("");
  }
  const label = (s: Skill) => (s.repo ? `${s.name} (${s.repo})` : s.name);

  return (
    <div className="steps-editor">
      <ol className="steps-list">
        {steps.map((s, i) => {
          const stepModel =
            s.kind === "skill" ? skillByName.get(s.name)?.model : agentByName.get(s.name)?.model;
          return (
            <li className="step-row" key={`${s.kind}:${s.name}:${i}`}>
              <span className="step-num">{i + 1}</span>
              {s.kind === "skill" ? <Sparkles size={12} /> : <Bot size={12} />}
              <span className="mono step-name">{s.name}</span>
              {stepModel && <span className="model-chip">{stepModel}</span>}
              <input
                className="step-note"
                placeholder="optional instruction for this step…"
                value={s.note ?? ""}
                onChange={(e) =>
                  onChange(steps.map((x, idx) => (idx === i ? { ...x, note: e.target.value } : x)))
                }
              />
              <button className="chip-btn" onClick={() => move(i, -1)} title="Move up">
                <ChevronUp size={13} />
              </button>
              <button className="chip-btn" onClick={() => move(i, 1)} title="Move down">
                <ChevronDown size={13} />
              </button>
              <button
                className="chip-btn remove"
                onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
                title="Remove step"
              >
                <X size={13} />
              </button>
            </li>
          );
        })}
        {steps.length === 0 && <span className="hint">No steps yet — add one below.</span>}
      </ol>
      <div className="row">
        <select className="step-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a step…</option>
          <optgroup label="Agents">
            {agents.map((a) => (
              <option key={`agent:${a.name}`} value={`agent:${a.name}`}>
                {a.name}
                {a.model ? ` · ${a.model}` : ""}
              </option>
            ))}
          </optgroup>
          <optgroup label="Skills">
            {skills.map((s) => (
              <option key={`skill:${s.name}:${s.repo ?? ""}`} value={`skill:${s.name}`}>
                {label(s)}
                {s.model ? ` · ${s.model}` : ""}
              </option>
            ))}
          </optgroup>
        </select>
        <button className="btn-ghost sm" disabled={!pick} onClick={add}>
          <Plus size={14} /> Add step
        </button>
      </div>
    </div>
  );
}

type PathStatus = "unchecked" | "ok" | "missing";

function PathsEditor({ paths, onChange }: { paths: string[]; onChange: (p: string[]) => void }) {
  const [statuses, setStatuses] = useState<PathStatus[]>(() => paths.map(() => "unchecked"));

  // Keep status array length in sync when paths are added or removed.
  useEffect(() => {
    setStatuses((prev) => paths.map((_, i) => prev[i] ?? "unchecked"));
  }, [paths.length]);

  function setStatus(i: number, s: PathStatus) {
    setStatuses((prev) => prev.map((x, idx) => (idx === i ? s : x)));
  }

  async function onBlur(i: number, val: string) {
    if (!val.trim()) {
      setStatus(i, "unchecked");
      return;
    }
    try {
      const { exists } = await api.checkPath(val.trim());
      setStatus(i, exists ? "ok" : "missing");
    } catch {
      setStatus(i, "unchecked");
    }
  }

  return (
    <div className="paths-editor">
      <div className="paths-label">
        Codebase paths{" "}
        <span className="hint">— first is the working dir; the rest are also accessible to the agent</span>
      </div>
      {paths.map((p, i) => (
        <div className="path-row" key={i}>
          <input
            className={`repo-input${statuses[i] === "missing" ? " path-missing" : ""}`}
            placeholder="~/dev/ReviewWave/eyeconic"
            value={p}
            onChange={(e) => {
              onChange(paths.map((x, idx) => (idx === i ? e.target.value : x)));
              setStatus(i, "unchecked");
            }}
            onBlur={(e) => onBlur(i, e.target.value)}
          />
          {statuses[i] === "ok" && <Check size={14} className="path-status-icon ok" />}
          {statuses[i] === "missing" && <AlertCircle size={14} className="path-status-icon missing" />}
          <button
            className="chip-btn remove"
            onClick={() => {
              onChange(paths.filter((_, idx) => idx !== i));
              setStatuses((prev) => prev.filter((_, idx) => idx !== i));
            }}
            title="Remove path"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        className="btn-ghost sm"
        onClick={() => {
          onChange([...paths, ""]);
          setStatuses((prev) => [...prev, "unchecked"]);
        }}
      >
        <Plus size={14} /> Add path
      </button>
    </div>
  );
}

function StatusEditor({
  statuses,
  onChange,
  canPull,
  onPull,
}: {
  statuses: string[];
  onChange: (s: string[]) => void;
  canPull: boolean;
  onPull: () => void;
}) {
  const [draft, setDraft] = useState("");

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= statuses.length) return;
    const next = [...statuses];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="status-editor">
      <div className="status-list">
        {statuses.map((s, i) => (
          <span className="status-chip" key={`${s}-${i}`}>
            <button className="chip-btn" onClick={() => move(i, -1)} title="Move left">
              <ChevronLeft size={13} />
            </button>
            {s}
            <button className="chip-btn" onClick={() => move(i, 1)} title="Move right">
              <ChevronRight size={13} />
            </button>
            <button
              className="chip-btn remove"
              onClick={() => onChange(statuses.filter((_, idx) => idx !== i))}
              title="Remove"
            >
              <X size={13} />
            </button>
          </span>
        ))}
        {statuses.length === 0 && <span className="hint">No columns yet.</span>}
      </div>
      <div className="row">
        <input
          className="status-input"
          placeholder="add a status, press Enter…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onChange([...statuses, draft.trim()]);
              setDraft("");
            }
          }}
        />
        <button
          className="btn-ghost"
          disabled={!canPull}
          onClick={onPull}
          title={canPull ? "Fetch statuses from Jira for this project" : "Set the project key first"}
        >
          <Download size={15} /> Pull statuses from Jira
        </button>
      </div>
    </div>
  );
}
