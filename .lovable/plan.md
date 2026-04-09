

# Fix: Dashboard Report Tabs — 2x2 Grid on Mobile

## Problem
On mobile (390px), the 4 report type tabs (Inspections, Training, Daily, Invoiced) overflow horizontally with an ugly scrollbar.

## Solution
On mobile, switch the `TabsList` to a 2x2 grid layout. On `sm:` and above, keep the current inline row.

**Single file edit:** `src/components/dashboard/DashboardReportsSection.tsx` (line 525)

Change the `TabsList` className from:
```tsx
<TabsList className="w-full sm:w-auto mb-4 overflow-x-auto">
```
To:
```tsx
<TabsList className="grid grid-cols-2 sm:inline-flex sm:grid-cols-none w-full sm:w-auto mb-4">
```

Also hide the icons on mobile to save space in each tab trigger (lines 526-542), adding `hidden sm:inline` to each icon:
```tsx
<FileText className="w-4 h-4 hidden sm:inline" />
```

This gives a clean 2-row, 2-column layout on phones and reverts to the standard inline tab bar on wider screens.

