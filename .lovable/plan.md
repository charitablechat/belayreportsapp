
# Fix Plan: Inspection Loading Freeze Issue

## Problem Summary
The application freezes indefinitely on "Loading inspection..." after page reload. The root cause is that critical IndexedDB functions lack error boundary protection, causing the loading lifecycle to hang when IndexedDB is slow or unavailable.

## Root Cause Details

### 1. Missing Error Boundaries
Three functions in `src/lib/offline-storage.ts` are not wrapped with the `withIndexedDBErrorBoundary` protection:

| Function | Line | Current State |
|----------|------|---------------|
| `getRelatedDataOffline` | 762-770 | Unprotected - can block indefinitely |
| `saveRelatedDataOffline` | 734-759 | Unprotected - can block indefinitely |
| `clearRelatedDataOffline` | 772-787 | Unprotected - can block indefinitely |

### 2. Blocking Save Operations After Network Fetch
In `InspectionForm.tsx`, after successfully fetching data from the database, the code calls `saveRelatedDataOffline()` to cache the data locally. These calls have no timeout protection:

- Line 688: `await saveInspectionOffline(data)`
- Line 706: `await saveRelatedDataOffline('systems', ...)`
- Line 722: `await saveRelatedDataOffline('ziplines', ...)`
- Line 735: `await saveRelatedDataOffline('equipment', ...)`
- Line 744: `await saveRelatedDataOffline('standards', ...)`
- Line 754: `await saveRelatedDataOffline('summary', ...)`

When IndexedDB hangs, these operations block forever, preventing `setLoading(false)` from being called.

---

## Implementation Plan

### Step 1: Wrap `getRelatedDataOffline` with Error Boundary

```typescript
// src/lib/offline-storage.ts (lines 762-770)
export async function getRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string
): Promise<any[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = storeNameMap[type];
      const index = db.transaction(storeName).store.index('by-inspection');
      return await index.getAll(inspectionId);
    },
    [],
    `getRelatedDataOffline:${type}`
  );
}
```

### Step 2: Wrap `saveRelatedDataOffline` with Error Boundary

```typescript
// src/lib/offline-storage.ts (lines 734-759)
export async function saveRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string,
  data: any[]
) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = storeNameMap[type];
      
      const existingData = await getRelatedDataOffline(type, inspectionId);
      for (const item of existingData) {
        await db.delete(storeName, item.id);
      }
      
      for (const item of data) {
        const dataWithInspectionId = {
          ...item,
          inspection_id: inspectionId,
          id: ensureValidUUID(item.id),
        };
        await db.put(storeName, dataWithInspectionId);
      }
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Saved ${type}:`, data.length, 'items');
      }
    },
    undefined,
    `saveRelatedDataOffline:${type}`
  );
}
```

### Step 3: Wrap `clearRelatedDataOffline` with Error Boundary

```typescript
// src/lib/offline-storage.ts (lines 772-787)
export async function clearRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string
) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = storeNameMap[type];
      const existingData = await getRelatedDataOffline(type, inspectionId);
      
      for (const item of existingData) {
        await db.delete(storeName, item.id);
      }
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Cleared ${type} for inspection:`, inspectionId);
      }
    },
    undefined,
    `clearRelatedDataOffline:${type}`
  );
}
```

### Step 4: Make Post-Network Cache Operations Non-Blocking

In `InspectionForm.tsx`, wrap the cache save operations to be non-blocking so that a failure to cache locally does not prevent the form from loading:

```typescript
// After fetching from Supabase, save to offline cache without blocking
if (data) {
  setInspection(data);
  setInspectorId(data.inspector_id);
  // Non-blocking cache update
  saveInspectionOffline(data).catch(e => 
    console.warn('[InspectionForm] Non-critical: failed to cache inspection', e)
  );
}

// For related data:
if (systemsData) {
  const normalizedSystems = systemsData.map(item => ({...}));
  setSystems(normalizedSystems);
  // Non-blocking cache update
  saveRelatedDataOffline('systems', id!, normalizedSystems).catch(e =>
    console.warn('[InspectionForm] Non-critical: failed to cache systems', e)
  );
}
// ... repeat pattern for ziplines, equipment, standards, summary
```

---

## Files to Modify

1. **`src/lib/offline-storage.ts`**
   - Wrap `getRelatedDataOffline` with `withIndexedDBErrorBoundary`
   - Wrap `saveRelatedDataOffline` with `withIndexedDBErrorBoundary`
   - Wrap `clearRelatedDataOffline` with `withIndexedDBErrorBoundary`

2. **`src/pages/InspectionForm.tsx`**
   - Make all post-network cache operations non-blocking using `.catch()` pattern

---

## Expected Outcome

After these changes:
- The "Loading inspection..." screen will always resolve within 3-5 seconds maximum
- IndexedDB failures will be logged but will not block the UI
- Users will see their data immediately after the network fetch completes
- Local caching happens in the background without blocking the loading state

---

## Technical Notes

- The `withIndexedDBErrorBoundary` wrapper already includes a 5-second timeout and returns a fallback value on failure
- This fix follows the existing architectural pattern established for other offline storage functions
- No changes to database schema or backend functions required
