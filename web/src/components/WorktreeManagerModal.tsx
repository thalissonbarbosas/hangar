import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Trash2, X } from "lucide-react";
import { api } from "../api";
import { WorktreeEntry } from "../types";

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
      .then(() => load())
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setRemoving(null));
  }

  function removeAll() {
    setRemovingAll(true);
    setError(null);
    (isAiwf ? api.deleteAllAiwfWorktrees(id) : api.deleteAllJiraWorktrees(id))
      .then(() => load())
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setRemovingAll(false));
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg aiwf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Worktrees — {title}</span>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

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
                <tr key={wt.key}>
                  <td>
                    <span className="card-key">{wt.key}</span>
                  </td>
                  <td>
                    <code className="wt-branch">{wt.taskBranch}</code>
                  </td>
                  <td className="wt-path" title={wt.worktreePath}>
                    {wt.worktreePath}
                  </td>
                  <td>
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
    </div>,
    document.body,
  );
}
