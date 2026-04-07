# TextMyAgent Desktop — Design & UI Research

> Deep research document covering onboarding, component libraries, layout strategies,
> Apple-like design principles, and Electron packaging guidance.
>
> **Date:** April 2026  
> **Current stack:** Electron 39 + Next.js 14 + Tailwind CSS 3 + Lucide icons + SWR  
> **Distribution:** Developer ID signed + Notarized DMG (not App Store)

---

## Table of Contents

1. [Onboarding Flow](#1-onboarding-flow)
2. [Design Principles — Apple-Like Premium Feel](#2-design-principles--apple-like-premium-feel)
3. [Color System & Theming](#3-color-system--theming)
4. [Component Library Recommendations](#4-component-library-recommendations)
5. [Responsive & Flexible Layout Strategy](#5-responsive--flexible-layout-strategy)
6. [Making Electron Feel Native on macOS](#6-making-electron-feel-native-on-macos)
7. [Micro-Interactions & Animation](#7-micro-interactions--animation)
8. [Packaging & Distribution Polish](#8-packaging--distribution-polish)
9. [Design Inspiration — Apps to Study](#9-design-inspiration--apps-to-study)
10. [Recommended Implementation Order](#10-recommended-implementation-order)

---

## 1. Onboarding Flow

### Why It Matters

Research across 200+ onboarding flows (source: DesignerUp) shows that 90% of users who
don't complete onboarding never return. For TextMyAgent, onboarding is *critical* because the
app requires three system permissions, an API key, and a conceptual understanding of what
the agent does.

### The Winning Formula (Research-Backed)

1. **Personalized onboarding** — "This is just for me" effect. Ask the user a question or two
   early (e.g., "What do you want Grace to help with?") so subsequent steps feel tailored.
2. **Progressive disclosure** — "Just-in-time" rule. Don't show everything at once. Reveal
   information only when the user needs it.
3. **Emotional engagement** — "Make it feel good" factor. Micro-rewards (checkmarks,
   progress bars, subtle animations) create dopamine hits that keep users engaged.

### Recommended Flow for TextMyAgent

```
Step 1: Welcome Screen
├── App logo + "Welcome to TextMyAgent"
├── Brief 1-sentence value prop
├── "Get Started" CTA button
│
Step 2: Permissions (progressive — one at a time)
├── Full Disk Access (explain WHY, show system screenshot)
│   ├── "Open System Settings" button
│   ├── Polling check: auto-detect when granted ✓
├── Automation (auto-prompted on first send)
│   ├── Explain briefly, show it will be prompted later
├── Contacts (optional, skip-able)
│   ├── "Enable" or "Skip for now"
│
Step 3: API Key Configuration
├── "Get your Anthropic API key" with link
├── Secure input field
├── Validate key on paste (show ✓ or ✗ immediately)
│
Step 4: Test Message
├── Send a test message to yourself
├── Show the response arriving in real-time
├── "Your AI assistant is ready!"
│
Step 5: Dashboard Tour (optional tooltip overlay)
├── Highlight sidebar sections briefly
├── "Dismiss" or auto-fade after 5 seconds
```

### Key Mistakes to Avoid

- **Too many steps** — Keep it to 4–5 screens maximum. Group related actions.
- **Wall of text** — Use visuals, icons, and short sentences. No paragraphs.
- **No escape** — Always provide a "Skip" or "Set up later" option. Users who feel trapped
  abandon apps.
- **No progress indicator** — Always show "Step 2 of 4" or a progress bar.

### UX Patterns to Use

| Pattern | Where | Why |
|---------|-------|-----|
| **Stepper/wizard** | Onboarding flow | Clear progression, reduces overwhelm |
| **Inline validation** | API key input | Instant feedback builds confidence |
| **Permission polling** | Full Disk Access step | User doesn't have to manually confirm |
| **Tooltip tour** | Post-onboarding dashboard | Non-blocking introduction to features |
| **Celebration moment** | End of onboarding | Confetti/checkmark, emotional reward |

---

## 2. Design Principles — Apple-Like Premium Feel

### Apple Human Interface Guidelines (HIG) — Key Takeaways for macOS

Apple's HIG distills down to these core principles relevant to TextMyAgent:

1. **Clarity** — Content is the focus. Use plenty of whitespace. Text should be legible at
   every size. Icons should be precise and clear.
2. **Deference** — The UI should help people understand and interact with content, never
   compete with it. Subtle translucency, clean typography, no visual clutter.
3. **Depth** — Visual layers and realistic motion create hierarchy. Use shadows, blur, and
   layering to communicate what's in front and what's behind.

### Specific macOS Design Patterns

| Element | Apple Way | Current TextMyAgent | Gap |
|---------|-----------|---------------------|-----|
| **Sidebar** | 220–240px wide, translucent/vibrancy, dimmed when unfocused | 240px, solid bg, no unfocused state | Add vibrancy + unfocused dimming |
| **Font** | SF Pro, 13px base (not 16px web default) | 14px base, system font ✓ | Good — 14px is acceptable |
| **Cursor** | Default arrow everywhere (pointer only for external links) | Likely using web defaults | Set `cursor: default` globally |
| **Spacing** | 8px grid system, generous margins | Using Tailwind spacing | Audit for consistency |
| **Corners** | 8–12px border-radius on cards, 6px on buttons | Mix of values | Standardize to 8/10/12px |
| **Colors** | Muted, high-contrast, system-aware | CSS variables, basic palette | Refine (see §3) |
| **Dark mode** | First-class, matches system | Supported ✓ | Polish transitions |
| **Typography hierarchy** | Clear weight/size distinctions, limited font sizes | Uses 11/13px sizes | Good start, formalize scale |

### The "Premium" Checklist

- [ ] **Consistent spacing** — 4/8/12/16/24/32px scale only
- [ ] **Limited color palette** — Max 2 accent colors + neutrals
- [ ] **Generous whitespace** — More space = more premium
- [ ] **Subtle shadows** — `0 1px 3px rgba(0,0,0,0.08)` not hard borders
- [ ] **Smooth transitions** — 150–200ms on state changes, eased
- [ ] **Typography hierarchy** — 3 sizes max per view (title/body/caption)
- [ ] **Icon consistency** — Same weight, same size grid (Lucide is good)
- [ ] **No visual noise** — Remove unnecessary borders, badges, decorations

---

## 3. Color System & Theming

### Current State

The app uses CSS custom properties with a simple light/dark toggle. Colors are functional
but don't feel distinctly "TextMyAgent."

### Recommended Color System

**Philosophy:** Apple-like neutrals with a single distinctive brand accent.

#### Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#ffffff` | Main background |
| `--color-bg-secondary` | `#f5f5f7` | Sidebar, cards (Apple's actual gray) |
| `--color-bg-tertiary` | `#ebebed` | Hover states, subtle fills |
| `--color-bg-elevated` | `#ffffff` | Cards, popovers (with shadow) |
| `--color-text` | `#1d1d1f` | Primary text (Apple's near-black) |
| `--color-text-secondary` | `#6e6e73` | Secondary text (Apple's gray) |
| `--color-text-tertiary` | `#86868b` | Captions, timestamps |
| `--color-border` | `#d2d2d7` | Dividers (Apple's actual border) |
| `--color-brand` | `#0071e3` | Primary actions (Apple's blue) |
| `--color-brand-hover` | `#0077ed` | Hover state |
| `--color-success` | `#34c759` | Apple's system green |
| `--color-warning` | `#ff9f0a` | Apple's system orange |
| `--color-error` | `#ff3b30` | Apple's system red |

#### Dark Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#000000` | Main background (true black like Apple) |
| `--color-bg-secondary` | `#1c1c1e` | Sidebar, cards |
| `--color-bg-tertiary` | `#2c2c2e` | Hover states |
| `--color-bg-elevated` | `#1c1c1e` | Cards (with subtle border) |
| `--color-text` | `#f5f5f7` | Primary text |
| `--color-text-secondary` | `#98989d` | Secondary text |
| `--color-text-tertiary` | `#636366` | Captions |
| `--color-border` | `#38383a` | Dividers |
| `--color-brand` | `#0a84ff` | Apple's dark mode blue |

> **Note:** These are Apple's actual system colors extracted from macOS.
> Using them makes the app feel instantly native.

---

## 4. Component Library Recommendations

### Decision Framework

| Criteria | Weight | Why |
|----------|--------|-----|
| Apple-like aesthetic | High | Core requirement — premium macOS feel |
| Next.js 14 compatibility | High | Current framework |
| Tailwind CSS integration | High | Already using Tailwind |
| Bundle size | Medium | Electron ships everything, less critical than web |
| Accessibility (WCAG) | High | Already have a11y patterns in place |
| Active maintenance | High | Long-term viability |
| Customizability | High | Need to match Apple aesthetic, not look generic |

### Top 3 Recommendations (Ranked)

---

#### 🥇 Recommendation: shadcn/ui

| Attribute | Details |
|-----------|---------|
| **Website** | https://ui.shadcn.com |
| **License** | MIT |
| **Architecture** | Copy-paste — components live in YOUR repo |
| **Built on** | Radix UI primitives + Tailwind CSS |
| **Next.js support** | First-class (official installation guide) |
| **Bundle impact** | Zero runtime dependency — you own the code |
| **Electron proven** | Yes — `electron-shadcn` boilerplate exists, multiple production apps |

**Why #1 for TextMyAgent:**
- **Full control** — You copy components into your project and own them. This means you
  can freely modify every component to match Apple's aesthetic without fighting a library.
- **Radix UI underneath** — Handles all accessibility (ARIA, keyboard nav, focus management)
  correctly. You already have good a11y; this maintains it.
- **Tailwind native** — You're already using Tailwind. Zero learning curve for styling.
- **No lock-in** — Unlike Mantine or MUI, if shadcn/ui stops being maintained, your code
  doesn't break. You just have local component files.
- **Community ecosystem** — Huge community of custom themes, including Apple/macOS-inspired
  themes. shadcn/ui is the most popular React component approach in 2025–2026.

**Specific components you'd use:**
- `Dialog` — For onboarding wizard, settings modals, preferences window
- `Tabs` — For dashboard sections, settings categories  
- `Command` — For a Raycast/Spotlight-style command palette (nice-to-have)
- `Toast` — For notifications (agent started, message sent, errors)
- `Sheet` — For mobile-width side panels
- `Tooltip` — For onboarding tour, icon explanations
- `Progress` — For onboarding stepper
- `Switch` — For settings toggles
- `Table` — For messages list, logs
- `Badge` — For status indicators
- `Skeleton` — For loading states

**Migration effort: LOW** — You can adopt incrementally, one component at a time. No need
to rewrite anything. Just add components you need.

---

#### 🥈 Alternative: Mantine

| Attribute | Details |
|-----------|---------|
| **Website** | https://mantine.dev |
| **License** | MIT |
| **Architecture** | Package install — `@mantine/core` |
| **Built on** | Custom primitives, own styling engine |
| **Next.js support** | Good (official docs) |
| **Bundle impact** | ~45KB gzipped (core), tree-shakeable |
| **Electron proven** | Yes — used in Tauri and Electron apps |

**Why it's a good alternative:**
- Batteries-included: 100+ components, 60+ hooks (`useForm`, `useNotifications`, etc.)
- Beautiful default theme that's cleaner/more neutral than MUI or Ant Design
- Excellent Figma kit for design handoff
- Built-in `Stepper` component — perfect for onboarding wizard
- `Spotlight` component — command palette out of the box

**Why it's #2 not #1:**
- Package dependency means you're locked to their release cycle
- Styling system (CSS modules by default) is a second system alongside your Tailwind
- Slightly opinionated aesthetics — harder to make look exactly like macOS
- Heavier than shadcn/ui for what you need

---

#### 🥉 Alternative: HeroUI (formerly NextUI)

| Attribute | Details |
|-----------|---------|
| **Website** | https://heroui.com |
| **License** | MIT |
| **Architecture** | Package install — `@heroui/react` |
| **Built on** | React Aria (Adobe) + Tailwind CSS |
| **Next.js support** | Good |
| **Bundle impact** | ~40KB gzipped, tree-shakeable |
| **Electron proven** | Less proven than shadcn/ui or Mantine |

**Why notable:**
- Gorgeous default aesthetic — closest to Apple's design out of the box
- Built on React Aria (Adobe's accessibility primitives) — excellent a11y
- Tailwind-native like shadcn/ui
- Smooth animations built-in

**Why it's #3:**
- Younger ecosystem, smaller community
- Less battle-tested in Electron specifically
- Some reports of customization complexity for deep changes
- React Aria under the hood can make debugging harder

---

#### Libraries Considered But Not Recommended

| Library | Reason to Skip |
|---------|---------------|
| **MUI (Material UI)** | Google Material Design aesthetic — antithetical to Apple-like feel. Heavy. |
| **Ant Design** | Enterprise-oriented, Chinese design language, very opinionated. Heavy (200KB+). |
| **Chakra UI** | In transition (v3 → Ark UI). Uncertain future. Style doesn't match macOS. |
| **Fluent UI** | Microsoft's design language — not appropriate for a macOS-first app. |
| **Blueprint UI** | Data-heavy apps (like Palantir). Overkill and wrong aesthetic. |

---

## 5. Responsive & Flexible Layout Strategy

### The Desktop Responsive Challenge

Unlike web apps targeting phones → tablets → desktop, Electron apps target a
**single platform** (macOS) but need to handle:

- **Window resizing** — Users freely drag edges from ~800px to ultrawide
- **Full screen** — macOS full-screen mode on various display sizes
- **Split view** — macOS split-screen (half of 1440p = ~720px, half of 5K = ~1280px)

### Recommended Breakpoint Strategy

Don't use mobile-first breakpoints. Use **desktop-first with collapse points**:

```
┌─────────────────────────────────────────────────────┐
│ Full layout (>= 1200px)                             │
│ ┌──────────┬────────────────────────────────────┐   │
│ │ Sidebar  │  Content (4-column grid)            │   │
│ │ 240px    │                                     │   │
│ └──────────┴────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│ Medium layout (900px – 1199px)                      │
│ ┌──────────┬────────────────────────────────────┐   │
│ │ Sidebar  │  Content (2-column grid)            │   │
│ │ 200px    │                                     │   │
│ └──────────┴────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│ Compact layout (800px – 899px)                      │
│ ┌────┬──────────────────────────────────────────┐   │
│ │Icon│  Content (1-column, sidebar icons only)   │   │
│ │64px│                                           │   │
│ └────┴──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Implementation Approach

#### CSS Container Queries (Recommended over Media Queries)

Container queries let components respond to their *own container's* size, not the viewport.
This is ideal for Electron where the BrowserWindow IS the viewport.

```css
/* Define containers */
.main-content { container-type: inline-size; }

/* Respond to container width, not viewport */
@container (min-width: 800px) {
  .stats-grid { grid-template-columns: repeat(4, 1fr); }
}
@container (max-width: 799px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
```

**Browser support:** Chromium 105+ — Electron 39 ships Chromium 128+, so this is fully supported.

#### Sidebar Collapse Strategy

| Window Width | Sidebar State | Width |
|-------------|--------------|-------|
| >= 1000px | Full (labels + icons) | 240px |
| 800–999px | Collapsed (icons only) | 64px |
| < 800px | Hidden (hamburger toggle) | 0px |

Use CSS `transition: width 200ms ease` for smooth collapse animation.

#### Tailwind Utility Classes for Desktop

```
/* Stats grid that adapts */
grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4

/* Content with max-width for readability on ultrawide */
max-w-[1200px] mx-auto

/* Sidebar that collapses */
w-[240px] lg:w-[240px] md:w-[64px]
```

### Key Layout Rules

1. **Max content width** — Cap main content at 1200px and center it. Prevents unreadable
   line lengths on ultrawide monitors.
2. **Minimum window size** — Already set to 800×600 in `main.ts`. Good.
3. **Sticky elements** — Sidebar should be fixed. Page headers should be sticky at top.
4. **Scroll containers** — Only the main content area scrolls, never the sidebar.
5. **Grid gap consistency** — Use `gap-4` (16px) for grids, `gap-6` (24px) for sections.

---

## 6. Making Electron Feel Native on macOS

### Critical Native-Feel Details

These are patterns extracted from research on shipping polished Electron macOS apps
(sources: Lotus app by Vadim Demedes, Missive, Linear, Notion).

#### 6.1 Window Behavior

| Feature | Implementation | Status in TextMyAgent |
|---------|---------------|----------------------|
| **Hide on close** (minimize to tray) | `mainWindow.on('close', e => { e.preventDefault(); mainWindow.hide() })` | ✅ Already done |
| **Show when ready** (no white flash) | `show: false` + `ready-to-show` event | ✅ Already done |
| **Remember window position** | Use `electron-window-state` package | ❌ Not implemented |
| **Background color matching** | Set `backgroundColor` to match dark/light theme | ✅ Partially done |
| **Vibrancy/translucency** | `vibrancy: 'under-window'` on BrowserWindow | ✅ Already done |
| **Traffic light position** | `trafficLightPosition: { x: 15, y: 15 }` | ✅ Already done |
| **Single instance lock** | `app.requestSingleInstanceLock()` | ✅ Already done |

#### 6.2 UI Behavior

| Feature | Implementation | Priority |
|---------|---------------|----------|
| **Default cursor everywhere** | `*, a, button { cursor: default; }` — pointer only for external links | HIGH |
| **Disable text selection** | `user-select: none` on UI chrome (not content) | HIGH |
| **Window unfocus dimming** | Detect focus/blur via IPC, gray out active colors in sidebar | MEDIUM |
| **System font** | `-apple-system, BlinkMacSystemFont, 'SF Pro Text'` | ✅ Done |
| **14px base font** | `html { font-size: 14px }` | ✅ Done |
| **Native scrollbars** | Thin overlay scrollbars matching macOS | ✅ Done |

#### 6.3 Menu Bar & Keyboard Shortcuts

| Feature | Priority |
|---------|----------|
| Standard macOS menu (Edit, View, Window, Help) | HIGH |
| `⌘,` opens Preferences/Settings | HIGH |
| `⌘R` refresh/restart | MEDIUM |
| `⌘Q` quit | ✅ Already works |
| `⌘W` hides window (doesn't quit) | MEDIUM |

#### 6.4 Native Sidebar with Vibrancy (Advanced)

The `electron-tinted-with-sidebar` package allows dual vibrancy zones — a translucent
sidebar + opaque main content — matching native macOS apps like Finder, Notes, and Mail.

```
npm install electron-tinted-with-sidebar
```

API:
```javascript
const tint = require('electron-tinted-with-sidebar');
tint.setWindowLayout(win.getNativeWindowHandle(), 240, 52);
```

This creates a true native `NSVisualEffectView` behind the sidebar area, giving the
frosted-glass effect that makes apps feel like they belong on macOS.

**Alternative (free):** Use Electron's built-in `vibrancy: 'sidebar'` which provides a
similar but less customizable effect. TextMyAgent already uses `vibrancy: 'under-window'`.
Switching to `'sidebar'` and making the sidebar background transparent would get 80% of
the way there.

---

## 7. Micro-Interactions & Animation

### Recommended Library: Framer Motion (now "Motion")

| Attribute | Details |
|-----------|---------|
| **Package** | `motion` (formerly `framer-motion`) |
| **License** | MIT |
| **Size** | ~15KB gzipped (tree-shakeable) |
| **React support** | First-class |

### Where to Add Animations

| Element | Animation | Duration |
|---------|-----------|----------|
| **Page transitions** | Fade + slight slide-up on route change | 200ms |
| **Card hover** | Subtle scale(1.01) + shadow lift | 150ms |
| **Status badge** | Pulse animation on "Running" state | Continuous, subtle |
| **Sidebar nav** | Background-color slide on active item change | 150ms |
| **Toast notifications** | Slide in from top-right, fade out | 300ms in, 200ms out |
| **Onboarding steps** | Crossfade between steps | 250ms |
| **Stats counter** | Number count-up on load | 400ms, eased |
| **Loading states** | Skeleton shimmer (already supported by shadcn/ui) | Continuous |

### Animation Principles for Desktop

1. **Faster than web** — Desktop animations should be 100–200ms, not 300–500ms.
   Desktop users expect snappy responses.
2. **Respect `prefers-reduced-motion`** — Already have the CSS media query. Framer Motion
   respects it automatically with `useReducedMotion()`.
3. **Physics-based** — Use spring animations (`type: "spring"`) for natural feel.
   Avoid linear easing.
4. **Purposeful** — Every animation should communicate something (entrance, state change,
   feedback). No animation for decoration.

---

## 8. Packaging & Distribution Polish

### DMG Design

The current DMG is functional but could be more premium:

| Element | Current | Recommended |
|---------|---------|-------------|
| **Background** | White (#ffffff) | Custom branded image (1080×660 @2x) with app name and subtle gradient |
| **Icon size** | 100px | 128px |
| **Window size** | 540×380 | 600×420 |
| **Layout** | App icon + Applications alias | Same, but with background artwork |

Create a `background.png` and `background@2x.png` in `resources/` for the DMG:
- Subtle gradient or pattern with TextMyAgent branding
- Clear visual arrow or guide showing drag direction
- Retina-ready (2x image for HiDPI)

### App Icon

Current icon exists at `resources/icons/icon.icns`. Ensure:
- All sizes present in the `.iconset` (16, 32, 64, 128, 256, 512, 1024 @1x and @2x)
- Icon follows Apple's shape guidelines (rounded square with shadow)
- Looks good at 16×16 in the menu bar and 512×512 in Finder

### Splash/Loading State

When the app launches, there's a brief moment while Electron loads. Current implementation
uses `show: false` + `ready-to-show`. Consider:
- Setting `backgroundColor` to exactly match the app's sidebar color
- Adding a lightweight HTML splash that shows the app icon + "Loading..." before React hydrates
- The splash should match dark/light mode using `nativeTheme.shouldUseDarkColors`

### Auto-Updater UX

Current: `electron-updater` with GitHub Releases. Polish opportunities:
- Show a subtle in-app banner "Update available" (not a blocking modal)
- "Download in background" button
- "Restart to update" when download completes
- Show release notes in the update prompt

### Tray Icon

- Use a template image (grayscale, 16×16 or 18×18) for the menu bar
- Template images automatically adapt to light/dark menu bar
- Name it `iconTemplate.png` and `iconTemplate@2x.png`

---

## 9. Design Inspiration — Apps to Study

### Tier 1: Best-in-Class Electron/Web-Tech macOS Apps

| App | What to Study | Why |
|-----|--------------|-----|
| **Linear** | Layout, typography, animations, command palette | Gold standard for Electron design. Feels completely native. Sidebar + main content pattern identical to TextMyAgent. |
| **Notion** | Sidebar navigation, page transitions, onboarding | Excellent progressive disclosure. Clean typography. |
| **Raycast** | Command palette, preferences window, settings design | Premium macOS-first app. Perfect keyboard shortcuts. |
| **Arc Browser** | Sidebar, vibrancy, color customization | Pushing boundaries of what Electron can look like on macOS. |
| **Missive** | Email client layout, dark mode, vibrancy | Dual-pane with native vibrancy. Excellent dark mode. |

### Tier 2: Native macOS Apps to Reference

| App | What to Study |
|-----|--------------|
| **Apple Mail** | Sidebar layout, toolbar, master-detail pattern |
| **Apple Notes** | Three-column layout, simple typography |
| **Apple Music** | Vibrancy, sidebar, now-playing indicators |
| **System Settings** | Settings/preferences layout, toggle patterns |
| **Finder** | Sidebar icons, toolbar, status bar |

### Key Patterns Across All

- Sidebar is always 200–260px
- Active sidebar item uses a filled background (blue or gray)
- Content area has generous top padding (titlebar + toolbar ≈ 50–52px)
- Cards use subtle shadows, not borders (or very faint borders)
- Monochrome iconography — single color or system gray
- Typography: 2–3 sizes per view, one weight for body, one for headings

---

## 10. Recommended Implementation Order

### Phase 1: Foundation (Low effort, high impact)

1. **Update color system** — Swap CSS variables to Apple system colors (§3)
2. **Global cursor fix** — `cursor: default` on all elements (§6.2)
3. **Add `electron-window-state`** — Remember window position/size (§6.1)
4. **Standardize spacing** — Audit and enforce 4/8/12/16/24/32px scale (§2)
5. **Typography audit** — Ensure consistent size scale across all pages

### Phase 2: Component Library (Medium effort, high impact)

6. **Install shadcn/ui** — Initialize with Tailwind, add to dashboard
7. **Migrate core components** — Dialog, Toast, Tooltip, Switch, Table, Badge, Progress
8. **Add Framer Motion** — Page transitions + card animations
9. **Build onboarding wizard** — Using shadcn/ui Dialog + Stepper pattern (§1)

### Phase 3: Layout Polish (Medium effort, medium impact)

10. **Sidebar collapse** — Responsive sidebar with icon-only mode (§5)
11. **Container queries** — Replace media queries in stats grid (§5)
12. **Max content width** — Cap at 1200px, center on ultrawide (§5)
13. **Window unfocus handling** — Dim sidebar on blur (§6.2)

### Phase 4: Native Feel (Higher effort, high impact)

14. **macOS menu bar** — Standard Edit/View/Window/Help menu (§6.3)
15. **Keyboard shortcuts** — ⌘, for settings, ⌘R for refresh (§6.3)
16. **Sidebar vibrancy** — Switch to `vibrancy: 'sidebar'` or `electron-tinted-with-sidebar` (§6.4)
17. **Preferences window** — Separate native-like window for settings (§6)

### Phase 5: Distribution Polish (Lower effort, medium impact)

18. **DMG background** — Custom branded artwork (§8)
19. **Tray template icon** — Proper 16×16 template image (§8)
20. **Update UX** — Non-blocking update banner (§8)
21. **Loading splash** — Themed splash matching dark/light mode (§8)

---

## Appendix A: Package Summary

| Package | Purpose | License | Install |
|---------|---------|---------|---------|
| `shadcn/ui` | Component library (copy-paste) | MIT | `npx shadcn@latest init` |
| `@radix-ui/*` | Accessibility primitives (via shadcn) | MIT | Auto-installed |
| `motion` | Animations | MIT | `npm install motion` |
| `electron-window-state` | Remember window position | MIT | `npm install electron-window-state` |
| `electron-tinted-with-sidebar` | Native vibrancy zones | MIT | `npm install electron-tinted-with-sidebar` |
| `class-variance-authority` | Component variant styling (via shadcn) | Apache 2.0 | Auto-installed |
| `clsx` + `tailwind-merge` | Conditional class merging (via shadcn) | MIT | Auto-installed |

## Appendix B: Reference Links

- [Apple HIG — macOS](https://developer.apple.com/design/human-interface-guidelines/)
- [Apple HIG — Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [shadcn/ui](https://ui.shadcn.com)
- [shadcn/ui Next.js install](https://ui.shadcn.com/docs/installation/next)
- [electron-shadcn boilerplate](https://github.com/LuanRoger/electron-shadcn)
- [Mantine](https://mantine.dev)
- [HeroUI (NextUI)](https://heroui.com)
- [Framer Motion / Motion](https://motion.dev)
- [Making Electron Feel Native on Mac](https://dev.to/vadimdemedes/making-electron-apps-feel-native-on-mac-52e8)
- [electron-tinted-with-sidebar](https://github.com/davidcann/electron-tinted-with-sidebar)
- [Onboarding UX Research (200+ flows)](https://designerup.co/blog/i-studied-the-ux-ui-of-over-200-onboarding-flows-heres-everything-i-learned/)
- [React UI Libraries Comparison 2025](https://makersden.io/blog/react-ui-libs-2025-comparing-shadcn-radix-mantine-mui-chakra)
- [CSS Container Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries)
