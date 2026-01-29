
# Plan: Implement Consistent Immediate, Irreversible Persistence

## Summary
Ensure all data entry forms implement consistent **immediate auto-save after each field entry** (3-second debounce), so data cannot be lost or overwritten by another user. This builds on the existing database-level protections already in place.

## Current State
The database layer already prevents unauthorized modifications:
- **Immutable `inspector_id`**: Database trigger blocks any change to the report owner
- **Owner-only UPDATE policies**: RLS policies restrict updates to `inspector_id = auth.uid()`
- **No Super Admin write access**: Super Admin UPDATE policies were removed

However, the frontend auto-save patterns are inconsistent:
- **InspectionForm**: 3-second debounce + 10-second interval
- **TrainingForm**: 30-second interval only (no field-level trigger)
- **DailyAssessmentForm**: 3-second debounce pattern

## Implementation Details

### 1. TrainingForm Auto-Save Alignment
**File**: `src/pages/TrainingForm.tsx`

Change the 30-second interval to a 3-second debounce triggered on data changes:

- Add a `saveDebounceTimerRef` similar to InspectionForm
- Add a `useEffect` that watches all form data arrays and triggers debounced save
- Keep the 30-second interval as a backup only
- Ensure each field update triggers the debounce timer reset

### 2. Verify DailyAssessmentForm Pattern
**File**: `src/pages/DailyAssessmentForm.tsx`

The 3-second debounce pattern exists. Verify it covers all data sections:
- Beginning of Day
- End of Day
- Operating Systems
- Equipment Checks
- Structure Checks
- Environment Checks

### 3. Field-Level Save in InspectionForm (Already Implemented)
**File**: `src/pages/InspectionForm.tsx`

The `handleHeaderUpdate` function already saves immediately per field:
```typescript
// Saves offline first, then syncs to database
await saveInspectionOffline(updatedInspection);
if (isOnline) {
  await supabase.from("inspections").update({ [field]: value }).eq("id", id);
}
```

This pattern should be verified for all section update handlers.

### 4. Background Sync Integration
The `useAutoSync` hook already handles:
- 3-second debounce after local data changes
- Immediate sync on network reconnection
- Sync on app visibility changes
- Realtime subscriptions for multi-device awareness

---

## Technical Changes

### TrainingForm.tsx
```diff
+ const saveDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

// Add effect to trigger debounced save on data changes
+ useEffect(() => {
+   if (!isLoading && training) {
+     setHasUnsavedChanges(true);
+     
+     if (saveDebounceTimerRef.current) {
+       clearTimeout(saveDebounceTimerRef.current);
+     }
+     
+     saveDebounceTimerRef.current = setTimeout(() => {
+       if (!isSaving) {
+         saveTraining();
+       }
+     }, 3000);
+   }
+   
+   return () => {
+     if (saveDebounceTimerRef.current) {
+       clearTimeout(saveDebounceTimerRef.current);
+     }
+   };
+ }, [deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary]);
```

### DailyAssessmentForm.tsx
Verify the existing `useEffect` with `autoSaveTimerRef` is watching all data arrays. If any are missing, add them to the dependency array.

---

## Summary of Protections

| Layer | Protection | Status |
|-------|------------|--------|
| Database | `prevent_inspector_id_change` trigger | ✅ Active |
| Database | Owner-only UPDATE RLS policies | ✅ Active |
| Database | No Super Admin UPDATE policies | ✅ Removed |
| Frontend | `useReportEditPermission` hook | ✅ Active |
| Frontend | Inputs disabled when `isReadOnly=true` | ✅ Active |
| Frontend | 3-second debounce auto-save (Inspection) | ✅ Active |
| Frontend | 3-second debounce auto-save (Training) | ⚠️ Needs alignment |
| Frontend | 3-second debounce auto-save (Daily Assessment) | ✅ Active |
| Background | `useAutoSync` silent sync | ✅ Active |

## Outcome
After these changes:
1. Data is saved within 3 seconds of any field change across all report types
2. No other user can overwrite data (enforced by RLS at database level)
3. The `inspector_id` remains permanently locked (enforced by database trigger)
4. All operations remain silent with no user-facing sync prompts
