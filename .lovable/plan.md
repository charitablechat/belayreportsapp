
# Fix Offline Report Sync Failure

## Root Cause

Reports created offline get a `temp-${Date.now()}-${random}` ID (in `NewInspection.tsx` line 147). When `syncInspectionAtomic` runs, it validates the complete data package using `inspectionSchema` which requires `id: z.string().uuid()` -- a strict UUID check. The temp ID fails this validation, and the sync silently throws a "Validation failed" error. This happens on every sync cycle, which is why the logs show "Unsynced count: 1" repeating indefinitely with no progress.

The `inspector_name` field is not stored in the database -- it is resolved via a Supabase JOIN (`inspector:profiles!inspections_inspector_id_profiles_fkey`). Since the report never syncs to the server, it never appears online, making it seem like the inspector name is lost.

```text
Offline Creation Flow:
  NewInspection.tsx -> id = "temp-1707500000-abc123xyz"
  
Sync Attempt:
  atomic-sync-manager.ts -> validateInspectionPackage()
  validation-schemas.ts  -> id: z.string().uuid()  --> FAILS!
  Result: "Validation failed" error, sync skipped
  
Next Cycle (60s later):
  Same inspection still unsynced -> same failure -> infinite loop
```

## Fix (2 changes in 1 file)

### 1. `src/lib/atomic-sync-manager.ts` -- Transform temp inspection IDs before sync

In `syncInspectionAtomic()`, after loading the inspection from IndexedDB (line 102) and before validation (line 153), add logic to detect a `temp-` prefixed ID and replace it with a real UUID. The new UUID must also be propagated to all child records (systems, ziplines, equipment, standards, summary) which reference the inspection via `inspection_id`.

After a successful sync, the local IndexedDB record must be updated: delete the old temp-ID entry, save under the new UUID, and update all child record stores with the new `inspection_id`.

```text
Before validation:
  1. Check if inspection.id starts with "temp-"
  2. If yes, generate a real UUID: crypto.randomUUID()
  3. Replace inspection.id with the new UUID
  4. Update inspection_id in all child records (systems, ziplines, equipment, standards, summary)
  5. Proceed with validation (now passes z.string().uuid())

After successful sync:
  1. Delete old IndexedDB entry keyed by temp ID
  2. Save new entry keyed by real UUID  
  3. Update all child IndexedDB stores to reference the new inspection_id
```

### 2. `src/lib/atomic-sync-manager.ts` -- Update local navigation after ID change

After the sync completes and IndexedDB is updated, the inspection form may still be open using the temp-ID URL (e.g., `/inspection/temp-123...`). The post-sync save already updates IndexedDB with the new data, so when the dashboard next loads, it will show the correct UUID-based link.

## What Does NOT Need to Change

- **`inspector_name`**: Not a database column. It is derived from the `profiles` table via join. Once the inspection syncs to the server with a valid `inspector_id`, the join works correctly. No changes needed.
- **`inspector_id`**: Already a valid UUID (from real auth or deterministic offline auth). No changes needed.
- **Validation schemas**: The strict `z.string().uuid()` on `inspectionSchema.id` is correct -- the fix is to transform the ID before validation, not weaken validation.
- **Child record temp IDs**: Already handled by `transformTempIds()` at lines 137-150. No changes needed.
- **No new database tables or auth logic** per the requirements.

## Technical Details

### Changes in `src/lib/atomic-sync-manager.ts`

Around line 102 (after `getOfflineInspection`), insert approximately 30 lines:

```typescript
// Detect and replace temp IDs with real UUIDs before sync
let inspectionIdMapping: { oldId: string; newId: string } | null = null;

if (inspection.id.startsWith('temp-')) {
  const newId = crypto.randomUUID();
  inspectionIdMapping = { oldId: inspection.id, newId };
  
  console.log('[Atomic Sync] Replacing temp ID with real UUID:', {
    oldId: inspection.id,
    newId,
  });
  
  // Update the inspection record
  inspection.id = newId;
  inspectionId = newId; // Update the function parameter reference
}
```

Then update child records' `inspection_id` references (after they are loaded but before validation):

```typescript
if (inspectionIdMapping) {
  const updateInspectionId = (items: any[]) =>
    items.map(item => ({
      ...item,
      inspection_id: inspectionIdMapping!.newId,
    }));
  
  rawSystems = updateInspectionId(rawSystems);
  rawZiplines = updateInspectionId(rawZiplines);
  rawEquipment = updateInspectionId(rawEquipment);
  rawStandards = updateInspectionId(rawStandards);
  if (rawSummary) {
    rawSummary = { ...rawSummary, inspection_id: inspectionIdMapping.newId };
  }
}
```

After successful sync (around line 382), add IndexedDB cleanup for the old temp ID:

```typescript
if (inspectionIdMapping) {
  // Delete old temp-ID entry from IndexedDB
  await deleteOfflineInspection(inspectionIdMapping.oldId);
  
  // Update child record stores with new inspection_id
  // (saveRelatedDataOffline handles this by keying on inspection_id)
  const childStores = ['systems', 'ziplines', 'equipment', 'standards', 'summary'] as const;
  for (const store of childStores) {
    const oldData = await getRelatedDataOffline(store, inspectionIdMapping.oldId);
    if (oldData.length > 0) {
      // Delete old entries and save with new inspection_id
      await deleteRelatedDataOffline(store, inspectionIdMapping.oldId);
      const updated = oldData.map(item => ({
        ...item,
        inspection_id: inspectionIdMapping!.newId,
      }));
      await saveRelatedDataOffline(store, inspectionIdMapping.newId, updated);
    }
  }
}
```

A helper `deleteRelatedDataOffline` will need to be added to `src/lib/offline-storage.ts` to delete child records by `inspection_id` from each IndexedDB store.

### New helper in `src/lib/offline-storage.ts`

Add a `deleteRelatedDataOffline` function that deletes all records from a given child store matching a specific `inspection_id`. This mirrors the existing `saveRelatedDataOffline` pattern.

## Risk Assessment

- **Data integrity**: The temp-to-UUID swap happens atomically before any DB writes. If sync fails, the original temp-ID data remains in IndexedDB untouched (the swap is only persisted after successful sync).
- **Navigation**: Users on `/inspection/temp-...` will still work from IndexedDB until they navigate away. On next dashboard load, the report appears with the real UUID.
- **No schema changes**: No database migrations needed.
- **No auth changes**: Existing offline auth system is unaffected.
