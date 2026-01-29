
# Plan: Optimize Auto-Save Performance for Near Real-Time Persistence

## Root Cause Analysis

After thorough investigation of the auto-save implementation, I've identified **multiple performance bottlenecks** causing the perceived lag:

### Bottleneck 1: Serial Database Operations (Primary Issue)
**Location**: `src/pages/InspectionForm.tsx` lines 882-1100

The current `performSave` function executes **9+ sequential database calls**:
1. Update inspection record
2. Upsert existing systems (if any)
3. Insert new systems (if any)
4. Upsert existing ziplines (if any)
5. Insert new ziplines (if any)
6. Upsert existing equipment (if any)
7. Insert new equipment (if any)
8. Delete all standards → Insert all standards
9. Upsert summary

Each call waits for the previous to complete. With typical network latency of 50-200ms per call, this creates **500-2000ms total latency**.

### Bottleneck 2: Dual-Layer Persistence
**Location**: Lines 853-873 (IndexedDB) + Lines 882-1077 (Supabase)

Every save operation:
1. Saves to IndexedDB (local) with 5-second timeout wrapper
2. Then syncs to Supabase (remote)

This is architecturally correct for offline-first, but the sequential execution adds latency.

### Bottleneck 3: Redundant Conflict Detection in useAutoSync
**Location**: `src/hooks/useAutoSync.tsx`

The `useAutoSync` hook also attempts to sync all data every 30 seconds via `syncAllInspectionsAtomic()`, which:
- Re-fetches all related data from IndexedDB
- Re-validates the entire package
- Executes another full transaction

This creates **duplicate sync attempts** that compete for database connections.

### Bottleneck 4: Delete-Then-Insert Pattern for Standards
**Location**: Lines 1042-1054

Standards are saved with a destructive pattern:
```typescript
await supabase.from("inspection_standards").delete().eq("inspection_id", id);
await supabase.from("inspection_standards").insert(standardsToInsert);
```

This creates 2 database calls when 1 `upsert` would suffice.

---

## Proposed Optimizations

### Optimization 1: Parallelize Independent Database Operations

**Change**: Execute independent operations concurrently using `Promise.all()`

**Before**:
```typescript
await supabase.from("inspections").update(...);
await supabase.from("inspection_systems").upsert(...);
await supabase.from("inspection_ziplines").upsert(...);
await supabase.from("inspection_equipment").upsert(...);
await supabase.from("inspection_standards").upsert(...);
await supabase.from("inspection_summary").upsert(...);
```

**After**:
```typescript
await Promise.all([
  supabase.from("inspections").update(...),
  supabase.from("inspection_systems").upsert(...),
  supabase.from("inspection_ziplines").upsert(...),
  supabase.from("inspection_equipment").upsert(...),
  supabase.from("inspection_standards").upsert(...),
  supabase.from("inspection_summary").upsert(...),
]);
```

**Expected improvement**: Reduces 6 sequential calls to 1 parallel batch (6x faster).

### Optimization 2: Replace Delete-Insert with Upsert for Standards

**Change**: Use upsert with proper conflict handling instead of delete + insert

```typescript
// Instead of delete + insert
const { error } = await supabase
  .from("inspection_standards")
  .upsert(standards.map(s => ({ ...s, inspection_id: id })), { 
    onConflict: 'id',
    ignoreDuplicates: false 
  });
```

**Expected improvement**: 1 call instead of 2.

### Optimization 3: Reduce Debounce Delay from 3 Seconds to 1.5 Seconds

**Change**: Adjust the debounce timer to feel more responsive while still batching rapid changes

**Location**: `src/pages/InspectionForm.tsx` line 310

```typescript
// Current
saveDebounceTimerRef.current = setTimeout(() => {
  autoSaveProgress();
}, 3000);

// Optimized
saveDebounceTimerRef.current = setTimeout(() => {
  autoSaveProgress();
}, 1500);
```

**Expected improvement**: 50% faster perceived responsiveness.

### Optimization 4: Batch New Item Inserts

**Change**: Instead of inserting new items one-by-one with ID retrieval, insert all at once

**Current pattern** (lines 920-950):
```typescript
if (newSystems.length > 0) {
  const { data: insertedSystems } = await supabase
    .from("inspection_systems")
    .insert(newSystems.map(...))
    .select();
  // Update local state with new IDs...
}
```

**Optimized pattern**:
```typescript
// Pre-generate UUIDs client-side to avoid needing .select()
const systemsWithIds = newSystems.map(s => ({
  ...s,
  id: crypto.randomUUID(), // Pre-generate ID
  inspection_id: id
}));
await supabase.from("inspection_systems").insert(systemsWithIds);
// Update local state immediately with pre-generated IDs
```

This eliminates the `.select()` roundtrip.

### Optimization 5: Decouple IndexedDB from Critical Path

**Change**: Make IndexedDB saves fire-and-forget for UI responsiveness

```typescript
// Current: await blocks until IndexedDB completes
await saveInspectionOffline(inspectionToSave);

// Optimized: Non-blocking with error logging
saveInspectionOffline(inspectionToSave).catch(console.error);
```

The UI should update immediately; offline storage is for fault tolerance, not blocking.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/InspectionForm.tsx` | Parallelize DB ops, reduce debounce, batch inserts |
| `src/pages/TrainingForm.tsx` | Mirror same optimizations |
| `src/pages/DailyAssessmentForm.tsx` | Mirror same optimizations |

---

## Security Considerations

All optimizations **preserve existing security**:
- RLS policies remain unchanged
- `inspector_id` immutability is maintained
- Authentication checks stay in place
- No bypass of validation logic

---

## Performance Expectations

| Metric | Current | After Optimization |
|--------|---------|-------------------|
| Debounce delay | 3000ms | 1500ms |
| DB operations (serial) | ~9 calls | ~1-2 parallel batches |
| Typical save latency | 500-2000ms | 100-300ms |
| Perceived responsiveness | "Laggy" | "Near-instant" |

---

## Summary

| Category | Detail |
|----------|--------|
| Files Changed | 3 (InspectionForm.tsx, TrainingForm.tsx, DailyAssessmentForm.tsx) |
| Primary Fix | Parallelize database operations |
| Secondary Fix | Reduce debounce to 1.5s |
| Risk Level | Low (no schema/security changes) |
| Testing | Edit fields rapidly and observe auto-save indicator timing |
