## Recolor invoiced rows: money-green tint + "$ Invoiced" chip

Replace the purple invoiced tint with a distinct teal/money-green, and add a small inline chip so invoiced rows are unmistakable even when the green tints are similar.

### Color choice

To stay distinct from the existing **completed** green (`bg-emerald-50/80`), invoiced uses a deeper, more blue-leaning **teal**:

- Row tint: `bg-teal-100/80 dark:bg-teal-950/40`
- Left accent bar (3px): `bg-teal-500 dark:bg-teal-400`
- Chip: `bg-teal-600 text-white dark:bg-teal-500` with a `DollarSign` icon (lucide) and the label "Invoiced"

This reads as "paid / billable" without colliding with the completed-green (which is lighter and more yellow-green). Side-by-side: completed = pale mint, invoiced = saturated teal.

### Files

1. **`src/components/dashboard/ReportListView.tsx`**
   - Change `INVOICED_TINT` from `bg-purple-100/80 dark:bg-purple-950/40` to `bg-teal-100/80 dark:bg-teal-950/40`.
   - Update the left-accent-bar logic (`getAccentClasses` or inline) so when `isAdmin && isInvoiced`, the bar uses `bg-teal-500 dark:bg-teal-400` (overrides the age-based color, same precedence as the row tint).
   - Inside `ReportRow`'s right-side metadata cluster, when `isAdmin && isInvoiced`, render a small chip:
     ```
     <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-600 text-white dark:bg-teal-500">
       <DollarSign class="w-3 h-3" /> Invoiced
     </span>
     ```
     Place it just before the existing date/age text so it sits next to the other status badges.

2. **`src/components/dashboard/ReportCard.tsx`** (grid view) — for visual parity, swap any `purple-*` invoiced styling to the same teal tokens so list, split, and grid all match.

### Out of scope

- No change to the red overdue / yellow warning / green completed tints.
- No change to the existing "INVOICED" watermark on rendered reports (that stays red per the Invoiced Reports memory).
- No filter, query, or data changes.
