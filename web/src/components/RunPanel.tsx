import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Bot,
  ShieldQuestion,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Terminal,
  Square,
  Check,
  Ban,
  ExternalLink,
  GitPullRequest,
  GitBranch,
  ListChecks,
  Send,
  MessageCircleQuestion,
  User,
  RotateCcw,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { Agent, RunEvent, RunKind, RunState, Skill, isActive } from "../types";
import { HandoffModal } from "./HandoffModal";
import { Markdown } from "./Markdown";

// Default prompt sent by the one-click "Resume" — picks the session back up without a custom steer.
const RESUME_MESSAGE = "Continue.";

// Funny "working" words shown (rotating) while the agent runs tools, in place of echoing every
// command — mirrors how Claude Code narrates activity.
const ACTIVITY_WORDS = [
  "Percolating",
  "Herding",
  "Noodling",
  "Conjuring",
  "Simmering",
  "Ruminating",
  "Tinkering",
  "Whirring",
  "Cogitating",
  "Puttering",
  "Marinating",
  "Vibing",
];

// Static map of skill → suggested follow-on skills, in display order.
const SKILL_NEXT_MAP: Record<string, string[]> = {
  // Spec workflow
  prd: ["roadmap", "spec"],
  roadmap: ["spec"],
  adr: ["spec"],
  rfc: ["spec"],
  spec: ["feature"],
  design: ["spec"],
  // Implementation workflow
  tdd: ["feature"],
  feature: ["commit", "pr", "verify"],
  fix: ["commit", "pr"],
  simplify: ["commit", "pr"],
  // Quality workflow
  "code-review": ["fix", "commit"],
  "security-review": ["fix"],
  security: ["fix"],
  review: ["fix"],
  verify: ["commit", "pr"],
  // Delivery workflow
  commit: ["pr"],
  pr: ["review", "jira-comment"],
  "release-pr": ["jira-announce"],
};

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function limitMessage(subtype: string): string {
  if (subtype === "error_max_turns")
    return "Hit the max-turns limit — raise it in Settings → Run limits and hand off to continue.";
  if (subtype === "error_max_budget_usd")
    return "Hit the per-run spend cap — raise it in Settings → Run limits.";
  return subtype || "Run ended with an error";
}

export function RunPanel({
  runId,
  ticketKey,
  agentName,
  ticketUrl,
  agents,
  skills,
  onHandoff,
  onRestart,
  onClose,
  onClearTask,
  onOpenInTerminal,
  terminalConfigured,
  richText = true,
}: {
  runId: string;
  ticketKey: string;
  agentName: string;
  ticketUrl?: string;
  agents: Agent[];
  skills: Skill[];
  onHandoff: (name: string, kind: RunKind, note: string) => void;
  onRestart: () => void;
  onClose: () => void;
  onClearTask?: () => void;
  onOpenInTerminal?: () => void;
  terminalConfigured?: boolean;
  richText?: boolean;
}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [submitting, setSubmitting] = useState<Set<string>>(new Set());
  const [handoff, setHandoff] = useState(false);
  const [reconnect, setReconnect] = useState(0);
  const [sending, setSending] = useState(false);
  const [terminalWarning, setTerminalWarning] = useState(false);
  const [streamError, setStreamError] = useState<"not_found" | "error" | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reconnecting (bumped after sending a follow-up) re-opens the SSE so a resumed/steered
  // turn streams in. The endpoint replays the full transcript first, so resetting is lossless.
  useEffect(() => {
    setEvents([]);
    setStreamError(null);
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (e) => {
      try {
        setEvents((prev) => [...prev, JSON.parse(e.data) as RunEvent]);
      } catch {
        /* ignore */
      }
    };
    // EventSource.CLOSED means the server rejected the connection (e.g. 404) — no retry.
    // CONNECTING means a transient drop and the browser is retrying; leave it alone.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        fetch(`/api/runs/${runId}`)
          .then((r) => setStreamError(r.status === 404 ? "not_found" : "error"))
          .catch(() => setStreamError("error"));
      }
    };
    es.addEventListener("end", () => es.close());
    return () => es.close();
  }, [runId, reconnect]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [events]);

  const resolvedDecisions = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) if (e.kind === "permission_resolved") m.set(s(e.requestId), s(e.decision));
    return m;
  }, [events]);
  const resolvedQuestions = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) if (e.kind === "question_resolved") m.set(s(e.requestId), s(e.answer));
    return m;
  }, [events]);
  const pendingQuestion = useMemo(
    () => events.some((e) => e.kind === "question" && !resolvedQuestions.has(s(e.requestId))),
    [events, resolvedQuestions],
  );
  const pendingPermission = useMemo(
    () => events.some((e) => e.kind === "permission_request" && !resolvedDecisions.has(s(e.requestId))),
    [events, resolvedDecisions],
  );

  const state = useMemo<RunState>(
    () => deriveState(events, resolvedDecisions, resolvedQuestions),
    [events, resolvedDecisions, resolvedQuestions],
  );
  const sessionId = useMemo(
    () => events.find((e) => e.kind === "system" && e.sessionId)?.sessionId as string | undefined,
    [events],
  );
  const cost = useMemo(() => {
    const r = [...events].reverse().find((e) => typeof e.costUsd === "number");
    return r?.costUsd as number | undefined;
  }, [events]);
  const phase = useMemo(() => {
    const p = [...events].reverse().find((e) => e.kind === "phase");
    return p ? { label: s(p.label), done: Number(p.done) || 0, total: Number(p.total) || 0 } : null;
  }, [events]);
  const prUrl = useMemo(() => events.find((e) => e.kind === "pr")?.url as string | undefined, [events]);
  const branch = useMemo(
    () => events.find((e) => e.kind === "worktree")?.branch as string | undefined,
    [events],
  );
  const resultText = useMemo(() => {
    const r = [...events].reverse().find((e) => e.kind === "result" && e.subtype === "success");
    if (r?.result) return String(r.result);
    return events
      .filter((e) => e.kind === "assistant_text")
      .map((e) => s(e.text))
      .join("\n\n");
  }, [events]);

  async function decide(requestId: string, decision: "allow" | "deny") {
    setSubmitting((p) => new Set(p).add(requestId));
    try {
      await api.resolvePermission(runId, requestId, decision);
    } catch {
      setSubmitting((p) => {
        const n = new Set(p);
        n.delete(requestId);
        return n;
      });
    }
  }

  // Send a follow-up: answers an open question, steers a running turn, or resumes a finished
  // session. Reconnect to stream the resulting events back in. Returns true on success so the
  // composer can clear itself only when the message was actually sent.
  async function sendFollowup(text: string): Promise<boolean> {
    const t = text.trim();
    if (!t || sending) return false;
    setSending(true);
    try {
      await api.sendMessage(runId, t);
      setReconnect((n) => n + 1);
      return true;
    } catch {
      return false; // surfaced via the run state
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="run-overlay" onClick={onClose}>
      <aside className="run-panel" onClick={(e) => e.stopPropagation()}>
        <header className="run-head">
          <div className="run-head-main">
            <StateBadge state={state} />
            <span className="run-title">
              <span className="run-ticket">{ticketKey}</span>
              <span className="run-arrow">→</span>
              <Bot size={14} /> {agentName}
            </span>
          </div>
          <div className="run-head-actions">
            {state === "error" && (
              <button
                className="btn-ghost sm"
                onClick={onRestart}
                title="Start a fresh session — same agent and context, brand-new session"
              >
                <RefreshCw size={13} /> Restart
              </button>
            )}
            {!isActive(state) && sessionId && (
              <button
                className="btn-ghost sm"
                onClick={() => sendFollowup(RESUME_MESSAGE)}
                disabled={sending}
                title="Resume from where it left off"
              >
                <RotateCcw size={13} /> Resume
              </button>
            )}
            {!isActive(state) && sessionId && onOpenInTerminal && (
              <button
                className="btn-ghost sm"
                onClick={() => {
                  if (!terminalConfigured) {
                    setTerminalWarning(true);
                    return;
                  }
                  onOpenInTerminal();
                }}
                title="Resume this session in your terminal"
              >
                <Terminal size={13} /> Terminal
              </button>
            )}
            <button
              className="btn-ghost sm"
              onClick={() => setHandoff(true)}
              title="Hand off result to another agent"
            >
              <GitBranch size={13} /> Hand off
            </button>
            {isActive(state) && (
              <button className="btn-ghost danger sm" onClick={() => api.stopRun(runId)} title="Stop session">
                <Square size={13} /> Stop
              </button>
            )}
            {onClearTask && (
              <button
                className="btn-ghost danger sm"
                onClick={onClearTask}
                title="Delete all sessions for this task"
              >
                <Trash2 size={13} /> Clear
              </button>
            )}
            <button className="icon-btn" onClick={onClose} title="Close">
              <X size={17} />
            </button>
          </div>
        </header>

        {terminalWarning && (
          <div className="banner warn">
            <AlertCircle size={14} /> No terminal configured. Set your default terminal in{" "}
            <b>Settings → Terminal</b> to use "Open in terminal".
          </div>
        )}

        {streamError && (
          <div className="banner error">
            <AlertCircle size={14} />
            {streamError === "not_found"
              ? "This run no longer exists — it may have been deleted."
              : "Could not load the session stream. The server may be unavailable."}
          </div>
        )}

        <div className="run-sub">
          {ticketUrl && (
            <a href={ticketUrl} target="_blank" rel="noreferrer" title="Open in Jira">
              <ExternalLink size={11} /> Jira
            </a>
          )}
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noreferrer" title={prUrl}>
              <GitPullRequest size={11} /> PR
            </a>
          )}
          {branch && (
            <span title="Isolated worktree branch">
              <GitBranch size={11} /> {branch}
            </span>
          )}
          {sessionId && <span title="Claude Code session id">session {sessionId.slice(0, 8)}</span>}
          {typeof cost === "number" && <span>${cost.toFixed(4)}</span>}
        </div>

        {phase && (
          <div
            className={`run-phase${isActive(state) ? " active" : ""}`}
            title="Current step (from the agent's todo list)"
          >
            {isActive(state) ? <Loader2 size={13} className="spin" /> : <ListChecks size={13} />}
            <span className="run-phase-label">{phase.label}</span>
            {phase.total > 0 && (
              <span className="run-phase-count">
                {phase.done}/{phase.total}
              </span>
            )}
          </div>
        )}

        <div className="run-body" ref={bodyRef}>
          {events.length === 0 && (
            <div className="run-line muted">
              <Loader2 size={14} className="spin" /> Connecting…
            </div>
          )}
          {renderEvents(
            events,
            resolvedDecisions,
            resolvedQuestions,
            submitting,
            decide,
            sendFollowup,
            richText,
          )}
          {isActive(state) && !pendingQuestion && !pendingPermission && events.length > 0 && (
            <ActivityStatus />
          )}
        </div>

        {(sessionId || isActive(state)) && (
          <SmartButtons
            agentName={agentName}
            skills={skills}
            state={state}
            sessionId={sessionId}
            sendFollowup={sendFollowup}
          />
        )}

        {(sessionId || isActive(state)) && (
          <Composer
            pendingQuestion={pendingQuestion}
            active={isActive(state)}
            sending={sending}
            onSend={sendFollowup}
          />
        )}

        {handoff && (
          <HandoffModal
            fromLabel={agentName}
            agents={agents}
            skills={skills}
            initialNote={resultText}
            onRun={(name, kind, note) => {
              onHandoff(name, kind, note);
              setHandoff(false);
            }}
            onCancel={() => setHandoff(false)}
          />
        )}
      </aside>
    </div>
  );
}

// Live "working" indicator shown while the agent runs tools. Owns its own ticking state so the
// rotating word re-renders only this line, not the whole transcript.
function ActivityStatus() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), 2500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="run-activity">
      <Loader2 size={14} className="spin" />
      {ACTIVITY_WORDS[i % ACTIVITY_WORDS.length]}…
    </div>
  );
}

// The message composer owns its own draft state so keystrokes re-render only this small input,
// not the whole transcript (which re-parses every assistant message's Markdown and made typing lag).
function Composer({
  pendingQuestion,
  active,
  sending,
  onSend,
}: {
  pendingQuestion: boolean;
  active: boolean;
  sending: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");

  async function submit() {
    if (!draft.trim() || sending) return;
    const ok = await onSend(draft);
    if (ok) setDraft("");
  }

  return (
    <form
      className={`run-composer${pendingQuestion ? " asking" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={
          pendingQuestion
            ? "Type your answer…"
            : active
              ? "Send a message to the session…"
              : "Send a follow-up (resumes the session)…"
        }
      />
      <button className="btn sm" type="submit" disabled={!draft.trim() || sending} title="Send (Enter)">
        <Send size={14} />
      </button>
    </form>
  );
}

// Walk from the newest event and return on the first state-bearing one. This handles
// resumed/multi-turn sessions correctly: a later turn's state overrides an earlier result.
function deriveState(
  events: RunEvent[],
  resolvedPerms: Map<string, string>,
  resolvedQs: Map<string, string>,
): RunState {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    switch (e.kind) {
      case "result":
        return e.subtype === "success" ? "done" : "error";
      case "stopped":
        return "stopped";
      case "error":
        return "error";
      case "state":
        return e.state as RunState;
      case "question":
        if (!resolvedQs.has(s(e.requestId))) return "awaiting_input";
        break;
      case "permission_request":
        if (!resolvedPerms.has(s(e.requestId))) return "awaiting_input";
        break;
    }
  }
  return "starting";
}

// Rich text renders Markdown; raw renders a plain text node (never HTML), preserving whitespace.
function renderText(text: string, richText: boolean): JSX.Element {
  return richText ? <Markdown>{text}</Markdown> : <div className="run-raw">{text}</div>;
}

// Render each assistant_text event as a complete block, interleaved with other events.
function renderEvents(
  events: RunEvent[],
  resolved: Map<string, string>,
  resolvedQuestions: Map<string, string>,
  submitting: Set<string>,
  decide: (id: string, d: "allow" | "deny") => void,
  answer: (text: string) => void,
  richText: boolean,
) {
  const out: JSX.Element[] = [];

  for (const e of events) {
    if (e.kind === "assistant_text") {
      out.push(
        <div className="run-line text" key={e.seq}>
          {renderText(s(e.text), richText)}
        </div>,
      );
      continue;
    }
    const el = renderOther(e, resolved, resolvedQuestions, submitting, decide, answer, richText);
    if (el) out.push(el);
  }
  return out;
}

function renderOther(
  e: RunEvent,
  resolved: Map<string, string>,
  resolvedQuestions: Map<string, string>,
  submitting: Set<string>,
  decide: (id: string, d: "allow" | "deny") => void,
  answer: (text: string) => void,
  richText: boolean,
): JSX.Element | null {
  switch (e.kind) {
    case "permission_request": {
      const id = s(e.requestId);
      const decision = resolved.get(id);
      if (decision) {
        return (
          <div className={`run-line resolved ${decision}`} key={e.seq}>
            {decision === "allow" ? <Check size={13} /> : <Ban size={13} />}
            {decision === "allow" ? "Approved" : "Denied"} <b>{s(e.tool)}</b>
          </div>
        );
      }
      const busy = submitting.has(id);
      return (
        <div className="perm-request" key={e.seq}>
          <div className="perm-head">
            <ShieldQuestion size={15} /> Approve <b>{s(e.tool)}</b>?
          </div>
          <div className="perm-input">{s(e.input)}</div>
          <div className="perm-actions">
            <button className="btn sm" disabled={busy} onClick={() => decide(id, "allow")}>
              <Check size={14} /> Allow
            </button>
            <button className="btn-ghost danger sm" disabled={busy} onClick={() => decide(id, "deny")}>
              <Ban size={14} /> Deny
            </button>
          </div>
        </div>
      );
    }
    case "worktree":
      return (
        <div className="run-line muted" key={e.seq}>
          <GitBranch size={13} /> worktree {s(e.repo)} @ {s(e.branch)}
        </div>
      );
    case "system":
      return (
        <div className="run-line muted" key={e.seq}>
          <Terminal size={13} /> {s(e.message)}
        </div>
      );
    case "info":
      return e.message ? (
        <div className="run-line muted" key={e.seq}>
          {s(e.message)}
        </div>
      ) : null;
    case "stopped":
      return (
        <div className="run-result stopped" key={e.seq}>
          <Square size={14} /> Session stopped by operator
        </div>
      );
    case "result":
      return e.subtype === "success" ? (
        <div className="run-result done" key={e.seq}>
          <div className="run-result-head">
            <CheckCircle2 size={15} /> Result
          </div>
          <div className="run-result-body">{renderText(s(e.result), richText)}</div>
        </div>
      ) : (
        <div className="run-result error" key={e.seq}>
          <AlertCircle size={15} /> {limitMessage(s(e.subtype))}
        </div>
      );
    case "error":
      return (
        <div className="run-result error" key={e.seq}>
          <AlertCircle size={15} /> {s(e.message)}
        </div>
      );
    case "user_message":
      return (
        <div className="run-user" key={e.seq}>
          <span className="run-user-label">
            <User size={12} /> You
          </span>
          <div className="run-user-text">{s(e.text)}</div>
        </div>
      );
    case "question":
      return (
        <QuestionCard key={e.seq} e={e} answered={resolvedQuestions.get(s(e.requestId))} answer={answer} />
      );
    default:
      return null;
  }
}

interface ParsedQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

// Build the single string we hand back to the session. With multiple questions we label each
// answer with its header/question so the model can tell them apart; a lone question stays terse.
function formatAnswer(questions: ParsedQuestion[], picks: string[][]): string {
  if (questions.length === 1) return picks[0].join(", ");
  return questions.map((q, qi) => `${q.header || q.question}: ${picks[qi].join(", ")}`).join("\n");
}

// Renders an AskUserQuestion prompt. Selections accumulate locally so every question (and every
// pick within a multiSelect question) is captured before a single combined answer is sent — a
// lone single-select question keeps the one-click fast path.
function QuestionCard({
  e,
  answered,
  answer,
}: {
  e: RunEvent;
  answered?: string;
  answer: (text: string) => void;
}) {
  const questions = (Array.isArray(e.questions) ? e.questions : []) as ParsedQuestion[];
  const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []));
  const oneClick = questions.length === 1 && !questions[0]?.multiSelect;

  const toggle = (qi: number, label: string, multi: boolean) => {
    if (oneClick) {
      answer(label);
      return;
    }
    setPicks((prev) => {
      const next = prev.map((row) => [...row]);
      const row = next[qi] ?? (next[qi] = []);
      const at = row.indexOf(label);
      if (multi) {
        if (at >= 0) row.splice(at, 1);
        else row.push(label);
      } else {
        next[qi] = at >= 0 ? [] : [label];
      }
      return next;
    });
  };

  const complete = questions.length > 0 && questions.every((_, qi) => (picks[qi]?.length ?? 0) > 0);
  const disabled = !!answered;

  return (
    <div className="run-question">
      <div className="rq-head">
        <MessageCircleQuestion size={15} /> The agent is asking
      </div>
      {questions.map((q, qi) => (
        <div className="rq-block" key={qi}>
          {q.header && <span className="rq-tag">{q.header}</span>}
          <div className="rq-text">{q.question}</div>
          <div className="rq-options">
            {(q.options ?? []).map((o, oi) => {
              const selected = (picks[qi] ?? []).includes(o.label);
              return (
                <button
                  key={oi}
                  className={`rq-opt${selected ? " selected" : ""}`}
                  disabled={disabled}
                  title={o.description}
                  onClick={() => toggle(qi, o.label, !!q.multiSelect)}
                >
                  {selected && <Check size={12} />}
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {answered ? (
        <div className="rq-answered">
          <Check size={12} /> You answered: {answered}
        </div>
      ) : oneClick ? (
        <div className="rq-hint">Pick an option, or type a reply below.</div>
      ) : (
        <div className="rq-actions">
          <button
            className="btn sm"
            disabled={!complete}
            onClick={() => answer(formatAnswer(questions, picks))}
          >
            <Send size={13} /> Send answer{questions.length > 1 ? "s" : ""}
          </button>
          <span className="rq-hint">
            {complete
              ? "Send your selections, or type a reply below."
              : "Choose an option for each question."}
          </span>
        </div>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: RunState }) {
  const map: Record<RunState, { label: string; cls: string; icon: JSX.Element }> = {
    queued: { label: "Queued", cls: "await", icon: <Loader2 size={13} /> },
    starting: { label: "Starting", cls: "running", icon: <Loader2 size={13} className="spin" /> },
    running: { label: "Running", cls: "running", icon: <Loader2 size={13} className="spin" /> },
    awaiting_input: { label: "Needs input", cls: "await", icon: <ShieldQuestion size={13} /> },
    done: { label: "Done", cls: "done", icon: <CheckCircle2 size={13} /> },
    error: { label: "Error", cls: "error", icon: <AlertCircle size={13} /> },
    stopped: { label: "Stopped", cls: "stopped", icon: <Square size={13} /> },
  };
  const m = map[state];
  return (
    <span className={`run-badge ${m.cls}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

function SmartButtons({
  agentName,
  skills,
  state,
  sessionId,
  sendFollowup,
}: {
  agentName: string;
  skills: Skill[];
  state: RunState;
  sessionId: string | undefined;
  sendFollowup: (text: string) => void;
}) {
  if (isActive(state) || !sessionId) return null;
  const suggestions = SKILL_NEXT_MAP[agentName];
  if (!suggestions) return null;
  const available = new Set(skills.map((s) => s.name));
  const buttons = suggestions.filter((name) => available.has(name));
  if (buttons.length === 0) return null;
  return (
    <div className="smart-buttons">
      <span className="smart-buttons-label">Next:</span>
      {buttons.map((name) => (
        <button key={name} className="smart-btn" onClick={() => sendFollowup("/" + name)}>
          /{name}
        </button>
      ))}
    </div>
  );
}
