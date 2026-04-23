## H3 — Stop the global Realtime handler from clobbering a form that's currently editing the record

### Finding

`useAutoSync.tsx` ~lines 804–840: the global Realtime subscription writes `payload.new` into IDB via `saveInspectionOffline(enriched)` (and the training/assessment equivalents), gated only by `shouldPreserveLocalRecord(record)`. That guard compares the *server* timestamp against the *IDB* timestamp — but in-flight React form state hasn't been written to IDB yet (autosave is debounced 1500 ms). So if User A is mid-keystroke on inspection X and User B (or A on another device) saves X, the Realtime UPDATE arrives, IDB silently swaps to B's row, A's next 1500 ms autosave writes A's React state on top of B's IDB row, and the reconcile/empty-local-guard pipeline downstream sees a parent/child timestamp mismatch and ends up clobbering one side's edits.

The form-level subscriptions in `InspectionForm.tsx` / `TrainingForm.tsx` / `DailyAssessmentForm.tsx` already correctly suppress reload when `hasUnsavedRef.current` is true — but the global IDB writer in `useAutoSync` has no equivalent gate. That's the gap.

### Fix — active-form registry consulted by the global Realtime IDB writer

1. **Add an in-memory active-form registry** in `src/lib/sync-events.ts` (it already hosts the self-write registry and remote-deleted bus, so it's the natural home):

   ```ts
   // H3: forms register the (table, id) they are currently mounted-and-editing.
   // The global Realtime IDB writer in useAutoSync skips overwriting a record
   // that is in this set, since the form has unsaved React state that is not
   // yet flushed to IDB and an IDB swap would be silently clobbered on the
   // next debounced autosave.
   type ActiveFormTable = 'inspections' | 'trainings' | 'daily_assessments';
   const activeFormRecords = new Map<string, ActiveFormTable>(); // id -> table

   export function registerActiveFormRecord(table, id) { ... }
   export function unregisterActiveFormRecord(id) { ... }
   export function isActiveFormRecord(table, id): boolean { ... }
   ```

   Plus a parallel `pendingRemoteUpdates` bus so the form can show a "Updates available — reload" banner when the writer skipped an overwrite:

   ```ts
   export interface PendingRemoteUpdate {
     table: ActiveFormTable;
     recordId: string;
     remoteUpdatedAt: string;
   }
   export function emitPendingRemoteUpdate(p: PendingRemoteUpdate): void { ... }
   export function onPendingRemoteUpdate(cb): () => void { ... }
   ```

2. **Gate the IDB writer in `useAutoSync.handleRemoteChange`** (~line 814):

   ```ts
   const persistToIDB = async () => {
     try {
       // H3: if the form for this record is currently mounted and editing,
       // skip the IDB overwrite. The form holds the truth in React state;
       // an IDB swap here would be silently clobbered by the next debounced
       // autosave and trigger downstream parent/child timestamp mismatches.
       if (isActiveFormRecord(payload.table, record.id)) {
         emitPendingRemoteUpdate({
           table: payload.table,
           recordId: record.id,
           remoteUpdatedAt: record.updated_at,
         });
         return;
       }
       if (shouldPreserveLocalRecord(record)) return;
       // ... existing enriched save ...
     } catch (e) { ... }
   };
   ```

   Note: still allow `scheduleFullRefetch` and the queryClient invalidation to run as today — those refresh the in-memory dashboard list (which doesn't touch the form's React state) and will re-arm IDB the moment the form unregisters.

3. **Register/unregister in the three forms** — one effect each in `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`:

   ```ts
   useEffect(() => {
     if (!id || id.startsWith('temp-')) return;
     registerActiveFormRecord('inspections', id);
     return () => unregisterActiveFormRecord(id);
   }, [id]);
   ```

   Place adjacent to the existing form-level Realtime subscription effect so the lifecycles match exactly. Temp-id records are excluded — they aren't in the server yet, so cross-device Realtime can't target them.

4. **Surface the deferred update in the form** — extend the existing form-level Realtime effect to also subscribe to `onPendingRemoteUpdate` for this `id`. When fired *and* `hasUnsavedRef.current` is true, set a small `pendingRemoteUpdate` state. Render the existing "Remote update detected" banner pattern (already used by `CollaboratorPresence`) with two actions:
   - **Reload from server** — calls the existing `loadInspection()` / equivalent (will discard local React edits; the user explicitly chose this).
   - **Keep my changes** — clears the banner; next autosave proceeds normally; field-merge on the next sync (per the existing silent-merge memory) handles per-field reconciliation.

   If the user has no unsaved changes when the pending update arrives, fall through to the form's existing reload path immediately (matches today's behavior).

5. **Cleanup edge cases:**
   - Form unmounts → `unregisterActiveFormRecord` runs in cleanup → next Realtime event writes IDB normally.
   - User saves and the form is still mounted → after the save flushes IDB, the form stays registered; that's correct, because the form still holds React state and a Realtime event from another device is still ambiguous. The pending-update banner is the right UX.
   - HMR / fast refresh in dev → registry is module-scoped; cleanup runs in StrictMode double-mount. Harmless.

### Files changed

- **`src/lib/sync-events.ts`** — add `registerActiveFormRecord` / `unregisterActiveFormRecord` / `isActiveFormRecord` and the `pendingRemoteUpdate` bus.
- **`src/hooks/useAutoSync.tsx`** — consult `isActiveFormRecord` in `handleRemoteChange`'s `persistToIDB`, emit `pendingRemoteUpdate` when skipping.
- **`src/pages/InspectionForm.tsx`** — register on mount with `id`; add `onPendingRemoteUpdate` subscription + banner.
- **`src/pages/TrainingForm.tsx`** — same.
- **`src/pages/DailyAssessmentForm.tsx`** — same.

No new components needed; reuse the existing inline banner pattern that the form-level Realtime subscription already uses for the "remote-detected, no unsaved" reload path.

### Why this is safe

- The change is *more conservative* than today: today we always overwrite IDB; after the fix we sometimes skip.
- The gate is precise (`isActiveFormRecord(table, id)`) — it doesn't suppress overwrites for other records on other tabs or for records the user isn't actively editing.
- The skip path still emits a pending-update event, so the user is never silently denied the remote change. If the form is unmounted before the user reacts, the next sync cycle (or the next form open) reconciles via the existing per-field merge.
- No interaction with C8/C9: those operate inside the sync transaction; this change only gates the side-effect IDB writer in the cross-device Realtime listener.

### Out of scope

- A multi-device "live" co-editing view (operational transform / CRDT). The existing field-level merge and the new banner are sufficient.
- Realtime gating for child-row events (zipline_name etc.). Those don't have their own Realtime subscriptions today; `scheduleFullRefetch` already debounces and the form-mounted gate above transitively protects them.

### Risk

Low. Two-line gate in the writer, one effect added per form, one new module-scoped Map. Worst-case bug: the registry leaks an id after unmount (StrictMode oddity) → user gets a "pending update" banner they have to dismiss; no data loss.

### Verification

- DEV scenario A (the bug): open inspection X on device 1 in InspectionForm, type 5 characters, then on device 2 (or a second tab) open the same inspection, change a field, save. Expect: device 1 shows a "Remote update available — reload?" banner; device 1's typed characters are still visible in the textarea; device 1's IDB row is unchanged. Today: device 1's IDB row silently swaps to device 2's copy and the next autosave clobbers one side's edits.
- DEV scenario B (passive viewer): device 1 is on Dashboard (form unmounted); device 2 saves X. Expect: identical to today — IDB updates, dashboard list refreshes.
- DEV scenario C (form mounted, no unsaved edits): device 1 has the form open but hasn't typed anything; device 2 saves. Expect: form auto-reloads from server (existing path, since `hasUnsavedRef` is false).
- DEV scenario D (training + daily assessment): repeat A.
- Regression: `npx tsc --noEmit`; existing form-level realtime subscription behavior is unchanged when no remote events arrive; existing self-write suppression still functions (the active-form gate runs *before* `shouldPreserveLocalRecord` but doesn't interact with `isRecentSelfWrite`).