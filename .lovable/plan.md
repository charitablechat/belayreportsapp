## Glassmorphism Dashboard & Report Cards Redesign

### Objective
Elevate the dashboard and report cards to a premium, professional aesthetic using a consistent Glassmorphism design language — translucent surfaces, soft blurs, subtle gradients, and a neutral refined palette. All changes are purely cosmetic; zero data or functional logic is touched.

### Scope
- **Dashboard page container** (`src/pages/Dashboard.tsx`)
- **Report cards** (`src/components/dashboard/ReportCard.tsx`)
- **Stats bar** (`src/components/dashboard/DashboardStatsBar.tsx`)
- **Foyer action cards** (within Dashboard.tsx)
- **Supporting design tokens** (`src/index.css`)
- **Card primitive** (`src/components/ui/card.tsx`) — optional glass variant

### Out of Scope
- Form pages (Inspection, Training, Daily, JCF)
- Dialogs, sheets, and modals
- Non-dashboard routes

### Design Direction
- **Surface treatment**: `backdrop-blur-md` (≈12px) with `bg-white/[0.03–0.08]` in light mode, `bg-slate-900/[0.25–0.40]` in dark mode.
- **Borders**: ultra-subtle `border-white/10` (light) / `border-white/[0.06]` (dark) instead of solid `border-foreground`.
- **Shadows**: soft diffuse shadows (`shadow-lg shadow-black/5`) for depth without heaviness.
- **Age-state cards**: replace solid `bg-red-200`, `bg-yellow-50`, `bg-sky-50` with tinted glass — e.g., `bg-red-500/[0.03]` + `border-l-destructive/50`.
- **Background layer**: replace the random texture image with a fixed, subtle animated mesh gradient (CSS-only, low CPU cost) behind the glass layers.

### Implementation Steps

#### 1. Design Tokens & Utilities (`src/index.css`)
- Add `.glass-dashboard` utility: `backdrop-blur-md bg-white/[0.03] dark:bg-slate-900/30 border border-white/10 dark:border-white/[0.06] shadow-lg shadow-black/5`.
- Add `.glass-card` override variant for report cards with tinted edge states.
- Add a subtle `.dashboard-bg-gradient` keyframe animation for the page background (neutral slate/indigo tones, very low saturation).

#### 2. Dashboard Container (`src/pages/Dashboard.tsx`)
- Replace the outer container’s solid `bg-background` with the new gradient background layer.
- Wrap the `<main>` content area in a glass surface if needed for readability.
- Update the **Reports Section** wrapper: remove `border-2 border-foreground rounded-lg p-4` and apply `.glass-dashboard` with generous padding.
- Update **Foyer cards** (Inspection, Training, Daily, JCF): replace solid color accents with glass surfaces + subtle icon halo. Keep existing layout and navigation.

#### 3. Report Cards (`src/components/dashboard/ReportCard.tsx`)
- Replace `ageStateClasses` solid backgrounds with glass tints:
  - `critical`: `bg-red-500/[0.03] border-l-4 border-l-destructive/60`
  - `warning`: `bg-amber-500/[0.03] border-l-4 border-l-amber-500/60`
  - `completed`: `bg-sky-500/[0.03] border-l-4 border-l-sky-500/60`
  - `default`: `bg-white/[0.02] border-l-4 border-l-muted-foreground/20`
- Add `backdrop-blur-md` to the card base class.
- Keep all interaction logic (hover lift, click, sparkles, haptics, badges, dropdown) untouched.
- Ensure the `COMPLETED` and `INVOICED` watermarks remain visually legible over the new translucent backgrounds.

#### 4. Stats Bar (`src/components/dashboard/DashboardStatsBar.tsx`)
- Replace `bg-card` / `bg-primary/10` stat buttons with glass variants.
- Active state: slightly elevated opacity + ring, no solid color block.
- Storage pressure bar: keep existing logic, optionally soften the background to a glass tint.

#### 5. Shadcn Card Primitive (`src/components/ui/card.tsx`)
- **Decision needed**: either introduce an optional `glass` prop/variant, or leave the primitive untouched and apply glass classes via `className` overrides in dashboard components. *Plan recommends the latter* (no primitive changes) to avoid side-effects across the app.

### Visual QA Checklist
- [ ] Dashboard renders cleanly in both light and dark modes.
- [ ] Report cards remain legible with all age states.
- [ ] `COMPLETED` / `INVOICED` watermarks are still clearly visible.
- [ ] Hover/active states on cards feel responsive.
- [ ] No layout shifts or broken spacing.
- [ ] Mobile viewport: glass readability holds, no performance degradation.

### Estimated Effort
Small — focused CSS/className changes across 4 files with no logic modifications.