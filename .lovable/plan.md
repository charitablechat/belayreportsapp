

# Root Cause Analysis: Rocky River Ranch "Unsynced" on Admin Side

## Finding: Server is Correctly Aligned -- Problem is Local IndexedDB State

The Rocky River Ranch inspection (`7834f8ad-...`) on the server shows:
- `synced_at`: `2026-02-18 04:08:12.601833+00`
- `updated_at`: `2026-02-18 04:08:12.601833+00`
- **Zero drift. Perfectly aligned.**

There are also **zero drifted records** across the entire `inspections`, `trainings`, and `daily_assessments` tables. The `align_synced_at` RPC and smart triggers are working correctly on the server side.

## Why the Mobile Client Still Shows "Unsynced"

The "unsynced" / "pending" indicator on the Dashboard comes from **local IndexedDB**, not the server. The flow is:

```text
useAutoSync.updateUnsyncedCounts()
  -> getUnsyncedInspections(userId)     [reads from IndexedDB]
    -> filters where: synced_at is null OR updated_at > synced_at
      -> returns count > 0 = "pending" badge shown
```

The most likely scenario is a **stale local record** in the mobile user's IndexedDB where the local `synced_at` was never updated despite the server sync succeeding. This can happen when:

1. **`shouldPreserveLocalRecord` blocks the refresh**: When the Dashboard fetches server data and tries to cache it locally, it calls `shouldPreserveLocalRecord(localRecord)`. If the local record has `updated_at > synced_at` (even by 1ms due to the old trigger drift), the Dashboard **skips overwriting** the local copy. This means the local record keeps its stale timestamps even though the server is aligned.

2. **Timing window**: The user may have made a minor edit after sync completed, bumping local `updated_at` past `synced_at`. The next auto-sync cycle would pick this up, but if the user checks before the next cycle fires, they see "pending."

3. **Old build residue**: The previous build (before `align_synced_at` was deployed) may have left stale local records in IndexedDB that were never re-aligned.

## The Self-Reinforcing Loop

This creates a subtle feedback loop:
1. Local IndexedDB has `updated_at > synced_at` (stale from old build)
2. Auto-sync picks it up and syncs to server -- server is now correct
3. But `shouldPreserveLocalRecord` guard on Dashboard refresh **prevents** the server's aligned timestamps from overwriting the local stale copy
4. Local IndexedDB still shows `updated_at > synced_at`
5. Dashboard shows "pending" -- user taps "force sync" -- cycle repeats

## Fix

### 1. Update `shouldPreserveLocalRecord` to allow server-aligned overwrites

The guard currently blocks ALL overwrites when local `updated_at > synced_at`. It should also check if the incoming server record has a **newer or equal** `synced_at` than the local `updated_at`, which means the data was successfully synced and the server copy is authoritative.

**File: `src/pages/Dashboard.tsx`** (lines 382-388)

Change the caching logic from:
```typescript
if (shouldPreserveLocalRecord(localRecord)) {
  return; // blocks refresh
}
```

To:
```typescript
if (shouldPreserveLocalRecord(localRecord)) {
  // Exception: if server record has synced_at >= local updated_at,
  // the data WAS synced successfully -- allow overwrite to fix stale local state
  const serverSyncedAt = inspection.synced_at ? new Date(inspection.synced_at).getTime() : 0;
  const localUpdatedAt = localRecord.updated_at ? new Date(localRecord.updated_at).getTime() : 0;
  if (serverSyncedAt < localUpdatedAt) {
    console.log('[Dashboard] Preserving unsynced local inspection:', inspection.id);
    return;
  }
  console.log('[Dashboard] Server synced_at >= local updated_at, allowing overwrite:', inspection.id);
}
```

Apply the same pattern for trainings and daily assessments caching sections.

### 2. Same fix in atomic-sync-manager post-sync local save

The atomic sync manager already sets `synced_at = serverTimestamp` and `updated_at = serverTimestamp` locally (line 453-456), which is correct. No changes needed there.

### 3. No database changes required

The server data is perfectly aligned. No SQL needed.

## Security Audit

- No credentials or secrets are logged in the frontend sync code
- The `align_synced_at` RPC is `SECURITY DEFINER` and only accepts whitelisted table names -- safe
- Console logs use truncated user IDs (`userId.substring(0, 8)`) -- no PII exposure
- All sync operations go through authenticated sessions with RLS enforcement

## Impact

- Fixes the "perpetual pending" display on mobile for records that were already successfully synced
- Preserves the safety guard for genuinely unsynced local edits (where `synced_at` on the server is older than local `updated_at`)
- No risk of data loss -- the guard still blocks overwrites for truly unsynced data

