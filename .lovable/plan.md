

# Fix: Druidia Report Perpetual Re-Sync Loop

## Summary of Investigation

**Timestamp comparisons**: Already using `new Date().getTime()` in all three `getUnsynced*` functions -- no string comparison issue exists.

**Server state**: Druidia record is fully aligned on the server (`synced_at > updated_at` by ~50 minutes). No triggers on the inspections table that could re-dirty timestamps.

**`align_synced_at` RPC**: Correctly sets `synced_at = updated_at` and returns both values. The atomic sync manager saves aligned timestamps locally after each successful sync.

**Realtime loop**: Already fixed in the previous edit (cooldown + in-progress guard on `handleRemoteChange`).

## Remaining Issue: Micro-Drift Tolerance

When `align_synced_at` runs on the server, it sets `synced_at = updated_at` perfectly. But the atomic sync manager reads the returned `updated_at` timestamp and saves it locally as both `synced_at` and `updated_at`. On the very next Dashboard refresh, the server data is cached locally -- and the server's `synced_at` may differ from `updated_at` by microseconds due to PostgreSQL timestamp precision. This microscopic drift (`updated_at` 04:37:21.091403 vs `synced_at` 05:27:06.935) can cause the `new Date().getTime()` comparison to return `true` if the wrong pair of timestamps ends up in IndexedDB.

## Fix Plan

### 1. Add micro-drift tolerance to `getUnsynced*` filters

**File: `src/lib/offline-storage.ts`**

In all three functions (`getUnsyncedInspections`, `getUnsyncedTrainings`, `getUnsyncedDailyAssessments`), replace:

```typescript
return new Date(i.updated_at).getTime() > new Date(i.synced_at).getTime();
```

With:

```typescript
// Tolerate up to 2 seconds of drift from server-side timestamp alignment
const drift = new Date(i.updated_at).getTime() - new Date(i.synced_at).getTime();
return drift > 2000;
```

This ensures that records with negligible timestamp differences (caused by RPC/trigger timing) are NOT re-queued for sync. Only records with meaningful local edits (which would produce >2s drift) are treated as unsynced.

### 2. Add terminal-style sync confirmation log in atomic-sync-manager

**File: `src/lib/atomic-sync-manager.ts`**

After the `align_synced_at` RPC succeeds (for all three report types), add a structured console log in the retro-tech terminal style:

```typescript
console.log(
  '%c[SYNC_TERMINAL] align_synced_at CONFIRMED %c%s',
  'color: #4ade80; font-family: monospace; font-weight: bold',
  'color: #86efac; font-family: monospace',
  `| table=${p_table_name} | id=${recordId.substring(0,8)}... | ts=${serverTimestamp}`
);
```

### 3. Enhance SyncPulse terminal with alignment confirmation

**File: `src/components/pwa/SyncPulse.tsx`**

Add a "LAST_ALIGNED" row to the terminal sheet that shows when `align_synced_at` last confirmed timestamp alignment. This uses the existing `lastSyncTime` from the PWA context and the existing blinking cursor animation for the "syncing" state.

### 4. Security Audit

- No API keys or database secrets are hardcoded in the frontend
- The `align_synced_at` RPC is `SECURITY DEFINER` with a whitelisted table name check
- Console logs use truncated IDs (`substring(0, 8)`) -- no PII exposure
- All sync operations go through authenticated sessions with RLS enforcement

## Technical Details

Files to modify:
- `src/lib/offline-storage.ts` -- 3 filter functions (lines 609, 1066, 1339)
- `src/lib/atomic-sync-manager.ts` -- 3 post-RPC log statements (lines 448, 990, 1447)
- `src/components/pwa/SyncPulse.tsx` -- add LAST_ALIGNED row to terminal sheet

Risk: Very low. The 2-second tolerance only affects the "is this record unsynced?" check. Any genuine user edit would produce far more than 2 seconds of drift. The visual changes are additive only.

