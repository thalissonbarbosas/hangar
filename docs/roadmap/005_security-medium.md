# Phase 005 — Security: MEDIUM Priority Fixes

## Context

Three MEDIUM-severity items from `docs/THREAT_MODEL.md`. Depends on Phase 004 being merged
first — Task 1 touches `index.ts`, which Phase 004 also modifies.

## Trunk Alignment

All tasks ship directly on merge. Task 3 (default permission change) is the most visible to
the operator — it changes behavior on first boot for new installs and shows a UI warning.
Existing `hangar.config.json` files are unaffected (the saved value is explicit).

## Tasks

### Task 1: Restrict `/api/fs/exists` to configured repoPaths

- **Type:** security
- **Files:** `server/src/index.ts`
- **Dependencies:** Phase 004 merged
- **Verification:** `npm run typecheck`; `curl "http://localhost:3001/api/fs/exists?path=/etc/passwd"` → 400; `curl "http://localhost:3001/api/fs/exists?path=<valid-repo-path>/src"` → 200
- **Feature flag:** none
- **Estimated complexity:** Low

Addresses Threat 12 (filesystem enumeration).

```typescript
// server/src/index.ts — GET /api/fs/exists handler
app.get("/api/fs/exists", (req, res) => {
  const p = req.query.path as string;
  if (!p) return res.status(400).json({ error: "path required" });

  const repoPaths = getConfig().boards.flatMap((b) => b.repoPaths ?? []);
  const allowed = repoPaths.some((root) => path.resolve(p).startsWith(path.resolve(root)));
  if (!allowed) return res.status(400).json({ error: "path outside configured repos" });

  res.json({ exists: fs.existsSync(p) });
});
```

---

### Task 2: Config schema validation with Zod

- **Type:** security
- **Files:** `server/src/config.ts`, `server/package.json`
- **Dependencies:** Phase 004 merged
- **Verification:** `npm run typecheck`; sending a crafted `PUT /api/config` with `repoPaths: ["/etc"]` is rejected with a 400
- **Feature flag:** none
- **Estimated complexity:** Medium

Addresses Threat 11 (config injection via crafted payload).

Add `zod` as a server dependency (`npm install --prefix server zod`). Write a Zod schema for
`HangarConfig` in `config.ts` that mirrors `server/src/types.ts`:

- `boards[]` — require `key` (string), `name` (string); validate `repoPaths` entries are
  non-empty strings (not path allow-listing, just structural validation)
- `bypassPermissions` — boolean
- `isolateRuns` — boolean
- `maxTurns` — optional positive integer
- `maxBudgetUsd` — optional positive number
- `exclusiveAgents` — optional string array
- `terminal` — optional string
- `aiWorkflow.projects[]` — require `id`, `name`, `repoPath`

Call `schema.safeParse(body)` in `PUT /api/config` and `validateConfig`. Return 400 with Zod
error details on parse failure. Do not throw — return a structured error so the Settings UI
can surface it.

---

### Task 3: Default `bypassPermissions: false` + UI warning

- **Type:** security
- **Files:** `server/src/config.ts`, `hangar.config.example.json`, `web/src/components/Settings.tsx`
- **Dependencies:** Phase 004 merged (independent of Tasks 1 and 2 — different files)
- **Verification:** Fresh install with no `hangar.config.json` → permission mode defaults to gated; Settings shows amber warning when unrestricted mode is enabled
- **Feature flag:** none
- **Estimated complexity:** Low

Addresses Threat 7, 8, 13 (agent scope when unrestricted).

**`config.ts`** — change the default in `validateConfig` / `demoConfig`:
```typescript
bypassPermissions: config.bypassPermissions ?? false,  // was: ?? true
```

**`hangar.config.example.json`** — update:
```json
"bypassPermissions": false
```

**`Settings.tsx`** — add an amber inline warning below the permissions toggle when unrestricted
mode is on:
```
⚠ Unrestricted mode: agents run without approval prompts, like
  --dangerously-skip-permissions. Only use with repos you fully trust.
```

This is a behavior change for new installs only. Operators who have already saved
`bypassPermissions: true` are unaffected.

## Execution Order

1. **Parallel:** Tasks 1 and 3 (different files, no overlap)
2. **Sequential after Tasks 1 and 3:** Task 2 (touches `config.ts` — wait for Task 3's PR to
   merge first, since both modify `config.ts`)

## Phase Checklist

- [ ] `/api/fs/exists` validates path is under a configured repoPath
- [ ] `zod` installed as server dependency
- [ ] Zod schema validates `HangarConfig` shape in `PUT /api/config`
- [ ] `bypassPermissions` defaults to `false` in `validateConfig` and example config
- [ ] Settings UI shows amber warning when unrestricted mode is on
- [ ] `npm run typecheck` passes
- [ ] `THREAT_MODEL.md`: move items 4, 5, 6 from "Required" to "Implemented"
