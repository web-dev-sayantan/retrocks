# Retrocks Board Page (`/b/:id`) — UI/UX Audit & Redesign Plan

> **Scope:** Visual hierarchy, spacing, sizing, zero-CLS interaction architecture, and Apple-inspired tactile polish for the individual Board workspace (`/b/:id`), aligning it directly with the redesigned Home page (`4a0fa69`) while preserving all 4 color themes (`light`, `dark`, `retro`, `parchment`), all 8 Column accents, all `SPEC.md` behavioral contracts, `GLOSSARY.md` terminology, `@media print` output, easter eggs, and the test suite.
>
> **Audit Basis:** Live visual & interactive inspection of `http://localhost:3001` (Home + newly created Standard Retro Board populated with standalone Cards, a Card Group, Votes, reactions, comments, and Action Items) across `1440×900` (Dark & Light), `1024×768` (Dark), and `375×812` (Mobile Dark), cross-referenced against the Home page commit `4a0fa69` and source components.

---

## 1. Executive Summary & Live Audit Findings

Comparing the redesigned Home page (`/`) against the live Board page (`/b/:id`) reveals a stark generational split:

- **The Home page** promises a calm, studio-grade workspace: a floating glass Dynamic Island (`.home-island`), strictly rationed `--retrocks-accent`, crisp `LucideIcon` strokes, recessed segmented controls with critically damped sliding thumbs, and a `BoardPreview` framing Columns with clean `4px` accent bars and subtle 5% header tints.
- **The current Board page** feels like an earlier wireframe prototype: `229px` of stacked desktop chrome (`389px` on mobile!), noisy `border-control` boxes stamped onto every filter pill, `bg-accent` wasted on the passive default `"All"` filter, 10 distinct interactive layout shifts (up to `+180px` in-flow card expansion), orphaned reaction rows, triple-redundant Action Item labels, and `167px`-tall Card Group headers.

### 1.1 Interactive Layout Shift Audit (Zero-CLS Inventory)

Every shift below was directly observed in the live DOM and confirmed in source code:

| # | Interaction | Measured Shift | Root Cause in Source | Target Behavior (Zero-CLS) |
| :- | :--- | :---: | :--- | :--- |
| **1** | **Search or Filter (`Mine` / `Voted` / `Action Items`)** | **`+44px` vertical** (entire Board shifts down) | [BoardFilterBar.tsx](../src/components/BoardFilterBar.tsx#L195-L221) mounts a second row (`mt-2`) below the toolbar for match count + `Clear filters`. | Integrate match count pill + compact `Clear filters` action inline on the right side of the single toolbar row (desktop) or reserved compact status pill, producing `0px` vertical shift on desktop. |
| **2** | **Inline Board Title Rename (`✎`)** | **`-9px` vertical** + type drop (`36px → 16px`) | [BoardWorkspace.tsx](../src/components/BoardWorkspace.tsx#L1535-L1576) swaps a `45px`-tall `text-4xl` `<h1>` for a `34px`-tall `text-base` `<input>`. | Match `<input>` typography (`text-xl sm:text-2xl font-semibold tracking-tight`), height, and vertical alignment to the `<h1>` so editing happens in-place with `0px` header height delta. |
| **3** | **Toggle Private Mode / Reveal All** | **`+28px` vertical** + horizontal push | [BoardWorkspace.tsx](../src/components/BoardWorkspace.tsx#L1762-L1801) appends a wrapping `basis-full` helper paragraph (`"Only you can read your Cards until they’re revealed."`) inside the header row and swaps widths. | Keep the Private Mode status + `Reveal All` trigger in a compact, fixed-height pill cluster; render the explanatory note in a sleek, non-intrusive status strip or tooltip/popover cue without inflating the primary header bar, or reserve a clean collapsible banner with smooth grid/transform entry below the floating island. |
| **4** | **Focus `+ Add Card` Composer** | **`+58px` permanent asymmetric shift** | [ColumnPanel.tsx](../src/components/ColumnPanel.tsx#L93) latches `hasFocusedComposer` to `true` forever, switching `rows={1 → 2}` (`44px → 66px`) and mounting the hint + `Add` row below. Cards in clicked Columns permanently sit `58px` lower than untouched Columns. | Make the composer a single compact, consistent inline surface with an embedded `Add` button inside its right edge (and `Enter` hint subtly surfaced on focus/hover via `title`/helper without adding a `36px` external bar). Auto-collapse cleanly on blur/Escape/submit when empty. |
| **5** | **Open Card Reaction Picker (`☺+`)** | **`+74px` vertical** inside Card | [CardReactions.tsx](../src/components/CardReactions.tsx#L154-L187) renders the 6-emoji picker **in document flow** (`basis-full`) inside `<article>`, shoving all lower Cards down. | Position the picker as an anchored floating popover (`position: absolute`, `bottom-full` / `top-full`, `z-30`, glass/elevated surface, `@starting-style` scale-from-trigger) inside `controls` (`root.contains()` focus/click logic remains 100% intact). |
| **6** | **Open Card Actions (`···`) Menu** | **`+140–220px` vertical** inside Card | [CardItem.tsx](../src/components/CardItem.tsx#L764-L773) uses `class="relative z-10 mt-1 ml-auto"` **in document flow**, stretching the Card vertically to contain its own menu. | Position as an anchored floating overlay (`position: absolute right-0 top-full z-30` with viewport-edge flip upward if near bottom), with `0px` shift to surrounding Cards. |
| **7** | **Open Card Group `Move to…` Menu** | **`+120px` vertical** inside Group header | [CardGroupItem.tsx](../src/components/CardGroupItem.tsx#L399-L428) mounts a `basis-full` menu inside the Group header flex container. | Float as an anchored popover (`position: absolute right-0 top-full z-30`) from the Move trigger button. |
| **8** | **Click `+ Add a Column`** | **`+96px` full-Board jump** (spatially disconnected) | [BoardWorkspace.tsx](../src/components/BoardWorkspace.tsx#L1937-L2034) mounts a full-width form *above* `<main>`, far away from the `+ Add a Column` button on the far right. | Open the Add Column form either **in-place** as a sleek column-width card/popover anchored directly to the `+ Add a Column` rail/trigger or as a compact modal dialog — zero vertical jump of existing Columns. |
| **9** | **Pending Action / Reaction Status** | **`+20px` flicker** on every click | [CardItem.tsx](../src/components/CardItem.tsx#L880-L882) and [CardReactions.tsx](../src/components/CardReactions.tsx#L190-L192) mount `<p role="status">` in-flow during brief async requests. | Keep `role="status"` as `sr-only` for screen readers while showing subtle visual pending opacity/pulse on the active button itself (`0px` height flicker). |
| **10** | **Countdown Timer State Changes** | **`+1.5px` → `+54px` horizontal** | [CountdownTimer.tsx](../src/components/CountdownTimer.tsx#L254-L280) switches text between `Timer`, `05:00`, and `Paused 05:00` with no `min-w` reserve, nudging sibling header controls. | Set a balanced `min-w-[5.25rem]` (and use a compact pause icon + `tabular-nums` time readout instead of prepending the wide word `"Paused"` visibly while keeping `"Paused"` in `sr-only` / `aria-label` — wait: verify `SPEC §3.5` *"visible paused state"* via a crisp amber dot/pause badge inside a stable width!). |

---

### 1.2 Visual Hierarchy, Spacing, Sizing & Iconography Issues

1. **Chrome Bloat & Broken Visual Continuity with Home (`229px` desktop / `389px` mobile):**
   - Desktop renders 4 stacked horizontal bands before any Column starts: Brand row (`Retrocks` with an outdated `10px` square dot instead of Home's circular `Columns3` mark) → oversized `36px` `<h1>` → status/timer/private-mode/votes row → `63px` filter bar.
   - Mobile stacks **389px** of top chrome plus **88px** of sticky bottom composer, leaving barely **335px** (less than half of an `812px` screen) to read Cards.
2. **Inconsistent Header Control Sizing, Radii & Typography:**
   - Five adjacent header controls mix **3 typography scales** and **2 radii**: `Timer` (`rounded-full`, `text-xs font-semibold`), `Private Mode` (`rounded-lg`, `text-sm font-medium`), `Action Items` (`rounded-lg`, `text-xs font-medium` with a nested bordered pill inside a bordered button), `Share` (`rounded-lg`, `text-xs font-medium`), and `More` (`rounded-lg`, `text-sm font-medium`).
   - **No primary action anchor:** `Share` has the exact same low-contrast outline style as `More` and `Action Items`, while the passive default `"All"` filter pill below it is flooded with solid `bg-accent text-accent-contrast`!
3. **Wireframe Outline Noise (`border-control` Spam):**
   - `BoardFilterBar` stamps heavy `border-control` (`#777d79` / `#81877e`) outlines onto Search, all 4 filter buttons, and Sort — creating borders *brighter* than actual Card borders in dark mode.
   - Redundant visible `"Search"` and `"Sort"` text labels consume horizontal width beside self-explanatory icon-led controls, and the native `<select>` displays a misaligned browser-default arrow.
4. **Column Framing Discontinuity & `1024px` Squeeze:**
   - Home's `BoardPreview` uses crisp architectural Column rails (`h-1` accent top bar + 5% tinted header + subtle outer rail border). The live Board drops all Column framing onto raw canvas.
   - At `1024×768`, placing `+ Add a Column` (`140px`) in a 4th grid track (`grid-cols-[repeat(3,minmax(0,1fr))_auto]`) compresses 3 Columns to `262px` wide, forcing Card footers and Card Group headers to wrap into jagged two-row layouts.
5. **Card Anatomy Clutter & Dead Whitespace:**
   - **Orphaned empty reaction row:** Every Card with zero reactions renders a lonely `24×24px` smiley+ icon on its own dedicated row under the text, creating ~32px of awkward blank space.
   - **Triple-redundant Action Item chrome:** Action Item cards display (1) a chunky full-width bordered container with `[ ] Open` and ~280px of empty dark void, (2) an `"Action Item"` pill right below it, and (3) an `"Actions"` badge in the Column header.
   - **Duplicate comment triggers:** Once a Card has ≥1 comment, the footer renders *two* separate speech-bubble buttons (`[💬 1]` on the left AND `[💬]` on the right) that both open the exact same `CardDetailDrawer`.
   - **`Group with…` menu overflow:** Target Card previews inside the submenu have no `line-clamp`, letting multi-sentence Cards stretch the menu to 7+ lines per item.
6. **Card Group Header Breakdown (`167.5px` tall!):**
   - Auto-generated Group titles wrap 4–5 lines and truncate mid-word at 120 chars without an ellipsis (`"...unblocked edge cas"`).
   - The expand chevron floats vertically centered in a wide empty left margin, `2 cards` wraps below, and the Vote stepper + Move/Rename/Dissolve icons break onto a third row.
   - Double borders (`rounded-xl border` Group wrapping `rounded-lg border` child Cards) add visual heaviness.
7. **Drawer, Modal & Iconography Inconsistencies:**
   - **Drawer widths mismatch:** `CardDetailDrawer` is `max-w-md` (`448px`); `ActionItemsDrawer` is `max-w-lg` (`512px`).
   - **ALL-CAPS labels** (`ACTION ITEM`, `COMMENTS`) in `CardDetailDrawer` contradict `frontend-design` guidance and the Sentence Case used across `ActionItemsDrawer`, `ShareBoard`, and `BoardVotingSettings`.
   - **Two separate drawer CSS systems:** `.card-detail-dialog` (manual scrim div) vs `.action-items-dialog` (`::backdrop`), neither using spring/fluid feel.
   - **Modal heading & close button drift:** `ShareBoard` (`text-xl`, `min-h-11 px-3` close button) vs `BoardVotingSettings` (`text-base`, `size-9` close button).
   - **Legacy custom SVGs (`Icons.tsx`):** The Board still uses 16×16 hand-coded SVGs with mixed `1.5` and `1.75` strokes instead of the tree-shakable `LucideIcon` system introduced in `4a0fa69`.
   - **Mobile usability gaps (`375×812`):** Column tabs hard-clip `"Action Items"` with a visible horizontal scrollbar and no edge fade; `<main>` lacks bottom scroll clearance (`pb-4`) so the sticky bottom composer occludes lower Cards' vote/action controls; `More` menu stays open after toggling the theme.

---

## 2. Pass 1 — Compact Design System & Layout Concept (`frontend-design`)

### 2.1 Subject Matter & Aesthetic Point of View

- **Subject:** Live & async agile retrospective workspace for engineering and product teams — zero-login, calm, anonymous, and fast.
- **Primary Job:** Keep attention on **people's thoughts (Cards)** and **shared decisions (Votes & Action Items)** while keeping facilitation controls (Timer, Private Mode, Share, Filters) immediately reachable yet visually quiet.
- **Signature Focal Choice ("Spend your boldness in one place"):** Carry the Home page's **floating translucent studio chrome (`.board-island`)** and **architectural accent-capped Column rails** onto `/b/:id`, keeping every Card and secondary control razor-quiet so the Board's own Column accents and participant content carry the color and energy.

### 2.2 Color Token System (Preserved Verbatim Across All 4 Themes)

No palette tokens are altered; hierarchy comes from disciplined surface layering and strict accent rationing:

| Role | Light | Dark | Usage Discipline |
| :--- | :--- | :--- | :--- |
| **Canvas (`--retrocks-canvas`)** | `#F7F5F0` | `#1C1E20` | Open workspace backdrop & recessed segmented/vote wells |
| **Surface (`--retrocks-surface`)** | `#FFFFFF` | `#27292C` | Opaque Cards, floating island glass (`80%` + `blur(20px)`), popovers, drawers |
| **Surface Subtle (`--retrocks-surface-subtle`)** | `#EDEAE3` | `#313337` | Column rail wells, active segmented thumb (dark), hover fills, quiet metadata chips |
| **Border (`--retrocks-border`)** | `#D9D5CC` | `#515456` | Soft structural hairlines (`border-border/75` default; reserve `border-control` strictly for text inputs) |
| **Text / Muted (`--retrocks-text` / `-muted`)** | `#202522` / `#555C56` | `#F6F5F1` / `#BFC3BF` | High-contrast body copy & calm secondary metadata |
| **Accent (`--retrocks-accent`)** | `#255B48` | `#ABD7C2` | **Rationed strictly to:** Retrocks brand mark, `Share` (primary board CTA — or `Reveal All` when Private Mode is ON), `Add` / `Save` / `Post` submit buttons, and active checkbox/vote-cast emphasis. **Never** on the passive `"All"` filter pill. |

*(Plus `retro` `#1A1713`/`#FFC46B`, `parchment` `#F4EAD5`/`#644724`, focus `#414BB0`/`#AAB2FF`, and the 8 pastel Column accents unchanged.)*

### 2.3 Typography Scale & Optical Discipline

Single system sans-serif family (`--font-sans`) + monospace (`--font-mono`) strictly for keyboard shortcuts (`/`), file extensions (`.md`), and `retro` theme; `tabular-nums` on every count, timer, and vote total.

| Element | Size / Line-Height | Weight & Tracking | Notes |
| :--- | :--- | :--- | :--- |
| **Board Title (`<h1>` & inline `<input>`)** | `20px` (`text-xl`) mobile / `22–24px` (`sm:text-2xl`) desktop, `leading-tight` | `600`, `tracking-[-0.025em]` | Down from bloated `36px` so the header stays compact; identical size in edit mode (`0px` shift). |
| **Board Subtitle** | `13px–14px`, `leading-snug` | `400`, `text-text-muted`, `max-w-[65ch]` | Only rendered when non-empty. |
| **Column Title (`<h2>`)** | `15px` (`text-[15px]`), `leading-snug` | `600`, `tracking-[-0.015em]` | Crisp, scannable, matches `BoardPreview`. |
| **Card Body** | `15px–16px` (`text-base` per SPEC §4.1: *"Start Card and composer text at 1 rem"*), `leading-[1.5]` | `400`, `tracking-normal` | Preserves SPEC 1 rem floor with generous readability. |
| **Controls / Tabs / Menus** | `13px` (`text-[13px]`), `leading-none` | `500` (inactive) / `600` (active) | Unified across ALL header pills, toolbar controls, and menus. |
| **Micro Metadata (timestamps, badges)** | `12px` (`text-xs`), `tabular-nums` | `500`, `tracking-[0.005em]` | Zero `10px` squint pills; zero ALL-CAPS tracked eyebrows. |

### 2.4 Unified Sizing & Radius Ladder

- **Interactive Control Heights:**
  - Desktop (`>= 640px`): **`36px` (`h-9`)** for all primary header/toolbar controls (Search, Segmented Filter, Sort, Timer, Private Mode, Action Items, Share, More); **`28px` (`h-7`)** for compact in-card icon/vote buttons.
  - Mobile (`< 640px`): **`44px` (`min-h-11`)** across every interactive tap target (WCAG / Apple HIG / SPEC §4.2 floor).
- **Border-Radius Hierarchy (Encodes Elevation — Never Flatly Uniform):**
  - Floating Island / Modals / Mobile Sheet tops: `rounded-2xl` (`16px`)
  - Column Rails / Card Groups / Popover Menus: `rounded-xl` (`12px`)
  - Standalone Cards / Inputs / Segmented Tracks / Primary Buttons: `rounded-lg`–`rounded-xl` (`10px`–`12px`)
  - Segmented Thumb / Inner Chips / Compact Steppers: `rounded-lg` (`8px`)
  - Status Pills / Reaction Chips / Avatar-free Badges / Brand Mark: `rounded-full`

### 2.5 Layout Concept & ASCII Wireframes

**Prose concept:** Replace the 4-row stacked header+toolbar (`229px`) with a **two-band studio header (`~116px` total)**:
1. **Top Floating Workspace Island (`.board-island`, sticky, `56px` desktop):** Full-width capped container (`max-w-[1600px]`) holding the translucent glass pill bar — brand home mark + editable Board title on the left, live presence + facilitation controls (`Timer`, `Private Mode` / `Reveal All`, `Blind Voting` / `Locked` status) + collaboration actions (`Action Items`, primary `Share`, `More`) on the right.
2. **Quiet Utility Strip (`48px` desktop, borderless or hairline-separated):** Left-aligned border-soft Search input (`/`), recessed spring-animated Segmented Filter (`All | Mine | Voted | Action Items`), custom-styled Sort dropdown, and right-aligned live Vote budget (`2 / 5 votes left`) + inline active filter summary & `Clear filters` (so filtering never adds a row!).
3. **Architectural Column Workspace:** Equal-width framed Column rails (`rounded-2xl`, `3px` top accent cap + 5% header tint, matching Home's `BoardPreview`) holding quiet opaque Cards (`bg-surface`) and streamlined Card Groups.

#### Desktop (`1440×900`) Wireframe
```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  ╭────────────────────────────────────────────────────────────────────────────────────╮  │
│  │ (⊞) | Sprint Retrospective — Nov 20  ✎      ● Live 1  (⏱ 05:00)  [👁 Private Mode] │  │
│  │                                          |  [⚑ Actions 2]  [ Share ]  [ ··· More ] │  │
│  ╰────────────────────────────────────────────────────────────────────────────────────╯  │
│                                                                                          │
│  [🔍 Search cards…      /]  ╭───────────────────────────╮  [↕ Newest ⌄]     2 / 5 votes  │
│                             │ All │ Mine │ Voted │ Acts │                   (or 2/6 ×)   │
│                             ╰───────────────────────────╯                                │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐   │
│  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│   │
│  │ Went Well        2  ··· │  │ To Improve       2  ··· │  │ Action Items   ⚑ 2  ··· │ + │
│  ├─────────────────────────┤  ├─────────────────────────┤  ├─────────────────────────┤   │
│  │ [ + Add Card      Add ] │  │ [ + Add Card      Add ] │  │ [ + Add Card      Add ] │   │
│  │                         │  │                         │  │                         │   │
│  │ ╭─────────────────────╮ │  │ ┌─────────────────────┐ │  │ ┌─────────────────────┐ │   │
│  │ │ ⌄ API Migration  (2)│ │  │ │ Staging database    │ │  │ │ ☐ Automate nightly  │ │   │
│  │ │   [− 2 +]  ⇄  ✎  🗑 │ │  │ │ seed data is stale  │ │  │ │   staging seed      │ │   │
│  │ ├─────────────────────┤ │  │ │                     │ │  │ │   refresh           │ │   │
│  │ │ Cross-team collab…  │ │  │ │ You 2m  [− 1 +] ☺💬···│ │  │ │   [Open]   @Infra   │ │   │
│  │ │ 👍1 🎉1             │ │  │ └─────────────────────┘ │  │ │ You 2m  [− 0 +] ☺💬···│ │   │
│  │ │ You 1m   💬1  ◫ ··· │ │  │                         │  │ └─────────────────────┘ │   │
│  │ ├─────────────────────┤ │  │ ┌─────────────────────┐ │  │                         │   │
│  │ │ Shipped onboarding… │ │  │ │ CI pipeline takes   │ │  │                         │   │
│  │ │ You 1m      ☺ 💬 ···│ │  │ │ 14 minutes on PRs   │ │  │                         │   │
│  │ ╰─────────────────────╯ │  │ │ You 2m  [− 0 +] ☺💬···│ │  │                         │   │
│  └─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Tablet / Compact Desktop (`1024×768`) Wireframe
```text
┌──────────────────────────────────────────────────────────────┐
│ ╭──────────────────────────────────────────────────────────╮ │
│ │ (⊞) Sprint Retrospective — Nov 20 ✎   [⚑ 2] [Share] [···]│ │
│ │ ● Live 1   (⏱ Timer)   [👁 Private Mode]      2 / 5 left │ │
│ ╰──────────────────────────────────────────────────────────╯ │
│ [🔍 Search…  /]  (All|Mine|Voted|Actions)  [↕ Newest ⌄] [+Col]│
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐  │
│ │ Went Well  2 ···│ │ To Improve 2 ···│ │ Action Itm ⚑2···│  │
│ │ (Full 312px col │ │ (Full 312px col │ │ (Full 312px col │  │
│ │  width — zero   │ │  width — zero   │ │  width — zero   │  │
│ │  footer wrap!)  │ │  footer wrap!)  │ │  footer wrap!)  │  │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```
*Key win at `1024px`:* Moving `+ Add a Column` out of a dedicated `140px` 4th grid track (showing it as a compact icon+label button in the toolbar/column-rail header on `sm–lg` and a slim `+` rail tab on `xl+`) reclaims **+50px per Column** (`262px → ~314px`), eliminating Card footer wrapping completely!

#### Mobile (`375×812`) Wireframe
```text
┌───────────────────────────┐
│ ╭───────────────────────╮ │  ← Compact floating glass bar (~52px)
│ │ (⊞) [⏱] [👁] [Share][···]│
│ ╰───────────────────────╯ │
│ Sprint Retrospective — ✎  │  ← Clean title + quiet status (~44px)
│ ● Live 1 · 2 / 5 left     │
│ [●Went Well 2][●To Imp 2]▒│  ← Edge-faded pill tabs (no scrollbar, ~44px)
│ [🔍 Search…  ] [Filter ⌄] │  ← Compact single row (~44px)
├───────────────────────────┤  ← Total top chrome: ~190px (down from 389px!)
│                           │
│ ┌───────────────────────┐ │  ← ~530px of clear Card reading space
│ │ Card content...       │ │
│ │ You 2m  [− 1 +] ☺💬···│ │
│ └───────────────────────┘ │
│ ┌───────────────────────┐ │
│ │ Card content...       │ │
│ └───────────────────────┘ │
│      (pb-24 scroll pad)   │
├───────────────────────────┤
│ Writing in Went Well      │  ← Translucent glass bottom composer
│ [ Add a Card…      ][Add] │
└───────────────────────────┘
```

---

## 3. Pass 2 — Studio Self-Critique & Revisions (`frontend-design`)

Before locking the plan, we audited Pass 1 against `frontend-design` anti-patterns, `apple-design` principles, `docs/SPEC.md`, and `BoardWorkspace.test.tsx`:

| Pass 1 Draft Choice | Critique (Why It Could Fail or Read Generic) | Revised Choice in Final Plan |
| :--- | :--- | :--- |
| **Single-row floating island squeezing title + all 7 controls at `1440px`** | If a Board has a 60+ character title AND a subtitle, plus Private Mode + Blind Voting + Locked badges simultaneously, a rigid single-row island will collide, truncate the Board title prematurely, or wrap unpredictably. | **Two-tier Adaptive Floating Island:** Top utility island (`.board-island`, sticky, `rounded-full` / `rounded-2xl`) stays compact and predictable for brand + live status + Timer + Private Mode + Action Items + Share + More. Directly beneath it, a quiet, flush canvas Title + Subtitle header (`24px` `<h1>` + inline rename + optional subtitle + vote budget) gives long titles breathing room without inflating the sticky chrome! As you scroll down tall Columns, only the slim `52px` floating island sticks—maximizing vertical workspace. |
| **Putting `"·"` middle dots between `Live · 1 online · 2/5 left`** | `frontend-design` explicitly calls out meta strings joined with middle dots (`A · B · C`) as a generated-UI tell, and `BoardWorkspace.test.tsx` checks `getByRole('status')` for exact `/^Live$/` plus `getByText('2 online')`. | Use clean `1px` vertical hairline dividers (`h-3.5 w-px bg-border/75`, matching Home's `.home-island`) and quiet spacing rather than middle dots, preserving exact accessible text nodes. |
| **Putting `☐` checkbox directly beside Card title for Action Items** | Wait — `CardItem.tsx` currently puts the checkbox in its own strip below the text and keeps `CardText` double-clickable to edit! Putting a checkbox to the left of the text could collide with drag-to-group/double-click targets and misalign Action Cards vs regular Cards. | Keep Card text flush-left across all Columns for consistent scanning rhythm; replace the oversized bordered `[ ] Open` box with a **sleek, compact inline Action bar** (`bg-col-sky-tint/70` or `bg-surface-subtle/60`, `rounded-lg`, tight padding, checkbox + `Open`/`Done` + owner tag inline on the right) and remove the redundant `"Action Item"` pill from the footer when the bar itself is already visible (or keep an `sr-only` span if any test checks for it — verified: no test requires the footer `"Action Item"` pill, only `CardDetailDrawer` checkbox label!). |
| **Putting `+ Add a Column` inside `BoardFilterBar`** | Mixing a Facilitator structural mutation (`+ Add a Column`) into the viewer-local Search/Filter/Sort bar violates Apple's **Grouping & Mapping** principle (place a control near what it affects). | Keep `+ Add a Column` spatially adjacent to the Columns rail: on `xl+` (`>= 1280px`) render a slim vertical/compact ghost rail card on the right edge (`w-11` collapsed icon rail or `w-44` subtle dashed header aligned with Column headers, never squeezing 3 Columns below `310px`), and at `sm–lg` (`640px–1279px`) place a clean compact `+ Add a Column` button right-aligned on a quiet sub-row or in the trailing grid slot below only when 4+ columns exist — **never** shrinking 3 columns at `1024px` down to `262px`! Even better: at `1024px` (3 columns), make the grid `lg:grid-cols-3` for the 3 columns and place `+ Add a Column` cleanly aligned with the top-right of the workspace rail (or as a slim `44px` edge tab) so all 3 columns get full `~315px` width! |
| **Removing `"Add reaction"` from Cards without reactions** | Hiding the smiley+ button completely until hover hurts touch devices (tablets/phones) and keyboard discoverability (`CardReactions.test.tsx` clicks `button "Add reaction"` directly). | Move the empty-state `Add reaction` button **into the Card footer action bar** (right next to comment & `···`) when `activeReactions().length === 0`, eliminating the dead 32px blank row while keeping it 100% visible, tappable, and keyboard-reachable at all times! Once ≥1 reaction exists, show the compact reaction chips row with the `☺+` button tucked naturally at the end of the chips. |
| **Over-animating Cards on sort/filter** | Scattering fade-slide entrances on every Card or hover bounce on every element reads as AI-slop (`frontend-design`). | Apply motion **strictly in response to user actions** (`apple-design`): `.spring-press` on buttons, critically damped `.segmented-thumb` on Filter & Action Items tabs, anchored `@starting-style` + `linear()` spring popovers (Timer, Reaction Picker, Card/Column/More menus), and symmetric fluid drawers. Zero gratuitous page-load choreography. |

---

## 4. Detailed Component-by-Component Fix Plan

### 4.1 Global Design Primitives & Motion ([src/App.css](../src/App.css))

1. **Floating Board Island Material (`.board-island`):**
   - Reuse and slightly tune `.home-island` translucent glass recipe (`color-mix(in srgb, var(--retrocks-surface) 82%, transparent)`, `backdrop-filter: blur(20px) saturate(165%)`, light-catching `inset 0 1px 0` specular highlight, layered elevation shadow, plus `@media (prefers-reduced-transparency: reduce)` solid fallback and `@media (prefers-contrast: more)` crisp border).
2. **Anchored Popover Material & Spring Reveal (`.board-popover`):**
   - Shared class for `CountdownTimer`, `More` menu, `ColumnPanel` menu, `CardItem` menu, `CardGroupItem` move menu, and `CardReactions` emoji picker.
   - `transform-origin` anchored to trigger edge (`top right`, `top left`, or `bottom left`), `@starting-style` entry from `opacity: 0; scale: 0.95; translate: 0 -4px` using inline `ease-out` fallback followed by critically damped `linear()` spring (`280ms`), never bouncing `opacity`, fully neutralized under `@media (prefers-reduced-motion: reduce)`.
3. **Unified Fluid Drawers (`.board-drawer-dialog` & `.board-drawer-panel`):**
   - Consolidate `.card-detail-dialog` and `.action-items-dialog` onto one shared CSS drawer architecture (`max-w-md` = `448px` on desktop, `rounded-t-2xl` bottom sheet on mobile, symmetric slide-in/slide-out along the same axis, subtle backdrop blur/dimming `rgb(0 0 0 / 0.45)`).
4. **Horizontal Scroll Edge Fade (`.scroll-edge-fade`):**
   - Clean CSS mask gradient + hidden scrollbar (`scrollbar-width: none`) for the mobile Column Tab Bar so clipped tabs fade gracefully instead of showing a harsh cut-off and native scrollbar.
5. **Preserve 100% of existing rules:** Keep `@media print`, `.card-revealed`, `.secret-search-*`, `[data-theme='retro']`, `[data-theme='parchment']`, and `@media (prefers-reduced-motion: reduce)` intact.

---

### 4.2 Workspace Header & Home-Style Floating Island ([src/components/BoardWorkspace.tsx](../src/components/BoardWorkspace.tsx), [src/components/CountdownTimer.tsx](../src/components/CountdownTimer.tsx), [src/components/ShareBoard.tsx](../src/components/ShareBoard.tsx))

1. **Home-Style Floating Dynamic Island (`.board-island`, sticky, `~52px`):**
   - Directly mirrors Home's `.home-island` pill aesthetic (`backdrop-filter: blur(20px) saturate(165%)`, light-catching top specular highlight, layered elevation shadow):
     - **Left:** `Retrocks` home link with the circular `bg-accent` `Columns3` badge.
     - **Center:** The **Board title (`<h1>`)** (`text-base sm:text-lg font-semibold tracking-[-0.02em]`), **double-clickable / double-tappable** by Facilitators on unlocked Boards to enter inline edit mode (just like Board Cards), paired with a subtle, quiet `Rename Board` pencil button (preserving keyboard/touch discoverability and existing accessibility contracts). Inline edit `<input>` matches the exact title font size and height (`0px` shift).
     - **Right:** `ThemeToggle` (`variant="island"`, matching Home) — keeping the `More` menu item synced for keyboard/SPEC compatibility.
2. **Board Control & Status Band (Directly beneath the island, scrolls cleanly):**
   - Optional Board subtitle (`text-sm text-text-muted max-w-[65ch]`) tucked quietly above/beside controls only when present.
   - Balanced single control bar (`role="group" aria-label="Board status"` on the left, collaboration actions on the right):
     - **Left (`Board status`):** Quiet live indicator (`● Live` / `Reconnecting…` + `N online` separated by subtle vertical hairline, no middle dots), `CountdownTimer` pill (`h-9 rounded-full`, `LucideIcon` `Clock`/`Pause`, stable `min-w-[5.25rem]` width), `Private Mode` / `Reveal All` toggle (`EyeOff`/`Eye`), independent `Private Mode` / `Blind Voting` / `Locked` status pills, and Vote budget (`2 / 5 votes left`, `tabular-nums`, `Vote` icon).
     - **Right (Actions):** `Action Items` button (`h-9 rounded-full`, `Flag` icon + borderless tabular count pill preserving `"Action Items N open"`), `Share` button promoted to **primary collaborative CTA** (`bg-accent text-accent-contrast`, `Share2` icon, `.spring-press` — yielding primary accent to `Reveal All` whenever Private Mode is active), and `More` (`h-9 rounded-full`, `Ellipsis` icon, `aria-label="More board actions"`).
3. **Typography & Sizing Unification:**
   - Every control uses **`h-9` (`min-h-11 sm:min-h-9`), `rounded-full` (status/header pills), `text-[13px] font-medium`**, and `.spring-press` — eliminating the 3-font-size / 2-radius soup.

---

### 4.3 Search, Filter & Sort Toolbar ([src/components/BoardFilterBar.tsx](../src/components/BoardFilterBar.tsx))

1. **Zero `border-control` Spam & Recessed Segmented Filter:**
   - Replace the 4 heavy-bordered filter boxes (`All`, `Mine`, `Voted`, `Action Items`) with Home's **recessed `.segmented-track` + sliding `.segmented-thumb`** pattern!
   - Removing `bg-accent` from `"All"` immediately restores visual hierarchy across the entire page: the elevated neutral `.segmented-thumb` cleanly indicates the active filter while reserving `--retrocks-accent` for true actions.
   - Keep `role="group" aria-label="Filter cards"` and `aria-pressed` on each button so all tests and screen-reader contracts pass untouched.
2. **Cleaner Search & Custom-Chevron Sort:**
   - Make `"Search"` and `"Sort"` `<label>` elements `sr-only` (keeping exact label/accessibility bindings) and give Search a helpful placeholder `"Search cards…"` with `LucideIcon` `Search` + `/` `<kbd>` hint.
   - Soften Search & Sort borders from harsh `border-control` to `border-border/85 hover:border-control/75 focus-visible:border-accent`, matching Home's `compactInputClass`.
   - Style `<select aria-label="Sort cards">` with `appearance-none` + custom Lucide `ChevronDown` icon (`pointer-events-none right-2.5`) + leading `ArrowUpDown` icon so it looks identical and crisp across macOS, Linux, and Windows.
3. **Zero-CLS Active Filter Feedback:**
   - Instead of mounting a `44px` second row underneath the toolbar, render the active match summary (`1 match (1 of 6 cards)`) + `Clear filters` button **inline on the right side of the same flex row** on desktop (`ml-auto`), so filtering or typing in Search causes **`0px` vertical shift** to the Columns below!
   - On narrow mobile (`< 640px`), keep a sleek compact active-filter pill right below Search (per `SPEC §4.2` so active filter + `Clear filters` remain visible even when `Filter & sort` is collapsed).

---

### 4.4 Architectural Column Rails & Zero-Shift Composer ([src/components/ColumnPanel.tsx](../src/components/ColumnPanel.tsx), [src/components/BoardWorkspace.tsx](../src/components/BoardWorkspace.tsx))

1. **Match Home's `BoardPreview` Column Language:**
   - Frame each Column as a calm architectural rail: `rounded-2xl border border-border/75 bg-surface-subtle/35 dark:bg-surface/40 overflow-hidden` (Wait: ensure `overflow: visible` on the inner card stream or floating portal/fixed popovers so floating card menus are never clipped! Better: use `rounded-t-2xl` on the header cap and keep outer rail `overflow-visible` so anchored card popovers never clip!).
   - Top accent bar (`h-[3px] w-full`, `COLUMN_ACCENT_STYLES[col.accent].bar` with `data-column-accent-bar="true"` for `@media print`) + subtle 5% tinted Column header (`COLUMN_ACCENT_STYLES[col.accent].tint`, `px-3.5 py-2.5 border-b border-border/60`).
   - Replace the boxy `"Actions"` text badge with a crisp `Flag` icon (`text-col-sky`, `title="Action Column"`, matching Home's `BoardPreview`!) alongside the tabular count pill and `Ellipsis` menu button.
2. **Zero-Shift Inline `+ Add Card` Composer (Fixing the Permanent-Open Bug):**
   - Replace the latching `hasFocusedComposer` pattern (`rows={1 → 2}` + external `36px` hint/Add row) with a **single unified composer box** (`rounded-xl border border-border/85 bg-surface focus-within:border-accent transition-colors`):
     - Single compact row by default (`min-h-11`, `py-2.5 pl-3 pr-16`), with the `Add` button embedded cleanly inside the right edge (`right-1.5 bottom-1.5`, subtle muted state when empty, crisp `bg-accent text-accent-contrast` as soon as `cardDraft().trim().length > 0`).
     - Grows smoothly *only* when the user actually types multiple lines (auto-height or `field-sizing: content` with `max-h-36`), and resets cleanly to single-line height on submit/clear — **0px layout shift on click/focus**, and all 3 Columns stay perfectly aligned at top!
     - Investigate & verify the `Enter` submit clear behavior so submitting via `Enter` reliably clears the draft and never leaves a stray newline.
     - Show character counter `801/1000` subtly inside the bottom corner only when `> 800` chars; keep `Enter to add · Shift+Enter for new line` as a quiet tooltip or subtle footer hint when typing.
3. **Column Grid & `+ Add a Column` at `1024px` vs `1440px`:**
   - Stop letting `+ Add a Column` steal a `140px` 4th grid track at `1024px` (`lg`):
     - Use clean equal-width grids (`sm:grid-cols-2 lg:grid-cols-3` for 3 columns, `lg:grid-cols-4` for 4 columns) so at `1024px` each of 3 columns gets **`~315px`** instead of `262px`.
     - Place `+ Add a Column` in a refined **inline-end slim rail** on `xl+` (`>= 1280px`) or a quiet right-aligned header/rail control on `sm–lg` (`640px–1279px`), and open the Add Column form inside an **anchored popover / compact modal dialog** instead of pushing `<main>` down `+96px`!

---

### 4.5 Cards, Reactions, Action Items & Card Groups ([src/components/CardItem.tsx](../src/components/CardItem.tsx), [src/components/CardReactions.tsx](../src/components/CardReactions.tsx), [src/components/CardGroupItem.tsx](../src/components/CardGroupItem.tsx), [src/components/VoteControls.tsx](../src/components/VoteControls.tsx))

1. **Cleaner Card Surface & Padding Rhythm:**
   - `rounded-xl border border-border/80 bg-surface p-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]` (subtle elevation on the recessed rail well; slightly crisper hover border `hover:border-control/70` without noisy jumps).
   - Card body: `text-base leading-relaxed text-text` (preserving 1 rem floor).
2. **Eliminate the Orphaned Empty Reaction Row + Float the Picker:**
   - When `activeReactions().length === 0`: render the `SmilePlus` trigger button inline inside the **Card footer action bar** (next to details & `···`), reclaiming ~32px of dead vertical space on every single Card!
   - When `activeReactions().length > 0`: render the compact reaction pills row (`mt-2.5 flex flex-wrap items-center gap-1.5`) with the `SmilePlus` trigger tucked smoothly at the end of the row.
   - Float the 6-emoji picker as a `.board-popover` (`absolute bottom-full left-0 mb-1.5 z-30` or flipped below if near top) so clicking `☺+` causes **`0px` layout shift**!
3. **Streamlined Action Item Strip (Zero Triple-Redundancy):**
   - Replace the oversized bordered `[ ] Open` void box + redundant footer `"Action Item"` pill with a sleek, compact inline Action bar (`mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-surface-subtle/65 px-2.5 py-1.5`):
     - Left: tactile checkbox + `Open` / `Done` label (`text-xs font-medium`), plus subtle strikethrough + muted text on Card content when `actionDone === true` (matching `ActionItemsDrawer`!).
     - Right: compact owner chip (when set) or quiet `Flag` micro-icon (`text-col-sky`) — no giant empty bordered rectangle and no redundant `"Action Item"` badge stamped right below it.
4. **Refined Card Footer & Vote Stepper:**
   - Left metadata: quiet `You` pill (borderless `bg-surface-subtle text-text-muted text-[11px] font-medium px-2 py-0.5 rounded-full`) + relative timestamp (`text-xs text-text-muted tabular-nums`).
   - Right controls grouped cleanly with consistent `h-7` (`min-h-11 sm:min-h-7`) heights:
     - `VoteControls`: recessed capsule (`rounded-lg bg-surface-subtle/75 border border-border/75`), crisp Lucide `Minus` / `Plus` icons (`size-3.5`), `.spring-press`, subtle accent tint when `myVotes() > 0` so your own votes are immediately scannable at a glance.
     - Comment / Detail controls: replace duplicate speech-bubble icons by using `MessageSquare` + count for the comment pill (`1 comment`) and `PanelRightOpen` (or unified single trigger — see Open Question #3) for `Open Card details`.
     - `Card actions` (`Ellipsis`): opens a **floating `.board-popover` menu** (`absolute right-0 top-full mt-1 z-30`, smart flip upward near viewport bottom) with **`line-clamp-2`** on `Group with…` target Card previews — eliminating the `+180px` in-flow card stretch and 7-line menu overflow!
   - Move transient `pendingAction()` / `pendingEmoji()` status text into `sr-only` live regions (`0px` flicker).
5. **Card Group Hierarchy Overhaul (`CardGroupItem.tsx`):**
   - **Clamp auto-generated Group title to 2 lines (`line-clamp-2`)** with clean CSS ellipsis (`text-ellipsis`) so a Group header is compact (`~56–72px` instead of `167.5px`!).
   - **Clean 2-row Group Header Layout:**
     - Row 1: Expand/collapse chevron (`ChevronRight` with `.spring-chevron` rotation) aligned to the first line of the title + bold Group title + compact tabular count pill (`2 cards`).
     - Row 2 (compact toolbar): Left-aligned `VoteControls` (`− 2 +`) + right-aligned icon actions (`ArrowRightLeft`, `Pencil`, `Ungroup`/`Trash2` with `LucideIcon`). On wide Columns (`>= 340px`), single-line titles can sit cleanly alongside `VoteControls` without colliding.
   - **Eliminate harsh double borders:** Give the Card Group container a soft tinted surface (`rounded-xl border border-border/80 bg-surface-subtle/50 p-1.5`) and give child Cards a lighter inner separation (`border-border/60 bg-surface`) so nested Cards read as a cohesive stack rather than boxes inside boxes.
   - Float `Move Card Group to Column` as an anchored `.board-popover` (`0px` shift).

---

### 4.6 Drawers, Modals & Iconography Unification

| Component | Key Redesign Improvements |
| :--- | :--- |
| **`CardDetailDrawer.tsx` & `ActionItemsDrawer.tsx`** | Unify width to **`max-w-md` (`448px`)** on desktop; unify header padding (`px-5 py-3.5`), heading size (`text-base font-semibold`), and close button (`size-9 rounded-lg border-transparent hover:bg-surface-subtle`); replace ALL-CAPS `ACTION ITEM` / `COMMENTS` labels with clean Sentence Case (`text-xs font-semibold text-text-muted`); upgrade `ActionItemsDrawer` filter (`All / Open / Done`) to Home's **recessed `.segmented-track` + `.segmented-thumb`**; use shared fluid slide-over CSS with symmetric enter/exit. |
| **`ShareBoard.tsx` & `BoardVotingSettings.tsx`** | Unify modal chrome: `rounded-2xl border border-border bg-surface shadow-2xl`, consistent `px-5 py-4` sticky header with `text-lg font-semibold tracking-tight` and unified ghost-border close button (`X` Lucide icon), consistent `border-border/85` input/select styling, and clean visual separation for destructive actions (`Reset All Votes`, `Delete Board`) inside a quiet danger card section. Upgrade Vote Limit / Per-Card Cap inside `BoardVotingSettings` to match Home's clarity (preserving native `<select>` `combobox` roles tested by `BoardWorkspace.test.tsx`!). |
| **`CountdownTimer.tsx`** | Upgrade trigger to `h-9 rounded-full` with `LucideIcon` `Clock`/`Pause`/`Volume2`/`VolumeX`; apply `.board-popover` entrance from trigger; unify preset buttons (`3m / 5m / 10m / 15m`) into a clean recessed segmented strip or crisp tonal chips without heavy outlines. |
| **`Icons.tsx` → `LucideIcon.tsx`** | Replace all 14 hand-coded 16×16 SVGs in `Icons.tsx` with tree-shakable `lucide` icons via `LucideIcon` (`Plus`, `Pencil`, `Trash2`, `ArrowRightLeft`, `Ellipsis`, `ChevronLeft`, `ChevronRight`, `Check`, `X`, `SmilePlus`, `Flag`, `MessageSquare`, `Download`, `Search`, plus `Columns3`, `Eye`, `EyeOff`, `Lock`, `Share2`, `Clock`, `Pause`, `Vote`, `SlidersHorizontal`, `PanelRightOpen`, `ArrowUpDown`) at consistent `1.75–1.9px` stroke weight. |

---

### 4.7 Mobile (`375×812`) Ergonomics Overhaul

1. **Slash Top Chrome Nearly in Half (`389px → ~190px`):**
   - Compact sticky floating top bar (`h-13`) with brand mark, `Timer` icon pill, `Private Mode` icon/compact pill, `Share` (44×44+ accent), and `More` (44×44+).
   - Compact Board title (`text-xl leading-snug`) + quiet inline status (`Live · 1 online · 2 / 5 votes left`) that scrolls away naturally.
2. **Clean Horizontal Column Tab Bar:**
   - Hide native scrollbar (`scrollbar-width: none`) and apply `.scroll-edge-fade` mask on the right/left scroll edges so `"Action Items"` fades smoothly instead of hard-clipping `"Action Iter…"`.
   - Use soft tonal pill tabs (`rounded-full`) with Column accent dot, title, and tabular count — active tab uses crisp elevated `bg-surface shadow-xs border-border` on a recessed rail.
3. **Clear Bottom Scroll Padding Above Sticky Composer:**
   - Add `pb-28 sm:pb-6` to `<main>` so the last Card's vote controls and `···` actions are never covered by the sticky bottom composer bar.
   - Give the sticky bottom composer bar translucent glass material (`backdrop-filter: blur(18px)`) matching the top island, keeping `--keyboard-inset` (`visualViewport`) behavior intact.

---

## 5. Preservation & Verification Checklist

Before any code merges, every item below must pass:

- [ ] **All 4 color schemes preserved:** `light`, `dark`, `retro` (including scanlines + monospace), `parchment`, plus all 8 Column accents.
- [ ] **Exact ARIA & Test Contracts green:** `pnpm test` (`BoardWorkspace.test.tsx`, `ActionItemsDrawer.test.tsx`, `CountdownTimer.test.tsx`, `CardReactions.test.tsx`, `CardText.test.tsx`) passes with **zero** Solid 2.0 reactivity diagnostics (`expectNoDiagnostics`).
- [ ] **Typecheck & Lint clean:** `pnpm typecheck` and `pnpm lint` (`oxlint src`) pass with zero warnings/errors.
- [ ] **Print & Easter Eggs intact:** `@media print` (`PrintBoard`), `secret-search-*` (`scope-creep`, `rock`, `blame`, `kudos`, `pivot`), dramatic reveal (`Shift+Click Reveal All`), and redacted card whispers remain functional.
- [ ] **Zero-CLS Visual Verification in Browser:** Re-run live browser checks on `http://localhost:3001/b/:id` across `1440×900` (Dark + Light), `1024×768` (Dark), and `375×812` (Mobile Dark + Light), measuring `0px` vertical shift for inline rename, filter switch, composer focus, reaction picker, and card/group menus.
- [ ] **Accessibility & Reduced Preferences:** Verify `prefers-reduced-motion: reduce`, `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, WCAG AA contrast, keyboard shortcuts (`/`, `N`, `A`, `B`, `T`, `Esc`), and focus return after closing all drawers/menus/modals.

---

## 6. Phased Implementation Order

1. **Phase 1 — Foundation CSS & Icon Unification:** Add `.board-island`, `.board-popover`, unified `.board-drawer-*`, and `.scroll-edge-fade` in [src/App.css](../src/App.css); swap `Icons.tsx` wrappers over to `LucideIcon` so all board components gain crisp uniform strokes immediately.
2. **Phase 2 — Floating Header, Timer & Zero-CLS Filter Bar:** Refactor [BoardWorkspace.tsx](../src/components/BoardWorkspace.tsx) header + [CountdownTimer.tsx](../src/components/CountdownTimer.tsx) + [ShareBoard.tsx](../src/components/ShareBoard.tsx) trigger + [BoardFilterBar.tsx](../src/components/BoardFilterBar.tsx) (recessed segmented filter, inline match/clear, zero-shift title rename).
3. **Phase 3 — Architectural Columns, Zero-Shift Composer, Cards & Card Groups:** Upgrade [ColumnPanel.tsx](../src/components/ColumnPanel.tsx) (accent-capped rails, fixed-height embedded-Add composer, `1024px` 3-col spacing), [CardItem.tsx](../src/components/CardItem.tsx) (floating actions menu, compact Action Item strip, footer alignment), [CardReactions.tsx](../src/components/CardReactions.tsx) (floating picker + footer empty-state trigger), [CardGroupItem.tsx](../src/components/CardGroupItem.tsx) (2-line clamped header, floating move menu), and [VoteControls.tsx](../src/components/VoteControls.tsx).
4. **Phase 4 — Unified Drawers, Modals & Mobile Polish:** Align [CardDetailDrawer.tsx](../src/components/CardDetailDrawer.tsx), [ActionItemsDrawer.tsx](../src/components/ActionItemsDrawer.tsx), [ShareBoard.tsx](../src/components/ShareBoard.tsx), and [BoardVotingSettings.tsx](../src/components/BoardVotingSettings.tsx); polish mobile header height, edge-faded Column tabs, and bottom scroll clearance.
5. **Phase 5 — Automated Tests & Live Visual QA:** Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and visually audit desktop, tablet, and mobile in both light and dark modes.

---

## 7. Approved Design Decisions

The following decisions are locked in and ready to be sliced into implementation tickets:

1. **Board Header & Theme Toggle:** Bring the Home page's floating Dynamic Island header (`.board-island`) to `/b/:id` — `Retrocks` circular mark on the left, the **Board title centered** (double-click/double-tap to edit inline like Board Cards, plus keeping the accessible `Rename Board` button for Facilitators), and the island `ThemeToggle` on the right (while keeping the synced `More` menu item). Sit the unified facilitation/status & collaboration bar cleanly below so it stays scannable and easy to iterate on.
2. **Column Rail Framing:** Softly framed architectural Column rails matching Home's `BoardPreview` (`3px` top accent bar + soft 5% tinted Column header + quiet recessed rail with opaque Cards).
3. **Card Comment & Detail Triggers:** Keep both buttons for zero test churn, visually distinguished (`💬 1` comment pill + `PanelRightOpen` icon for `Open Card details`).
4. **Zero-CLS Overlays & Motion:** Float all in-card/in-group menus and the reaction picker via anchored popovers, fix the permanent composer expansion shift, and apply tactile `.spring-press` + critically damped `linear()` springs guarded by reduced-motion / reduced-transparency media queries.
