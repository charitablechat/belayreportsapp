

# Polish All Inspection Header Fields

## Problem

The header fields (Inspector, Facility Name, Location, ACCT#, etc.) use plain default input styling -- flat white boxes with minimal visual definition. They lack the refinement seen in the recently polished autocomplete dropdown.

## Changes

### File: `src/components/inspection/InspectionHeader.tsx`

**1. Add consistent labels with better hierarchy**

Update the `Label` styling from `text-sm text-muted-foreground` to `text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block`. This gives labels a small-caps, defined look that clearly separates them from the input values.

**2. Wrap each field group with subtle structure**

Add a light background and rounded border to each field cell:
```tsx
<div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
```

This creates visually distinct "field cards" that group label + input together.

**3. Style the disabled Inspector field**

The Inspector field is always disabled. Give it a more intentional read-only appearance:
```tsx
className="bg-muted/50 cursor-not-allowed font-medium"
```

**4. Section heading for the two-column grid**

Add a subtle heading above the fields grid:
```tsx
<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
  Report Details
</h2>
```

**5. Improve the "Known Course History" textarea section**

Add a matching field-card wrapper so it visually aligns with the grid fields above.

**6. Clean up the Inspection Categories and Important Notes sections**

These informational blocks can be simplified:
- Give the categories section consistent card-like styling with the same `bg-muted/30 border` treatment
- Tighten spacing between items

### Summary of visual improvements

- Labels: uppercase, smaller, tracked -- creates clear hierarchy
- Field cells: subtle background + border grouping
- Disabled fields: intentional read-only styling
- Consistent spacing throughout the card
- No logic changes -- purely CSS/className updates

