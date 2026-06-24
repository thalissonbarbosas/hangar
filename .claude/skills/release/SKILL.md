---
name: release
description: "Cut a Hangar release — compute the next SemVer from conventional commits since the last release, update CHANGELOG.md and the root package.json version on a release/<version> branch, and open a PR. Use when the user says 'cut a release', 'create a release', 'release X.Y.Z', 'prep the changelog', 'ship a version', or wants to roll recent commits into a tagged release. After the PR merges, run again (or follow the post-merge steps) to tag main and publish the GitHub Release."
---

Cut a release for **Hangar** (`thalissonbarbosas/hangar`, a public, trunk-based repo).

A release here is two phases:

1. **Changelog PR** — a `release/<version>` branch that updates `CHANGELOG.md` and bumps the
   root `package.json` version, opened as a PR titled `Release <version>`.
2. **Tag + GitHub Release** — \*after that PR merges to `main`\_, tag the merge commit `v<version>`
   and publish a GitHub Release whose notes are the new changelog section.

The skill detects which phase to run: if a `release/<version>` PR is already open or merged for the
computed version, skip ahead to tagging; otherwise start at the changelog PR.

## Guardrails

- **`main` is trunk and must stay deployable.** Branch from an up-to-date `main`; never commit the
  release directly to `main`. The changelog change ships as a reviewable PR like any other.
- **Versioning is SemVer, derived from conventional commits** since the last `v*` tag:
  - a commit with `!` (e.g. `feat!:`) or a `BREAKING CHANGE:` footer → **major**
  - any `feat:` → **minor**
  - otherwise (`fix:`, `perf:`, `refactor:`, …) → **patch**
  - **0.x caveat:** while the version is `0.y.z`, a breaking change bumps the **minor** (→ `0.(y+1).0`),
    not the major — pre-1.0 the public API is allowed to move. State the computed version and the
    reason, and let the user override before writing anything.
- **The root `package.json` is the single source of truth for the version.** Do **not** touch
  `server/package.json` or `web/package.json` — they intentionally stay at `0.1.0` and aren't part of
  release versioning.
- **The product is Hangar.** Never reintroduce the old name "FleetView" in changelog text.
- **PR title is plain sentence case, no type prefix** (repo convention): `Release 0.9.0` — not
  `chore(release): 0.9.0` and not `release/0.9.0: …`. The _commit_ still uses a conventional prefix.
- **Don't bypass hooks** (`--no-verify`). Prettier/lint-staged will reformat `CHANGELOG.md` on commit;
  let it. If a hook fails, fix the cause and commit again.
- **Tag only a merged commit.** Never push a `v*` tag for a release whose PR hasn't merged to `main`.
- **Tag format is `v<version>`** (e.g. `v0.9.0`). The pre-existing `bundled-0.4.0` tag is legacy and
  not part of this scheme — ignore it for "last release" detection.

## Steps

### Phase 1 — Changelog PR

1. **Preconditions.** Confirm the working tree is clean and you're on `main`:

   ```
   git status --porcelain && git rev-parse --abbrev-ref HEAD
   git pull --ff-only
   ```

   If the tree is dirty or you're not on `main`, stop and tell the user.

2. **Find the last release.** The latest version tag:

   ```
   git describe --tags --match 'v*' --abbrev=0 2>/dev/null
   ```

   If there is none, this is the **first release** — the range is the full history and the current
   `package.json` version is the baseline.

3. **Collect commits** since that tag (or all commits, first release). Use first-parent so squashed
   PRs read as one line each:

   ```
   git log <lastTag>..HEAD --first-parent --pretty='%s%n%b%x00'
   ```

   Parse each commit's conventional prefix and `!`/`BREAKING CHANGE:` markers.

4. **Compute the next version** per the rules in Guardrails, starting from the root
   `package.json` version. Announce it to the user with the bump reason and the list of commits that
   drove it, e.g. _"3 feats + 5 fixes since v0.8.0 → minor bump → **0.9.0**. Override?"_ Wait for
   confirmation (accept an explicit override version).

5. **Create the branch:**

   ```
   git switch -c release/<version>
   ```

6. **Refresh README screenshots.** Run the screenshots script so the release PR ships
   up-to-date visuals alongside the changelog:

   ```
   npm run screenshots
   ```

   This starts the demo server, drives Playwright through the 8 key UI states, and saves PNGs
   to `docs/screenshots/`. If it fails (Playwright not installed, port conflict, etc.) print the
   error, skip this step, and continue — screenshots are best-effort; they do not block the
   release. If Playwright's Chromium browser has never been installed, the error message will say
   so; the user can run `npx playwright install chromium` and re-run `npm run screenshots`
   manually.

   Stage screenshots only if the script succeeded:

   ```
   git add docs/screenshots/
   ```

7. **Update `CHANGELOG.md`** (create it if missing) in [Keep a Changelog](https://keepachangelog.com)
   format. Insert a new section directly under the header, newest first. Get the date from
   `date +%F`. Group entries by category and write them as human-readable lines (rephrase terse
   commit subjects into clear past-tense changes; drop noise like `chore: retrigger CI`,
   merge commits, and pure formatting/test commits unless notable):

   ```markdown
   ## [<version>] - <YYYY-MM-DD>

   ### Added # from feat:

   ### Changed # behaviour changes, refactors that are user-visible

   ### Fixed # from fix:

   ### Security # from security: / security-relevant fixes
   ```

   Omit empty categories. If the file is new, prepend the standard preamble:

   ```markdown
   # Changelog

   All notable changes to this project are documented in this file.

   The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
   and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
   ```

8. **Bump the version** in the root `package.json` to `<version>` (edit the `"version"` field only).

9. **Commit, push, open the PR.** Use a conventional commit but a plain PR title:
   ```
   git add CHANGELOG.md package.json
   git commit -m "chore(release): v<version>"
   git push -u origin release/<version>
   gh pr create --base main --title "Release <version>" \
     --body "<summary + the new CHANGELOG section + a note that tagging happens after merge>"
   ```
   Report the PR URL. Remind the user that CI (test, typecheck, build, lint, format) must pass and
   the PR must merge before Phase 2.

### Phase 2 — Tag + GitHub Release (after the PR merges)

Run these once the `Release <version>` PR is merged to `main`.

1. **Sync main and confirm the merge:**

   ```
   git switch main && git pull --ff-only
   git log -1 --pretty='%s'   # expect the release merge / squash commit
   ```

   Verify `package.json` version equals `<version>` on `main`.

2. **Tag the merge commit and push the tag:**

   ```
   git tag -a v<version> -m "v<version>"
   git push origin v<version>
   ```

3. **Publish the GitHub Release** using the changelog section as notes:

   ```
   gh release create v<version> --title "v<version>" --notes "<the CHANGELOG section body>"
   ```

   For a pre-1.0 (`0.y.z`) release, add `--prerelease` only if the user wants it flagged as such;
   otherwise a normal release is fine. Report the release URL.

4. **Clean up** the merged branch:
   ```
   git branch -d release/<version> && git push origin --delete release/<version>
   ```
