---
name: smoke
description: "Boot Hangar in demo mode and verify the critical API paths work — tickets, agents, skills, runs, and the SSE stream. Use before merging any server change, when something feels broken, or as a quick sanity check. Runs typecheck first, then spins up the server and exercises the endpoints."
---

Smoke-test **Hangar** — confirm the server boots, serves demo data, and the SSE stream flows.

## Steps

### 1. Typecheck

```
npm run typecheck
```

Stop and report if typecheck fails — there's no point starting the server with broken types.

### 2. Boot demo mode

Start the server in demo mode (no Jira, no real config):

```
HANGAR_DEMO=1 npm run dev:server &
SERVER_PID=$!
```

Poll until it's up (up to 15 s):

```bash
for i in $(seq 1 15); do
  curl -sf http://localhost:3001/api/config > /dev/null && break
  sleep 1
done
```

If it doesn't come up in 15 s, kill the process, report the failure, and stop.

### 3. Exercise the critical endpoints

Run all of these and report the status code + a brief summary of the payload for each:

| Endpoint                      | What to check                                                 |
| ----------------------------- | ------------------------------------------------------------- |
| `GET /api/config`             | returns `{ boards: [...] }` with at least one board           |
| `GET /api/tickets?board=DEMO` | returns an array of demo tickets (expect 6+)                  |
| `GET /api/agents`             | returns an array (may be empty if no agents dir)              |
| `GET /api/skills`             | returns an array of skills                                    |
| `GET /api/runs`               | returns seeded demo runs (array with at least one `done` run) |

For each, note the HTTP status code. A 4xx/5xx is a failure; report it clearly.

### 4. Verify the SSE stream

Pick the first run from `GET /api/runs` that has state `done`. Connect to its SSE stream:

```
curl -sf --max-time 3 http://localhost:3001/api/runs/<id>/stream
```

Expect to see at least one `data:` line. If the stream opens and emits data, it passes.
If the run id doesn't exist or the stream returns nothing, report it.

### 5. Tear down

Kill the server:

```
kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
```

### 6. Report

Print a pass/fail summary:

```
SMOKE RESULTS
─────────────
typecheck       ✓ / ✗
server boot     ✓ / ✗
GET /api/config       ✓ / ✗
GET /api/tickets      ✓ / ✗
GET /api/agents       ✓ / ✗
GET /api/skills       ✓ / ✗
GET /api/runs         ✓ / ✗
SSE stream            ✓ / ✗
─────────────
Overall: PASS / FAIL
```

Include a one-sentence note for each failure. If everything passes, say so and stop — no
unnecessary detail.
