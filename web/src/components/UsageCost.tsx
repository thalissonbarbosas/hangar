import { useEffect, useState } from "react";
import { CircleDollarSign, RefreshCw, Download, AlertTriangle } from "lucide-react";
import { api } from "../api";

type Mode = "daily" | "monthly" | "weekly" | "blocks" | "session";

const MODES: { value: Mode; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "blocks", label: "Blocks" },
  { value: "session", label: "Session" },
];

function currentWeekRange(): { since: string; until: string } {
  const today = new Date();
  const day = today.getDay(); // 0=Sun … 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(monday), until: fmt(sunday) };
}

// Mirrors the server-side DATE_RE: YYYY-MM-DD only (YYYYMMDD not shown in the UI).
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function fmtNum(n: number) {
  return n.toLocaleString();
}

function fmtCost(n: number) {
  return `$${n.toFixed(2)}`;
}

type Row = {
  period?: string;
  startTime?: string;
  endTime?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  totalCost?: number;
  [key: string]: unknown;
};

type UsageData = {
  [key: string]: Row[];
};

export function UsageCostOverlay() {
  const [installed, setInstalled] = useState<boolean | null>(null); // null = loading
  const [version, setVersion] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("daily");
  const { since: defaultSince, until: defaultUntil } = currentWeekRange();
  const [since, setSince] = useState(defaultSince);
  const [until, setUntil] = useState(defaultUntil);
  const [activeOnly, setActiveOnly] = useState(false);
  const [recent, setRecent] = useState(false);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  // Check installation status on mount.
  useEffect(() => {
    api
      .usageStatus()
      .then((s) => {
        setInstalled(s.installed);
        setVersion(s.version);
      })
      .catch(() => setInstalled(false));
  }, []);

  function validateDates(): boolean {
    if ((since && !DATE_RE.test(since)) || (until && !DATE_RE.test(until))) {
      setDateError("Dates must be YYYY-MM-DD (e.g. 2026-01-01)");
      return false;
    }
    setDateError(null);
    return true;
  }

  function fetchData() {
    if (!validateDates()) return;
    setLoading(true);
    setError(null);
    const params: Record<string, string> = { mode };
    if (since) params.since = since;
    if (until) params.until = until;
    if (mode === "blocks") {
      if (activeOnly) params.active = "true";
      if (recent) params.recent = "true";
    }
    api
      .usageData(params)
      .then((d) => setData(d as UsageData))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function install() {
    setInstalling(true);
    setError(null);
    api
      .usageInstall()
      .then(() => api.usageStatus())
      .then((s) => {
        setInstalled(s.installed);
        setVersion(s.version);
        if (!s.installed) {
          setError("Installed but ccusage was not detected — restart the server and reload.");
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setInstalling(false));
  }

  // Loading state while checking installation.
  if (installed === null) {
    return (
      <div className="settings">
        <section className="card-panel">
          <h2>
            <CircleDollarSign size={17} /> Usage Cost
          </h2>
          <p className="hint">
            <RefreshCw size={12} className="spin" style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Checking ccusage…
          </p>
        </section>
      </div>
    );
  }

  // Not-installed CTA.
  if (!installed) {
    return (
      <div className="settings">
        <section className="card-panel">
          <h2>
            <CircleDollarSign size={17} /> Usage Cost
          </h2>
          <div className="banner warn">
            <AlertTriangle size={14} /> ccusage is not installed
          </div>
          <p className="hint" style={{ margin: "12px 0" }}>
            ccusage provides Claude Code usage data grouped by day, month, billing block, and session.
          </p>
          {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 10px" }}>{error}</p>}
          <button className="btn" disabled={installing} onClick={install}>
            {installing ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
            {installing ? "Installing…" : "Install ccusage globally"}
          </button>
        </section>
      </div>
    );
  }

  const rows: Row[] = data ? (data[mode] ?? []) : [];
  const totalCost = rows.reduce((sum, r) => sum + (r.totalCost ?? 0), 0);
  const isBlocks = mode === "blocks";

  return (
    <div className="settings">
      <section className="card-panel">
        <h2>
          <CircleDollarSign size={17} /> Usage Cost
          {version && (
            <span className="hint" style={{ marginLeft: 4, fontWeight: 400 }}>
              {version}
            </span>
          )}
        </h2>

        {/* Mode tab bar */}
        <div style={{ marginBottom: 14 }}>
          <div className="board-toggles" style={{ width: "fit-content" }}>
            {MODES.map((m) => (
              <label key={m.value} className={mode === m.value ? "pill on" : "pill"}>
                <input type="radio" checked={mode === m.value} onChange={() => setMode(m.value)} />
                {m.label}
              </label>
            ))}
          </div>
        </div>

        {/* Filter row: since / until / blocks toggles / Run */}
        <div className="row" style={{ marginBottom: 14, gap: 10, alignItems: "center" }}>
          <label
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Since
          </label>
          <input
            type="text"
            placeholder="YYYY-MM-DD"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            style={{ width: 120 }}
          />
          <label
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Until
          </label>
          <input
            type="text"
            placeholder="YYYY-MM-DD"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            style={{ width: 120 }}
          />
          {isBlocks && (
            <>
              <label className={activeOnly ? "pill on" : "pill"}>
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                  style={{ display: "none" }}
                />
                Active only
              </label>
              <label className={recent ? "pill on" : "pill"}>
                <input
                  type="checkbox"
                  checked={recent}
                  onChange={(e) => setRecent(e.target.checked)}
                  style={{ display: "none" }}
                />
                Recent (3d)
              </label>
            </>
          )}
          <button className="btn" onClick={fetchData} disabled={loading}>
            {loading ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />}
            Run
          </button>
        </div>

        {dateError && <p style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 8px" }}>{dateError}</p>}
        {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 8px" }}>{error}</p>}

        {/* Results table */}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border)",
                    textAlign: "left",
                    color: "var(--text-muted)",
                  }}
                >
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>Period</th>
                  {isBlocks && <th style={{ padding: "6px 10px", fontWeight: 600 }}>Start</th>}
                  {isBlocks && <th style={{ padding: "6px 10px", fontWeight: 600 }}>End</th>}
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>Input</th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>Output</th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>Cache Read</th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <td style={{ padding: "6px 10px" }}>
                      {r.period ?? "—"}
                      {isBlocks && !r.endTime && (
                        <span
                          style={{
                            marginLeft: 7,
                            fontSize: 11,
                            background: "var(--accent-soft)",
                            color: "var(--accent)",
                            borderRadius: "var(--r-pill)",
                            padding: "1px 7px",
                            fontWeight: 600,
                          }}
                        >
                          Active
                        </span>
                      )}
                    </td>
                    {isBlocks && (
                      <td style={{ padding: "6px 10px", color: "var(--text-muted)", fontSize: 12 }}>
                        {r.startTime ?? "—"}
                      </td>
                    )}
                    {isBlocks && (
                      <td style={{ padding: "6px 10px", color: "var(--text-muted)", fontSize: 12 }}>
                        {r.endTime ?? "—"}
                      </td>
                    )}
                    <td style={{ padding: "6px 10px", fontVariantNumeric: "tabular-nums" }}>
                      {r.inputTokens != null ? fmtNum(r.inputTokens) : "—"}
                    </td>
                    <td style={{ padding: "6px 10px", fontVariantNumeric: "tabular-nums" }}>
                      {r.outputTokens != null ? fmtNum(r.outputTokens) : "—"}
                    </td>
                    <td style={{ padding: "6px 10px", fontVariantNumeric: "tabular-nums" }}>
                      {r.cacheReadTokens != null ? fmtNum(r.cacheReadTokens) : "—"}
                    </td>
                    <td style={{ padding: "6px 10px", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {r.totalCost != null ? fmtCost(r.totalCost) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border-strong)" }}>
                  <td
                    colSpan={isBlocks ? 6 : 4}
                    style={{
                      padding: "6px 10px",
                      textAlign: "right",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Total
                  </td>
                  <td
                    style={{
                      padding: "6px 10px",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                    }}
                  >
                    {fmtCost(totalCost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {rows.length === 0 && !loading && data != null && (
          <p className="hint">No data for the selected period.</p>
        )}
      </section>
    </div>
  );
}
