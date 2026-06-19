---
name: config-field
description: "Add a new field to HangarConfig correctly — all five touch-points in the right order. Use when adding any new top-level config option: the field must land in the server type, validation, save logic, web type, Settings UI, and README simultaneously. Args: the field name and a one-line description of what it does."
---

Add a new field to **Hangar**'s config, touching every required location so nothing is half-wired.

The five mandatory touch-points, in order:

1. **`server/src/types.ts`** — the authoritative type (`HangarConfig`)
2. **`server/src/config.ts`** — validation (`validateConfig`) and serialisation (`saveConfig`)
3. **`web/src/types.ts`** — the mirrored web type (`FullConfig`)
4. **`web/src/components/Settings.tsx`** — the UI control
5. **`README.md`** — user-facing documentation

## Steps

### 0. Understand the field

Read the args. Determine:

- The TypeScript type (boolean, number, string, string[], or an interface)
- Whether it's optional (almost always yes — keep backwards-compat with existing configs)
- The default value / fallback when absent
- Whether it's relevant to the Settings UI (most fields are; skip only if it's dev-internal)

### 1. `server/src/types.ts` — add to `HangarConfig`

Add the field with its type and a JSDoc comment explaining what it controls. Keep the comment
terse — one line max. Follow the existing optional-field style:

```ts
/** One-line description. */
myField?: SomeType;
```

### 2. `server/src/config.ts` — wire validation and persistence

**`validateConfig`**: if the field has required constraints (e.g. must be positive, must not be
empty when present), add a guard. Optional fields with sensible defaults don't need validation.

**`saveConfig`**: add a spread entry to the `clean` object using the same conditional pattern as
existing fields. The pattern is:

- Boolean: `...(typeof raw.myField === "boolean" ? { myField: raw.myField } : currentConfig?.myField !== undefined ? { myField: currentConfig.myField } : {})`
- Number (positive sets, 0 clears, undefined preserves): mirror the `maxTurns`/`maxBudgetUsd` pattern
- String (non-empty sets, "" clears, undefined preserves): mirror the `terminal` pattern
- Array: mirror the `exclusiveAgents` pattern (trim + filter)

The rule: **an explicit value from `raw` wins; otherwise preserve `currentConfig`; otherwise omit
(so the key isn't written to disk unless set)**.

### 3. `web/src/types.ts` — mirror in `FullConfig`

Add the identical field + type. The web `FullConfig` is a subset of the server `HangarConfig`
(it never includes server-only fields like resolved paths). Keep it in sync.

### 4. `web/src/components/Settings.tsx` — add a UI control

Follow the existing control patterns:

- Boolean toggle → find the `isolateRuns` or `bypassPermissions` section; add an analogous `<label>` + `<input type="checkbox">` block
- Number input → find the `maxTurns`/`maxBudgetUsd` section; add an analogous `<input type="text" inputMode="numeric">` block
- String input → add a text `<input>` wired to local state, calling `api.saveConfig` on blur/submit

Each control should:

1. `useEffect` to load the initial value from `api.config()`
2. Call `api.saveConfig({ ...latest, myField: value })` on change
3. Show a brief label + helper text describing the field

### 5. `README.md` — document it

Find the configuration reference section (search for nearby fields like `maxTurns`, `bypassPermissions`).
Add a one-liner row or bullet describing the new field, its type, default, and what it does.

### 6. `hangar.config.example.json` (conditional)

If the field should be visible to new users setting up Hangar for the first time, add it
(commented out or with a sensible default) to `hangar.config.example.json`. Skip if it's
optional and the default is always correct.

### 7. Verify

Run typecheck before calling it done:

```
npm run typecheck
```

Fix any errors before reporting completion. List all files you modified.
