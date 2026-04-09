

# Text Wrapping & Responsive Design Audit

## Overall Assessment: WELL-IMPLEMENTED — 3 Minor Issues Found

The application has a mature responsive design foundation with global text-wrapping safety nets in `index.css`, consistent `md`/`lg` breakpoint usage, and proper mobile card fallbacks for all complex tables. The audit identified **3 minor issues** — none are layout-breaking.

---

## Verified — Working Correctly

These areas were audited and confirmed to be properly responsive:

1. **Global CSS safety net** — `overflow-wrap: anywhere` and `word-break: break-word` applied to all text containers (p, span, label, td, th, div, li). Grid children have `min-width: 0`. Inputs/selects use `text-overflow: ellipsis`.

2. **EquipmentTable** — Desktop grid (`hidden lg:block`) with `overflow-x-auto`. Mobile card layout (`lg:hidden`) with proper stacking. Buttons use `flex-1 lg:flex-none` for full-width on mobile.

3. **ZiplinesTable** — Same `lg` breakpoint pattern with 15-column desktop grid wrapped in `overflow-x-auto`, mobile cards below `lg`.

4. **InspectionHeader** — Title uses `break-words [overflow-wrap:anywhere]` with responsive text sizing (`text-xl md:text-2xl`). Form fields use `grid-cols-1 md:grid-cols-2`.

5. **TrainingHeader / DailyAssessmentHeader** — Proper `grid-cols-1 md:grid-cols-2` layouts.

6. **ReportCard** — Uses `line-clamp-1` on titles, responsive padding (`p-4 md:p-6`), text sizing (`text-xs md:text-sm`).

7. **ReportListView** — Columns hidden at breakpoints (`hidden md:table-cell`, `hidden sm:table-cell`). Title column has `min-w-[180px]`.

8. **DashboardFilters** — A-Z letter chips use `ScrollArea` with horizontal scrollbar. Filter pills use `flex flex-wrap`.

9. **DashboardQuickFilters** — Uses `flex flex-wrap gap-2` for chip layout.

10. **DashboardControls** — Uses `flex flex-wrap items-center gap-2`.

11. **SummarySection** — CardHeader uses `flex-col md:flex-row` with responsive button text.

12. **AuthenticatedHeader** — Fixed position `top-3 right-3` with proper z-index.

---

## Issue 1 — LOW: Dashboard Report Tabs Overflow on Small Mobile (320px)

**Component:** `DashboardReportsSection.tsx` line 525

**Problem:** The `TabsList` with "Inspections (N)", "Training (N)", "Daily (N)", and optionally "Invoiced (N)" tabs uses `w-full sm:w-auto` but doesn't wrap or scroll on very narrow screens (320px). With 4 tabs (super admin), text will compress and become illegible.

**Fix:** Add `overflow-x-auto` to the `TabsList` wrapper or hide icons on mobile:
```tsx
<TabsList className="w-full sm:w-auto mb-4 overflow-x-auto">
```

---

## Issue 2 — LOW: "9 Most Recent Reports" Tab Text Truncates on Mobile

**Component:** `Dashboard.tsx` line 1499-1506

**Problem:** The "9 Most Recent Reports" tab trigger text is long and may truncate on screens below 375px. The "All Reports" tab beside it compounds the width pressure.

**Fix:** Use shorter text on mobile:
```tsx
<TabsTrigger value="recent" className="text-base font-semibold px-5 py-2">
  <span className="hidden sm:inline">9 Most Recent Reports</span>
  <span className="sm:hidden">Recent</span>
</TabsTrigger>
```

---

## Issue 3 — LOW: Dashboard Header Right-Side Controls Crowded on 360-375px

**Component:** `Dashboard.tsx` lines 1315-1361

**Problem:** The header row contains SyncPulse, pending badge, NetworkQualityIndicator, ForceSyncButton, refresh button, and Super Admin badge — all in a `flex items-center gap-2` container with `mr-14`. On narrow phones (360px), these controls compress against each other.

**Fix:** Hide non-essential indicators on mobile by adding responsive visibility:
```tsx
<NetworkQualityIndicator className="hidden sm:flex" />
```
Or wrap the controls in a scrollable container.

---

## Summary

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | Report tabs overflow on 320px | LOW | DashboardReportsSection L525 |
| 2 | "9 Most Recent Reports" text too long for mobile | LOW | Dashboard L1499 |
| 3 | Header controls crowded at 360px | LOW | Dashboard L1315 |

### Plan

**Step 1:** Add `overflow-x-auto` to the report type `TabsList` in `DashboardReportsSection.tsx`.

**Step 2:** Add responsive text shortening for the "9 Most Recent Reports" / "All Reports" tab triggers in `Dashboard.tsx`.

**Step 3:** Add `hidden sm:flex` to the `NetworkQualityIndicator` in the dashboard header to reduce crowding on narrow phones.

Three targeted edits, no structural changes needed.

