

## Fix: Softer Active State on Stats Bar Buttons

**File:** `src/components/dashboard/DashboardStatsBar.tsx` (line 34)

Change the active button style from the opaque `bg-accent` to a lighter, more transparent blue:

```
- isActive && "bg-accent border-primary/50 ring-1 ring-primary/20"
+ isActive && "bg-primary/10 border-primary/40 ring-1 ring-primary/15"
```

This replaces the solid accent background with a 10% opacity primary blue, making text and icons easier to read while still clearly indicating the active state.

