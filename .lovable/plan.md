

## C6 — Fix `migrateUserData` silent partial-failure on transaction auto-close

### Finding

`src/lib/offline-auth.ts:316-334` (inspections/trainings/daily_assessments loop) and `:339-360` (photos loop) both await `store.put()` inside a `for` loop after `await store.getAll()`. IndexedDB transactions auto-close as soon as the microtask queue yields without a pending request, so on Chromium/WebKit the second `put` typically throws `InvalidStateError: The transaction has finished`. The `catch (storeError)` swallows it with a `console.warn`, and migration aborts after the first row.

Result on the offline→online reconcile path: any inspections/trainings/daily_assessments/photos saved under the deterministic email-hash UUID stay tagged with the old `inspector_id`. Dashboard queries filter by the real `inspector_id`, so the rows look "disappeared" to the user even though they exist in IDB.

### Fix

Single file: `src/lib/offline-auth.ts`, function `migrateUserData` (~lines 304-365). Replace the awaited-put-in-loop pattern with the standard non-yielding pattern: collect all `put()` requests **synchronously** inside the same `readwrite` transaction, then `await Promise.all(puts).then(() => tx.done)`. No await between requests means the transaction stays open.

**Before (each store loop):**
```ts
const tx = db.transaction(name, 'readwrite');
const store = tx.objectStore(name);
const allRecords = await store.getAll();
for (const record of allRecords) {
  if (record[idField] === oldUserId) {
    record[idField] = newUserId;
    await store.put(record);   // ← tx auto-closes here
    totalMigrated++;
  }
}
await tx.done;
```

**After:**
```ts
// Read phase in its own readonly tx (free to await)
const readTx = db.transaction(name, 'readonly');
const allRecords = await readTx.objectStore(name).getAll();
await readTx.done;

const toMigrate = allRecords.filter(r => r[idField] === oldUserId);
if (toMigrate.length === 0) continue;

// Write phase: open tx, fire all puts synchronously, then await tx.done
const writeTx = db.transaction(name, 'readwrite');
const writeStore = writeTx.objectStore(name);
const puts = toMigrate.map(record => {
  record[idField] = newUserId;
  return writeStore.put(record);   // returns a promise; do NOT await here
});
await Promise.all(puts);
await writeTx.done;
totalMigrated += toMigrate.length;
```

Apply the identical pattern to the `photos` loop at ~lines 339-360 (the change-detection logic stays; just collect mutated records first, then fire puts in one synchronous batch).

### Why this is safe

- `idb` `store.put()` returns a promise that resolves on transaction success. Firing all `put()` calls synchronously before any `await` is the canonical pattern documented in the `idb` README and works on every browser that supports IndexedDB.
- Read tx and write tx are split — the read can safely `await getAll()`, the write never yields between requests.
- No schema changes, no new stores, no consumers to update.
- Worst-case if a single `put` rejects: `Promise.all` rejects, the `catch (storeError)` keeps the existing warn-and-continue behavior, but now we get **all-or-nothing per store** instead of "first row only," which is strictly better.
- For very large stores (>10k matching rows) `Promise.all` over many `put`s is still fine — IDB handles them in the same tx and they all commit together. If we ever cross that threshold this can be chunked, but it's not in scope.

### Out of scope

- Restructuring the helper into a single transaction across all four stores (cross-store atomicity isn't required here — each store stands alone, and `report_deleted_items` audit is a separate concern).
- Telemetry / progress UI for migration. The toast in the caller (`verifyAndReconcileOfflineAuth`) already announces the linkup; this fix just makes the count under it accurate.
- The `inspector_id` field-name assumption — already correct for all three report stores.

### Risk

Trivial. Same function signature, same surrounding caller flow, same error-swallowing semantics. The behavior change is "migrate all matching rows per store" instead of "migrate one row per store and silently warn."

### Verification

- `npx tsc --noEmit`.
- DEV scenario A (the bug): in DevTools, seed IDB `inspections` with 5 rows whose `inspector_id` equals the deterministic email-hash UUID. Force a reconcile (`verifyAndReconcileOfflineAuth`). Expect: console log `[OfflineAuth] Migrated 5 records ...` (or the equivalent count including photos), all 5 rows now have the real `inspector_id`, dashboard renders them.
- DEV scenario B (no matches): seed 5 rows with the real `inspector_id` already. Reconcile. Expect: count = 0, no errors, rows untouched.
- DEV scenario C (mixed): 3 matching, 2 non-matching, 1 photo with `oldUserId` in `photoUrl`. Expect: count = 4, only the 3 inspector_id rows + 1 photo touched, the other 2 untouched.
- Repeat for `trainings`, `daily_assessments`, `photos`.

