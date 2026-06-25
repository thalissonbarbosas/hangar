import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "../api";
import { AiwfDocTreeNode } from "../types";
import { Markdown } from "./Markdown";

interface DocPanelProps {
  projectId: string;
  node: AiwfDocTreeNode;
  onClose: () => void;
}

// Read-only panel that fetches and renders a project doc's markdown content.
// Reuses the run-panel CSS shell so it slots in the same right-hand panel slot.
export function DocPanel({ projectId, node, onClose }: DocPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable load function so the Retry button always captures the latest projectId/node.path.
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .aiwfProjectDocContent(projectId, node.path)
      .then((r) => setContent(r.content))
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [projectId, node.path]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape key closes the panel — same pattern as modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="run-panel">
      <div className="run-head">
        <div className="run-head-main">
          <span className="run-title">{node.title}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div className="run-body doc-panel-body">
        {loading && (
          <div style={{ padding: "20px 16px", color: "var(--text-muted)", display: "flex", gap: 8 }}>
            <Loader2 size={14} className="spin" /> Loading…
          </div>
        )}
        {error && (
          <div style={{ padding: "20px 16px" }}>
            <div style={{ color: "var(--danger)", marginBottom: 10, fontSize: 13 }}>
              Failed to load: {error}
            </div>
            <button className="btn-ghost" onClick={load}>
              Retry
            </button>
          </div>
        )}
        {!loading && !error && content !== null && <Markdown>{content}</Markdown>}
      </div>
    </div>
  );
}
