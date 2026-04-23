

## Gap 2.2 — Surface localStorage emergency-fallback failures

### Problem

`emergencyLocalStorageFallback` (`src/lib/offline-storage.ts:574-607`) catches every error with a bare `catch {}` and returns `false`. When IDB is already down (circuit breaker open) and localStorage is also full or blocked (Safari private mode, quota exceeded, SecurityError), the user sees a generic "Storage unavailable" toast. There is no log of what failed, no audit trail of which record could not be persisted, and no signal to the dead-letter UI that data was dropped.

### Change

Single-file change to `src/lib/offline-storage.ts`. No new modules, no DB schema, no UI components.

#### 1. Replace bare `catch {}` with a typed catch that classifies and reports

In `emergencyLocalStorageFallback`:

- Catch the error as `unknown`, then classify:
  - `QuotaExceededError` (or `name === 'QuotaExceededError'`, or DOMException code 22 / 1014) → code `'localstorage_quota'`
  - `SecurityError` (Safari private mode, disabled storage) → code `'localstorage_blocked'`
  - Anything else → code `'localstorage_unknown'`

- Always `console.error('[Offline Storage] Emergency localStorage fallback FAILED', { code, reportType, id, op: operationName, bytes: json?.length, error })` — operational signal, not gated by debug flag.

- Forward to `logError(err, { scope: 'emergency-localstorage-fallback', extra: { code, reportType, id: id?.slice(0,8), operationName, approxBytes } })` (existing `src/lib/log-error.ts`) so the failure lands in `audit_logs.client.error` for admin-side visibility.

- Best-effort dead-letter persistence: call into the existing `photo_upload_failures`-style pattern but for reports. Reuse the `photo_upload_failures` IDB store added in Fix 1.C? No — IDB is the system that just failed, can't write there. Instead, write a **single rolling marker** to `sessionStorage` under key `rw_emergency_fallback_failures` (a small JSON array, capped at 20 entries, FIFO eviction). This survives the current tab session and lets `SyncDiagnosticsSheet` surface "N records could not be saved this session."

- Best-effort `addSyncNotification('Storage is full — {n} record(s) could NOT be saved. Free space immediately.')` so the failure appears in the notification rail next to the existing dead-letter UI from Fix 1.C. Wrap in try/catch — the notification module loads dynamically and must never throw out of the fallback.

- Return `false` as today (the boundary already throws `IdbSaveError('storage_unavailable')` on `false`, which the form auto-save now correctly honors per Gap 2.1 — so the user sees the persistent "Save failed" error in the form, not just a toast).

#### 2. Tiny helper for the sessionStorage dead-letter ring buffer

Inside `offline-storage.ts` (private, not exported):

```ts
function recordEmergencyFallbackFailure(entry: {
  code: 'localstorage_quota' | 'localstorage_blocked' | 'localstorage_unknown';
  reportType: string;
  id: string;
  operationName: string;
  approxBytes: number;
  ts: number;
}): void
```

Reads `sessionStorage.rw_emergency_fallback_failures` as a JSON array, pushes the new entry, trims to 20, writes it back. Wrapped in try/catch (sessionStorage can also be full / blocked). Never throws.

#### 3. Optional reader for `SyncDiagnosticsSheet`

Export `getEmergencyFallbackFailures(): Array<{...}>` so the existing diagnostics sheet can render a "Records lost this session" panel next to the photo-failures panel from Fix 1.C. **No UI work in this gap** — just expose the data; surfacing it is a follow-up.

### Out of scope

- No changes to the boundary itself (Gap 2.1 already makes hard failures throw correctly).
- No changes to other call sites of `emergencyLocalStorageFallback` (there is only one — inside `withIndexedDBSaveBoundary`).
- No DB schema, no edge function, no migration.
- No diagnostics UI changes — covered as a follow-up if/when desired.

### Files touched

- `src/lib/offline-storage.ts` — typed catch with classification, `logError` forward, sessionStorage ring buffer helper, optional `getEmergencyFallbackFailures` export.

