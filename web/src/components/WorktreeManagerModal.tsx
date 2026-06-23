import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, GitBranch, Loader2, Trash2, X } from "lucide-react";
import { api } from "../api";
import { Ticket, WorktreeEntry } from "../types";

// Modal listing active task worktrees for an AIWF project or Jira board.
// contextId: "aiwf-<projectId>" or "jira-<boardKey>" — drives which API endpoints to call.
export function WorktreeManagerModal({
  contextId,
  title,
  onClose,
}: {
  contextId: string;
  title: string;
  onClose: () => void;
}) {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingAll, setRemovingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<WorktreeEntry | null>(null);

  const isAiwf = contextId.startsWith("aiwf-");
  const id = contextId.slice(5); // "aiwf-" and "jira-" are both 5 chars

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    (isAiwf ? api.listAiwfWorktrees(id) : api.listJiraWorktrees(id))
      .then((r) => setWorktrees(r.worktrees))
      .catch(() => setWorktrees([]))
      .finally(() => setLoading(false));
  }, [isAiwf, id]);

  useEffect(() => {
    load();
  }, [load]);

  function removeOne(key: string) {
    setRemoving(key);
    setError(null);
    (isAiwf ? api.deleteAiwfWorktree(id, key) : api.deleteJiraWorktree(id, key))
      .then(() => {
        if (selectedEntry?.key === key) setSelectedEntry(null);
        load();
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setRemoving(null));
  }

  function removeAll() {
    setRemovingAll(true);
    setError(null);
    (isAiwf ? api.deleteAllAiwfWorktrees(id) : api.deleteAllJiraWorktrees(id))
      .then(() => {
        setSelectedEntry(null);
        load();
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setRemovingAll(false));
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl aiwf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Worktrees — {title}</span>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="wt-manager-body">
          {loading ? (
            <div className="wt-manager-state">
              <Loader2 size={16} className="spin" />
            </div>
          ) : worktrees.length === 0 ? (
            <div className="wt-manager-state">No active task worktrees for this project.</div>
          ) : (
            <table className="wt-manager-table">
              <thead>
                <tr>
                  <th>Card</th>
                  <th>Branch</th>
                  <th>Path</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {worktrees.map((wt) => (
                  <tr
                    key={wt.key}
                    className={`wt-manager-row${selectedEntry?.key === wt.key ? " selected" : ""}`}
                    onClick={() => setSelectedEntry(wt.key === selectedEntry?.key ? null : wt)}
                  >
                    <td>
                      <span className="card-key">{wt.key}</span>
                    </td>
                    <td>
                      <code className="wt-branch">{wt.taskBranch}</code>
                    </td>
                    <td className="wt-path" title={wt.worktreePath}>
                      {wt.worktreePath}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="icon-btn"
                        title="Remove worktree"
                        disabled={removing === wt.key || removingAll}
                        onClick={() => removeOne(wt.key)}
                      >
                        {removing === wt.key ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {error && <div className="wt-manager-error">{error}</div>}

        <div className="modal-actions">
          {worktrees.length > 0 && (
            <button className="btn-ghost" disabled={removingAll || removing !== null} onClick={removeAll}>
              {removingAll ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
              Remove all
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {selectedEntry && (
        <WtCardSidebar
          entry={selectedEntry}
          projectId={isAiwf ? id : null}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </div>,
    document.body,
  );
}

function WtCardSidebar({
  entry,
  projectId,
  onClose,
}: {
  entry: WorktreeEntry;
  projectId: string | null; // non-null = AIWF; fetch card data
  onClose: () => void;
}) {
  const [card, setCard] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(!!projectId);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .getAiwfCard(projectId, entry.key)
      .then((r) => setCard(r.ticket))
      .catch(() => setCard(null))
      .finally(() => setLoading(false));
  }, [projectId, entry.key]);

  const history = card?.history ?? [];

  return (
    <div className="wt-card-sidebar" onClick={(e) => e.stopPropagation()}>
      <div className="wt-card-sidebar-head">
        <div className="wt-card-sidebar-head-main">
          <span className="card-key">{entry.key}</span>
          {card && <span className="wt-card-sidebar-title">{card.summary}</span>}
        </div>
        <button className="icon-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="wt-card-sidebar-body">
        {loading ? (
          <div className="wt-manager-state">
            <Loader2 size={14} className="spin" />
          </div>
        ) : (
          <>
            {card && (
              <div className="wt-card-sidebar-meta">
                <span>
                  <strong>Status</strong>
                  {card.status}
                </span>
                <span>
                  <strong>Kind</strong>
                  {card.kind ?? "thread"}
                </span>
                {card.skill && (
                  <span>
                    <strong>Skill</strong>/{card.skill}
                  </span>
                )}
              </div>
            )}

            <div className="wt-card-sidebar-section">
              <strong>Worktree</strong>
              <div className="wt-card-sidebar-worktree">
                <span>
                  <GitBranch
                    size={11}
                    style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }}
                  />
                  <code>{entry.taskBranch}</code>
                </span>
                <code>{entry.worktreePath}</code>
              </div>
            </div>

            {card && (
              <div className="wt-card-sidebar-section">
                <strong>History</strong>
                {history.length === 0 ? (
                  <span className="wt-card-sidebar-empty">No runs yet</span>
                ) : (
                  history.map((h, idx) => (
                    <div key={idx} className="wt-card-sidebar-hist-row">
                      <CheckCircle2 size={11} />
                      <span>
                        {h.phase} · /{h.skill}
                      </span>
                      {h.summary && <span style={{ color: "var(--text-faint)" }}>{h.summary}</span>}
                      <span className="wt-card-sidebar-hist-time">{new Date(h.at).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
