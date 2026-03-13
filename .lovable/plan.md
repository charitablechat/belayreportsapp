

## Expand Completed Reports by Default

**Single-line change** in `src/hooks/useDashboardFilters.tsx` line 88:

Change `useState(true)` → `useState(false)` for `completedCollapsed`, so the Completed group starts expanded (matching Drafts behavior).

