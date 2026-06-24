# Phase 004 — Security: HIGH Priority Fixes

## Context

Three HIGH-severity items from `docs/THREAT_MODEL.md`. None require new dependencies or
architectural changes — they are targeted patches to existing code. Tackle these before the
medium/low security work and before route splitting (which would otherwise move patched code
into multiple new files).

## Trunk Alignment

All tasks ship directly on merge. No feature flags.

## Tasks

### Task 1: Restrict CORS origin + bind server to 127.0.0.1

- **Type:** security
- **Files:** `server/src/index.ts`
- **Dependencies:** None
- **Verification:** `npm run typecheck`; `curl -H "Origin: http://evil.example.com" http://localhost:3001/api/health` should be rejected (CORS header absent)
- **Feature flag:** none
- **Estimated complexity:** Low

Addresses Threats 1–3 (CSRF) and Threat 6 (accidental LAN exposure).

**CORS** — replace the open `app.use(cors())` with an origin allowlist:

```typescript
// server/src/index.ts
const WEB_ORIGIN = `http://localhost:${process.env.WEB_PORT ?? 5180}`;
app.use(
  cors({
    origin: [WEB_ORIGIN, "http://127.0.0.1:5180"],
    credentials: false,
  })
);
```

**Bind to 127.0.0.1** — update the `app.listen` call:

```typescript
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server listening on http://127.0.0.1:${PORT}`);
});
```

Both changes are in the same file — commit together.

---

### Task 2: Replace shell-string exec in `aiwf.ts`

- **Type:** security
- **Files:** `server/src/aiwf.ts`
- **Dependencies:** None (different file from Task 1 — can run in parallel)
- **Verification:** `npm run typecheck`; `npm run dev` → AI Workflow install/uninstall still works
- **Feature flag:** none
- **Estimated complexity:** Low

Addresses Threat 10 (shell injection via crafted `$HOME` path).

Find the two `execSync`/`execAsync` calls that build shell strings from `aiwfBin` and replace
with array-args variants:

```typescript
// BEFORE
execSync(`"${aiwfBin}" version`, { encoding: "utf8" });
await execAsync(`"${aiwfBin}" uninstall-all`);

// AFTER
execFileSync(aiwfBin, ["version"], { encoding: "utf8" });
await execFileAsync(aiwfBin, ["uninstall-all"]);
```

Import `execFileSync` from `child_process`; create a promisified `execFileAsync` with
`util.promisify(execFile)` if not already present.

## Execution Order

Tasks 1 and 2 touch different files — dispatch in parallel, merge as two separate PRs (or one
combined PR if preferred).

## Phase Checklist

- [ ] `app.use(cors())` replaced with origin-restricted version
- [ ] `app.listen` binds to `"127.0.0.1"` explicitly
- [ ] `execSync`/`execAsync` shell strings in `aiwf.ts` replaced with `execFileSync`/`execFileAsync`
- [ ] `npm run typecheck` passes
- [ ] Manual check: AI Workflow install/version/uninstall still works in UI
- [ ] `THREAT_MODEL.md` security controls: move items 1, 2, 3 from "Required" to "Implemented"
