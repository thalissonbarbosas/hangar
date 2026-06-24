---
name: hangar-validate
description: "Validate a Hangar UI or server change before merging — runs typecheck, lint, captures screenshots in both light and dark mode, and outputs a focused visual checklist based on what changed. Use before merging any design, UI, or server change."
---

Validate the current branch. Does not modify any files or commit anything.

## Steps

### 1. Identify what changed

```bash
git diff main --stat
git diff main --name-only
```

Save the list of changed files — used in Step 5 to generate the visual checklist.

### 2. Run typecheck + lint

```bash
npm run typecheck
npm run lint -- --max-warnings=2
```

**If typecheck fails, stop here.** Report the errors and tell the user to fix them — screenshots on a broken build are misleading.

Report ✅/❌ for each check.

### 3. Capture screenshots in light + dark mode

```bash
npm run validate
```

This kills any running processes on ports 5180 and 3001, starts a fresh demo server (`HANGAR_DEMO=1`), captures board/sessions/settings in both light and dark mode, then shuts down. Output lands in `docs/screenshots/validation/`.

If Playwright's Chromium hasn't been installed yet, the script will error with a clear message. Run `npx playwright install chromium` and re-run.

### 4. Open the screenshots

```bash
open docs/screenshots/validation/
```

### 5. Generate visual checklist

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

### 6. Report summary

```
## Validation Report — <branch name>

**Changed files:** <list from Step 1>

### Checks
- Typecheck: ✅ / ❌ <error summary>
- Lint:      ✅ / ❌ <warning/error count>

### Screenshots
docs/screenshots/validation/
  light/board.png   light/sessions.png   light/settings.png
  dark/board.png    dark/sessions.png    dark/settings.png

### Visual Checklist
<rows from Step 5 relevant to changed files>

### Result
✅ Checks pass — review screenshots, then merge
❌ Fix failures before merging
```
