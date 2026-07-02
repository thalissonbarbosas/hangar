import { useEffect, useState } from "react";

const KEY = "hangar-rich-text";

function getInitial(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "true") return true;
    if (saved === "false") return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function useRichText() {
  const [richText, setRichText] = useState<boolean>(getInitial);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, richText ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [richText]);

  return { richText, setRichText };
}
