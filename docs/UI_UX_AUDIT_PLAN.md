# TextMyAgent Desktop — Comprehensive UI/UX Audit Plan

> **Version:** 1.0  
> **Date:** April 7, 2025  
> **App:** TextMyAgent Desktop v1.6.0  
> **Stack:** Electron + Next.js (App Router) + React + Express.js backend  
> **Platform:** macOS 12.0+  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Audit Scope & Boundaries](#2-audit-scope--boundaries)
3. [Reference Frameworks & Sources](#3-reference-frameworks--sources)
4. [Audit Methodology](#4-audit-methodology)
5. [Phase 1 — Heuristic Evaluation (Nielsen's 10 Heuristics)](#5-phase-1--heuristic-evaluation-nielsens-10-heuristics)
6. [Phase 2 — Don Norman's 7 Design Principles Audit](#6-phase-2--don-normans-7-design-principles-audit)
7. [Phase 3 — IxDF UX Factors & Usability Characteristics](#7-phase-3--ixdf-ux-factors--usability-characteristics)
8. [Phase 4 — WCAG 2.2 Accessibility Audit](#8-phase-4--wcag-22-accessibility-audit)
9. [Phase 5 — Apple HIG Compliance (macOS Desktop)](#9-phase-5--apple-hig-compliance-macos-desktop)
10. [Phase 6 — Visual Design & UI Polish Review](#10-phase-6--visual-design--ui-polish-review)
11. [Phase 7 — Cognitive Walkthrough (Key User Tasks)](#11-phase-7--cognitive-walkthrough-key-user-tasks)
12. [Phase 8 — Electron Desktop-Specific UX Audit](#12-phase-8--electron-desktop-specific-ux-audit)
13. [Phase 9 — Performance & Perceived Speed Audit](#13-phase-9--performance--perceived-speed-audit)
14. [Phase 10 — Error Handling & Edge Cases](#14-phase-10--error-handling--edge-cases)
15. [Phase 11 — Information Architecture & Navigation](#15-phase-11--information-architecture--navigation)
16. [Phase 12 — Code-Level UI Quality Audit](#16-phase-12--code-level-ui-quality-audit)
17. [Severity Classification System](#17-severity-classification-system)
18. [Deliverables & Reporting Format](#18-deliverables--reporting-format)
19. [Audit Execution Order](#19-audit-execution-order)

---

## 1. Executive Summary

This document defines a **deep, comprehensive UI/UX audit plan** for TextMyAgent Desktop — an Electron-based macOS app that provides an AI assistant for iMessage. The app consists of a Next.js dashboard UI rendered inside an Electron BrowserWindow, backed by an Express.js API server, with system tray integration and macOS permission management.

The audit synthesizes methodologies from **6 industry-standard frameworks** and **7 GitHub agent-skills repositories** to produce a 12-phase evaluation covering every layer of the user experience: from pixel-level visual polish to cognitive load analysis to Electron-specific desktop UX patterns.

### Goals
- Identify every usability issue, design inconsistency, and UX friction point
- Evaluate accessibility compliance against WCAG 2.2 AA
- Assess macOS platform conformance against Apple HIG
- Audit the onboarding/setup flow, dashboard, and all key user journeys
- Produce a prioritized, severity-rated findings report with actionable fixes

---

## 2. Audit Scope & Boundaries

### In Scope

| Area | Details |
|------|---------|
| **Onboarding / Setup Flow** | First-launch experience, permission requests, API key entry, test connection |
| **Dashboard Home** | Agent status, system overview, quick actions |
| **Messages View** | Message history, conversation threads, user list |
| **Users View** | User list, user details, message history per user |
| **Settings Page** | API configuration, model selection, temperature, token limits |
| **Permissions Page** | macOS permission status, grant flow, troubleshooting |
| **Logs Page** | Real-time log stream, filtering, search |
| **Usage / Analytics** | Token usage charts, daily/weekly/monthly breakdown |
| **System Tray** | Tray icon, context menu, status indicators |
| **Window Management** | Resize, minimize-to-tray, restore, close behavior |
| **Auto-Updater** | Update notifications, download, install flow |
| **Error States** | API failures, permission denied, disconnected states |
| **Dark Mode / Light Mode** | Theme switching, vibrancy, contrast |

### Out of Scope
- Backend business logic correctness (not a functional QA audit)
- iMessage protocol-level testing
- Anthropic API response quality
- Load/stress testing
- Automated test coverage (separate concern)

### Key Files Under Audit

| File | Role |
|------|------|
| `dashboard/` | Entire Next.js frontend (app router pages, components, lib) |
| `electron/main.ts` | Window creation, BrowserWindow config, IPC, lifecycle |
| `electron/preload.ts` | Exposed API surface to renderer |
| `electron/utils/tray.ts` | System tray menu, status icons, click behavior |
| `electron/utils/auto-updater.ts` | Update notification UX |
| `electron/backend/routes/dashboard.ts` | API responses that feed UI state |
| `electron/backend/services/PermissionService.ts` | Permission check UX |

---

## 3. Reference Frameworks & Sources

This audit plan is built from the following GitHub repositories and industry frameworks:

### GitHub Agent Skills Repositories

| # | Repository | What We Use |
|---|-----------|-------------|
| 1 | **[mastepanoski/claude-skills](https://github.com/mastepanoski/claude-skills)** | `ux-audit-rethink` (IxDF 7 UX factors + 5 usability characteristics), `nielsen-heuristics-audit`, `wcag-accessibility-audit`, `don-norman-principles-audit`, `cognitive-walkthrough`, `ui-design-review` |
| 2 | **[plugin87/ux-ui-agent-skills](https://github.com/plugin87/ux-ui-agent-skills)** | WCAG 2.2 checklist (POUR principles, P0/P1/P2), design review rubric (6 weighted dimensions), Nielsen heuristics process, Atomic Design component specs, accessibility/ARIA patterns |
| 3 | **[ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills)** | 300+ design rules: Apple HIG for macOS (menu bars, toolbars, keyboard shortcuts, window management), WCAG 2.2 web platform rules |
| 4 | **[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)** | 99 UX guidelines with anti-patterns, 67 UI styles reference, color palette evaluation, typography audit criteria |
| 5 | **[VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)** | Curated index: `ibelick/ui-skills` (interface constraints), `Leonxlnx/taste-skill` (design variance, motion, visual density), `raintree-technology/apple-hig-skills` (14 HIG agent skills) |
| 6 | **[Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)** | Anti-"UI slop" detection: tunable design variance, motion intensity, visual density evaluation |
| 7 | **[anthropics/frontend-design](https://officialskills.sh/anthropics/skills/frontend-design)** | Official Anthropic frontend design and UI/UX development baseline |

### Industry Frameworks

| Framework | Application |
|-----------|------------|
| **Jakob Nielsen's 10 Usability Heuristics** | Phase 1 — Systematic usability inspection |
| **Don Norman's 7 Design Principles** | Phase 2 — Intuitiveness and learnability |
| **IxDF UX Honeycomb** (Peter Morville) | Phase 3 — 7 UX factors: Useful, Usable, Findable, Credible, Desirable, Accessible, Valuable |
| **IxDF 5 Usability Characteristics** | Phase 3 — Learnability, Efficiency, Memorability, Errors, Satisfaction |
| **WCAG 2.2 Level AA** | Phase 4 — Accessibility compliance |
| **Apple Human Interface Guidelines (macOS)** | Phase 5 — Platform-native desktop expectations |
| **Eleken UX Audit Checklist** | Cross-referenced with Phase 1 for practical sub-checks |

---

## 4. Audit Methodology

### 4.1 Process Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  PREPARATION                                                        │
│  • Build & launch app in dev mode                                   │
│  • Document all reachable screens/states                            │
│  • Map user flows and navigation paths                              │
│  • Capture screenshots of every view                                │
├─────────────────────────────────────────────────────────────────────┤
│  EVALUATION (12 Phases)                                             │
│  • Each phase evaluates against its specific framework              │
│  • Every finding gets: ID, description, location, severity,        │
│    screenshot, recommendation                                       │
├─────────────────────────────────────────────────────────────────────┤
│  SYNTHESIS                                                          │
│  • De-duplicate findings across phases                              │
│  • Assign final severity (Critical / Major / Minor / Enhancement)  │
│  • Group by screen/component and by theme                           │
│  • Produce final report with prioritized action items               │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 For Each Finding, Capture

| Field | Description |
|-------|-------------|
| **ID** | `{Phase}-{Number}` e.g. `H1-003` |
| **Title** | Short descriptive name |
| **Location** | Screen / component / file path |
| **Heuristic / Principle** | Which rule is violated |
| **Description** | What the issue is |
| **Impact** | How it affects the user |
| **Severity** | Critical / Major / Minor / Enhancement |
| **Evidence** | Screenshot or code snippet |
| **Recommendation** | Specific fix with implementation guidance |

### 4.3 Evaluation Approach
- **Code review**: Read React components, page files, CSS/Tailwind classes, and Electron config
- **Visual inspection**: Run the app, screenshot every state, evaluate against frameworks
- **Interactive testing**: Click through all flows, test keyboard navigation, resize window, toggle themes
- **Simulated user personas**: First-time user, power user, accessibility-dependent user

---

## 5. Phase 1 — Heuristic Evaluation (Nielsen's 10 Heuristics)

*Source: mastepanoski/claude-skills `nielsen-heuristics-audit`, plugin87/ux-ui-agent-skills `design-review.md`, Eleken checklist*

For each heuristic, evaluate every screen and component. Use severity scale 0-4.

### H1: Visibility of System Status
The system should always keep users informed about what is going on through appropriate feedback within reasonable time.

**Checklist:**
- [ ] Agent running/stopped status is clearly visible at all times
- [ ] Loading states shown for all async operations (API calls, permission checks)
- [ ] Progress indicators for multi-step processes (setup wizard)
- [ ] iMessage polling status is communicated (active, paused, error)
- [ ] API key validation shows real-time feedback (testing, success, failure)
- [ ] System tray icon reflects current agent status (connected/disconnected/error)
- [ ] Backend server health is communicated if degraded
- [ ] Log stream connection status (SSE connected/reconnecting)
- [ ] Auto-update download progress shown
- [ ] Token usage is visible during or after message processing

### H2: Match Between System and Real World
The system should speak the users' language with words, phrases, and concepts familiar to the user rather than system-oriented terms.

**Checklist:**
- [ ] No developer jargon exposed (e.g., "ROWID", "chat_guid", "SSE", "IPC")
- [ ] Error messages use plain language, not error codes or stack traces
- [ ] Permission names match macOS System Settings terminology exactly
- [ ] "Agent" concept is clearly explained for non-technical users
- [ ] API key setup instructions are written for non-developers
- [ ] Model names (claude-3-5-haiku-latest) are explained or simplified
- [ ] Token counts translated to approximate cost or message count
- [ ] Technical settings (temperature, max tokens) have user-friendly explanations

### H3: User Control and Freedom
Users often choose system functions by mistake and need a clearly marked "emergency exit" to leave the unwanted state.

**Checklist:**
- [ ] Agent can be stopped immediately from any screen
- [ ] Setup wizard allows going back to previous steps
- [ ] Setup can be exited and resumed later
- [ ] API key can be changed/removed after initial setup
- [ ] Settings changes can be reverted (undo or reset to defaults)
- [ ] Window close minimizes to tray with clear indication (not silent disappear)
- [ ] Destructive actions (delete data, reset) require confirmation
- [ ] Navigation allows returning to previous view from any screen

### H4: Consistency and Standards
Users should not have to wonder whether different words, situations, or actions mean the same thing.

**Checklist:**
- [ ] Button styles consistent across all pages (primary, secondary, destructive)
- [ ] Icon usage consistent (same icon = same meaning everywhere)
- [ ] Terminology consistent ("Agent" vs "Bot" vs "Assistant" — pick one)
- [ ] Status indicators use consistent colors (green=good, red=error, yellow=warning)
- [ ] Date/time formats consistent throughout
- [ ] Error message format consistent (toast, inline, modal — same pattern)
- [ ] Navigation patterns match Next.js/web conventions
- [ ] macOS conventions respected (Cmd+Q, Cmd+W, Cmd+, for preferences)

### H5: Error Prevention
Even better than good error messages is a careful design which prevents a problem from occurring in the first place.

**Checklist:**
- [ ] API key input validates format before submission (sk-ant-* pattern)
- [ ] Permissions guide prevents user from proceeding without required grants
- [ ] Settings inputs have proper constraints (min/max for temperature, tokens)
- [ ] Confirm dialog before stopping a running agent
- [ ] Prevent double-click on action buttons (start/stop/restart)
- [ ] Graceful handling when backend server is not ready
- [ ] Prevent saving empty/invalid configuration values

### H6: Recognition Rather Than Recall
Minimize the user's memory load by making objects, actions, and options visible.

**Checklist:**
- [ ] Current page/section clearly indicated in navigation
- [ ] Agent status always visible (not hidden in a sub-page)
- [ ] Permission status shows which are granted vs pending vs denied
- [ ] Settings show current values (not just labels)
- [ ] Recently active users visible without navigating deep
- [ ] Setup progress shows completed vs remaining steps
- [ ] Keyboard shortcuts discoverable (menu bar, tooltips)

### H7: Flexibility and Efficiency of Use
Accelerators — unseen by the novice user — may speed up interaction for the expert user.

**Checklist:**
- [ ] Keyboard shortcuts for common actions (start/stop agent, open settings)
- [ ] Menu bar provides access to all key functions
- [ ] System tray provides quick agent control without opening window
- [ ] Search/filter available in logs and messages views
- [ ] Refresh/reload available via standard shortcuts (Cmd+R)
- [ ] Quick access to Anthropic console from settings

### H8: Aesthetic and Minimalist Design
Dialogues should not contain information which is irrelevant or rarely needed.

**Checklist:**
- [ ] Dashboard home shows only essential information
- [ ] No redundant UI elements competing for attention
- [ ] Settings page organized into logical groups
- [ ] Log view defaults to useful filter (not showing debug noise)
- [ ] Empty states are meaningful (not blank screens)
- [ ] Visual hierarchy guides the eye to most important information

### H9: Help Users Recognize, Diagnose, and Recover from Errors
Error messages should be expressed in plain language, precisely indicate the problem, and constructively suggest a solution.

**Checklist:**
- [ ] API key validation failure explains what's wrong and how to fix it
- [ ] Permission denied errors link directly to System Settings
- [ ] Agent start failure explains prerequisites (API key + Full Disk Access)
- [ ] Network errors distinguished from auth errors
- [ ] iMessage access errors provide step-by-step resolution
- [ ] Backend server unavailable shows recovery steps
- [ ] No raw error objects or stack traces shown to user

### H10: Help and Documentation
Even though it is better if the system can be used without documentation, it may be necessary to provide help.

**Checklist:**
- [ ] First-launch onboarding guides user through setup
- [ ] Tooltips on complex settings (temperature, max tokens, context window)
- [ ] Link to documentation/support from within the app
- [ ] Permission setup has step-by-step instructions with screenshots
- [ ] FAQ or troubleshooting accessible from the app
- [ ] Version info and changelog accessible

---

## 6. Phase 2 — Don Norman's 7 Design Principles Audit

*Source: mastepanoski/claude-skills `don-norman-principles-audit`, "The Design of Everyday Things"*

### DN1: Discoverability
- [ ] Can a new user figure out what TextMyAgent does within 10 seconds?
- [ ] Are all available actions visible or easily discoverable?
- [ ] Is the setup flow self-evident without reading docs?
- [ ] Can users discover the system tray functionality?
- [ ] Are all navigation paths obvious?

### DN2: Affordances
- [ ] Do clickable elements look clickable (buttons, links, cards)?
- [ ] Do status indicators afford interaction (click to see details)?
- [ ] Does the API key input field afford text entry (placeholder, label)?
- [ ] Do permission cards afford action (grant, open settings)?
- [ ] Does the message list afford scrolling and selection?

### DN3: Signifiers
- [ ] Are visual cues present for all interactive elements?
- [ ] Do icons have labels where meaning is ambiguous?
- [ ] Are required vs optional fields clearly marked in forms?
- [ ] Do status badges clearly signal state (running, stopped, error)?
- [ ] Are active navigation items visually distinguished?

### DN4: Feedback
- [ ] Every user action produces visible, immediate feedback
- [ ] Agent start/stop shows transition state (starting..., stopping...)
- [ ] Form submissions show success/failure
- [ ] Permission checks show testing state
- [ ] Tray icon changes reflect status changes
- [ ] Log stream shows connection feedback

### DN5: Mapping
- [ ] Layout of controls maps logically to what they affect
- [ ] Settings are grouped by domain (AI config, iMessage config, app config)
- [ ] Navigation order matches user mental model (setup → dashboard → details)
- [ ] Tray menu items map to app sections

### DN6: Constraints
- [ ] Users cannot proceed past setup without required permissions
- [ ] Invalid input is prevented, not just flagged after submission
- [ ] Destructive actions are gated behind confirmation
- [ ] API key format constraints are enforced
- [ ] Number inputs have valid ranges

### DN7: Conceptual Models
- [ ] User understands the "agent" metaphor (what it does, when it's active)
- [ ] Relationship between iMessage, the agent, and Claude is clear
- [ ] Permission model makes sense (why the app needs each permission)
- [ ] The difference between "app running" and "agent running" is clear
- [ ] Users understand what "polling" means in practical terms

---

## 7. Phase 3 — IxDF UX Factors & Usability Characteristics

*Source: mastepanoski/claude-skills `ux-audit-rethink`, IxDF Interaction Design Foundation frameworks*

### 7.1 Seven UX Factors (Peter Morville's UX Honeycomb)

#### Useful
- [ ] Does the dashboard provide actionable information?
- [ ] Are the displayed metrics (usage, messages, users) actually useful?
- [ ] Does the settings page expose the right controls?
- [ ] Is the logs page useful for debugging or just noise?

#### Usable
- [ ] Can the primary task (start agent) be completed in ≤3 clicks?
- [ ] Is the setup flow completable in one session?
- [ ] Are common tasks efficient (check status, view messages, change settings)?

#### Findable
- [ ] Can users find settings quickly?
- [ ] Is the logs page discoverable?
- [ ] Can users find how to update their API key after initial setup?
- [ ] Is the usage/analytics view discoverable?

#### Credible
- [ ] Does the app look professional and trustworthy?
- [ ] Is the branding consistent and polished?
- [ ] Do status indicators inspire confidence?
- [ ] Are security practices visible (keychain storage mention, HTTPS)?

#### Desirable
- [ ] Is the visual design appealing?
- [ ] Does the app feel native to macOS?
- [ ] Are animations smooth and purposeful?
- [ ] Does the dark mode feel intentional, not an afterthought?

#### Accessible
- [ ] (Covered in depth in Phase 4 — WCAG 2.2)

#### Valuable
- [ ] Does the app deliver clear value on the dashboard?
- [ ] Is the cost/benefit of the AI agent visible (usage tracking)?
- [ ] Does the UI help users feel in control of their AI assistant?

### 7.2 Five Usability Characteristics

#### Learnability
- [ ] Time to complete setup for a first-time user
- [ ] Number of errors made during first-use
- [ ] Are instructions progressive (reveal complexity gradually)?
- [ ] Is terminology consistent and learnable?

#### Efficiency
- [ ] Number of clicks for common tasks
- [ ] Time to check agent status
- [ ] Time to change a setting
- [ ] Keyboard shortcut coverage

#### Memorability
- [ ] After 2 weeks away, can a user resume without re-learning?
- [ ] Is the navigation memorable?
- [ ] Are critical paths (start/stop agent) in consistent locations?

#### Errors
- [ ] Frequency of user errors during typical tasks
- [ ] Severity of errors (recoverable vs destructive)
- [ ] Quality of error recovery paths

#### Satisfaction
- [ ] Does the app feel responsive?
- [ ] Is the visual design pleasing?
- [ ] Does the app respect the user's time?
- [ ] Are success states celebrated (agent started, setup complete)?

### 7.3 Five Interaction Dimensions

#### Words
- [ ] Microcopy quality (button labels, tooltips, placeholders)
- [ ] Error message tone (helpful, not blaming)
- [ ] Onboarding copy clarity

#### Visual Representations
- [ ] Icon clarity and consistency
- [ ] Color meaning consistency
- [ ] Data visualization quality (usage charts)

#### Physical Space
- [ ] Window size and responsiveness
- [ ] Information density appropriate for desktop
- [ ] Comfortable reading distances and text sizes

#### Time
- [ ] Perceived loading speed
- [ ] Animation timing and easing
- [ ] Polling interval impact on freshness perception

#### Behavior
- [ ] System tray behavior matches macOS conventions
- [ ] Window close/minimize behavior is predictable
- [ ] Auto-start behavior on app launch is clear

---

## 8. Phase 4 — WCAG 2.2 Accessibility Audit

*Source: plugin87/ux-ui-agent-skills `wcag-checklist.md`, mastepanoski/claude-skills `wcag-accessibility-audit`, ehmo/platform-design-skills `web`*

### 8.1 Perceivable

#### 1.1 Text Alternatives
- [ ] All images have meaningful alt text
- [ ] Icon-only buttons have aria-label
- [ ] Status icons have text alternatives
- [ ] Tray icon status changes announced

#### 1.2 Time-Based Media
- [ ] N/A (no video/audio content expected)

#### 1.3 Adaptable
- [ ] Content meaningful without CSS (semantic HTML)
- [ ] Reading order logical in DOM
- [ ] Form inputs have associated labels
- [ ] ARIA landmarks used for page regions

#### 1.4 Distinguishable
- [ ] Text contrast ratio ≥ 4.5:1 (AA)
- [ ] Large text contrast ratio ≥ 3:1
- [ ] UI component contrast ratio ≥ 3:1
- [ ] Color not sole means of conveying information (status indicators)
- [ ] Text resizable up to 200% without loss
- [ ] Content reflows at 320px viewport width (for responsive windowing)
- [ ] Focus indicators visible (≥ 2px, sufficient contrast)
- [ ] No content obscured when focused (Focus Not Obscured — WCAG 2.2)

### 8.2 Operable

#### 2.1 Keyboard Accessible
- [ ] All interactive elements reachable via Tab
- [ ] Tab order logical and predictable
- [ ] No keyboard traps
- [ ] Custom components keyboard-operable (dropdowns, modals, toggles)
- [ ] Skip-to-content link present

#### 2.2 Enough Time
- [ ] No auto-advancing content without user control
- [ ] SSE log stream doesn't auto-scroll away from user's position
- [ ] Session/timeout warnings if applicable

#### 2.4 Navigable
- [ ] Page titles unique and descriptive per route
- [ ] Focus order matches visual order
- [ ] Link purpose clear from text
- [ ] Multiple ways to find pages (nav, search, sitemap)
- [ ] Headings and labels descriptive
- [ ] Focus visible on all interactive elements

#### 2.5 Input Modalities
- [ ] Touch target size ≥ 24x24px (WCAG 2.2 Target Size)
- [ ] No motion-based input required
- [ ] Pointer gestures have alternatives

### 8.3 Understandable

#### 3.1 Readable
- [ ] Page language declared (`lang="en"`)
- [ ] Abbreviations explained on first use

#### 3.2 Predictable
- [ ] No unexpected context changes on focus
- [ ] No unexpected context changes on input
- [ ] Navigation consistent across pages

#### 3.3 Input Assistance
- [ ] Error identification specific and descriptive
- [ ] Labels or instructions for user input
- [ ] Error suggestions provided
- [ ] Error prevention for important submissions (API key)

### 8.4 Robust

#### 4.1 Compatible
- [ ] Valid HTML (no duplicate IDs, proper nesting)
- [ ] ARIA attributes used correctly
- [ ] Name, role, value exposed for all UI components
- [ ] Status messages use `aria-live` regions

---

## 9. Phase 5 — Apple HIG Compliance (macOS Desktop)

*Source: ehmo/platform-design-skills `macos`, raintree-technology/apple-hig-skills*

### 9.1 Window Management
- [ ] Window respects standard macOS resize behavior
- [ ] Minimum window size is appropriate (currently 800x600 — verify)
- [ ] Window state persisted between launches (size, position)
- [ ] Traffic light buttons positioned correctly (currently x:15, y:15)
- [ ] `hiddenInset` title bar style feels native
- [ ] Vibrancy effect (`under-window`) renders correctly
- [ ] Full-screen mode supported and functional
- [ ] Window restoration on app relaunch

### 9.2 Menu Bar
- [ ] Standard macOS menu bar present with expected items
- [ ] App menu has "About TextMyAgent", "Preferences" (Cmd+,), "Quit" (Cmd+Q)
- [ ] Edit menu with standard items (Undo, Redo, Cut, Copy, Paste, Select All)
- [ ] View menu with zoom controls and DevTools toggle
- [ ] Window menu with standard controls (Minimize, Zoom, Bring All to Front)
- [ ] Help menu with search and documentation link

### 9.3 System Tray
- [ ] Template image used for menu bar icon (adapts to light/dark)
- [ ] Tray tooltip informative ("TextMyAgent — Running" vs just "TextMyAgent")
- [ ] Left-click behavior matches macOS convention (toggle window)
- [ ] Right-click shows context menu
- [ ] Context menu items are standard and expected
- [ ] Status icon variants (green/gray/red) visually distinct at 16x16

### 9.4 Keyboard Shortcuts
- [ ] Cmd+Q quits the app
- [ ] Cmd+W closes/hides the window
- [ ] Cmd+, opens preferences/settings
- [ ] Cmd+R refreshes the dashboard
- [ ] Cmd+H hides the app
- [ ] Standard text editing shortcuts work in all input fields

### 9.5 Native Feel
- [ ] App uses system font (SF Pro) or respects user font size
- [ ] Dark mode follows system preference automatically
- [ ] Accent color follows system preference
- [ ] Animations use macOS-native timing curves
- [ ] Alerts/dialogs follow macOS patterns (not custom modals for critical actions)
- [ ] No web-app "tells" (no URL bar, no right-click context menu leakage)

### 9.6 Notifications & Permissions
- [ ] Permission requests explain why access is needed
- [ ] Permission request timing is appropriate (not all at once on first launch)
- [ ] Settings deep-links open correct System Settings pane
- [ ] Notification style matches macOS conventions (if notifications used)

---

## 10. Phase 6 — Visual Design & UI Polish Review

*Source: plugin87/ux-ui-agent-skills `design-review.md` (6 weighted dimensions), nextlevelbuilder/ui-ux-pro-max-skill (99 UX guidelines, anti-patterns), Leonxlnx/taste-skill (anti-slop detection)*

### 10.1 Typography (Weight: 15%)
- [ ] Font hierarchy clear (H1 > H2 > H3 > body > caption)
- [ ] Line height comfortable for readability (1.4–1.6 for body)
- [ ] Font sizes appropriate for desktop (≥14px body)
- [ ] Consistent font family usage (no mixing sans/serif without purpose)
- [ ] Text truncation handled gracefully (ellipsis, not overflow)
- [ ] Monospace font used for code/technical values (API keys, log entries)

### 10.2 Color System (Weight: 20%)
- [ ] Consistent color palette (not ad-hoc hex values)
- [ ] Semantic color usage (success=green, error=red, warning=amber, info=blue)
- [ ] Dark mode colors are intentional (not just inverted)
- [ ] Brand color applied consistently
- [ ] Sufficient contrast in both light and dark modes
- [ ] Color not the sole differentiator for any information

### 10.3 Spacing & Layout (Weight: 15%)
- [ ] Consistent spacing scale (4px or 8px grid)
- [ ] Adequate whitespace between sections
- [ ] Content doesn't feel cramped or wastefully sparse
- [ ] Alignment grid respected (no "off by 1px" elements)
- [ ] Responsive to window resize (no horizontal scrolling, no cut-off content)
- [ ] Sidebar + content area layout appropriate for dashboard

### 10.4 Component Consistency (Weight: 20%)
- [ ] Buttons follow consistent size/shape/color patterns
- [ ] Input fields styled uniformly
- [ ] Cards/panels have consistent border radius and shadow
- [ ] Status badges consistent in shape, size, and color mapping
- [ ] Tables styled consistently (borders, padding, hover states)
- [ ] Icons from a single icon set (Lucide, Heroicons, etc.)

### 10.5 Visual Hierarchy (Weight: 15%)
- [ ] Most important information (agent status) has strongest visual weight
- [ ] Secondary info (usage, logs) is visually subordinate
- [ ] Call-to-action buttons stand out from secondary actions
- [ ] Empty states don't dominate the visual hierarchy
- [ ] Data visualization (charts) readable at a glance

### 10.6 Motion & Animation (Weight: 15%)
- [ ] Page transitions smooth (not jarring or absent)
- [ ] Loading skeletons or spinners used appropriately
- [ ] Hover/focus states have subtle transitions
- [ ] No gratuitous animation that serves no purpose
- [ ] Animation respects `prefers-reduced-motion`
- [ ] Status changes animate smoothly (e.g., agent starting → running)

### 10.7 Anti-"UI Slop" Checks (from taste-skill)
- [ ] No generic/template-looking placeholder content
- [ ] Design feels intentional, not auto-generated
- [ ] Visual density appropriate (not too sparse desktop, not too cramped mobile)
- [ ] Micro-interactions feel crafted (button press, toggle switch, tab transition)
- [ ] No Lorem Ipsum or "TODO" visible in any view

---

## 11. Phase 7 — Cognitive Walkthrough (Key User Tasks)

*Source: mastepanoski/claude-skills `cognitive-walkthrough`*

For each task, walk through as a **first-time user with no documentation** and answer 4 questions at every step:

1. Will the user know what to do?
2. Will the user see how to do it?
3. Will the user understand the feedback?
4. Will the user know they succeeded?

### Task 1: First Launch & Complete Setup
```
Steps:
1. Open app for the first time
2. Understand what the app does
3. Grant Full Disk Access
4. Grant Automation permission
5. Grant Contacts permission (optional)
6. Enter Anthropic API key
7. Test API key connection
8. Start the agent
9. Confirm agent is running
```

### Task 2: Check Agent Status
```
Steps:
1. Glance at dashboard/tray to see if agent is running
2. Understand what "running" means (processing messages)
3. See recent activity or message count
```

### Task 3: View Conversation History
```
Steps:
1. Navigate to messages or users view
2. Find a specific user's conversation
3. Read message thread
4. Understand which messages are from user vs AI
```

### Task 4: Change AI Model Settings
```
Steps:
1. Navigate to Settings
2. Find model configuration section
3. Understand what each setting does (model, temperature, max tokens)
4. Change a setting
5. Confirm the change was saved
6. Understand if agent needs restart
```

### Task 5: Troubleshoot a Permission Issue
```
Steps:
1. See permission error on dashboard
2. Understand which permission is missing
3. Navigate to permissions page
4. Follow instructions to grant permission in System Settings
5. Return to app and verify permission is now granted
```

### Task 6: Stop and Restart the Agent
```
Steps:
1. Find the stop button
2. Confirm intent to stop
3. See agent stopped state
4. Start agent again
5. Confirm agent is running again
```

### Task 7: Check API Usage/Costs
```
Steps:
1. Navigate to usage view
2. Understand token usage data
3. Identify usage trends (daily, weekly)
4. Estimate cost implications
```

### Task 8: Handle an App Update
```
Steps:
1. Receive update notification
2. Understand what's new
3. Download update
4. Install update
5. Confirm app is updated
```

---

## 12. Phase 8 — Electron Desktop-Specific UX Audit

*Source: Electron best practices, ehmo/platform-design-skills `macos`, app codebase analysis*

### 12.1 Window Lifecycle
- [ ] Close button minimizes to tray (not quit) — is this communicated to user?
- [ ] First-time close should explain tray behavior (tooltip or notification)
- [ ] App appears in Dock when window is open
- [ ] App icon in Dock has badge for notifications (if applicable)
- [ ] Single instance enforcement works (second launch focuses existing window)
- [ ] `ready-to-show` prevents white flash on launch

### 12.2 Power Management
- [ ] Agent pauses on system suspend (verified in code — good)
- [ ] Agent resumes on system wake (verified — 3s delay)
- [ ] User informed if agent was paused/resumed due to sleep
- [ ] Battery impact considered (2s polling interval)

### 12.3 Security UX
- [ ] API key stored in Keychain — communicated to user?
- [ ] No API key visible in settings after entry (masked display)
- [ ] URL validation prevents navigation to untrusted origins
- [ ] Context isolation enabled (verified)
- [ ] No node integration in renderer (verified)

### 12.4 IPC & Preload
- [ ] All exposed APIs (`electronAPI`) are minimal and well-scoped
- [ ] No `any` types leaked to renderer that could confuse UI
- [ ] Event listener cleanup prevents memory leaks (verified — good)
- [ ] Backend port communication reliable

### 12.5 Auto-Update
- [ ] Update available notification is non-intrusive
- [ ] User can defer update
- [ ] Download progress visible
- [ ] Install-and-restart UX is smooth
- [ ] Release notes shown to user
- [ ] Rollback/recovery if update fails

---

## 13. Phase 9 — Performance & Perceived Speed Audit

### 13.1 Startup Performance
- [ ] Time from app launch to usable dashboard (target: <3s)
- [ ] Splash screen or skeleton shown during initialization
- [ ] Database initialization doesn't block UI
- [ ] Backend server startup doesn't block window creation

### 13.2 Navigation Performance
- [ ] Page transitions instantaneous (<100ms)
- [ ] No full-page reloads when navigating between sections
- [ ] Data fetching shows loading states (not blank screens)
- [ ] Stale data handled (refresh on focus, polling intervals)

### 13.3 Data Loading
- [ ] Messages list loads incrementally (pagination, not all-at-once)
- [ ] Log stream doesn't cause memory growth over time
- [ ] Usage charts render quickly with reasonable data
- [ ] Users list handles 100+ contacts gracefully

### 13.4 Perceived Performance
- [ ] Optimistic UI updates where appropriate
- [ ] Skeleton loaders instead of spinners where possible
- [ ] Animations at 60fps (no jank)
- [ ] No layout shifts after content loads

---

## 14. Phase 10 — Error Handling & Edge Cases

### 14.1 Network/Server Errors
- [ ] App behavior when backend server fails to start
- [ ] Dashboard behavior when Express server becomes unreachable
- [ ] API call failures show meaningful errors
- [ ] SSE log stream reconnects automatically on disconnect
- [ ] Offline state handled gracefully

### 14.2 Permission Errors
- [ ] Behavior when Full Disk Access is revoked while running
- [ ] Behavior when Automation permission is revoked
- [ ] Behavior when Contacts permission is denied
- [ ] App response when iMessage database is locked/unavailable

### 14.3 Configuration Errors
- [ ] App behavior with no API key configured
- [ ] App behavior with invalid/expired API key
- [ ] App behavior with rate-limited API key (429)
- [ ] Settings with out-of-range values

### 14.4 Data Edge Cases
- [ ] Dashboard with zero messages/users (empty state)
- [ ] Very long messages (text overflow handling)
- [ ] Messages with special characters, emoji, Unicode
- [ ] User with very long name or phone number
- [ ] Very large log volume (1000+ entries)
- [ ] Usage data with zero values

### 14.5 System Edge Cases
- [ ] App behavior during macOS update
- [ ] App behavior when iMessage is not configured on Mac
- [ ] Behavior when Messages app is not installed or disabled
- [ ] Multiple displays / resolution changes
- [ ] Fast user switching

---

## 15. Phase 11 — Information Architecture & Navigation

### 15.1 Navigation Structure
- [ ] Map the complete navigation tree
- [ ] Evaluate: Is it flat enough? Too deep?
- [ ] Are all pages discoverable from the main navigation?
- [ ] Breadcrumbs or back-navigation where needed?
- [ ] Active state clearly shown in navigation

### 15.2 Content Organization
- [ ] Dashboard home answers the #1 question: "Is my agent running?"
- [ ] Information grouped by user intent, not by data type
- [ ] Settings organized logically (not one giant form)
- [ ] Logs vs Messages clearly differentiated (system logs vs chat messages)

### 15.3 URL Structure (Internal Routes)
- [ ] Routes are human-readable (`/settings`, `/messages`, `/usage`)
- [ ] Deep linking works (navigate to specific user's messages)
- [ ] Browser back/forward works within the Electron window
- [ ] Route changes update the window title

---

## 16. Phase 12 — Code-Level UI Quality Audit

### 16.1 React Component Quality
- [ ] Components follow consistent patterns (function components, hooks)
- [ ] Props are typed with TypeScript interfaces
- [ ] No inline styles where Tailwind/CSS modules should be used
- [ ] Conditional rendering handles all states (loading, error, empty, success)
- [ ] Keys used correctly in lists
- [ ] Memoization used appropriately (no over-optimization)

### 16.2 State Management
- [ ] Client state vs server state properly separated
- [ ] API data fetched with proper caching (SWR, React Query, or equivalent)
- [ ] Loading/error states managed per-request
- [ ] No stale closures in event handlers
- [ ] Form state managed properly (controlled components)

### 16.3 CSS/Styling Quality
- [ ] Consistent use of Tailwind utility classes (if used)
- [ ] No conflicting styles or `!important` overrides
- [ ] Responsive breakpoints tested
- [ ] Dark mode styles complete (no missing overrides)
- [ ] Z-index layering managed (modals, dropdowns, tooltips)

### 16.4 Accessibility in Code
- [ ] Semantic HTML elements used (`<nav>`, `<main>`, `<aside>`, `<section>`)
- [ ] `<button>` used for actions, `<a>` for navigation
- [ ] Form elements have `<label>` associations
- [ ] ARIA attributes correct and not redundant
- [ ] `role` attributes used only where semantic HTML insufficient
- [ ] Focus management for modals and dynamic content

---

## 17. Severity Classification System

*Adapted from plugin87/ux-ui-agent-skills and mastepanoski/claude-skills*

| Severity | Code | Definition | Action |
|----------|------|-----------|--------|
| **Critical** | P0 | Blocks core functionality or causes data loss. User cannot complete primary task. Accessibility violation prevents entire user group from using the app. | **Must fix immediately** — before any release |
| **Major** | P1 | Significant usability issue. Users can work around it but with significant friction. Causes frequent errors or confusion. WCAG AA violation. | **Fix this sprint** — high priority |
| **Minor** | P2 | Cosmetic issue or minor inconvenience. Does not block tasks but degrades the experience. Inconsistency or polish issue. | **Fix when convenient** — medium priority |
| **Enhancement** | P3 | Opportunity for improvement. Not a bug or violation, but would elevate the experience. Nice-to-have feature or delight moment. | **Add to backlog** — low priority |

### Nielsen Severity Rating (for Phase 1)
| Rating | Meaning |
|--------|---------|
| 0 | Not a usability problem |
| 1 | Cosmetic problem — fix if extra time |
| 2 | Minor usability problem — low priority |
| 3 | Major usability problem — high priority |
| 4 | Usability catastrophe — must fix before release |

---

## 18. Deliverables & Reporting Format

### 18.1 Primary Deliverable: Audit Report
File: `docs/UI_UX_AUDIT_REPORT.md`

Structure:
```
1. Executive Summary (findings count by severity)
2. Findings by Phase (grouped, with evidence)
3. Findings by Screen (cross-referenced)
4. Priority Action Plan (top 10 fixes by impact)
5. Accessibility Compliance Summary (WCAG scorecard)
6. Apple HIG Compliance Summary
7. Appendix: Screenshots and Evidence
```

### 18.2 Supporting Deliverables

| Deliverable | Format | Purpose |
|-------------|--------|---------|
| **Findings Tracker** | Markdown table | Every finding with ID, severity, status |
| **Screenshot Evidence** | PNG files | Visual evidence for each finding |
| **Screen Inventory** | Markdown | Map of all screens and states audited |
| **Accessibility Scorecard** | Markdown table | WCAG 2.2 criteria pass/fail |
| **Fix Recommendations** | Markdown | Specific code-level fixes per finding |

---

## 19. Audit Execution Order

Execute phases in this order to maximize efficiency (earlier phases inform later ones):

| Order | Phase | Est. Effort | Dependencies |
|-------|-------|-------------|-------------|
| 1 | **Preparation** — Screen inventory, screenshot all states | Medium | App running in dev mode |
| 2 | **Phase 11** — Information Architecture & Navigation | Light | Screen inventory |
| 3 | **Phase 7** — Cognitive Walkthrough (Key Tasks) | Heavy | Screen inventory |
| 4 | **Phase 1** — Nielsen's 10 Heuristics | Heavy | Screen inventory |
| 5 | **Phase 2** — Don Norman's 7 Principles | Medium | Phase 1 findings |
| 6 | **Phase 3** — IxDF UX Factors & Usability | Medium | Phases 1-2 findings |
| 7 | **Phase 4** — WCAG 2.2 Accessibility | Heavy | Code access + running app |
| 8 | **Phase 5** — Apple HIG Compliance | Medium | Running app on macOS |
| 9 | **Phase 6** — Visual Design & UI Polish | Medium | All previous phases |
| 10 | **Phase 8** — Electron Desktop-Specific | Medium | Code review + running app |
| 11 | **Phase 9** — Performance & Perceived Speed | Light | Running app |
| 12 | **Phase 10** — Error Handling & Edge Cases | Heavy | Running app + code review |
| 13 | **Phase 12** — Code-Level UI Quality | Heavy | Full codebase access |
| 14 | **Synthesis** — De-duplicate, prioritize, final report | Medium | All phases complete |

---

## Appendix A: Quick Reference — All Screens to Audit

| Screen | Route | States to Test |
|--------|-------|---------------|
| Onboarding / Setup | `/setup` | First launch, partial setup, complete setup |
| Dashboard Home | `/` | Agent running, agent stopped, agent error, no data |
| Messages | `/messages` | With messages, empty, loading, error |
| Users | `/users` | With users, empty, loading |
| User Detail | `/users/:id` | With conversation, no messages |
| Settings | `/settings` | Default values, custom values, saving, error |
| Permissions | `/permissions` | All granted, some missing, none granted |
| Logs | `/logs` | Streaming, filtered, empty, high volume |
| Usage | `/usage` | With data, no data, different periods |
| System Tray | N/A | Each status variant, menu items |
| Update Dialog | N/A | Available, downloading, ready to install |
| Error States | N/A | Backend down, API error, permission revoked |

## Appendix B: Tools for Audit Execution

| Tool | Purpose |
|------|---------|
| **Playwright** | Automated accessibility checks, screenshot capture |
| **axe-core** | WCAG compliance scanning |
| **Chrome DevTools** (via Electron) | Performance profiling, CSS inspection, accessibility tree |
| **Colour Contrast Analyser** | Manual contrast ratio checks |
| **VoiceOver (macOS)** | Screen reader testing |
| **Keyboard-only navigation** | Tab order and focus testing |
| **`prefers-reduced-motion` toggle** | Animation accessibility testing |
| **`prefers-color-scheme` toggle** | Dark/light mode testing |

---

*This audit plan will be executed phase-by-phase. No auditing has been started — this document defines the plan only.*
