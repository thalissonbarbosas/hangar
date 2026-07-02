import { useCallback, useState } from "react";
import { api } from "../api";

// One item per attached file. `path` is set once the upload resolves; `status` drives the chip UI.
export interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  path?: string;
  error?: string;
}

// Owns the attachment list and the per-file upload orchestration for one compose surface.
// Surface-agnostic so NoteModal, the resume input, and the composer can all reuse it.
export function useAttachments() {
  const [items, setItems] = useState<AttachmentItem[]>([]);

  const add = useCallback((files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      setItems((prev) => [...prev, { id, name: file.name, size: file.size, status: "uploading" }]);
      api
        .uploadAttachment(file)
        .then((saved) =>
          setItems((prev) =>
            prev.map((it) => (it.id === id ? { ...it, status: "done", path: saved.path } : it)),
          ),
        )
        .catch((e) =>
          setItems((prev) =>
            prev.map((it) =>
              it.id === id ? { ...it, status: "error", error: String(e?.message ?? e) } : it,
            ),
          ),
        );
    }
  }, []);

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((it) => it.id !== id)), []);
  const reset = useCallback(() => setItems([]), []);
  // Only fully-uploaded paths are sendable; in-flight and failed items are skipped.
  const paths = useCallback(
    () => items.filter((it) => it.status === "done" && it.path).map((it) => it.path as string),
    [items],
  );

  return { items, add, remove, reset, paths };
}
