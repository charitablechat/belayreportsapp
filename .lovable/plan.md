

## S5 + S6: Idempotent dedup key + race-free Realtime self-suppression

Two surgical fixes. S5 adds a stable client-side dedup key; S6 closes a self-trigger race in the Realtime handler.

---

### S5 — Replace `(inspector_id, organization, created_at)` dedup with a client idempotency key

**Root cause.** The current dedup query in `atomic-sync-manager.ts` (lines 159–165 / 1000–1006 / 1747–1753) matches on `created_at`, which the server frequently rewrites via `DEFAULT now()` for service-role inserts and is timezone-fragile. `maybeSingle()` also silently returns `null` if a previous failed run already left two collisions, so the third sync attempt creates a third row.

**Fix.** Add a nullable `client_idempotency_key text` column to `inspections`, `trainings`, `daily_assessments`. Populate it at temp-id creation time (it's literally the temp-id minus the `temp-` prefix — already a UUID, already persisted in IDB, never changes). On sync, dedup on this key instead of the fragile triple.

**Schema (migration):**
```sql
ALTER TABLE public.inspections      ADD COLUMN client_idempotency_key text;
ALTER TABLE public.trainings        ADD COLUMN client_idempotency_key text;
ALTER TABLE public.daily_assessments ADD COLUMN client_idempotency_key text;

-- Partial unique index per inspector (NULLs ignored, so legacy rows unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS inspections_client_idemp_unique
  ON public.inspections (inspector_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trainings_client_idemp_unique
  ON public.trainings (inspector_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS daily_assessments_client_idemp_unique
  ON public.daily_assessments (inspector_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;
```

The partial-unique index is the actual server-side guarantee — even if the dedup query races, the second insert fails loudly instead of silently duplicating.

**Producer changes** (where temp-ids are minted):
- `src/pages/NewInspection.tsx` (~`tempId` block, ~line 540–550): when creating offline `newInspection`, set `client_idempotency_key: tempId.replace(/^temp-/, '')`. When inserting online (line 514–523), also pass `client_idempotency_key: crypto.randomUUID()` so even online creates carry one.
- `src/pages/NewTraining.tsx` and `src/pages/NewDailyAssessment.tsx` — same pattern. Confirm during implementation.

**Sync changes** in `src/lib/atomic-sync-manager.ts`:

Replace each of the three temp-id dedup blocks. Inspection example (~159–165):
```ts
const idempKey = (inspection as any).client_idempotency_key
  ?? inspection.id.replace(/^temp-/, ''); // fallback for legacy temp rows

const { data: dupRows } = await supabase
  .from('inspections')
  .select('id')
  .eq('inspector_id', inspection.inspector_id)
  .eq('client_idempotency_key', idempKey)
  .limit(2); // detect prior-failed-run double-collision

if (dupRows && dupRows.length > 0) {
  if (dupRows.length > 1) {
    console.warn('[Atomic Sync] Multiple server rows share idempotency key — adopting first, manual cleanup needed', {
      idempKey, ids: dupRows.map(r => r.id),
    });
  }
  const serverId = dupRows[0].id;
  inspectionIdMapping = { oldId: inspection.id, newId: serverId };
  inspection.id = serverId;
  inspectionId = serverId;
} else {
  const newId = crypto.randomUUID();
  inspectionIdMapping = { oldId: inspection.id, newId };
  inspection.id = newId;
  inspectionId = newId;
}

// Always carry the key forward into the upsert payload.
(inspection as any).client_idempotency_key = idempKey;
```

Identical shape for trainings (~1000–1006) and daily_assessments (~1747–1753).

**Why this is safe.** Legacy rows without a key are never touched (partial index excludes NULLs; dedup query never matches NULL keys). New offline records inherit the key from their temp-id, so even a temp-id that's been retried 5 times still maps to the same server row. The `limit(2)` plus warn logs the prior double-collision case instead of silently producing a third.

---

### S6 — Close the Realtime self-suppression race

**Root cause.** In `useAutoSync.tsx` lines 510–520, the `finally` block runs:
```ts
syncInProgressRef.current = false;
setSyncInProgress(false);
lastSyncCompletedAtRef.current = Date.now();
```
A Realtime UPDATE that lands between line 511 and line 513 sees `syncInProgressRef === false` AND `lastSyncCompletedAtRef === <ancient or 0>`, so it falls through both gates and triggers `performSync(true)`. Worse, `align_synced_at` is a separate write that emits its own Realtime event after the transaction completes — so even the cooldown gate is racing against our own follow-up writes.

**Fix.** Two changes:

1. **Reorder the finally block** — set the timestamp *before* clearing the in-progress flag:
   ```ts
   } finally {
     lastSyncCompletedAtRef.current = Date.now();   // first
     syncInProgressRef.current = false;             // then release the gate
     setSyncInProgress(false);
     setState(prev => ({ ...prev, isSyncing: false }));
     updateUnsyncedCounts().catch(() => {});
     try { window.dispatchEvent(new Event('sync-photos-updated')); } catch {}
   }
   ```
   Now any Realtime event that races past `syncInProgressRef` will see a fresh `lastSyncCompletedAtRef` and hit the cooldown gate correctly.

2. **Per-record self-suppression set** — add a short-TTL "we just wrote this" registry that the Realtime handler consults *in addition to* the cooldown:
   ```ts
   // Top of useAutoSync.tsx, alongside the other refs:
   const recentSelfWritesRef = useRef<Map<string, number>>(new Map()); // recordId -> expiry ms
   const SELF_WRITE_TTL = 15000; // 15s — covers transaction commit + align_synced_at follow-up
   
   const markSelfWrite = useCallback((id: string) => {
     recentSelfWritesRef.current.set(id, Date.now() + SELF_WRITE_TTL);
   }, []);
   
   const isSelfWrite = useCallback((id: string) => {
     const exp = recentSelfWritesRef.current.get(id);
     if (!exp) return false;
     if (exp < Date.now()) {
       recentSelfWritesRef.current.delete(id);
       return false;
     }
     return true;
   }, []);
   ```
   
   Wire it in `handleRemoteChange` (line 619) before the existing gates:
   ```ts
   const recordId = payload?.new?.id || payload?.old?.id;
   if (recordId && isSelfWrite(recordId)) {
     if (import.meta.env.DEV) {
       console.log('[AutoSync] Skipping Realtime — self-write suppression', { recordId });
     }
     // Still persist to IDB and invalidate queries (existing logic), but do NOT trigger sync.
     // ...existing IDB persist + queryClient.invalidateQueries...
     return;
   }
   ```
   Refactor the existing function so the `performSync` retrigger lives in a separate branch and self-writes skip it cleanly.

3. **Atomic-sync ↔ hook bridge.** The atomic-sync helpers don't have a direct handle to `useAutoSync`'s ref. Use a tiny module-level registry in `src/lib/sync-events.ts` that already brokers `emitSyncComplete`:
   ```ts
   // sync-events.ts
   const recentSelfWriteIds = new Map<string, number>();
   export function registerSelfWrite(id: string, ttlMs = 15000) {
     recentSelfWriteIds.set(id, Date.now() + ttlMs);
   }
   export function isRecentSelfWrite(id: string) {
     const exp = recentSelfWriteIds.get(id);
     if (!exp) return false;
     if (exp < Date.now()) { recentSelfWriteIds.delete(id); return false; }
     return true;
   }
   ```
   `useAutoSync.handleRemoteChange` calls `isRecentSelfWrite(payload.new.id)`. Each atomic-sync helper calls `registerSelfWrite(inspectionId)` (and the same for trainings/assessments) **right before** the transaction's final `update` step and again right before/after the `align_synced_at` RPC. That covers both Realtime writes from the same record.

**Why this is safe.** The reorder is a pure ordering fix. The self-write set is additive — the cooldown and `syncInProgressRef` gates still run; we just stop trusting them as the only line of defense. TTL of 15s is generous vs. transaction + align timing (typically <2s) but well below the next legitimate edit window from another device. Cross-device updates still trigger sync because their record ids are not in our self-write set.

---

### Files

- **New migration:** add `client_idempotency_key` column + partial unique indexes on `inspections`, `trainings`, `daily_assessments`.
- `src/lib/atomic-sync-manager.ts` — three dedup blocks (~159–186, ~1000–1027, ~1747–1773) replaced; carry `client_idempotency_key` forward in the payload; call `registerSelfWrite` before the final transaction step and before `align_synced_at` (three sites each ≈ 6 lines).
- `src/lib/sync-events.ts` — add `registerSelfWrite` / `isRecentSelfWrite`.
- `src/hooks/useAutoSync.tsx` — reorder `finally` block (~510–520); call `isRecentSelfWrite` at the top of `handleRemoteChange` (~619), short-circuit the sync re-trigger when true while keeping IDB persist + query invalidation.
- `src/pages/NewInspection.tsx`, `src/pages/NewTraining.tsx`, `src/pages/NewDailyAssessment.tsx` — set `client_idempotency_key` at row creation (online and offline branches).

### Out of scope

- Backfilling `client_idempotency_key` for existing rows. Partial unique index ignores NULLs; legacy rows continue using the old triple-key path via the fallback `inspection.id.replace(/^temp-/, '')`.
- Hardening the cooldown duration — the per-record set replaces it as the primary guard; the time-based cooldown stays as belt-and-suspenders.
- Folding `align_synced_at` into the transaction (separate RPC change, deferred).

### Risk

Low–medium. S5 adds columns + partial unique indexes — the partial-NULL behavior keeps legacy rows untouched, and the producer changes are additive (key written but never required by old code paths). The unique index is the only thing that could surface a pre-existing duplicate at insert time; if so, the warn log identifies it for manual cleanup. S6 is pure ordering + additive bookkeeping — worst case the self-write set is wrong about a record and we do one redundant sync, identical to today's behavior.

