import { useState } from "react";

// Stable color per name for the letter-fallback avatar.
const COLORS = [
  "#4f7cff",
  "#10b981",
  "#e08e0b",
  "#ec4899",
  "#8b5cf6",
  "#0ea5e9",
  "#f43f5e",
  "#14b8a6",
  "#f59e0b",
  "#22c55e",
];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({
  name,
  src,
  size = 18,
}: {
  name: string | null;
  src?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const display = name ?? "Unassigned";
  const letter = display.trim().charAt(0).toUpperCase() || "?";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.5) } as const;

  if (src && !broken) {
    return (
      <img
        className="avatar"
        style={{ width: size, height: size }}
        src={src}
        alt={display}
        title={display}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className="avatar avatar-letter"
      style={{ ...style, background: colorFor(display) }}
      title={display}
    >
      {letter}
    </span>
  );
}
