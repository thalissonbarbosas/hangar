import { useRef, useState } from "react";
import { AlertCircle, Loader2, Paperclip, X } from "lucide-react";
import type { AttachmentItem } from "../hooks/useAttachments";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Drop target + click-to-browse + chip list for one compose surface. Presentational only:
// the list and upload orchestration live in useAttachments; this emits files and remove ids.
export function AttachmentBar({
  items,
  onAdd,
  onRemove,
  disabled,
}: {
  items: AttachmentItem[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`attachment-bar${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(e) => {
        // Ignore leave events fired when the cursor crosses onto a child (button/chip) — only
        // clear when it actually exits the drop zone, else the accent border flickers.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onAdd(files);
      }}
    >
      <button
        type="button"
        className="attachment-add"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip size={13} /> Drop files or click to attach
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAdd(files);
          e.target.value = "";
        }}
      />
      {items.length > 0 && (
        <ul className="attachment-chips">
          {items.map((it) => (
            <li
              key={it.id}
              className={`attachment-chip${it.status === "error" ? " failed" : ""}`}
              title={it.status === "error" ? (it.error ?? "Upload failed") : (it.path ?? it.name)}
            >
              {it.status === "uploading" ? (
                <Loader2 size={12} className="spin" />
              ) : it.status === "error" ? (
                <AlertCircle size={12} />
              ) : (
                <Paperclip size={12} />
              )}
              <span className="attachment-name">{it.name}</span>
              <span className="attachment-size">{it.status === "error" ? "failed" : humanSize(it.size)}</span>
              <button
                type="button"
                className="attachment-remove"
                onClick={() => onRemove(it.id)}
                title="Remove"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
