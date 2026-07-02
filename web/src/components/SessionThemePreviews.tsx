export function ClassicPreview() {
  return (
    <svg viewBox="0 0 160 96" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="160" height="96" fill="var(--surface)" />
      <rect x="0" y="0" width="160" height="16" fill="var(--surface-2)" />
      <circle cx="10" cy="8" r="2.5" fill="var(--border-strong)" />
      <circle cx="19" cy="8" r="2.5" fill="var(--border-strong)" />
      <circle cx="28" cy="8" r="2.5" fill="var(--border-strong)" />
      <rect x="12" y="26" width="120" height="18" rx="6" fill="var(--surface-2)" stroke="var(--border)" />
      <rect x="20" y="32" width="70" height="3" rx="1.5" fill="var(--text-muted)" />
      <rect x="20" y="38" width="94" height="3" rx="1.5" fill="var(--text-muted)" />
      <rect x="12" y="52" width="60" height="12" rx="6" fill="var(--accent-soft)" stroke="var(--accent)" />
      <rect x="20" y="57" width="40" height="3" rx="1.5" fill="var(--accent)" />
      <rect x="12" y="72" width="110" height="3" rx="1.5" fill="var(--text-muted)" />
      <rect x="12" y="80" width="80" height="3" rx="1.5" fill="var(--text-muted)" />
    </svg>
  );
}

export function TerminalPreview() {
  return (
    <svg viewBox="0 0 160 96" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="160" height="96" fill="#0a0c10" />
      <text x="8" y="26" fontFamily="monospace" fontSize="8" fill="#5ef2a0">
        ▸
      </text>
      <rect x="18" y="22" width="96" height="3" rx="1.5" fill="#d3dae6" />
      <rect x="18" y="28" width="70" height="3" rx="1.5" fill="#d3dae6" />
      <text x="8" y="46" fontFamily="monospace" fontSize="8" fill="#5ef2a0">
        $
      </text>
      <rect x="18" y="42" width="54" height="3" rx="1.5" fill="#6b7488" />
      <rect x="10" y="56" width="2" height="14" fill="#5ef2a0" />
      <rect x="18" y="58" width="86" height="3" rx="1.5" fill="#d3dae6" />
      <rect x="18" y="64" width="60" height="3" rx="1.5" fill="#d3dae6" />
      <text x="8" y="84" fontFamily="monospace" fontSize="8" fill="#5ef2a0">
        $
      </text>
      <rect x="18" y="80" width="40" height="3" rx="1.5" fill="#6b7488" />
    </svg>
  );
}
