

# Fix Autocomplete Entry Visibility and Database Deletion

## Overview

Three changes to `src/components/GlobalAutocomplete.tsx` to fix text truncation, make delete buttons accessible on mobile, and ensure deletions propagate to the database.

## Changes

### 1. Fix text wrapping (line ~410)
Remove `truncate` class from the entry text `<span>`, replace with `break-all` so long entries wrap fully.

### 2. Make delete button always visible (lines ~412-418)
Remove `opacity-0 group-hover:opacity-100` so the 'x' icon is always visible (critical for mobile/touch).

### 3. Database deletion in `handleDelete` (lines ~229-245)
Update `handleDelete` to accept the full `HistoryItem` object (not just the string value) and add a fire-and-forget Supabase delete call:

```typescript
const handleDelete = (option: HistoryItem, e: React.MouseEvent) => {
  e.stopPropagation();
  setHistoryOptions(prev => prev.filter(opt => opt.value !== option.value));

  // Update localStorage
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    const existing = JSON.parse(saved);
    localStorage.setItem(storageKey, JSON.stringify(
      existing.filter((v: string) => v !== option.value)
    ));
  }

  // Delete from database (fire-and-forget)
  if (!option.id.startsWith('local-')) {
    supabase
      .from('global_field_history')
      .delete()
      .eq('id', option.id)
      .then(({ error }) => {
        if (error) console.error('Failed to delete from global history:', error);
      });
  }
};
```

### 4. Update call site (line ~418)
Change `handleDelete(option.value, e)` to `handleDelete(option, e)` to pass the full object with the database ID.

### 5. Update entry rendering (lines ~406-420)
```tsx
<span className="break-all">{option.value}</span>
{/* delete button */}
<button
  onClick={(e) => handleDelete(option, e)}
  className="ml-2 shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1"
  aria-label={`Remove ${option.value} from suggestions`}
>
  <X className="h-3 w-3" />
</button>
```

## Scope

All changes are in one file: `src/components/GlobalAutocomplete.tsx`. Since this is the unified autocomplete used across all report forms (Inspections, Trainings, Daily Assessments), the fix applies universally.

