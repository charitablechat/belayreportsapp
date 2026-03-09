

# Fix: Next Inspection Date Not Persisting After Year Change

## Root Cause

**Stale closure in `performSave`**: When the user selects a date in `SummarySection`, two things happen synchronously in the same event handler:

1. `setSummary({...summary, next_inspection_date: "2027-03-09"})` — React **queues** this state update
2. `onImmediateSave()` — calls `performSave()` which reads `summary` from its **closure** — still the OLD value

The save fires before React commits the new state, so the old `next_inspection_date` is written to both IndexedDB and the database. The 1.5s debounced auto-save would eventually write the correct value, but it can be blocked by the `anySaveInProgressRef` mutex if the stale save is still running.

This affects ALL immediate-save fields (rich text editors on blur, date pickers), but date fields are most noticeable because the entire value changes in a single click.

## Fix

Add a `useRef` that always mirrors the latest `summary` state. Update `performSave` to read from the ref instead of the closure.

**File: `src/pages/InspectionForm.tsx`**

1. Add a ref near the state declaration (~line 153):
```typescript
const summaryRef = useRef(summary);
```

2. Keep the ref in sync with state (after the `summary` useState):
```typescript
useEffect(() => { summaryRef.current = summary; }, [summary]);
```

3. In `performSave` (~line 1318-1323), read from the ref:
```typescript
const currentSummary = summaryRef.current;
const saveData = {
  systems,
  ziplines,
  equipment,
  standards,
  summary: currentSummary,
  updated_at: new Date().toISOString(),
};
```

4. Update all other references to `summary` within `performSave` to use `currentSummary` (validation block at ~line 1272, sanitization at ~line 1504, IndexedDB writes at ~line 1379-1399, and the server upsert at ~line 1636).

This same ref pattern should also be applied to `systems`, `ziplines`, `equipment`, and `standards` for full consistency — but `summary` is the immediate fix for the reported bug since it's the only one where a single-click triggers both state update + immediate save.

## Scope

- **1 file changed**: `src/pages/InspectionForm.tsx`
- ~15 line additions/modifications
- No database changes
- No new dependencies
- No impact on report generation, comment handling, or sync logic

