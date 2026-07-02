import { useEffect, useState } from "react";

export type SessionTheme = "classic" | "terminal";

function getInitial(): SessionTheme {
  try {
    const saved = localStorage.getItem("hangar-session-theme");
    if (saved === "classic" || saved === "terminal") return saved;
  } catch {
    /* ignore */
  }
  return "terminal";
}

export function useSessionTheme() {
  const [sessionTheme, setSessionTheme] = useState<SessionTheme>(getInitial);

  useEffect(() => {
    document.documentElement.dataset.sessionTheme = sessionTheme;
    try {
      localStorage.setItem("hangar-session-theme", sessionTheme);
    } catch {
      /* ignore */
    }
  }, [sessionTheme]);

  return { sessionTheme, setSessionTheme };
}
