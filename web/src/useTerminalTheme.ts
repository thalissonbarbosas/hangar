import { useEffect, useState } from "react";

export type TerminalTheme = "light" | "dark";

function getInitial(): TerminalTheme {
  try {
    const saved = localStorage.getItem("hangar-terminal-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function useTerminalTheme() {
  const [terminalTheme, setTerminalTheme] = useState<TerminalTheme>(getInitial);

  useEffect(() => {
    document.documentElement.dataset.terminalTheme = terminalTheme;
    try {
      localStorage.setItem("hangar-terminal-theme", terminalTheme);
    } catch {
      /* ignore */
    }
  }, [terminalTheme]);

  const toggle = () => setTerminalTheme((t) => (t === "dark" ? "light" : "dark"));
  return { terminalTheme, toggleTerminalTheme: toggle };
}
