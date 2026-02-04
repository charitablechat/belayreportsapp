
# Fix Persistent "Failed to sync online" Error

## Root Cause Analysis

The investigation revealed **three distinct issues** causing the sync error to persist:

### Issue 1: `has_documentation` NULL Constraint Violation
The `inspection_standards` table has `has_documentation` column set to `NOT NULL`, but the frontend initializes standards with `null`:

```typescript
// InspectionForm.tsx lines 107-114
{ id: crypto.randomUUID(), standard_name: "...", has_documentation: null }
```

**Database Error:**
```
null value in column "has_documentation" of relation "inspection_standards" violates not-null constraint
```

### Issue 2: Stale Error State Not Cleared
The error "Failed to sync online - saved locally" is set when sync fails but may not be properly cleared when:
- Background sync later succeeds but doesn't trigger the listener in time
- The component re-renders with stale state
- A new save operation starts before the error is cleared

### Issue 3: RLS Policy Timing (Resolved)
The previous RLS migration added `WITH CHECK` clauses, which are now in place. However, errors may still occur if:
- Transactions don't commit the parent inspection before child inserts
- Network interruption causes partial writes

---

## Solution Design

### Phase 1: Fix has_documentation Default Value

**Option A: Allow NULL in Database (Recommended)**
Change the database column to allow NULL values. This matches the UI behavior where standards start as "Not Set" before the user selects Yes/No.

```sql
ALTER TABLE inspection_standards 
ALTER COLUMN has_documentation DROP NOT NULL;
```

**Option B: Change Frontend Default (Alternative)**
Initialize with a boolean default instead of null. But this changes UX - items would show Yes/No before user interaction.

**We'll go with Option A** because the UI already displays "Not Set" badge for null values.

### Phase 2: Sanitize Data Before Sync

Add data sanitization in the atomic sync manager to handle edge cases where null values slip through:

```typescript
// In syncInspectionAtomic() before validation
const sanitizedStandards = standards.map(s => ({
  ...s,
  // Default null has_documentation to false for DB compatibility
  has_documentation: s.has_documentation ?? false,
}));
```

### Phase 3: Improve Error State Clearing

Enhance the `onSyncComplete` listener to aggressively clear sync-related errors:

```typescript
// InspectionForm.tsx - Improved error clearing
useEffect(() => {
  const unsubscribe = onSyncComplete(() => {
    // Clear any sync-related errors on successful background sync
    setSaveError(prev => {
      if (!prev) return null;
      // Check multiple patterns that indicate sync errors
      const isSyncError = /sync|failed|offline|queued|network/i.test(prev);
      return isSyncError ? null : prev;
    });
  });
  
  return () => unsubscribe();
}, []); // Remove saveError dependency to avoid stale closures
```

### Phase 4: Add Auto-Retry After Error Clear

When an error is cleared via background sync, trigger a revalidation to update UI state:

```typescript
// After clearing error, also update lastSaved if inspection exists
if (inspection?.synced_at) {
  setLastSaved(new Date(inspection.synced_at));
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| **Database Migration** | `ALTER TABLE inspection_standards ALTER COLUMN has_documentation DROP NOT NULL` |
| `src/lib/atomic-sync-manager.ts` | Sanitize standards before sync to handle nulls |
| `src/pages/InspectionForm.tsx` | Improve error clearing logic with broader pattern matching |
| `src/lib/validation-schemas.ts` | Update standardSchema to allow nullable `has_documentation` |
| `vite.config.ts` | Increment to v2.2.71 |

---

## Technical Implementation

### 1. Database Migration

```sql
-- Allow NULL for has_documentation to match UI "Not Set" state
ALTER TABLE inspection_standards 
ALTER COLUMN has_documentation DROP NOT NULL;
```

### 2. Update Validation Schema

```typescript
// validation-schemas.ts line 70
has_documentation: z.boolean().nullable(), // Allow null for "Not Set" state
```

### 3. Sanitize in Atomic Sync Manager

```typescript
// atomic-sync-manager.ts - After transformTempIds
const sanitizedStandards = standards.map(s => ({
  ...s,
  // Ensure inspection_id is set for new standards
  inspection_id: s.inspection_id || inspectionId,
}));
```

### 4. Improve Error Clearing in InspectionForm

```typescript
// Enhanced sync completion listener
useEffect(() => {
  const unsubscribe = onSyncComplete(() => {
    // Aggressively clear sync-related errors
    setSaveError(null);
    
    // Optionally refresh sync status
    if (import.meta.env.DEV) {
      console.log('[InspectionForm] Sync complete - cleared all errors');
    }
  });
  
  return () => unsubscribe();
}, []); // Empty dependency array for stable reference
```

---

## Testing Checklist

1. Create new inspection → verify standards can be saved with "Not Set" state
2. Edit standards → verify sync succeeds when has_documentation is true/false/null
3. Simulate network failure → verify error displays
4. Restore network → verify background sync clears error automatically
5. Check error banner disappears after successful sync
6. Verify mobile PWA syncs correctly

---

## Version Update

```typescript
const APP_VERSION = "2.2.71";
const BUILD_TIMESTAMP = "02-04-2026 at 12:30 PM CST";
```
