## H5 — Remove dead `queueOperation` update fallbacks from `InspectionForm`

### Finding

The original report's "double bulk-clear per cycle" is **stale** — that bug was already fixed under S4. `useAutoSync.tsx` no longer calls `clearAllQueuedOperations` at all; both the entry path (line ~337) and the exit path (line ~475) now use `pruneCompletedQueuedOperations`, which only drops entries already represented in IDB state. (The only remaining `clearAllQueuedOperations` call site is the admin DataRecoveryTool, an explicit user action.)

What **is** real and unaddressed: `InspectionForm` calls `queueOperation('update', id, saveData)` at three sites — lines 1955, 1988, 2207 — but **nothing in the sync pipeline ever consumes plain update ops**:

- `processQueuedSoftDeletes` only handles ops with `data.deleted_at != null` (`isSoftDeleteOp` check in `queued-soft-delete-processor.ts`).
- `pruneCompletedQueuedOperations`'s `shouldDrop` for non-delete ops requires `isSynced(rec)` — true only after the *normal* IDB-driven sync path succeeds.
- No `applyQueuedUpdate` consumer exists anywhere in the codebase.

So these three fallback sites just write entries that:
1. Sit in IDB until the next sync cycle re-syncs the inspection through the normal IDB path (because `saveInspectionOffline` was already called earlier in the same flow, leaving `updated_at > synced_at`).
2. Get pruned only after that normal path succeeds.
3. Inflate IDB queue size in the meantime, slow down `getQueuedOperations` reads, and produce confusing "Queued for later sync" logs even though the actual sync mechanism is the IDB drift check.

The user's diagnosis is correct: **the IDB `updated_at`/`synced_at` drift is already the sole sync trigger** for inspection updates. The `queueOperation` calls are vestigial — they pre-date S4's prune redesign.

Other `queueOperation` call sites are **legitimate** and should not be touched:

- `NewInspection.tsx:555` — `queueOperation('create', tempId, newInspection)`. Consumed indirectly: brand-new IDB record has no `synced_at`, picked up by `syncInspectionAtomic`'s temp-ID → UUID swap. The queue entry isn't read by sync but the record is. Removing it has the same effect as InspectionForm's case, but it's a one-shot `create` not a hot-path `update` so the cleanup payoff is small. Leave it for now to keep blast radius narrow.
- `Dashboard.tsx:1263` — soft-delete op (`data.deleted_at` set). Consumed by `processQueuedSoftDeletes`. Keep.
- `PhotoGallery.tsx:600` — photo soft-delete (`data.deleted_at` set). Consumed by `processQueuedSoftDeletes`. Keep.

### Fix

Delete the three `queueOperation('update', ...)` fallback blocks in `InspectionForm.tsx`:

1. **~lines 1953–1960** (catch block after `syncWithRetry(3)` fails): drop the queue call. The local IDB save already happened earlier in the function (`localSaveSucceeded` flag at line 1964 confirms this); its `updated_at > synced_at` will trigger re-sync on the next `useAutoSync` cycle. Keep the `setSaveError('pending_sync')`, the toast/notification UX, and the `localSaveSucceeded` warning branch — those are user-facing and still correct.

2. **~lines 1986–1994** (offline branch — `else` of `if (isOnline)`): drop the queue call. `saveInspectionOffline` is already called upstream in the flow (the function name is `saveInspection` and it always persists locally first). Replace the queue block with a single `console.log('[InspectionForm Sync] Offline — IDB drift will trigger sync when online')`.

3. **~lines 2202–2212** (offline branch of `completeInspection`): the `await saveInspectionOffline(updatedInspection)` at line 2204 already persists the completion to IDB with a fresh `updated_at`. Drop the queue call.

Also remove the now-unused `queueOperation` import from `InspectionForm.tsx` if it's no longer referenced anywhere else in the file.

### Verification

- `npx tsc --noEmit` — must pass.
- DEV scenario A (network-fail retry exhausted): toggle DevTools offline mid-save, let `syncWithRetry(3)` exhaust, restore network, observe next auto-sync cycle picks up the inspection via `getUnsyncedInspections` and clears `updated_at > synced_at` drift. Expect: no entry appears in the `operations` IDB store; one normal sync round-trip; `synced_at` advances.
- DEV scenario B (offline edit then online): start offline, edit, save, observe `operations` store stays empty; come online, observe sync runs against IDB record only; `synced_at` advances.
- DEV scenario C (offline complete): start offline, hit Complete, observe `operations` store stays empty; IDB record carries `completed_at` + dirty `updated_at`; come online, observe sync persists the completion via the normal pipeline.
- Regression: confirm `processQueuedSoftDeletes` still picks up Dashboard soft-deletes and PhotoGallery photo deletes (unchanged code paths).

### Risk

Very low. The removed code was **never actually contributing to data persistence** — IDB drift was always the real sync trigger. We're deleting dead branches, shrinking queue churn, and removing a confusing log line. Worst-case bug: a sync edge case where the IDB write succeeded but the `updated_at` wasn't bumped — but `saveInspectionOffline` always sets `updated_at: new Date().toISOString()` (verified pattern across the codebase), so this can't occur.

### Files changed

- **`src/pages/InspectionForm.tsx`**: remove three `try { await Promise.race([queueOperation(...), ...]) }` blocks at ~1953, ~1986, ~2205. Drop the `queueOperation` import if unreferenced after edits. Total diff ≈ −30 lines.

### Out of scope

- `NewInspection.tsx`'s `queueOperation('create', ...)` — same dead-code pattern but lower frequency; defer to a follow-up if queue churn ever becomes a real concern.
- Implementing a true `applyQueuedUpdate` consumer — unnecessary; IDB drift already covers the use case more reliably (no double-write, no temp-ID confusion, no schema drift between queued payload and current row).
- Touching `useAutoSync`'s entry/exit prune calls — those are correct under S4.
