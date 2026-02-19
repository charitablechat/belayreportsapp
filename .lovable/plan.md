

# UI/UX Polish: Minimal Brutalist + Glassmorphism Aesthetic

## Overview
Apply a comprehensive visual refresh across the SuperAdmin Dashboard and Data Recovery Tool using a Minimal Brutalist aesthetic combined with Glassmorphism. Uses a Slate 900 / Indigo 500 / Emerald 400 palette for status indicators. All changes are purely visual -- zero modifications to data logic, sync patterns, IndexedDB error boundaries, or offline storage.

## Files to Modify

### 1. `src/components/admin/StatCard.tsx`
**Glassmorphism + Bento Grid card styling**
- Replace the default `Card` with glassmorphism classes: `backdrop-blur-md bg-white/10 dark:bg-slate-900/40 border-white/20`
- Add hover lift: `hover:-translate-y-1 transition-all duration-300`
- Make the metric value use oversized type: `text-4xl font-black tracking-tight` (expressive/brutalist)
- Use the Slate 900 / Indigo 500 / Emerald 400 palette for icon color accents

### 2. `src/pages/SuperAdminDashboard.tsx`
**Bento Grid layout + spacing**
- Increase container padding from `p-6` to `p-8`
- Change stat card grids from `gap-4` to `gap-6` for breathable spacing
- Add oversized type for the page title: `text-4xl font-black` (brutalist heading)
- Apply frosted glass background to the stats grid wrapper sections
- Update status badges throughout (inspections, trainings, daily assessments) to use the new palette:
  - `completed` -> Emerald 400 badge (`bg-emerald-400/15 text-emerald-400 border-emerald-400/30`)
  - `draft` -> Slate badge (`bg-slate-500/15 text-slate-400 border-slate-400/30`)
  - `in_progress` -> Indigo badge (`bg-indigo-500/15 text-indigo-400 border-indigo-500/30`)
- Apply `hover:-translate-y-0.5 transition-all` to interactive table rows

### 3. `src/components/admin/AdminTabsSection.tsx` + `AdminTab.tsx`
**Frosted glass tab list**
- Add glassmorphism to the `TabsList` container: `backdrop-blur-md bg-white/5 border border-white/10 rounded-xl`
- Add subtle lift transition to each tab trigger on hover

### 4. `src/components/admin/DataRecoveryTool.tsx`
**Premium Data Recovery cards**
- Apply glassmorphism to the main Card wrappers in both `LocalSnapshotsPanel` and `IndexedDBRecoveryPanel`
- Update the 4 mini-stat boxes (Trainings, Daily Assessments, Inspections, Queued Operations) to use the palette:
  - Synced/healthy counts -> Emerald 400
  - Unsynced badges -> `bg-indigo-500/15 text-indigo-400` instead of destructive red
  - Queued -> Slate 400 muted indicator
- Make the metric numbers oversized: `text-3xl font-black`
- Add hover lift to action buttons
- Apply rounded badge styling to the age indicators (already partially done)

### 5. `src/components/UserDataRecoverySheet.tsx`
**Premium high-contrast modal**
- Apply glassmorphism to the `SheetContent`: `backdrop-blur-xl bg-slate-900/95 border-white/10`
- Use high-contrast text: `text-slate-100` for title, `text-slate-400` for description
- The existing success toast on restore (`toast.success("Snapshot restored to local storage")` in DataRecoveryTool.tsx) is already in place -- no change needed

### 6. `src/index.css`
**Utility classes**
- Add a reusable `.glass-card` utility class under `@layer components`:
  ```
  backdrop-blur-md bg-white/10 dark:bg-slate-900/40 border border-white/20 shadow-lg
  ```
- Add `.brutalist-metric` for oversized type: `text-4xl font-black tracking-tight`
- Add `.card-lift` for the hover effect: `hover:-translate-y-1 transition-all duration-300`

## Technical Notes

- **Font**: Inter is already the default Tailwind sans-serif font. No font import needed.
- **No logic changes**: All existing IndexedDB error boundaries, `RecoveryErrorBoundary`, sync patterns, `handleBatchDelete`, `loadLocalData`, and offline storage remain untouched.
- **Responsive**: All grid layouts use existing `md:` and `lg:` breakpoints. Glass effects degrade gracefully on older browsers (backdrop-filter is widely supported).
- **Accessibility**: Color contrast ratios for Emerald 400 on dark backgrounds and Indigo 500 on light backgrounds meet WCAG AA. All existing `aria-` attributes and keyboard navigation preserved.
- **Security**: No secrets, API keys, or auth tokens are touched or exposed in any of these changes.

