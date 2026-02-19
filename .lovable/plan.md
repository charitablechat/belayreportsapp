

# Fix Two MEDIUM Data Integrity Vulnerabilities

**Version bump: v2.6.0 → v2.6.1**

## Finding 1: Silent QuotaExceededError on First Failures

**Problem:** When `saveInspectionOffline` or `savePhotoOffline` hits a `QuotaExceededError`, the inner `throw` propagates to `withIndexedDBErrorBoundary`, which catches it in the generic `catch` block (line 420-426). This records a failure and returns `fallbackValue` (which is `undefined`). The caller receives `undefined` with no user notification. The user only sees a toast after **3 consecutive failures** trip the circuit breaker -- meaning the first 2 failed saves are completely silent.

**Fix:** Inside the `catch` block of `withIndexedDBErrorBoundary` (line 420), detect `QuotaExceededError` specifically and immediately surface a destructive toast to the user, regardless of circuit breaker state. This ensures the very first quota failure is visible.

### File: `src/lib/offline-storage.ts`
In the `catch` block of `withIndexedDBErrorBoundary` (around line 420-426), add a check before returning the fallback:

```typescript
} catch (error: any) {
  console.error(`[Offline Storage] Error in ${operationName}:`, error);
  dbConnectionVerified = false;
  recordIndexedDBFailure();

  // IMMEDIATE user notification for QuotaExceededError (don't wait for circuit breaker)
  if (error?.name === 'QuotaExceededError' || error?.message?.includes('QuotaExceeded')) {
    if (typeof window !== 'undefined') {
      import('@/hooks/use-toast').then(({ toast }) => {
        toast({
          title: "Storage full",
          description: "Device storage is full. Please sync your data and clear old reports.",
          variant: "destructive",
        });
      }).catch(() => {});
    }
  }

  return fallbackValue;
}
```

---

## Finding 2: Service Worker Premature `synced_at` Marking

**Problem:** In `sw-sync.js`, the `syncInspectionWithTransaction` function sets `synced_at` on the parent inspection PATCH request (line 138) **before** child data (systems, ziplines, equipment, standards, summary) is upserted. If the SW process is killed mid-sync (e.g., browser kills it after the parent PATCH succeeds but before all children commit), the parent is marked `synced_at` on the server, but child data remains unsynced. The local IndexedDB also gets `synced_at` stamped (line 199), so background sync considers the record "done" and never retries the children.

**Fix:** Use the **deferred `synced_at` pattern** from `atomic-sync-manager.ts`:
1. PATCH the parent inspection **without** `synced_at` first (just the data fields).
2. Upsert all child data.
3. Only after all children succeed, PATCH the parent again with **just** `synced_at`.
4. Only after step 3 succeeds, update local IndexedDB `synced_at`.

### File: `public/sw-sync.js`
Rewrite `syncInspectionWithTransaction` to defer the `synced_at` stamp:

```javascript
async function syncInspectionWithTransaction(inspection, systems, ziplines, equipment, standards, summary) {
  const supabaseUrl = '...';
  const supabaseKey = '...';
  
  try {
    // Step 1: Upsert inspection data WITHOUT synced_at
    const inspData = { ...inspection };
    delete inspData.synced_at; // Don't mark as synced yet
    
    const inspResponse = await fetch(`${supabaseUrl}/rest/v1/inspections?id=eq.${inspection.id}`, {
      method: 'PATCH',
      headers: { ... },
      body: JSON.stringify(inspData)
    });
    if (!inspResponse.ok) throw new Error('Inspection sync failed');
    
    // Step 2: Upsert all child data
    await Promise.all([
      upsertRelatedData(supabaseUrl, supabaseKey, 'inspection_systems', systems),
      upsertRelatedData(supabaseUrl, supabaseKey, 'inspection_ziplines', ziplines),
      upsertRelatedData(supabaseUrl, supabaseKey, 'inspection_equipment', equipment),
      upsertRelatedData(supabaseUrl, supabaseKey, 'inspection_standards', standards),
      summary ? upsertRelatedData(supabaseUrl, supabaseKey, 'inspection_summary', [summary]) : Promise.resolve(true),
    ]);
    
    // Step 3: ONLY NOW mark as synced on the server (deferred synced_at)
    const syncStampResponse = await fetch(`${supabaseUrl}/rest/v1/inspections?id=eq.${inspection.id}`, {
      method: 'PATCH',
      headers: { ... },
      body: JSON.stringify({ synced_at: new Date().toISOString() })
    });
    if (!syncStampResponse.ok) throw new Error('Sync stamp failed');
    
    return true;
  } catch (error) {
    console.error('[SW Transaction] Failed:', error);
    return false;
  }
}
```

This ensures that if the SW is killed after step 1 or during step 2, the server still has `synced_at = null` (or old value), and the next sync cycle will retry the entire package.

---

## Version Bump

### File: `vite.config.ts`
- `APP_VERSION`: `"2.6.0"` --> `"2.6.1"`
- `BUILD_TIMESTAMP`: updated to current date/time

## Summary

| File | Change |
|------|--------|
| `src/lib/offline-storage.ts` | Immediate toast on first `QuotaExceededError` |
| `public/sw-sync.js` | Deferred `synced_at` pattern (3-step: data, children, stamp) |
| `vite.config.ts` | Version bump to v2.6.1 |

## What Does NOT Change
- All existing data safety guards, blocklists, WAL backups, and soft-delete logic remain untouched
- Circuit breaker behavior remains the same (these changes add an earlier notification, not replace the breaker)
- Photo sync in `sw-sync.js` is unaffected (photos don't have the parent-child relationship issue)

