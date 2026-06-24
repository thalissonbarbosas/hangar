import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { api } from "../api";
import { Markdown } from "./Markdown";

export interface ActiveDoc {
  title: string;
  content?: string; // pre-loaded (spec cards pass their description)
  slug?: string; // if set and content is absent, fetched from /api/aiwf/docs/:slug
}

export function DocPanel({ doc, onClose }: { doc: ActiveDoc; onClose: () => void }) {
  const [content, setContent] = useState(doc.content ?? "");
  const [loading, setLoading] = useState(!doc.content && !!doc.slug);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (doc.content) {
      setContent(doc.content);
      setLoading(false);
      return;
    }
    if (!doc.slug) return;
    setLoading(true);
    setError(null);
    api
      .aiwfDoc(doc.slug)
      .then((r) => setContent(r.content))
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [doc.slug, doc.content]);

  return (
    <div className="run-overlay" onClick={onClose}>
      <aside className="run-panel" onClick={(e) => e.stopPropagation()}>
        <header className="run-head">
          <div className="run-head-main">
            <span className="run-title">{doc.title}</span>
          </div>
          <div className="run-head-actions">
            <button className="icon-btn" onClick={onClose} title="Close">
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="run-body">
          {loading && (
            <div className="run-line muted">
              <Loader2 size={14} className="spin" /> Loading…
            </div>
          )}
          {error && (
            <div className="run-result error">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          {!loading && !error && (
            <div className="run-line text">
              <Markdown>{content}</Markdown>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
