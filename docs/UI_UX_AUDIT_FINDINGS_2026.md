# TextMyAgent — UI/UX Audit Findings (April 2026)

> **Scope:** Holistic audit of the desktop app's UI, onboarding flow, IA, animation, and security.  
> **Mode:** Findings only — no code changes applied.  
> **Current stack:** Electron + Next.js (App Router) dashboard + local Gemma 4 E4B via `node-llama-cpp`.  
> **Companion docs:** `docs/UI_UX_AUDIT_PLAN.md` (process), `docs/SCALE_ARCHITECTURE_PLAN.md` (system targets), `docs/SECURITY_AUDIT_PLAN.md`.  
> **Severity legend:** 🔴 P0 = broken / blocks user · 🟠 P1 = clear friction · 🟡 P2 = polish · 🔵 P3 = nice-to-have.

---

## 1. Executive Summary

Six major themes emerged. In order of impact:

1. **Cloud-era UI artifacts survived the migration to Gemma 4.** Budget (cents), "Estimated Cost", and dollar-denominated fields are now nonsense for local inference but still occupy prominent screen real estate on Dashboard, Usage, Security, and Settings.
2. **Information architecture has 10 nav items with significant overlap.** Reply Mode, contact allowlist, and rate limits each live in 2–3 places. Users and maintainers pay the cognitive tax.
3. **Onboarding skips the two highest-leverage steps** — choosing the model for the user's RAM, and validating the agent works before asking them to commit.
4. **A complete metrics pipeline (`/api/dashboard/metrics`) was built for the scale plan but is not rendered anywhere** — queue depth, p95 latency, pool utilization, session ages. This is the #1 feature the Dashboard is missing.
5. **Animation vocabulary is one keyframe (`fadeIn`) used in one place.** Everywhere else the app feels static; no toasts, no skeletons, no page transitions, no celebration on setup completion.
6. **Electron security is solid on the fundamentals but misses four checklist items**: no CSP, no IPC sender validation, no permission request handler, no in-app permission-revocation banner.

Bottom line: the bones are good (context isolation, sandboxing, strict CORS, LRU pool, SWR caching), but the product reads as a v1 dashboard that hasn't caught up with (a) the move from cloud to local inference, (b) the scale/metrics work in flight, or (c) a first-run experience that would convince a new user this is a polished, trustworthy privacy-first assistant.

---

## 2. Research Inputs

### 2.1 Industry frameworks consulted

| Source | Use in this audit |
|---|---|
| **Jakob Nielsen — 10 Usability Heuristics** (via Eleken checklist) | Primary heuristic pass on every tab |
| **IxDF — Micro-interactions in Modern UX** | Feedback, confirmation, celebration, and status-visibility gaps |
| **Electron Security Checklist (official)** | 20-item checklist applied to `electron/main.ts`, `electron/preload.ts`, `electron/backend/server.ts` |
| **Deepstrike — Electron Pen-Testing Guide** | CVE patterns + context-isolation/IPC review |
| **Apple HIG (macOS)** | Vibrancy, traffic-light, menu bar patterns (already partially respected) |

### 2.2 Agent-skill style repos referenced

Pulled from the list already in `UI_UX_AUDIT_PLAN.md` §3: `mastepanoski/claude-skills` (nielsen + don-norman + WCAG skills), `plugin87/ux-ui-agent-skills` (design-review rubric), `raintree-technology/apple-hig-skills`, `Leonxlnx/taste-skill` (anti-UI-slop heuristics), `anthropics/frontend-design`. Those skills are the methodology; this doc is the findings.

---

## 3. Current App Map (As-Built, April 2026)

### 3.1 Dashboard routes (Sidebar order)

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/components/Sidebar.tsx:20-46`

- **Overview:** `/` Dashboard · `/messages` · `/users` · `/usage`
- **AI Agent:** `/memory` · `/tools`
- **System:** `/logs` · `/permissions` · `/security` · `/settings`
- Plus the fullscreen **`/setup`** flow that replaces the sidebar.

### 3.2 Settings sub-tabs

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/settings/page.tsx:212-218` — `general | persona | tools | memory | security`.

### 3.3 Tools sub-tabs

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/tools/page.tsx:61-66` — `tools | executions | reminders | triggers`.

### 3.4 Setup flow steps

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/setup/page.tsx:41-46` — `welcome → permissions → model → ready`.

### 3.5 Backend endpoints used vs. exposed

Backend routers: `dashboard.ts`, `security.ts`, `memory.ts`, `tools.ts`, `metrics.ts`. The `metrics.ts` router is **complete** (`pool`, `rateLimit`, `queues`, `latency` percentiles) — see `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/routes/metrics.ts:25-57` — and **unused by the dashboard**.

---

## 4. Cloud → Local Migration Debt (highest-leverage fixes)

### 4.1 🔴 "Daily Budget" framed in dollars on the Dashboard

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/page.tsx:247-268` renders a card titled **Daily Budget** showing `$X.XX / day` and the caption "Agent will stop responding when budget is exceeded". With Gemma 4 running on-device there is no dollar cost. The setting key (`security.dailyBudgetCents`) and this widget are leftovers from the Anthropic-API era.

### 4.2 🔴 Settings security tab mixes tokens and cents

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/settings/page.tsx:664-666` labels the field "Daily Token Budget (0 = unlimited)" but binds it to `dailyBudgetCents` and hints "tokens/day limit" when > 0. Either (a) rename field and key to `dailyTokenBudget`, or (b) drop it — the help text itself admits "local inference has no cost".

### 4.3 🔴 Usage page "Estimated Cost" StatCard is decorative

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/usage/page.tsx:17-20` — `estimateCost` hard-returns `$0.00 (local)`. It takes a prime grid slot while conveying no signal. Same column in the table.

### 4.4 🟠 Security page Budget card displays `$` for tokens

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/security/page.tsx:45-83` — even when `dailyBudgetCents === 0` the card insists on dollar framing above a token readout. Inconsistent with the reality of the runtime.

### 4.5 🟡 System Info "Inference" row is static string

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/page.tsx:424-438` — hard-codes `'Local (on-device)'` next to live fields. Consider showing real-time backend detail (e.g., `Metal GPU · 8192 ctx · 4 pooled`) once adaptive sizing (Scale Plan Phase 1) lands.

### 4.6 🟡 Sidebar version fallback is stale

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/components/Sidebar.tsx:120` — fallback literal `'2.1.0'`. Current package is 2.2.0+. Minor but visible in dev.

---

## 5. Information Architecture & Tab Reshuffle

### 5.1 Duplications found

| Concept | Locations |
|---|---|
| **Reply Mode toggle + allowlist** | Dashboard (`page.tsx:284-420`) AND Settings/General (`settings/page.tsx:454-545`) |
| **Rate limit numbers** | Dashboard summary card, Security page summary card, Settings/Security fields |
| **Daily Budget** | Dashboard widget, Security page widget, Settings/Security field |
| **Model info** | Dashboard System Info, Settings/General Model card, Setup flow |
| **User list** | `/users` page and `/memory` page (user picker) — different filters of the same list |

Three sources of truth for Reply Mode and Rate Limits each. This is a code maintenance bug as much as a UX one.

### 5.2 🟠 Tab grouping is arbitrary

Memory and Tools are "AI Agent", but Logs, Permissions, Security, Settings are "System". Memory is arguably more system than AI Agent; Tools ↔ Reminders/Triggers live together but Reminders are not tools. Users scan three groups to find a single concept.

### 5.3 🔵 Proposed IA (7 top-level items + Setup)

```
Dashboard           ← hero status, LIVE metrics (queue, p95, pool, RAM)
Conversations       ← merge Messages + Users (master/detail)
Memory              ← facts + summaries (summaries currently missing from UI)
Automations         ← rename Tools; Reminders + Triggers live here
Activity            ← rename Usage; drop cost; show throughput & outcomes
Model               ← NEW dedicated page: download / load / swap E2B↔E4B / pool
Logs                ← unchanged
Settings            ← slimmed; permissions + security settings fold in here
```

**What folds away:**
- `/permissions` → an inline "Check Permissions" banner on Dashboard + a disclosure inside Settings.
- `/security` → its summary cards move to **Activity**, its blocked-users list moves to **Conversations**, its settings fields move to **Settings → Safety**.
- Reply Mode → exclusively in Settings; Dashboard reads-only it.

**Why:** every screen collapses down to one concept. Users with "I want to block someone" go to Conversations → user row → Block (already there). Users with "What's my queue depth?" go to Dashboard. Users with "Is my model loaded?" go to Model. Less click-ping-pong, fewer duplicate forms to keep in sync.

### 5.4 🟠 Command palette is absent

No `⌘K`/`⌘P` shortcut. With 10+ surfaces, a command palette (fuzzy route + actions like "Start agent", "Pause logs", "Block user X") would be the single biggest navigation unlock. Tray menu gives 4 entries (`tray.ts:52-82`) but the main window has zero shortcuts beyond `⌘Q`.

---

## 6. Onboarding Flow (the `/setup` route)

Source: `@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/setup/page.tsx`

### 6.1 🔴 "Skip to Dashboard" button bypasses required permissions

`setup/page.tsx:775-784` — writes `localStorage.setItem('setup-skipped', '1')` and exits. A user without Full Disk Access reaches the main dashboard where the agent silently will not run. No in-app banner explains why. Layout redirect at `@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/layout.tsx:38-42` honours that skip flag forever. This is the biggest first-run dead-end in the app.

### 6.2 🔴 No RAM-aware model choice

The Scale Architecture Plan explicitly requires E2B on 8 GB Macs and E4B on 16 GB+. The UI hardcodes Gemma 4 E4B (`setup/page.tsx:588`). An 8 GB Mac user will swap heavily; they need the option to pick E2B up front. Step 3 should:
- Detect `os.totalmem()` via a new endpoint.
- Present two cards (E2B 3.2 GB · E4B 5 GB) with "recommended for your Mac".
- Show projected speed and RAM impact.

### 6.3 🔴 Download starts the moment you land on Step 3

`setup/page.tsx:368-380` auto-fires `handleDownloadModel()` via a ref. There's no confirmation, no "Start download" button, and no "Download later". Metered-connection users will be angry. The pattern should be:
- Land on Model step → show card with size + bandwidth estimate → user clicks "Download 5 GB".
- Cancel button during download.

### 6.4 🟠 No agent test/chat before "Start Agent"

Step 4 says "You're all set" and offers **Start Agent & Go to Dashboard**. The user never sees the model respond. A 30-second "say hi to your agent" preview (send a canned prompt, render the reply) would build confidence and surface model-load errors before the user commits.

### 6.5 🟠 Persona and allowlist are deferred to Settings

For a personal-assistant product, "what should I call the AI" and "who can text it" are identity-defining choices. Both live in Settings after onboarding ends. A minimal onboarding step (**"Name your agent · Who can text it?"**) between Model and Ready would personalize the experience and prevent the default-name-"Grace" impression.

### 6.6 🟠 Privacy headline is buried

The strongest story this app tells is "runs 100% on your Mac". That line appears as the third bullet on the Welcome card (`setup/page.tsx:442`) and in fine print on Step 3. It should be the hero: a full-width "Private by design" panel on Welcome, a lock icon, and the explicit sentence "Your messages never leave this Mac."

### 6.7 🟡 Permission polling every 2 s while on Step 2

`setup/page.tsx:240-247` — good for responsiveness but wasteful. Debounce to 5 s or use `document.visibilityState === 'visible'` to pause polling while the window is backgrounded.

### 6.8 🟡 Failed "Start Agent" leaves users stuck

`setup/page.tsx:385-396` — on error, `startError` renders inline but the stepper stays on "Launch". No explicit retry with suggestions ("Did the model fail to load? Try Reload Model"). Deserve a richer error panel with action chips.

### 6.9 🟡 Download UX lacks ETA & bytes/sec

Progress bar updates every 1.5 s but only shows `%`. Add MB/s, ETA, bytes-downloaded/total. The `modelReady && modelLoading && !modelLoaded` chain at lines 626-648 is three near-identical info boxes — consolidate to a single status region with a finite-state model.

### 6.10 🔵 No celebration

A 4-step process ending in "You're All Set!" deserves more than a static rocket icon. A tasteful one-shot confetti, a haptic, or an animated gradient on the final button is the small delight that makes the app feel alive.

---

## 7. Animation & Polish Audit

### 7.1 🟠 Only one animation exists in the codebase

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/globals.css:108-115` defines one keyframe (`fadeIn`) and applies it via `.animate-in.fade-in` on onboarding step transitions. Every other screen is a hard swap.

### 7.2 🟠 No skeleton loaders

`LoadingSpinner` (`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/components/LoadingSpinner.tsx`) renders a centered spinner for every non-streaming fetch (Messages, Users, Usage, Memory, Tools, Security). Skeleton placeholders matching each card grid would lower perceived latency. Especially important on a local-inference app where the main-thread pause to load a chat list already feels janky.

### 7.3 🟠 Toast/snackbar pattern is missing

"Saved!" is a 3-second text swap inside the button (`settings/page.tsx:682-688`). "Reply mode saved" is a 2-second check icon near the toggle (`page.tsx:291-294`). There is no global toast/snackbar. Adds up to inconsistent feedback — Nielsen #1 violation.

### 7.4 🟡 Status pulse only on "running"

`StatusBadge` (`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/components/StatusBadge.tsx:9`) animates the dot only for `running`. `stopped`, `warning`, `error` are flat. A subtle pulse on `warning` + `error` would respect Nielsen #1 (visibility of system status).

### 7.5 🟡 No page-to-page transition

Tab clicks cause instant white flash and new layout. Next.js App Router supports `loading.tsx` per route; none exist. Add a shared fade or a subtle layout persistence.

### 7.6 🟡 Cards don't lift on hover

`Card` (`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/components/Card.tsx`) is a static border box. For clickable cards (user rows, fact rows), a 50 ms `translateY(-1px)` + shadow gives affordance.

### 7.7 🟡 Download progress can appear stalled

`setup/page.tsx:613-618` uses a gradient bar with `transition-all duration-500`. At 99 % for 40 seconds (final hash-verify) the bar looks frozen. Add an in-bar shimmer or a secondary "verifying…" state.

### 7.8 🔵 Tray icon doesn't reflect error states in real time

`tray.ts:87-110` exposes `setTrayStatus('connected'|'disconnected'|'error')` but main.ts never calls it. The tray is visually dead. Wire it to `agentService.getStatus()` transitions so the menu-bar icon is a live indicator.

### 7.9 Best-practice recipes (if/when you act)

From IxDF micro-interactions guidance — **trigger → rules → feedback → loops/modes**:
- Every async action → toast (success/error) with optional "undo".
- Every pending state > 800 ms → skeleton, not spinner.
- Respect `prefers-reduced-motion` (already honoured at `globals.css:117-125`).

---

## 8. Security Findings

Reference: the official 20-point Electron security checklist. Context-isolation, sandboxing, and nodeIntegration are all correct. Notable gaps:

### 8.1 🟠 No Content-Security-Policy

Checklist #7. Neither `electron/main.ts` nor `dashboard/app/layout.tsx` sets a CSP. For an app that exclusively loads `http://127.0.0.1:<port>` you can be quite restrictive. Recommended header via `session.defaultSession.webRequest.onHeadersReceived`:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data:; object-src 'none'; frame-ancestors 'none';
```

### 8.2 🟠 IPC `sender` is never validated

Checklist #17. `electron/main.ts:251-298` defines eight `ipcMain.handle` endpoints (incl. `quit-app`, `model:download`, `secure-storage:set`) that accept from any renderer frame. In this app there's only one window, but defense-in-depth says add `if (event.senderFrame.url !== mainWindow.webContents.mainFrame.url) return`.

### 8.3 🟡 No `setPermissionRequestHandler`

Checklist #5. With only localhost loaded, exposure is low, but setting an explicit deny-by-default handler future-proofs if you ever add `<webview>` or embed a third-party URL.

### 8.4 🟡 No in-app alert if user revokes macOS permissions later

If Full Disk Access is revoked in System Settings post-onboarding, the agent silently fails its next poll. The dashboard has no banner. The `/permissions` page tells the truth but only if the user goes looking. Recommendation: on every Agent status poll, if `requiredGranted` flips to false, inject a banner.

### 8.5 🟡 `webSecurity`, `allowRunningInsecureContent` not explicitly set

They default to safe values, but spelling them out in `webPreferences` (`webSecurity: true`, `allowRunningInsecureContent: false`) is the Electron docs' explicit recommendation. Same for explicit `webPreferences.enableBlinkFeatures: ''`.

### 8.6 🟡 `outputSanitization` setting is a black box

`settings/page.tsx:673` exposes the toggle; the user has no way to see what's been blocked. Adding "last X blocked outputs" to the Security page would fulfil Nielsen #10 (help users recognize + recover from errors).

### 8.7 🔵 HuggingFace token path

Setup flow asks about model download but token entry appears only via backend env (no UI field seen). Verify the token flows through `secure-storage` and never hits plain settings. (Preload exposes `getSecureValue`/`setSecureValue` — good, but confirm the settings tab never accepts/leaks it.)

### 8.8 🔵 Auto-updater downloads on startup automatically

`electron/utils/auto-updater.ts:63-67` calls `checkForUpdatesAndNotify()` 5 s after launch. That's fine, but `autoDownload = false` (line 6) is good — just surface "Update available" as a non-blocking toast inside the app once the preload event fires. `onUpdateAvailable` listener is defined but no UI subscribes to it; update notifications currently go nowhere.

---

## 9. Smoother-Flow & Discoverability Findings

### 9.1 🟠 Dashboard real-estate isn't earning its keep

Current hero sequence: Status card → 3 stat cards → 2 widget row (Budget/Memory) → Reply Mode card → Contacts modal → System Info. The "Processing" stat shows `processingCount` but the real value lives in the unused `/api/dashboard/metrics` endpoint. Suggested hero:

```
[ Live metrics strip ]  queue · p95 latency · pool · RAM · tokens/s
[ Agent Status + Start/Restart/Stop ]
[ Recent Conversations (last 5) ]
[ Model card: Gemma 4 E4B · loaded · 6.1 GB used ]
```

The Reply Mode / Contacts picker moves to Settings. Budget card deletes. Memory widget deletes (already a tab).

### 9.2 🟠 Users ⇄ Messages are the same table viewed differently

`Messages` (`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/messages/page.tsx`) is a flat list of 100 latest messages. `Users` (`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/users/page.tsx`) is a user list with drill-down. Merge them behind one "Conversations" route: default view = list of users, right-pane = selected user's messages. This is the standard Mail/Slack/Messages.app pattern and fixes the `selectedUserId` scroll-top bug too (`users/page.tsx:33-100` forces a full route swap when drilling in).

### 9.3 🟠 No pagination on Messages / Users / Logs

Backend takes `limit`/`offset` but the UI hard-codes 100 (`messages/page.tsx:12`) and 50 (`users/page.tsx`). Past that, old history is invisible. Infinite scroll or a "load older" button is needed now that local-only storage has no retention ceiling.

### 9.4 🟠 Memory page exposes facts but not summaries

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/memory/page.tsx:116-133` shows a Summaries *count* only. The Scale Plan Phase 2 adds auto-summarization on eviction; when those start landing, users should be able to read/delete/edit the rolling summaries per conversation. Design a second column here now.

### 9.5 🟠 Settings/Persona is a wall of textareas

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/settings/page.tsx:560-590` — 6 textareas with only "Who is this AI?" style placeholders. Users have no idea what works. Backend already has `/prompt/preview` (`dashboard.ts:820`) which isn't used. Add a live preview pane ("here's what the model sees") + 3–4 starter personas as one-click presets.

### 9.6 🟠 No keyboard shortcuts

`⌘1-9` for tabs, `⌘K` for command palette, `⌘S` for Save All, `⌘.` to toggle agent. None exist. For a macOS-native app this is unusual.

### 9.7 🟡 No unsaved-changes warning in Settings

Switching tabs or navigating away after edits silently discards work. Simple dirty-form detection + a "Discard / Save" confirm would prevent rework.

### 9.8 🟡 No manual theme override

Layout (`layout.tsx:17-28`) only listens to system `prefers-color-scheme`. Some users want a Light Mac but a Dark app, especially at night. A `light | dark | system` picker in Settings → General is table stakes.

### 9.9 🟡 Empty states are generic

Good that they exist (`EmptyState.tsx`), but each one is a static icon + title + description. No call-to-action (e.g., Messages empty state → "Send a test message to yourself" button). Heuristic #10 — help users recover / learn — underused.

### 9.10 🟡 Logs page magic padding

`@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/logs/page.tsx:279` — `pl-[147px]` is a hardcoded left padding that aligns expanded metadata to the message column. Fragile; any font or column tweak breaks alignment. Replace with a grid or a CSS variable.

### 9.11 🔵 No "Welcome back" state when agent was running

On reopen from tray, sidebar says "Running" but the main pane shows whatever was last visited. A once-per-session "Agent ran for 4h, 23 messages handled" micro-banner would reinforce value.

---

## 10. Prioritized Next-Steps (when you're ready to act)

### P0 — ship this sprint

- **Remove dollar framing everywhere.** Dashboard Budget card, Usage "Estimated Cost", Security Budget card, Settings field rename. Either delete or restate as token budget.
- **Surface `/api/dashboard/metrics` on the Dashboard.** Queue depth, p95 latency, pool utilization, RAM usage.
- **Guard "Skip to Dashboard"** so it cannot bypass required permissions — at minimum gate it behind `requiredGranted`.
- **Add CSP via `webRequest.onHeadersReceived`** in `electron/main.ts`.

### P1 — next sprint

- **RAM-aware model choice in Setup Step 3** (E2B vs E4B) with explicit confirm-to-download.
- **Merge Messages + Users → Conversations.** Delete one route.
- **Consolidate Reply Mode and contact allowlist** to a single source of truth (Settings).
- **Live "Test the agent" step** before "Start Agent" in onboarding.
- **Toast/snackbar system** + skeleton loaders + page-transition fade.
- **Validate IPC sender** on the 8 handlers in `electron/main.ts`.

### P2 — before 3.0

- **Dedicated `/model` route** for download/load/swap/pool status; drop the Model card in Settings.
- **Rename `/usage` → `/activity`**; fold queue + outcome breakdown into it; remove cost columns.
- **Command palette** (`⌘K`) + tab shortcuts (`⌘1-9`) + agent toggle (`⌘.`).
- **Conversation summaries** rendered on `/memory`.
- **Live tray status icon** wired to agent heartbeat.

### P3 — polish

- **One-shot celebration** on setup completion.
- **Manual theme override** (light/dark/system) in Settings.
- **In-bar shimmer** on model download progress.
- **Empty-state CTAs** across Messages/Users/Memory/Tools.
- **Persona preset cards** + live prompt preview.

---

## Appendix A — Files most likely to change per fix

| Finding | Primary files |
|---|---|
| Cloud-era UI artifacts (§4) | `dashboard/app/page.tsx`, `dashboard/app/usage/page.tsx`, `dashboard/app/security/page.tsx`, `dashboard/app/settings/page.tsx` |
| IA reshuffle (§5) | `dashboard/components/Sidebar.tsx`, create `dashboard/app/activity/`, `dashboard/app/model/`, `dashboard/app/conversations/` |
| Onboarding (§6) | `dashboard/app/setup/page.tsx`, `dashboard/app/layout.tsx`, `electron/backend/routes/dashboard.ts` (expose RAM) |
| Animation (§7) | `dashboard/app/globals.css`, new `dashboard/components/Toast.tsx`, new `components/Skeleton.tsx` |
| Security (§8) | `electron/main.ts`, `electron/preload.ts`, `electron/backend/server.ts` |
| Smoother flow (§9) | `dashboard/app/messages/page.tsx` + `users/page.tsx` merge, `dashboard/app/settings/page.tsx` |

## Appendix B — Quick metrics (lines of code)

- Dashboard app total: ~9 route pages · largest is `setup/page.tsx` (793 lines) then `settings/page.tsx` (718) then `page.tsx` (443).
- 8 shared components. No design-system primitives beyond `Button`, `Card`, `StatCard`, `StatusBadge`, `LoadingSpinner`, `PageHeader`, `EmptyState`, `ErrorBoundary`, `Sidebar`.
- One animation keyframe. No toast system. No skeleton system. One loading primitive.

*End of audit.*
