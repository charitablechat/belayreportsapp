

# Fix Temp-ID Sync and Redirect for ALL Report Types

## Problem

The previous fix only addressed **Inspections**. Trainings and Daily Assessments have the exact same two vulnerabilities:

1. **Redirect on open**: Both `TrainingForm.tsx` (line 289-304) and `DailyAssessmentForm.tsx` (line 285-299) query the server with temp-IDs, get null back, and redirect to dashboard.
2. **Silent sync skip**: Both `getUnsyncedTrainings` (line 1293) and `getUnsyncedDailyAssessments` (line 1043) filter by `inspector_id === userId`, silently excluding orphaned offline records. The sync functions in `atomic-sync-manager.ts` (lines 708 and 1146) also skip on ownership mismatch.

## Changes

### 1. TrainingForm.tsx -- Skip server queries for temp-IDs

Wrap the `if (isOnline)` block (line 289) with `!id.startsWith('temp-')` guard, matching the pattern already applied to InspectionForm:

```typescript
// Only fetch from server if this isn't a temp-ID
if (isOnline && !id.startsWith('temp-')) {
  // ... existing server fetch logic unchanged ...
} else if (!offlineTraining) {
  toast({ title: "Training not available offline", ... });
  navigate('/dashboard');
  return;
}
```

### 2. DailyAssessmentForm.tsx -- Skip server queries for temp-IDs

Same pattern at line 285:

```typescript
if (navigator.onLine && !id!.startsWith('temp-')) {
  // ... existing server fetch logic ...
} else if (!offlineAssessment) {
  toast.error("Assessment not available offline", ...);
  navigate('/dashboard');
  return;
}
```

### 3. offline-storage.ts -- Include orphaned temp-ID records in all three sync queries

Update all three `getUnsynced*` functions to include records where the `inspector_id` doesn't match but the ID starts with `temp-`:

- `getUnsyncedInspections` (line 608-609)
- `getUnsyncedTrainings` (line 1292-1293)
- `getUnsyncedDailyAssessments` (line 1042-1043)

Pattern for each:

```typescript
if (userId) {
  const owned = unsynced.filter(i => i.inspector_id === userId);
  const orphaned = unsynced.filter(
    i => i.inspector_id !== userId && i.id.startsWith('temp-')
  );
  if (orphaned.length > 0) {
    console.warn('[Offline Storage] Found orphaned temp-ID records:', 
      orphaned.map(i => ({ id: i.id.substring(0, 20) }))
    );
  }
  unsynced = [...owned, ...orphaned];
}
```

### 4. atomic-sync-manager.ts -- Auto-fix ownership for all three types

Update the ownership check in all three sync functions to auto-correct `inspector_id` for local-only records instead of skipping:

- `syncInspectionAtomic` (line 136)
- `syncTrainingAtomic` (line 708)
- `syncDailyAssessmentAtomic` (line 1146)

Pattern for each:

```typescript
if (record.inspector_id !== user.id) {
  if (originalId.startsWith('temp-') || !record.synced_at) {
    console.log('[Atomic Sync] Auto-fixing inspector_id for local record');
    record.inspector_id = user.id;
    await saveRecordOffline(record); // persist fix locally
  } else {
    return { success: false, skipped: true, reason: 'ownership_mismatch' };
  }
}
```

### 5. atomic-sync-manager.ts -- Production-visible sync logging

Move sync result logging outside `import.meta.env.DEV` guards in all three `syncAll*Atomic` functions so mobile production issues are diagnosable.

## Summary

| File | Change | Scope |
|------|--------|-------|
| `src/pages/TrainingForm.tsx` | Skip server queries for temp-IDs | Trainings |
| `src/pages/DailyAssessmentForm.tsx` | Skip server queries for temp-IDs | Daily Assessments |
| `src/lib/offline-storage.ts` | Include orphaned temp-ID records in all 3 unsynced queries | All types |
| `src/lib/atomic-sync-manager.ts` | Auto-fix ownership for local records in all 3 sync functions | All types |
| `src/lib/atomic-sync-manager.ts` | Enable production sync logging | All types |

This ensures any report created offline -- inspection, training, or daily assessment -- will correctly load from local storage, sync to the server, and never silently redirect to the dashboard.

