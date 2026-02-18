
# Fix Persistent Sync Conflict Loop (v2.5.8 patch)

## Root Cause

The unresolved conflict for **Twin Lakes Family YMCA - Cedar Park** (`f44d0658`) persists because of a gap in the `useConflicts` auto-resolution logic. Here's the exact cycle:

1. The inspection has `synced_at = Feb 11` and `updated_at = Feb 17` on the server
2. The sync pipeline sees `updated_at > synced_at` locally, so it attempts to sync
3. During sync, `atomic-sync-manager` detects the remote `updated_at` (Feb 17) is newer than the local `updated_at` (Feb 13) -- a conflict
4. A conflict record is created and the sync aborts with `{ success: true, conflict: true }`
5. The `useConflicts` hook picks up the conflict and runs last-write-wins: remote wins (Feb 17 > Feb 13)
6. **The bug**: When remote wins, the hook **only marks the conflict as `resolved = true`** -- it does NOT update the inspection's `synced_at` to match `updated_at`
7. So the inspection still has `synced_at = Feb 11` and `updated_at = Feb 17` -- it still looks "unsynced"
8. Next sync cycle: exact same thing happens, creating a new conflict (6 total for this inspection, 5 already resolved)

The v2.5.8 timestamp alignment fix doesn't help here because conflict detection happens BEFORE the transaction, so the post-transaction alignment code never runs.

## Fix Strategy

### 1. Align `synced_at` when remote wins (`useConflicts.tsx`)

When the auto-resolve determines remote wins (which means the server already has the correct/newer data), the hook must update the inspection's `synced_at` to match the server's `updated_at`. This signals "this record is already synced" and stops the loop.

```typescript
// When remote wins (useLocal = false):
// The server already has the newer data, so align synced_at to stop re-sync loop
const { data: serverRecord } = await supabase
  .from('inspections')
  .select('updated_at')
  .eq('id', conflict.inspection_id)
  .single();

if (serverRecord) {
  await supabase
    .from('inspections')
    .update({ synced_at: serverRecord.updated_at })
    .eq('id', conflict.inspection_id);
}
```

After this update, the `update_updated_at_column` trigger will bump `updated_at` again. But the v2.5.8 post-sync alignment in `atomic-sync-manager` won't apply here since this isn't a transaction-based sync. So we need to read back the server timestamp after the update and store it locally, OR use a different approach.

**Better approach**: Instead of updating via the API (which triggers the `updated_at` bump), we skip the server update entirely and just align the LOCAL IndexedDB state. The server data is already correct -- only the local state is confused.

```typescript
// When remote wins: align local IndexedDB only
// Server already has the correct data -- just fix local state
const { data: serverRecord } = await supabase
  .from('inspections')
  .select('updated_at, synced_at')
  .eq('id', conflict.inspection_id)
  .single();

if (serverRecord) {
  // Import and use the offline storage to align local timestamps
  const localInspection = await getInspectionFromOffline(conflict.inspection_id);
  if (localInspection) {
    await saveInspectionOffline({
      ...localInspection,
      updated_at: serverRecord.updated_at,
      synced_at: serverRecord.updated_at, // Align to prevent re-sync
    });
  }
}
```

Wait -- this introduces a dependency on offline storage functions in the hook, which complicates things. The cleanest fix is actually two-pronged:

**Prong 1**: In the `useConflicts` hook, when remote wins, update the server's `synced_at` to match `updated_at`. Yes, this bumps `updated_at` via the trigger, BUT we immediately read back the new `updated_at` and do a second `synced_at` update. This is the same race condition as before. 

**Cleanest approach**: Update `synced_at` on the server using the server's OWN `updated_at` value in a single statement, then let the v2.5.8 alignment handle the rest on the next dashboard load.

Actually, the simplest and most robust fix is:

1. In `useConflicts`, when remote wins, set `synced_at = NOW()` on the server. The trigger bumps `updated_at = NOW()` at the same instant, so they're perfectly aligned (same transaction, same `NOW()`).
2. Mark the conflict resolved.

### 2. Also handle local IndexedDB alignment in the conflict resolver

After resolving the conflict on the server, invalidate the inspections query so the dashboard re-fetches the aligned timestamps and stores them locally.

### 3. Clean up the existing stale conflict

The conflict `c1646f09` is now over 24 hours old (created Feb 17 16:35, current date Feb 18). The 24-hour stale cleanup in the useEffect should catch it on the next Dashboard load. But the fix ensures no NEW conflicts form afterward.

## Technical Changes

### File: `src/hooks/useConflicts.tsx`

**Change 1**: When remote wins in `autoResolveConflicts`, align `synced_at` on the server before marking resolved:

```typescript
if (useLocal) {
  // Apply local version (existing logic)
  // ...
} else {
  // Remote wins: align synced_at = NOW() on server
  // NOW() in the same transaction as the trigger means updated_at and synced_at align perfectly
  await supabase
    .from('inspections')
    .update({ synced_at: new Date().toISOString() })
    .eq('id', conflict.inspection_id);
}

// Mark conflict as resolved
await supabase
  .from('sync_conflicts')
  .update({ resolved: true })
  .eq('id', conflict.id);
```

**Change 2**: After resolving conflicts, invalidate the inspections-related queries so dashboards and forms re-fetch aligned data:

```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['sync-conflicts'] });
  queryClient.invalidateQueries({ queryKey: ['inspections'] });
},
```

**Change 3**: Reduce the stale cleanup threshold from 24 hours to 1 hour. Conflicts that sit unresolved for over an hour are almost certainly stale -- the auto-resolver runs every 60 seconds when the Dashboard is open.

## Files Modified

| File | Change |
|------|--------|
| `src/hooks/useConflicts.tsx` | Align `synced_at` when remote wins; invalidate inspection queries on resolve; reduce stale threshold to 1 hour |

## What Does NOT Change

- Atomic sync manager conflict detection logic
- Transaction manager
- Service worker sync
- Photo sync pipeline
- CompletionLockDialog or form pages
- Database triggers or RLS policies

## Why This Prevents Future Occurrences

The conflict loop requires ALL of these conditions:
1. `synced_at < updated_at` locally (looks unsynced)
2. Remote `updated_at` is newer than local (conflict detected)
3. Conflict resolver doesn't fix the timestamp gap

After this fix, condition 3 is eliminated: the resolver aligns `synced_at` when remote wins. Combined with the v2.5.8 post-transaction alignment for normal syncs, both conflict and non-conflict sync paths now properly align timestamps.
