

## Fix Tab Navigation Text Wrapping

### Problem
The Super Admin Dashboard navigation tabs have text that wraps incorrectly. The description text (after the em dash) is being cut off instead of properly truncating or staying on a single line.

### Root Cause
Each `TabsTrigger` contains three inline elements:
1. Icon (with `shrink-0`)
2. Title span (no shrink control)
3. Description span (no truncation)

The flex container doesn't prevent the description from wrapping awkwardly.

### Solution
Apply proper text truncation to keep each tab on a single line with ellipsis for overflow:

| Element | Fix |
|---------|-----|
| Title span | Add `shrink-0` to prevent shrinking |
| Description span | Add `truncate` class for text-overflow ellipsis |
| TabsTrigger | Add `overflow-hidden` to contain the truncation |

### Changes

**File:** `src/pages/SuperAdminDashboard.tsx`

Update all 10 TabsTrigger components (lines 681-730) with these class changes:

```tsx
// BEFORE
<TabsTrigger value="organizations" className="justify-start gap-3 w-full group hover:bg-accent/50 data-[state=active]:bg-accent">
  <Building2 className="h-4 w-4 shrink-0 ..." />
  <span>Organizations</span>
  <span className="text-xs text-muted-foreground font-normal">— Manage client facilities...</span>
</TabsTrigger>

// AFTER
<TabsTrigger value="organizations" className="justify-start gap-3 w-full overflow-hidden group hover:bg-accent/50 data-[state=active]:bg-accent">
  <Building2 className="h-4 w-4 shrink-0 ..." />
  <span className="shrink-0">Organizations</span>
  <span className="text-xs text-muted-foreground font-normal truncate">— Manage client facilities...</span>
</TabsTrigger>
```

### Tabs to Update
1. Organizations (line 681)
2. User Management (line 686)
3. Inspections (line 691)
4. Training Reports (line 696)
5. Daily Assessments (line 701)
6. Form CMS (line 706)
7. Notifications (line 711)
8. Data Recovery (line 716)
9. Report Ownership (line 721)
10. Maintenance (line 726)

### Result
- All tab titles remain fully visible
- Descriptions truncate gracefully with ellipsis when space is limited
- Layout stays clean and consistent across viewport sizes

