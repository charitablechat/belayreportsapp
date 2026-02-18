

# Fix: Ensure align_synced_at RPC Calls Execute in Production

## Current Status

The `align_synced_at` RPC code exists in `atomic-sync-manager.ts` (lines 443, 984, 1440 for inspections, trainings, and daily assessments respectively), but the **currently running build** does not include it. Evidence:

- Zero `align_synced_at` network requests observed
- Zero "align" console log entries
- Sync is still using direct PATCH requests to set `synced_at` independently from `updated_at`

The auto-sync cycle on the old build re-introduced drift for all 9 trainings and 3 daily assessments after our manual SQL alignment.

## What Needs to Happen

### 1. No code changes required

The `align_synced_at` RPC calls are already correctly implemented in `atomic-sync-manager.ts` at three locations. Once the current build finishes deploying, they will start executing.

### 2. Add a console log to confirm RPC execution (optional but recommended)

Currently the `align_synced_at` calls have no logging on success. Adding a brief log line after each RPC call would make future verification trivial without needing to inspect network requests.

**File: `src/lib/atomic-sync-manager.ts`**

After line 447 (inspections), after line 988 (trainings), and after line 1444 (daily assessments), add:
```typescript
console.log('[Atomic Sync] align_synced_at result:', inspectionId, serverTimestamp);
```

### 3. One-time server re-alignment after build deploys

Once the new build is live and confirmed (via the new console log), run the alignment SQL one final time to clean up the drift re-introduced by the old build:

```sql
UPDATE trainings SET synced_at = updated_at 
WHERE synced_at IS NOT NULL AND deleted_at IS NULL AND updated_at > synced_at;

UPDATE daily_assessments SET synced_at = updated_at 
WHERE synced_at IS NOT NULL AND deleted_at IS NULL AND updated_at > synced_at;
```

After this, the combination of:
- Smart triggers (already deployed) preventing `updated_at` bumps on metadata-only changes
- `align_synced_at` RPC (deploying with current build) ensuring `synced_at = updated_at` post-sync
- `Date` object comparison (already deployed) in `offline-storage.ts` as a safety net

...will permanently eliminate re-sync loops for all report types.

## Risk

- Very low. Adding console logs has zero functional impact. The SQL re-alignment is the same safe operation we ran before.

