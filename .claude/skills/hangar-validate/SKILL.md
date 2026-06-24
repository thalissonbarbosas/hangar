---
name: hangar-validate
description: "Validate a Hangar UI or server change before merging — runs typecheck, lint, starts the real dev server, opens the browser, and outputs a focused visual checklist based on what changed. Use before merging any design, UI, or server change."
---

Validate the current branch. Does not modify any files or commit anything.

## Steps

### 1. Identify what changed

```bash
git diff main --stat
git diff main --name-only
```

Save the list of changed files — used in Step 4 to generate the visual checklist.

### 2. Run typecheck + lint

```bash
npm run typecheck
npm run lint -- --max-warnings=2
```

**If typecheck fails, stop here.** Report the errors and tell the user to fix them — a broken build is not worth inspecting.

Report ✅/❌ for each check.

### 3. Start the dev server and open the app

```bash
npm run dev
```

Then open the browser:

```bash
open http://localhost:5180
```

This starts the real Hangar instance (with the user's actual Jira boards and config). The user will inspect the UI themselves.

Tell the user: "Server is running at http://localhost:5180 — check the items in the visual checklist below, then tell me when you're done."

**Wait for the user to confirm they've finished inspecting before continuing.**

### 4. Generate visual checklist

Based on the changed files from Step 1, output only the relevant rows:

| Changed file                           | What to verify                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `web/src/styles.css`                   | Accent color (buttons, active states, run tags, links) in **both** themes; borders; spacing |
| `web/src/components/Board.tsx`         | Card rendering; run-state left borders (active/awaiting/done); column headers; drag         |
| `web/src/components/Settings.tsx`      | Settings panel layout; permission toggle and any warning banner                             |
| `web/src/components/RunPanel.tsx`      | Run overlay; SSE output area; cost/branch sub-bar                                           |
| `web/src/components/SessionsView.tsx`  | Session rows; run-state badges; any new action buttons                                      |
| `web/src/components/AiWorkflow.tsx`    | aiwf board; card columns; worktree/checkout UI                                              |
| `web/src/components/AiwfDocsModal.tsx` | Docs browser modal; tab layout                                                              |
| `server/src/index.ts`                  | No visual check — typecheck + `/smoke` sufficient                                           |
| `server/src/config.ts`                 | No visual check — typecheck sufficient                                                      |
| `server/src/aiwf.ts`                   | No visual check — typecheck sufficient                                                      |
| `server/src/store.ts`                  | No visual check — typecheck sufficient                                                      |
| `server/src/sessions.ts`               | No visual check — run a session manually to verify behavior                                 |

To check both themes: open Settings → toggle the theme switch, or press the theme button in the topbar.

### 5. Report summary

After the user confirms the visual check, report:

```
## Validation Report — <branch name>

**Changed files:** <list from Step 1>

### Checks
- Typecheck: ✅ / ❌ <error summary>
- Lint:      ✅ / ❌ <warning/error count>

### Visual Checklist
<rows from Step 4 relevant to changed files, with ✅/❌ based on user feedback>

### Result
✅ Checks pass — ready to merge
❌ Fix failures before merging
```
