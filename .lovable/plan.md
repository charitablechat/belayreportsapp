

## Rename "Reports" group header to "Drafts"

The group label `'Reports'` on line 297 of `src/hooks/useDashboardFilters.tsx` is what renders the collapsible header shown in your screenshot. This is the single change needed.

### Change

**`src/hooks/useDashboardFilters.tsx`** — Line 297:
```
// From:
groups.push({ label: 'Reports', count: mainItems.length, items: mainItems });

// To:
groups.push({ label: 'Drafts', count: mainItems.length, items: mainItems });
```

One line, no other files affected.

