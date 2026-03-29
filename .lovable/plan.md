

## Harden Offline Storage: Maximum Reliability + Hybrid Cleanup

### Problem Summary
The "Storage temporarily unavailable" red toast appears when the circuit breaker in `offline-storage.ts` trips after 3 consecutive IndexedDB timeouts. Even though we previously added `dbPromise = null` reset on timeout, the system can still loop because:

1. **Aggressive re-polling**: `useUnsyncedPhotos` polls every 30s independently, `useAutoSync` polls every 30-60s, and `useStorageHealthCheck` polls every 30s -- all hitting IndexedDB concurrently
2. **Full table scans**: `getUnuploadedPhotos()` uses `db.getAll('photos')` which is slow on large photo stores and contributes to timeouts
3. **No exponential backoff**: Circuit breaker resets after exactly 60s and immediately gets hammered again
4. **No proactive connection test**: After circuit breaker resets, the first real operation may timeout again, instantly re-tripping the breaker

### Changes

#### 1. `src/lib/offline-storage.ts` — Exponential backoff + connection probe on reset

**Circuit breaker reset time**: Change from fixed 60s to exponential backoff (60s, 120s, 240s, max 5min). After the cooldown expires, run a lightweight probe (`db.count('inspections')`) before re-enabling operations.

```text
Current:  60s fixed cooldown → immediately re-enable → timeout → re-trip
Proposed: 60s → 120s → 240s (max 300s) → probe first → re-enable only on success
```

- Add `circuitBreakerResetCount` to track how many times the breaker has tripped consecutively
- Calculate reset time as `min(60000 * 2^resetCount, 300000)`
- In `isCircuitBreakerOpen()`, when cooldown expires, run a synchronous-style probe before returning `false`
- On successful probe: reset all counters. On failed probe: re-trip with incremented backoff

#### 2. `src/lib/offline-storage.ts` — Use index query for `getUnuploadedPhotos`

Replace `db.getAll('photos')` full table scan with an index query on `by-uploaded`:

```typescript
// Before (slow - reads every photo including uploaded ones with null blobs)
const allPhotos = await db.getAll('photos');
const unuploaded = allPhotos.filter(p => !p.uploaded && p.blob != null);

// After (fast - only reads photos where uploaded = false)
const index = db.transaction('photos').store.index('by-uploaded');
const unuploaded = await index.getAll(0); // uploaded is stored as 0/1
// Still need to filter for non-null blob
return unuploaded.filter(p => p.blob != null);
```

Note: The `by-uploaded` index stores boolean as 0/1 in IndexedDB. We need to verify this works correctly; if not, we'll use `IDBKeyRange.only(0)`.

#### 3. `src/hooks/useUnsyncedPhotos.tsx` — Eliminate independent polling

Remove the independent 30s interval. Instead, export `updatePhotoCount` for the main sync cycle to call after photo sync completes. This eliminates one concurrent IndexedDB reader.

```typescript
// Remove: const interval = setInterval(updatePhotoCount, 30000);
// Keep: updatePhotoCount on mount only
// The PWAProvider/useAutoSync will call updatePhotoCount after sync
```

#### 4. `src/hooks/useStorageHealthCheck.tsx` — Reduce polling frequency

Change from 30s to 10s polling. The circuit breaker status is an in-memory check (no IndexedDB access), so this is cheap. More frequent checks mean the warning banner disappears faster after recovery.

#### 5. `src/lib/offline-storage.ts` — localStorage-first guarantee for saves

When `withIndexedDBErrorBoundary` detects circuit breaker is open for a **write** operation, instead of silently dropping the write, attempt to save a compressed version to `localStorage` via `saveReportSnapshot` as a last resort. This is already done at the form level, but adding it at the storage layer provides defense-in-depth.

Add a new exported function `emergencyLocalStorageSave(key, data)` that the circuit breaker path calls for write operations matching inspection/training/assessment saves.

#### 6. `src/hooks/useAutoSync.tsx` — Call `updatePhotoCount` after sync

After the sync cycle completes successfully, import and call the photo count update so it stays in sync without independent polling.

#### 7. Auto-prune synced photo blobs (Hybrid cleanup)

In `getDB()` upgrade handler or as a periodic task in `useAutoSync`, add a cleanup pass that:
- Finds photos where `uploaded = true` AND `blob != null` AND `cachedAt < 7 days ago`
- Nullifies their blob to free storage
- Never touches unsynced (`uploaded = false`) photos

This prevents gradual storage quota exhaustion from cached remote photo blobs.

### Files Modified
| File | Change | Impact |
|------|--------|--------|
| `src/lib/offline-storage.ts` | Exponential backoff, connection probe, index query for photos, emergency localStorage | Core reliability |
| `src/hooks/useUnsyncedPhotos.tsx` | Remove independent 30s polling | Reduce IndexedDB pressure |
| `src/hooks/useStorageHealthCheck.tsx` | 30s → 10s polling (cheap in-memory check) | Faster UI recovery |
| `src/hooks/useAutoSync.tsx` | Call updatePhotoCount post-sync, add photo blob cleanup | Unified sync + hybrid cleanup |

