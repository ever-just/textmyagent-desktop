# TextMyAgent Desktop — Repo Restructure Implementation Plan

> **Status:** Draft v2 — gap-audited against `SCALE_ARCHITECTURE_PLAN.md`, CI v2.2.4, and web research
> **Scope:** 24 sequential steps across 5 phases
> **Constraint:** Every step must leave the repo in a passing-tests, buildable state
> **Baseline:** v2.3.0 (`c98624f`) · 122 tracked files · 229 tests passing · 10 test files

---

## Gap Analysis (What This v2 Plan Fixes vs v1)

This plan was gap-audited against:
1. `docs/SCALE_ARCHITECTURE_PLAN.md` (new, 541 lines) — scale work targeting same files
2. `docs/SCALE_RESEARCH_FINDINGS.md` (new, 386 lines) — research doc that informed the scale plan
3. v2.3.0 + v2.2.4 commits — agent behavior fixes and x64 Rosetta 2 CI
4. Web research on `npm workspaces` + `electron-builder` interop (GitHub [#7103](https://github.com/electron-userland/electron-builder/issues/7103))

### Gaps identified and addressed

| # | Gap | Resolution |
|---|-----|-----------|
| 1 | Plan didn't know about `SCALE_ARCHITECTURE_PLAN.md` touching the same files (`LocalLLMService`, `AgentService`, `PromptBuilder`, `database.ts`) | Added **Sequencing** section below; restructure happens BEFORE scale work |
| 2 | Step 2 deleted 13 stale docs but the 2 new SCALE docs are also potentially "stale" once scale work lands | Explicit decision: retain `SCALE_ARCHITECTURE_PLAN.md` (living), delete `SCALE_RESEARCH_FINDINGS.md` after scale Phase 1 is shipped (it's superseded by the plan) |
| 3 | npm workspaces + electron-builder has known issues ([#7103](https://github.com/electron-userland/electron-builder/issues/7103)) | Added **Step 7a: Validate packaged build** with rollback criteria before committing workspace change |
| 4 | x64 Rosetta 2 CI build (v2.2.4, commit `c628a51`) wasn't accounted for — CI edits in Step 7 could break it | Added explicit instruction in Step 7 to preserve `architecture: x64` Rosetta setup in `build-mac-x64` job |
| 5 | Route split (Step 10) didn't reserve space for scale plan's `/api/metrics` endpoint | Added `metrics.ts` as a planned route file in Step 10 |
| 6 | File rename (Step 12) missed new v2.3.0 test files | Already added `tool-call-stripping.test.ts` and `behavior-simulation.test.ts` |
| 7 | No ADRs (Architecture Decision Records) for kebab-case, workspace choice, or "no KV quantization" | Added **Step 0: Seed `docs/adr/`** with 4 initial records |
| 8 | No pre-commit enforcement — naming / secrets can regress after restructure | Added **Phase 5: Guardrails** (Steps 21-22) with lint-staged + gitleaks |
| 9 | No version bump guidance for the restructure itself | Added **Step 23: Bump to v2.4.0** since workspaces + route split is user-visible build-system change |
| 10 | No rollback plan per phase | Added "Rollback" subsection to high-risk steps (7, 10, 12) |
| 11 | `electron-builder.yml` `files: dashboard/out/**/*` glob needs re-verification after workspace hoist | Added explicit file-pattern check in Step 8 |
| 12 | `dev:dashboard` and `build:dashboard` scripts in root `package.json` still use `cd dashboard &&` | Added explicit script migration to Step 7 Action 7 |
| 13 | `electron-rebuild` in CI may resolve differently under workspaces | Added smoke-check in Step 7 verification |
| 14 | Summary table claimed "5 versions" but actually 6 (two `1.7.0` lines) | Corrected in Step 4 (already done) |
| 15 | No guidance on how to handle the untracked `docs/REPO_RESTRUCTURE_PLAN.md` itself | Added note: commit as first action in Step 0 |

### Sequencing: Restructure vs Scale Work

**Decision: Restructure-first.** Rationale:

- Scale plan Phase 1A modifies `LocalLLMService.ts` constructor (pool sizing). Easier to edit a 642-line file than split it AND add features.
- Scale plan Phase 2 adds `summarizeBeforeEviction()` which touches `MemoryService.saveSummary()`. Naming-standardization (Step 12) would rename `MemoryService.ts` → `memory-service.ts` — doing this AFTER scale work means rewriting import paths in fresh code.
- Scale plan Phase 3C adds a `/api/metrics` endpoint. Easier to add to a split `metrics.ts` than to the 830-line `dashboard.ts`.
- Merge-conflict surface: concurrent work would collide on 4 files. Sequential work has no conflicts.

**Recommended order:**
1. ✅ This restructure plan (Phases 0-4, ~3-5 days)
2. Tag `v2.4.0` — clean foundation
3. Scale plan Phase 1 (adaptive sizing)
4. Scale plan Phase 2 (auto-summarization)
5. Scale plan Phase 3 (metrics + queue)
6. Tag `v2.5.0`

---

## Recent Changes Since Audit (v2.2.2 → v2.3.0)

These changes were made between the audit and this plan. The plan accounts for them.

### v2.3.0 — Agent Behavior Fixes (5 fixes, 2 new test files, +1,100 lines)

| Fix | Files Modified | Summary |
|-----|---------------|----------|
| **Tool call text leak** | `LocalLLMService.ts`, `MessageFormatter.ts`, `AgentService.ts` | Two-layer defense: `stripAndExecuteRawToolCalls()` in LLM service + safety-net regex in formatter. Gemma 4 raw tool tokens no longer leak to iMessage. |
| **Multi-message splitting** | `MessageFormatter.ts`, `PromptBuilder.ts`, `database.ts` | Enabled by default. `maxChunks` 1→3, `hardMaxChars` 500→1200, prompt no longer says "never split." |
| **Memory system** | `PromptBuilder.ts` | Prompt now instructs model to **automatically** call `save_user_fact` for personal details. |
| **Typing delay** | `AgentService.ts` | Reduced from 800–3000ms to 200–1000ms (scale 15→8 ms/char). |
| **Inference telemetry** | `LocalLLMService.ts`, `AgentService.ts` | `durationMs` in `LLMResponse`, logged as `inferenceDurationMs`. |

| New Test Files | Tests | Lines |
|----------------|-------|-------|
| `ToolCallStripping.test.ts` | 20 | 269 |
| `BehaviorSimulation.test.ts` | 24 | 690 |

### v2.2.3–v2.2.4 — CI/CD Fixes (⚠️ Must be preserved)

| Commit | Summary |
|--------|---------|
| `c628a51` | **x64 build restored** via Rosetta 2 on `macos-14` runner (Intel `macos-13` runners deprecated). `architecture: x64` in `setup-node` makes `process.arch` report x64. |
| `00a01e4` | Full x64 job re-added with all arm64 fixes (git clone llama.cpp, correct paths, Metal GPU, temp .p8 file handling). |
| `0b14bd3` | `getLlama('lastBuild')` for custom binary, `useMmap: false` to prevent SIGBUS, per-request context creation. |
| `1e48148` | Safe `fs.statSync` in tests, added `statSync` mock. |
| Previous | Series of CI fixes: GITHUB_TOKEN passthrough, `--ignore-scripts` + selective rebuild, temp .p8 file for notarytool. |

### Impact on This Plan

- **Version** is now `2.3.0` (root) — dashboard still `2.1.0` (drift widened)
- **Test count** is now **229** across **10** test files (was 183/8 at audit time)
- **x64 build is restored** — README Intel download links are valid again (but point to stale v2.2.0)
- **`poc/` was cleaned** in commit `1bc58f6` (still exists as empty untracked dir)
- `LocalLLMService.ts` grew from ~510 → 642 lines (new `stripAndExecuteRawToolCalls`)
- `AgentService.ts` grew from ~540 → 658 lines (new guards, timing)
- `MessageFormatter.ts` grew from ~280 → 372 lines (tool call safety net)
- **`dashboard.ts` route file is still 830 lines** — untouched, still needs splitting
- **`database.ts` is still 574 lines** — untouched, still needs splitting
- **Fallback version `'1.7.0'` appears on TWO lines now** (dashboard.ts:38 and :85)
- **x64 Rosetta build in `release.yml` uses `architecture: x64`** — do NOT remove when editing workflow in Step 7

---

## Pre-Flight Checklist

Before beginning any work:

```bash
# 1. Ensure clean working tree
git status  # Must show "nothing to commit, working tree clean"

# 2. Create a long-lived branch for the entire restructure
git checkout -b refactor/repo-restructure

# 3. Verify baseline — all tests pass and app builds
npm test                          # Must pass all 229 tests
npm run build                     # Must succeed (tsc + next build)
cd dashboard && npm run build     # Must produce dashboard/out/

# 4. Record baseline metrics for comparison
npm test 2>&1 | tail -5           # Note: 229 tests passed
wc -l $(git ls-files) | tail -1   # Note: total line count
git ls-files | wc -l              # Note: total file count (122)
```

**If any of the above fail, fix them before proceeding.**

---

## Phase 1: Security & Cleanup (Steps 1–6)

These steps remove stale content and fix security issues. Zero risk to runtime behavior.

---

### Step 1: Remove `.env` from Git tracking

**Why:** `.env` contains `APPLE_API_ISSUER`, `APPLE_API_KEY_ID`, `APPLE_TEAM_ID`. These are sensitive identifiers that should never be in version control.

**Actions:**

1. Create `.env.example` with placeholder values:
   ```env
   # Apple Notarization — API Key method (preferred)
   APPLE_API_ISSUER=your-issuer-uuid-here
   APPLE_API_KEY_ID=YOUR_KEY_ID
   # APPLE_API_KEY_PATH is optional — notarytool searches ~/.appstoreconnect/private_keys/ and ~/private_keys/ automatically

   # Apple Notarization — Team ID (used for Apple ID fallback and code signing)
   APPLE_TEAM_ID=YOUR_TEAM_ID
   ```

2. Remove `.env` from Git tracking (keeps local file):
   ```bash
   git rm --cached .env
   ```

3. Verify `.env` is in `.gitignore`:
   - Open `.gitignore` — confirm `.env` is listed (it already is on line 31)
   - If missing, add it as the first entry under the `# Environment` section

4. Commit:
   ```bash
   git add .env.example .gitignore
   git commit -m "security: remove .env from tracking, add .env.example"
   ```

**Verification:**
```bash
git ls-files .env          # Must return empty (not tracked)
ls -la .env                # Must still exist locally
cat .env.example           # Must show placeholders, not real values
npm test                   # Must still pass
```

---

### Step 2: Delete 13 stale documentation files

**Why:** 7,893 lines of historical-only documents that reference stale code (`ClaudeService.ts`, Anthropic API) and confuse contributors.

**Actions:**

Delete these files in a single commit:

```bash
git rm docs/AGENT_ARCHITECTURE_AUDIT.md
git rm docs/AGENT_RESEARCH.md
git rm docs/AGENT_UPGRADE_PLAN.md
git rm docs/CODEX_AUDIT_FINDINGS.md
git rm docs/DESIGN_RESEARCH.md
git rm docs/IMPLEMENTATION_ROADMAP.md
git rm docs/REVISED_IMPLEMENTATION_PLAN.md
git rm docs/SECURITY_AUDIT_PLAN.md
git rm docs/SECURITY_AUDIT_SUMMARY.md
git rm docs/SECURITY_VERIFICATION_RESULTS.md
git rm docs/UI_UX_AUDIT_PLAN.md
git rm docs/UPGRADE_IMPACT_ANALYSIS.md
git rm docs/UPGRADE_REVIEW_REPORT.md
```

Commit:
```bash
git commit -m "docs: remove 13 stale historical documents (-7893 lines)

These documents were one-time audit reports, research notes, and
implementation plans that have been fully executed. They reference
stale code (ClaudeService.ts, Anthropic API) and were creating
confusion about current project state.

Retained living docs: API.md, ARCHITECTURE.md, DEPLOY.md,
DEVELOPMENT.md, SECURITY_TEST_PLAN.md, SETUP.md"
```

**Retention decisions for the two new (v2.3.0) scale docs:**

| File | Status | Reason |
|------|--------|--------|
| `docs/SCALE_ARCHITECTURE_PLAN.md` | ✅ **KEEP** (living) | Drives upcoming scale work; referenced by this plan |
| `docs/SCALE_RESEARCH_FINDINGS.md` | ⏳ **Defer-delete** | Superseded by `SCALE_ARCHITECTURE_PLAN.md`. Delete AFTER scale Phase 1 ships and the architecture is proven. Until then it documents the research trail. |

**Verification:**
```bash
ls docs/                   # Must show exactly 8 files
# Expected: API.md  ARCHITECTURE.md  DEPLOY.md  DEVELOPMENT.md  REPO_RESTRUCTURE_PLAN.md  SCALE_ARCHITECTURE_PLAN.md  SCALE_RESEARCH_FINDINGS.md  SECURITY_TEST_PLAN.md  SETUP.md
# (REPO_RESTRUCTURE_PLAN.md was committed in Step 0 below)
npm test                   # Must still pass (no code references these docs)
```

**Cross-check:** Confirm no code imports or references these deleted files:
```bash
grep -r "AGENT_ARCHITECTURE_AUDIT\|AGENT_RESEARCH\|AGENT_UPGRADE_PLAN\|CODEX_AUDIT\|DESIGN_RESEARCH\|IMPLEMENTATION_ROADMAP\|REVISED_IMPLEMENTATION\|SECURITY_AUDIT_PLAN\|SECURITY_AUDIT_SUMMARY\|SECURITY_VERIFICATION\|UI_UX_AUDIT\|UPGRADE_IMPACT\|UPGRADE_REVIEW" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.yml" .
```
Only `.windsurf/workflows/security-review.md` references `SECURITY_TEST_PLAN.md` — which is retained. All others should return empty.

---

### Step 3: Delete empty `poc/` directory and stale `electron/README.md`

**Why:**
- `poc/` is empty (untracked `.DS_Store` only) — serves no purpose
- `electron/README.md` references "BlueBubbles Server" (removed), "Node.js 18+" (now 20+), and duplicates info from root README and `docs/DEVELOPMENT.md`

**Actions:**

```bash
# poc/ is not git-tracked, so just remove from filesystem
rm -rf poc/

# electron/README.md IS tracked
git rm electron/README.md

git commit -m "chore: remove empty poc/ dir and stale electron/README.md

electron/README.md referenced BlueBubbles Server (removed), Node.js 18+
(now 20+), and duplicated content from root README and docs/DEVELOPMENT.md."
```

**Verification:**
```bash
ls -d poc/ 2>/dev/null     # Must fail (directory gone)
ls electron/README.md 2>/dev/null  # Must fail (file gone)
npm test                   # Must still pass
npm run build              # Must still succeed
```

---

### Step 4: Fix version drift across all files

**Why:** Six different version numbers exist across the repo:

| Location | Value | Should Be |
|----------|-------|-----------|
| `package.json` | `2.3.0` | ✅ Source of truth |
| `dashboard/package.json` | `2.1.0` | `2.3.0` |
| `README.md` download links | `2.2.0` | `latest` or current |
| `README.md` test badge | `155 passing` | Dynamic CI badge |
| `README.md` stack table | `Next.js 15, React 19` | `Next.js 14, React 18` |
| `docs/API.md` (3 places) | `2.0.1` | Dynamic note |
| `dashboard.ts` line 38 | `'1.7.0'` | `'unknown'` |
| `dashboard.ts` line 85 | `'1.7.0'` | `'unknown'` |

**Actions:**

1. **`dashboard/package.json`** — Change `"version": "2.1.0"` → `"version": "2.3.0"`

2. **`electron/backend/routes/dashboard.ts` lines 38 AND 85** — Change BOTH `'1.7.0'` → `'unknown'`:
   ```typescript
   // Before (two occurrences)
   version: electronApp?.getVersion() || '1.7.0',
   // After
   version: electronApp?.getVersion() || 'unknown',
   ```

3. **`docs/API.md`** — Replace all 3 hardcoded `"version": "2.0.1"` with a note: `"version": "<current app version>"`

4. **`README.md` lines 26-27** — Update download links from `2.2.0` to use the GitHub `latest` release URL pattern:
   ```markdown
   | **Apple Silicon** (M1–M4) | [DMG](https://github.com/ever-just/textmyagent-desktop/releases/latest) | [zip](https://github.com/ever-just/textmyagent-desktop/releases/latest) |
   | **Intel** | [DMG](https://github.com/ever-just/textmyagent-desktop/releases/latest) | [zip](https://github.com/ever-just/textmyagent-desktop/releases/latest) |
   ```

5. **`README.md` line 11** — Replace hardcoded `155 passing` badge with dynamic CI status badge:
   ```markdown
   <a href="https://github.com/ever-just/textmyagent-desktop/actions"><img src="https://img.shields.io/github/actions/workflow/status/ever-just/textmyagent-desktop/ci.yml?style=flat-square&label=tests" alt="Tests"></a>
   ```

6. **`README.md` line 104** — Change `npm test  # run 155 tests` → `npm test  # run tests`

7. **`README.md` line 139** — Fix stack table: `Next.js 15, React 19` → `Next.js 14, React 18` (matching `dashboard/package.json` actual deps)

Commit:
```bash
git add -A
git commit -m "fix: sync version numbers across all files

- dashboard/package.json: 2.1.0 → 2.3.0
- dashboard.ts fallback: '1.7.0' → 'unknown' (2 occurrences)
- API.md: hardcoded 2.0.1 → dynamic placeholder (3 occurrences)
- README: download links use /latest, dynamic CI badge, stack table fix"
```

**Verification:**
```bash
# Search for any remaining stale versions
grep -rn "1\.7\.0\|2\.0\.1\|2\.1\.0" --include="*.ts" --include="*.json" --include="*.md" . | grep -v node_modules | grep -v package-lock | grep -v CHANGELOG
# Should return zero results (CHANGELOG legitimately has old versions)

npm test                   # Must still pass (229 tests)
npm run build              # Must still succeed
```

---

### Step 5: Fix stale comments and references

**Why:** Several files reference Claude/Anthropic (no longer used) or contain misleading comments.

**Actions:**

1. **`resources/entitlements.mac.plist` line 26** — Change comment:
   ```xml
   <!-- Before -->
   <!-- Allow outbound network connections (for Claude API) -->
   <!-- After -->
   <!-- Allow outbound network connections (for model downloads and web requests) -->
   ```

2. **`LICENSE` line 3** — Decide on canonical attribution:
   - If company-owned: `Copyright (c) 2026 EVERJUST COMPANY`
   - If personal: keep `Weldon Makori` but add company in `electron-builder.yml` copyright
   - Must be consistent between `LICENSE` and `electron-builder.yml` line 3

3. **`README.md` download table** — Intel builds are now restored (via Rosetta 2 on `macos-14` runners, commit `c628a51`). Keep the Intel row but update download links to `/releases/latest` (done in Step 4).

4. **`electron/backend/types.ts` line 2** — Remove stale comment:
   ```typescript
   // Before
   // Pre-Phase 0.4: All subsequent phases depend on these types
   // After
   // Shared TypeScript interfaces used across backend services
   ```
   (The "Pre-Phase 0.4" refers to the completed implementation plan.)

Commit:
```bash
git add -A
git commit -m "fix: remove stale Claude/Anthropic references and outdated comments"
```

**Verification:**
```bash
# Search for any remaining Claude/Anthropic references
grep -rni "claude\|anthropic" --include="*.ts" --include="*.plist" --include="*.md" . | grep -v node_modules | grep -v CHANGELOG | grep -v package-lock
# Should return zero results

npm test                   # Must still pass
```

---

### Step 6: Phase 1 checkpoint — full verification

```bash
# File count should be ~108 (was 122, removed 14 files)
git ls-files | wc -l

# Line count reduction
wc -l $(git ls-files) | tail -1

# Full test suite
npm test

# Full build
npm run build
cd dashboard && npm run build && cd ..

# Verify docs/ has exactly 6 files
ls docs/
# Expected: API.md  ARCHITECTURE.md  DEPLOY.md  DEVELOPMENT.md  SECURITY_TEST_PLAN.md  SETUP.md

# Verify no broken references
grep -rn "AGENT_ARCHITECTURE\|CODEX_AUDIT\|DESIGN_RESEARCH\|BlueBubbles\|ClaudeService\|claude\|anthropic" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.yml" --include="*.md" . | grep -v node_modules | grep -v CHANGELOG | grep -v package-lock
# Should return zero

# Squash Phase 1 into clean commits if desired (optional)
```

---

## Phase 2: npm Workspaces & Dashboard Integration (Steps 7–9)

These steps eliminate the dual-install / dual-lockfile problem.

---

### Step 7: Add npm workspaces to root `package.json`

**Why:** Currently `dashboard/` has its own `node_modules`, its own `package-lock.json`, and requires a separate `npm install` step. npm workspaces deduplicates dependencies and unifies the install.

**Pre-work — understand current dependency overlap:**
```bash
# Check for shared deps between root and dashboard
comm -12 \
  <(jq -r '.dependencies + .devDependencies | keys[]' package.json | sort) \
  <(jq -r '.dependencies + .devDependencies | keys[]' dashboard/package.json | sort)
```

**Actions:**

1. Add `workspaces` field to root `package.json`:
   ```json
   {
     "name": "textmyagent-desktop",
     "version": "2.3.0",
     "workspaces": ["dashboard"],
     ...
   }
   ```
   Place this right after the `"version"` field.

2. Delete `dashboard/package-lock.json` (the root lockfile will manage all deps):
   ```bash
   git rm dashboard/package-lock.json
   ```

3. Delete `dashboard/node_modules/` if present:
   ```bash
   rm -rf dashboard/node_modules
   ```

4. Reinstall from root (npm will now hoist shared dependencies):
   ```bash
   rm -rf node_modules
   npm install
   ```

5. Verify the new lockfile captures dashboard deps:
   ```bash
   grep -c "dashboard" package-lock.json  # Should be > 0
   ls node_modules/.package-lock.json     # Must exist
   ```

6. Update CI workflows to remove the separate dashboard install step:

   **`.github/workflows/ci.yml`** — Remove lines 25-26:
   ```yaml
   # REMOVE these lines:
   - name: Install dashboard dependencies
     run: cd dashboard && npm ci
   ```
   `npm ci` at root will now install both.

   **`.github/workflows/release.yml`** — Same change in the `test` job (lines 26-27) and the `build-mac-arm64` job (lines 47-48).

7. Update root `package.json` build script if it runs `cd dashboard && npm run build`:
   ```json
   // If current script is:
   "build:dashboard": "cd dashboard && npm run build",
   // Change to (workspace-aware):
   "build:dashboard": "npm run build --workspace=dashboard",
   ```

Commit:
```bash
git add -A
git commit -m "build: add npm workspaces for dashboard

- Single 'npm install' installs both root and dashboard deps
- Removed dashboard/package-lock.json (root lockfile manages all)
- Updated CI workflows to remove separate dashboard install step
- Shared dependencies are now hoisted and deduplicated"
```

**Verification:**
```bash
# 1. Clean install works
rm -rf node_modules dashboard/node_modules
npm install
# Must complete without errors

# 2. Dashboard can still import its deps
node -e "require.resolve('next', { paths: ['dashboard'] })"
node -e "require.resolve('react', { paths: ['dashboard'] })"
node -e "require.resolve('swr', { paths: ['dashboard'] })"
# All must resolve without error

# 3. Dashboard build works
npm run build --workspace=dashboard
# OR: cd dashboard && npm run build
# Must produce dashboard/out/

# 4. Full app build
npm run build

# 5. Tests pass
npm test

# 6. Dev mode works (manual smoke test)
npm run dev
# Verify dashboard loads at localhost:3000
# Verify Electron window opens and connects to backend
# Ctrl+C to stop
```

---

### Step 8: Verify dashboard `next.config.js` compatibility with workspaces

**Why:** Hoisted `node_modules` can sometimes break Next.js module resolution. Need to verify.

**Actions:**

1. Check that `next.config.js` doesn't use `require.resolve` with hardcoded paths
2. Check that `dashboard/tsconfig.json` `paths` still resolve correctly:
   ```json
   "@/*": ["./*"]
   ```
   This is relative to `dashboard/` — should still work.

3. Run the dashboard in dev mode and navigate every page:
   - `/` (Dashboard)
   - `/messages`
   - `/users`
   - `/usage`
   - `/logs`
   - `/memory`
   - `/tools`
   - `/security`
   - `/settings`
   - `/setup`
   - `/permissions`

**Verification:**
```bash
cd dashboard && npx next build
# Must succeed with no errors
# Check for any "Module not found" warnings in output
```

No commit needed — this is a verification-only step.

---

### Step 9: Phase 2 checkpoint

```bash
# Verify single lockfile
ls package-lock.json           # Must exist
ls dashboard/package-lock.json # Must NOT exist

# Verify workspace setup
npm ls --workspaces 2>/dev/null | head -5

# Full test suite
npm test

# Full build
npm run build

# CI simulation (what GitHub Actions will run)
rm -rf node_modules dashboard/node_modules
npm ci
npm test
npm run build
```

---

## Phase 3: Backend Structural Improvements (Steps 10–14)

These steps split monolithic files and standardize naming. Each step is independently testable.

---

### Step 10: Split `dashboard.ts` route file (830 lines → 5-6 files)

**Why:** `electron/backend/routes/dashboard.ts` handles 25+ endpoints spanning status, config, agent control, messages, users, usage, logs, permissions, setup, model management, and persona. This violates single-responsibility.

**Pre-work — map all endpoints in `dashboard.ts`:**

Read through the file and categorize every `router.get/post/put/patch/delete` into groups:

| Group | Endpoints | Approx Lines |
|-------|-----------|-------------|
| **status** | `GET /status`, `GET /agent/status`, `GET /setup/status` | ~80 |
| **config** | `GET /config`, `PATCH /config`, `PATCH /config/persona`, `GET /config/persona`, `POST /config/persona/reset` | ~120 |
| **agent** | `POST /agent/start`, `POST /agent/stop`, `POST /agent/restart` | ~60 |
| **messages** | `GET /messages`, `GET /messages/users`, `GET /messages/user/:id` | ~80 |
| **users** | `GET /users`, `POST /users/block`, `POST /users/unblock`, `GET /users/blocked` | ~80 |
| **logs** | `GET /logs`, `GET /logs/stream` (SSE) | ~60 |
| **usage** | `GET /usage`, `GET /usage/budget` | ~60 |
| **permissions** | `GET /permissions`, `POST /permissions/request` | ~50 |
| **model** | `POST /model/download`, `GET /model/status`, `POST /model/load`, `POST /model/unload` | ~80 |

**Actions:**

1. Create new route files (one per group):

   ```
   electron/backend/routes/
   ├── status.ts        # Status, setup status, health
   ├── config.ts        # Config CRUD, persona
   ├── agent.ts         # Agent start/stop/restart
   ├── messages.ts      # Message queries (NOT the memory.ts that already exists)
   ├── users.ts         # User management, blocking
   ├── logs.ts          # Log queries, SSE stream
   ├── usage.ts         # Usage stats, budget
   ├── permissions.ts   # Permission checks/requests
   ├── model.ts         # Model download/load/unload
   ├── memory.ts        # (already exists — no change)
   ├── security.ts      # (already exists — no change)
   └── tools.ts         # (already exists — no change)
   ```

2. For each new file:
   - Move the relevant `router.get/post/...` handlers from `dashboard.ts`
   - Move only the imports that the extracted routes actually use
   - Export `default router` from each file

3. Update `server.ts` to mount all new routers:
   ```typescript
   // Before (in server.ts):
   import dashboardRoutes from './routes/dashboard';
   app.use('/api/dashboard', dashboardRoutes);

   // After:
   import statusRoutes from './routes/status';
   import configRoutes from './routes/config';
   import agentRoutes from './routes/agent';
   import messageRoutes from './routes/messages';
   import userRoutes from './routes/users';
   import logRoutes from './routes/logs';
   import usageRoutes from './routes/usage';
   import permissionRoutes from './routes/permissions';
   import modelRoutes from './routes/model';
   import memoryRoutes from './routes/memory';
   import securityRoutes from './routes/security';
   import toolsRoutes from './routes/tools';

   // Mount all under /api/dashboard (preserving existing URL structure)
   app.use('/api/dashboard', statusRoutes);
   app.use('/api/dashboard', configRoutes);
   app.use('/api/dashboard', agentRoutes);
   app.use('/api/dashboard/messages', messageRoutes);
   app.use('/api/dashboard/users', userRoutes);
   app.use('/api/dashboard', logRoutes);
   app.use('/api/dashboard', usageRoutes);
   app.use('/api/dashboard', permissionRoutes);
   app.use('/api/dashboard', modelRoutes);
   app.use('/api/dashboard/memory', memoryRoutes);
   app.use('/api/dashboard/security', securityRoutes);
   app.use('/api/dashboard/tools', toolsRoutes);
   ```

   **Critical:** The mount paths must produce the exact same full URL as before. For example, if `dashboard.ts` had `router.get('/messages', ...)`, and you mount the new router at `/api/dashboard`, the new file must keep `router.get('/messages', ...)`. If you mount at `/api/dashboard/messages`, the new file must use `router.get('/', ...)`. Choose one strategy and be consistent.

4. Keep `dashboard.ts` as a thin re-export barrel if needed by other imports:
   ```typescript
   // dashboard.ts — now just re-exports shared items
   export type { LogEntry } from '../logger';
   export { log, logBuffer } from '../logger';
   ```
   Or delete it entirely if nothing else imports from it.

5. Verify the dashboard `lib/api.ts` still hits the correct endpoints by checking every URL pattern:
   ```bash
   grep -n "request<" dashboard/lib/api.ts
   ```
   Every `request('/messages')`, `request('/config')`, etc. must match the mounted routes.

Commit:
```bash
git add -A
git commit -m "refactor: split dashboard.ts (830 lines) into 9 focused route files

Extracted: status, config, agent, messages, users, logs, usage,
permissions, model. All URL paths preserved — zero API changes.
Existing memory, security, tools routes unchanged."
```

**Verification:**
```bash
# 1. All tests pass
npm test

# 2. Build succeeds
npm run build

# 3. No 404s — test every API endpoint (start the app first)
npm run dev &
sleep 5

# Hit every endpoint that was in dashboard.ts
curl -s http://127.0.0.1:3001/api/dashboard/status | jq .
curl -s http://127.0.0.1:3001/api/dashboard/agent/status | jq .
curl -s http://127.0.0.1:3001/api/dashboard/config | jq .
curl -s http://127.0.0.1:3001/api/dashboard/messages?limit=5 | jq .
curl -s http://127.0.0.1:3001/api/dashboard/messages/users | jq .
curl -s http://127.0.0.1:3001/api/dashboard/users | jq .
curl -s http://127.0.0.1:3001/api/dashboard/usage?period=day | jq .
curl -s http://127.0.0.1:3001/api/dashboard/logs?limit=10 | jq .
curl -s http://127.0.0.1:3001/api/dashboard/permissions | jq .
curl -s http://127.0.0.1:3001/api/dashboard/model/status | jq .
curl -s http://127.0.0.1:3001/api/dashboard/setup/status | jq .
curl -s http://127.0.0.1:3001/api/health | jq .

# All must return 200 with valid JSON (not 404)
# Kill the dev server after testing
kill %1

# 4. Dashboard UI smoke test
npm run dev
# Open browser, click through every sidebar page
# Verify data loads on each page (no "Failed to fetch" errors)
```

---

### Step 11: Split `database.ts` (574 lines → database/ module)

**Why:** `database.ts` contains schema definitions, migration logic, 15+ query helper functions, and initialization code in a single file.

**Actions:**

1. Create `electron/backend/database/` directory

2. Split into focused files:

   ```
   electron/backend/database/
   ├── index.ts            # Re-exports everything (barrel file)
   ├── connection.ts       # getDatabase(), initializeDatabase(), closeDatabase()
   ├── schema.ts           # CREATE TABLE statements, migration SQL
   ├── settings.ts         # getSetting, setSetting, getSettingInt, getSettingBool, getSettingValue, seedDefaultSettings
   └── queries.ts          # Any remaining query helpers
   ```

3. Create `database/index.ts` that re-exports all public functions:
   ```typescript
   export { getDatabase, initializeDatabase, closeDatabase } from './connection';
   export { getSetting, setSetting, getSettingInt, getSettingBool, getSettingValue, seedDefaultSettings } from './settings';
   // ... any other exports
   ```

4. **Critical:** Every file that currently imports from `'../database'` or `'./database'` must continue to work. The barrel file at `database/index.ts` ensures backward compatibility:
   ```typescript
   // This import pattern must still work everywhere:
   import { getDatabase, getSetting } from '../database';
   // Node resolves '../database' → '../database/index.ts' ✓
   ```

5. Delete the original `electron/backend/database.ts` (replaced by `database/` directory).

6. Update `electron/tsconfig.json` — no changes needed, `include: ["./**/*.ts"]` already covers subdirectories.

Commit:
```bash
git add -A
git commit -m "refactor: split database.ts (574 lines) into database/ module

- connection.ts: getDatabase, initializeDatabase, closeDatabase
- schema.ts: table definitions, migrations
- settings.ts: getSetting/setSetting helpers, seedDefaultSettings
- queries.ts: remaining query helpers
- index.ts: barrel re-export (all existing imports unchanged)"
```

**Verification:**
```bash
# 1. Verify all imports still resolve
npx tsc --noEmit -p electron/tsconfig.json
# Must have zero errors

# 2. All tests pass
npm test

# 3. App starts and database initializes
npm run dev
# Check console for "Database initialized" (no errors)
# Navigate to dashboard — data loads correctly
```

---

### Step 12: Standardize file naming to kebab-case

**Why:** Three different conventions (PascalCase services, camelCase tools, kebab-case utils) create cognitive overhead. Industry standard for TypeScript/Node.js: kebab-case for all non-component files.

**Strategy:** Rename files one-at-a-time using `git mv`, then update all imports in the same commit. Do services first, then tools, then test files.

**Important:** This step has the highest risk of breaking imports. Use `tsc --noEmit` after every batch of renames.

**Actions — Part A: Rename service files:**

```bash
cd electron/backend/services

git mv AgentService.ts agent-service.ts
git mv iMessageService.ts imessage-service.ts
git mv LocalLLMService.ts local-llm-service.ts
git mv MemoryService.ts memory-service.ts
git mv MessageFormatter.ts message-formatter.ts
git mv PermissionService.ts permission-service.ts
git mv PromptBuilder.ts prompt-builder.ts
git mv RateLimiter.ts rate-limiter.ts
git mv ReminderService.ts reminder-service.ts
git mv ToolRegistry.ts tool-registry.ts
git mv TriggerService.ts trigger-service.ts
```

Then update **every import** across the codebase. Files that import services:
- `electron/main.ts`
- `electron/backend/server.ts`
- `electron/backend/routes/*.ts` (all route files)
- `electron/backend/tools/*.ts` (all tool files)
- Service files that import other services
- Test files in `__tests__/`

For each file, find and replace the import path:
```typescript
// Before:
import { agentService } from './services/AgentService';
// After:
import { agentService } from './services/agent-service';
```

Use project-wide find-and-replace (import paths only):
```
'./services/AgentService'      → './services/agent-service'
'./services/iMessageService'   → './services/imessage-service'
'./services/LocalLLMService'   → './services/local-llm-service'
'./services/MemoryService'     → './services/memory-service'
'./services/MessageFormatter'  → './services/message-formatter'
'./services/PermissionService' → './services/permission-service'
'./services/PromptBuilder'     → './services/prompt-builder'
'./services/RateLimiter'       → './services/rate-limiter'
'./services/ReminderService'   → './services/reminder-service'
'./services/ToolRegistry'      → './services/tool-registry'
'./services/TriggerService'    → './services/trigger-service'
'../services/AgentService'     → '../services/agent-service'
(repeat for all ../ relative paths used in routes/)
```

**Checkpoint A:**
```bash
npx tsc --noEmit -p electron/tsconfig.json   # Must be zero errors
npm test                                       # Must pass
```

**Actions — Part B: Rename tool files:**

```bash
cd electron/backend/tools

git mv createTrigger.ts create-trigger.ts
git mv getUserFacts.ts get-user-facts.ts
git mv saveUserFact.ts save-user-fact.ts
git mv searchHistory.ts search-history.ts
git mv setReminder.ts set-reminder.ts
git mv reactToMessage.ts react-to-message.ts
git mv waitTool.ts wait-tool.ts
```

Update imports in `electron/backend/tools/index.ts`:
```typescript
import { saveUserFact, saveUserFactDefinition } from './save-user-fact';
import { getUserFacts, getUserFactsDefinition } from './get-user-facts';
// ... etc.
```

**Checkpoint B:**
```bash
npx tsc --noEmit -p electron/tsconfig.json   # Must be zero errors
npm test                                       # Must pass
```

**Actions — Part C: Rename test files:**

```bash
cd electron/backend/services/__tests__

git mv AdvancedBehavior.test.ts advanced-behavior.test.ts
git mv AuditFixes.test.ts audit-fixes.test.ts
git mv CoreBehavior.test.ts core-behavior.test.ts
git mv LocalLLMService.test.ts local-llm-service.test.ts
git mv MessageFormatter.test.ts message-formatter.test.ts
git mv PromptBuilder.test.ts prompt-builder.test.ts
git mv RateLimiter.test.ts rate-limiter.test.ts
git mv ToolSimulation.test.ts tool-simulation.test.ts
git mv ToolCallStripping.test.ts tool-call-stripping.test.ts
git mv BehaviorSimulation.test.ts behavior-simulation.test.ts
```

Update any cross-references between test files (if test files import from each other).

Check that `vitest.config.ts` glob pattern still matches:
```typescript
include: ['electron/**/*.test.ts']   // ✓ This pattern is case-insensitive and matches kebab-case
```

**Checkpoint C:**
```bash
npm test                                       # Must pass all 229 tests
npx tsc --noEmit -p electron/tsconfig.json    # Must be zero errors
```

Commit:
```bash
git add -A
git commit -m "refactor: standardize file naming to kebab-case

Renamed all service files (PascalCase → kebab-case),
tool files (camelCase → kebab-case), and test files.
Updated all import paths across the codebase.

Convention: kebab-case for all .ts files, PascalCase for React .tsx components."
```

**Verification (comprehensive):**
```bash
# 1. No PascalCase or camelCase .ts files remain (excluding React components)
git ls-files '*.ts' | xargs -I{} basename {} | grep -E '^[A-Z]'
# Should return NOTHING

# 2. camelCase tool files gone
git ls-files electron/backend/tools/ | xargs -I{} basename {} | grep -E '^[a-z]+[A-Z]'
# Should return NOTHING

# 3. React components still PascalCase (correct)
git ls-files '*.tsx' | xargs -I{} basename {} | head
# Should show Button.tsx, Card.tsx, Sidebar.tsx, etc.

# 4. TypeScript compiles
npx tsc --noEmit -p electron/tsconfig.json

# 5. All tests pass
npm test

# 6. Full build
npm run build
```

---

### Step 13: Add route-level integration tests

**Why:** Currently zero test coverage for routes, database queries, tools, or logger. The route split (Step 10) and database split (Step 11) need test coverage to prevent regressions.

**Actions:**

1. Create `electron/backend/routes/__tests__/` directory

2. Create a test helper for route testing:
   ```
   electron/backend/routes/__tests__/test-helpers.ts
   ```
   This should:
   - Create an in-memory SQLite database (`:memory:`)
   - Mount the Express app with all routes
   - Export a `request()` function using `supertest` (add as devDependency)

3. Create test files for the most critical routes:
   ```
   electron/backend/routes/__tests__/status.test.ts      # GET /status, GET /health
   electron/backend/routes/__tests__/config.test.ts       # GET/PATCH /config
   electron/backend/routes/__tests__/messages.test.ts     # GET /messages
   ```

4. Add `supertest` as a dev dependency:
   ```bash
   npm install --save-dev supertest @types/supertest
   ```

5. Each test file should verify:
   - Correct HTTP status codes (200, 400, 404)
   - Response shape matches expected JSON structure
   - Error handling works (malformed requests)

6. Update `vitest.config.ts` to include route tests:
   ```typescript
   include: ['electron/**/*.test.ts']  // Already covers new test location
   ```

Commit:
```bash
git add -A
git commit -m "test: add integration tests for route endpoints

Added supertest-based tests for status, config, and messages routes.
Created shared test helpers with in-memory database setup."
```

**Verification:**
```bash
npm test
# Must pass all existing tests PLUS new route tests
# Note the new test count (should be 229 existing + new route tests)
```

---

### Step 14: Phase 3 checkpoint

```bash
# Full verification suite
npm test                                          # All tests pass
npx tsc --noEmit -p electron/tsconfig.json       # Zero TS errors
npm run build                                     # Build succeeds
cd dashboard && npx next build && cd ..           # Dashboard builds

# File naming audit
git ls-files '*.ts' | xargs -I{} basename {} | sort | grep -E '^[A-Z]'
# Must be empty (no PascalCase .ts files)

git ls-files '*.tsx' | xargs -I{} basename {} | sort
# Must all be PascalCase (React components)

# Route structure
ls electron/backend/routes/
# Expected: agent.ts  config.ts  logs.ts  memory.ts  messages.ts  model.ts  permissions.ts  security.ts  status.ts  tools.ts  usage.ts  users.ts

# Database module structure
ls electron/backend/database/
# Expected: connection.ts  index.ts  queries.ts  schema.ts  settings.ts

# Start app and smoke test every dashboard page
npm run dev
```

---

## Phase 4: Documentation Update (Steps 15–20)

These steps ensure all documentation reflects the new structure.

---

### Step 15: Rewrite `docs/ARCHITECTURE.md`

**Why:** Must reflect the new route structure, database module, and file naming convention.

**Actions:**

Rewrite to include:

1. **System overview diagram** (keep the existing ASCII diagram from README)

2. **Directory structure** — full annotated tree showing:
   ```
   textmyagent-desktop/
   ├── electron/                    # Electron main process + backend
   │   ├── main.ts                  # App lifecycle, window management, IPC
   │   ├── preload.ts               # Context bridge (renderer ↔ main)
   │   ├── backend/                 # Express.js API server
   │   │   ├── database/            # SQLite database layer
   │   │   │   ├── index.ts         # Barrel re-exports
   │   │   │   ├── connection.ts    # Database init/close
   │   │   │   ├── schema.ts        # Table definitions, migrations
   │   │   │   ├── settings.ts      # Settings CRUD helpers
   │   │   │   └── queries.ts       # Shared query helpers
   │   │   ├── routes/              # Express route handlers
   │   │   │   ├── status.ts        # Health, status, setup
   │   │   │   ├── config.ts        # Configuration CRUD
   │   │   │   ├── agent.ts         # Agent start/stop/restart
   │   │   │   ├── messages.ts      # Message queries
   │   │   │   ├── users.ts         # User management
   │   │   │   ├── logs.ts          # Log queries, SSE stream
   │   │   │   ├── usage.ts         # Token usage stats
   │   │   │   ├── permissions.ts   # Permission checks
   │   │   │   ├── model.ts         # LLM model management
   │   │   │   ├── memory.ts        # Memory/facts CRUD
   │   │   │   ├── security.ts      # Security events, rate limits
   │   │   │   └── tools.ts         # Tool definitions, executions
   │   │   ├── services/            # Business logic services
   │   │   │   ├── agent-service.ts
   │   │   │   ├── imessage-service.ts
   │   │   │   ├── local-llm-service.ts
   │   │   │   ├── memory-service.ts
   │   │   │   ├── message-formatter.ts
   │   │   │   ├── permission-service.ts
   │   │   │   ├── prompt-builder.ts
   │   │   │   ├── rate-limiter.ts
   │   │   │   ├── reminder-service.ts
   │   │   │   ├── tool-registry.ts
   │   │   │   └── trigger-service.ts
   │   │   ├── tools/               # AI tool implementations
   │   │   ├── server.ts            # Express app setup, middleware
   │   │   ├── logger.ts            # Logging + SSE broadcast
   │   │   └── types.ts             # Shared TypeScript interfaces
   │   └── utils/                   # Electron utilities
   │       ├── auto-updater.ts
   │       ├── secure-storage.ts
   │       └── tray.ts
   ├── dashboard/                   # Next.js frontend (workspace)
   │   ├── app/                     # App Router pages
   │   ├── components/              # React components (PascalCase)
   │   └── lib/                     # API client, hooks
   ├── resources/                   # Build resources
   │   ├── icons/                   # App icons (icns, png, svg)
   │   ├── entitlements.mac.plist
   │   └── entitlements.inherit.plist
   ├── docs/                        # Living documentation
   ├── scripts/                     # Utility scripts
   └── .github/workflows/           # CI/CD
   ```

3. **Naming conventions** section:
   - TypeScript files: `kebab-case.ts`
   - React components: `PascalCase.tsx`
   - Folders: `lowercase` or `kebab-case`
   - Exported classes/interfaces: `PascalCase`
   - Variables/functions: `camelCase`
   - Constants: `SCREAMING_SNAKE_CASE`

4. **Data flow** — Describe the request lifecycle: iMessage DB → iMessageService → AgentService → LocalLLMService → AppleScript → Messages.app

5. **npm workspaces** — Note that `dashboard/` is a workspace managed by root `package.json`

Commit:
```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: rewrite ARCHITECTURE.md to reflect new structure"
```

---

### Step 16: Update `docs/DEVELOPMENT.md`

**Actions:**

Update to reflect:

1. **Prerequisites** — Node.js 20+, npm 10+, macOS 12+
2. **Getting started** — Single `npm install` (not two separate installs)
3. **Project structure** — Reference `ARCHITECTURE.md` for the full tree
4. **Naming conventions** — Reference `ARCHITECTURE.md`
5. **Running tests** — `npm test` runs all 229 tests, mention `vitest`
6. **Adding a new route** — Step-by-step: create file in `routes/`, add handler, mount in `server.ts`, add API client function in `dashboard/lib/api.ts`, add SWR hook in `dashboard/lib/hooks.ts`
7. **Adding a new service** — Step-by-step: create `kebab-case.ts` in `services/`, export singleton, add tests
8. **Adding a new tool** — Step-by-step: create in `tools/`, register in `tools/index.ts`

Commit:
```bash
git add docs/DEVELOPMENT.md
git commit -m "docs: update DEVELOPMENT.md with new structure and conventions"
```

---

### Step 17: Update `docs/API.md`

**Actions:**

1. Update the route organization to reflect the split:
   ```
   All routes are under /api/dashboard/
   
   Status & Health:   /api/dashboard/status, /api/dashboard/health, /api/dashboard/setup/status
   Configuration:     /api/dashboard/config, /api/dashboard/config/persona
   Agent Control:     /api/dashboard/agent/start, /agent/stop, /agent/restart, /agent/status
   Messages:          /api/dashboard/messages, /messages/users, /messages/user/:id
   Users:             /api/dashboard/users, /users/block, /users/unblock, /users/blocked
   Logs:              /api/dashboard/logs, /logs/stream (SSE)
   Usage:             /api/dashboard/usage, /usage/budget
   Permissions:       /api/dashboard/permissions, /permissions/request
   Model:             /api/dashboard/model/status, /model/download, /model/load, /model/unload
   Memory:            /api/dashboard/memory/facts, /memory/summaries, /memory/stats
   Security:          /api/dashboard/security/events, /security/config, /security/rate-limits
   Tools:             /api/dashboard/tools/definitions, /tools/executions
   ```

2. Update any version numbers in example responses

3. Note which route file contains each endpoint group

Commit:
```bash
git add docs/API.md
git commit -m "docs: update API.md with split route organization"
```

---

### Step 18: Update `docs/DEPLOY.md`

**Actions:**

1. Verify all build commands still work and are documented
2. Add npm workspace context: "Dashboard is managed as an npm workspace — no separate install needed"
3. Verify notarization docs match current `notarize.js` (API key method)

Commit:
```bash
git add docs/DEPLOY.md
git commit -m "docs: update DEPLOY.md with workspace build flow"
```

---

### Step 19: Update root `README.md`

**Actions:**

1. Ensure all badges are accurate (version, tests, platform)
2. Download links match latest release
3. Stack table matches actual dependencies
4. Development section reflects single `npm install`
5. Architecture diagram still accurate
6. Link to `docs/ARCHITECTURE.md` for detailed structure

Commit:
```bash
git add README.md
git commit -m "docs: update README.md with accurate versions, badges, and commands"
```

---

### Step 20: Final verification and merge preparation

**Actions:**

1. **Full test suite:**
   ```bash
   npm test
   # Must pass ALL tests (existing + new route tests)
   ```

2. **Full build:**
   ```bash
   npm run build
   ```

3. **Clean install simulation (what CI does):**
   ```bash
   rm -rf node_modules dashboard/node_modules
   npm ci
   npm test
   npm run build
   ```

4. **TypeScript strict check:**
   ```bash
   npx tsc --noEmit -p electron/tsconfig.json
   ```

5. **File count and line count comparison:**
   ```bash
   git ls-files | wc -l
   # Compare with original 122 — should be similar or lower

   wc -l $(git ls-files) 2>/dev/null | tail -1
   # Compare with original ~40K — should be ~30K or lower
   ```

6. **Documentation completeness check:**
   ```bash
   ls docs/
   # Must have: API.md  ARCHITECTURE.md  DEPLOY.md  DEVELOPMENT.md  SECURITY_TEST_PLAN.md  SETUP.md

   # Verify no dead links in docs
   grep -rn '\[.*\](.*\.md)' docs/ README.md | grep -v http
   # Every .md reference must point to a file that exists
   ```

7. **Naming convention audit:**
   ```bash
   # No PascalCase .ts files (services, tools, tests)
   git ls-files '*.ts' | xargs -I{} basename {} | grep -E '^[A-Z]'
   # Must be empty

   # All React components still PascalCase
   git ls-files 'dashboard/components/*.tsx' | xargs -I{} basename {}
   # Must all start with uppercase
   ```

8. **No stale references:**
   ```bash
   grep -rni "claude\|anthropic\|bluebubbles\|ClaudeService" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.plist" . | grep -v node_modules | grep -v CHANGELOG | grep -v package-lock
   # Must return zero results
   ```

9. **Git log review:**
   ```bash
   git log --oneline refactor/repo-restructure --not main
   # Review all commits — should be clean, atomic, well-described
   ```

10. **Create PR:**
    ```bash
    git push origin refactor/repo-restructure
    # Create PR on GitHub with this plan as the description
    # Request review before merging to main
    ```

---

## Summary of Changes

| Metric | Before (v2.3.0) | After |
|--------|-----------------|-------|
| **Tracked files** | 122 | ~115 (removed 14, added ~7) |
| **Stale docs** | 13 files (7,893 lines) | 0 |
| **Largest route file** | 830 lines (`dashboard.ts`) | ~120 lines max |
| **Largest DB file** | 574 lines (`database.ts`) | ~200 lines max |
| **Naming conventions** | 3 (PascalCase, camelCase, kebab-case) | 2 (kebab-case + PascalCase React) |
| **`npm install` commands** | 2 (root + dashboard) | 1 (workspace) |
| **Lockfiles** | 2 | 1 |
| **Route files** | 4 (1 god file) | 12 (focused) |
| **Test files** | 10 (229 tests, services only) | 10+ (229+ tests, services + routes) |
| **`.env` in git** | Yes ⚠️ | No ✅ |
| **Version consistency** | 6 different values | 1 source of truth |
| **x64 (Intel) build** | Restored via Rosetta 2 | ✅ (no change needed) |
