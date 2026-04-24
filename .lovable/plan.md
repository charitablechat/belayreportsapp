

## Fix 2.A — Sticky save-failure error card with "Copy draft" escape hatch

### Status of the wrapper-flag piece

The wrapper-side change you described (`rethrowOn: 'quota'`) is already in place under a different shape from Gap 2.1: `withIndexedDBSaveBoundary` is a parallel wrapper that **always throws `IdbSaveError` on hard failure** (quota, timeout, idb_unhealthy, storage_unavailable). The three user-facing saves — `saveInspectionOffline`, `saveTrainingOffline`, `saveDailyAssessmentOffline` — already route through it (`offline-storage.ts:1523, 1541, 1569`). All three form pages already `import { isIdbSaveError }` and branch on it in their save catch handlers, and `setSaveError(...)` is wired into the header `AutoSaveIndicator`.

**Verdict:** no wrapper refactor needed. Adding a `rethrowOn` flag to the silent `withIndexedDBErrorBoundary` would duplicate behavior and risk drift. Skipping that part.

### What's missing

What 2.A still adds is the **UI escape hatch** for the user when a save genuinely cannot land:

1. The current `AutoSaveIndicator` shows the error as a small pill in the header. It is dismissible (the "Retry Save" button calls `setSaveError(null)`), it scrolls out of view, and on mobile it collapses to the word "Error" — not loud enough for "your data is at risk."
2. There is no way for the user to physically extract their unsaved draft when both IDB and localStorage have failed. They can only retry, which will likely fail again, or refresh and lose everything.

### Plan

#### 1. New component: `SaveFailureBanner`

`src/components/SaveFailureBanner.tsx` — a sticky, full-width, **non-auto-dismissing** error card that mounts at the top of the form's main scroll area whenever `saveError` is a real error (not `null`, not `'pending_sync'`).

Structure:
- Full-width red glassmorphism strip (`bg-destructive/10 border-destructive/40 backdrop-blur-xl`) anchored just below the form header so it stays visible as the user scrolls the form.
- Bold title: **"Save failed — your changes are NOT stored on this device."**
- Body: the error message + a one-line plain-English explanation derived from the `IdbSaveError.code` (quota → "Your device storage is full.", storage_unavailable → "Both fast and backup storage are unavailable.", idb_unhealthy → "Your browser's local database is in a bad state.", timeout → "The save took too long to complete.", unknown → generic).
- Three actions, in this order:
  1. **Retry save** — calls the same `saveProgress()` already wired to the header retry button.
  2. **Copy draft to clipboard** — primary escape hatch (see below).
  3. **Download draft (.json)** — secondary escape hatch (see below).
- A small `<details>` "Show technical details" disclosure with the raw error code/message for support copy-paste. Collapsed by default.
- No `X` close button. The banner only disappears when the next save succeeds (`saveError === null`).

#### 2. "Copy draft to clipboard" — the core escape hatch

The hard part of 2.A. Each form page already holds the live in-memory draft state. The banner needs access to that state without each form re-implementing the serializer.

Approach: each form page passes an **`onExportDraft: () => Record<string, unknown>`** callback to `SaveFailureBanner`. The callback returns a plain JSON-serializable object snapshot (e.g. `{ inspection, systems, ziplines, equipment, photos, ... }`) — exactly the same shape it would have passed to `saveInspectionOffline`. The banner then:

- **Copy:** `await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))`. On success, swap the button label to "✓ Copied" for 3s and toast confirm. On failure (clipboard API blocked / not in secure context), fall back to a textarea + auto-select for manual copy, and show a one-time hint "Long-press to copy."
- **Download:** Build a `Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })`, create an object URL, click an `<a download="rope-works-draft-{reportType}-{idShort}-{ts}.json">`, revoke the URL.

The downloaded file shape is the same JSON the user can later paste back to support, who can re-insert it via the existing recovery tooling (`DataRecoveryTool`). No new ingest path is built in this gap — the file is the rescue artifact.

Each of the three forms gets a tiny `buildDraftSnapshot()` helper wired to its page-level state. That's the only new logic per form.

#### 3. Wiring the three forms

For `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`:

- Add `<SaveFailureBanner saveError={saveError} onRetry={...} onExportDraft={buildDraftSnapshot} />` immediately inside the main form scroll container, above the existing header pill.
- Implement `buildDraftSnapshot()` — collect the same fields the form passes to its `saveXxxOffline` call (already gathered in one place inside the auto-save helpers — extract that object into a local builder).
- Leave the existing header `AutoSaveIndicator` exactly as-is — the pill is still useful as a status glance, but the banner is now the loud authoritative error UI.
- No catch-handler changes required — they already call `setSaveError(...)` with a meaningful message; the banner reads that.

Edge cases:
- If `saveError === 'pending_sync'`, do **not** show the banner. Pending-sync is not a failure.
- If the user retries and the next save succeeds, the existing `setSaveError(null)` call (already in the success path of every auto-save helper) automatically dismisses the banner. No new lifecycle code needed.
- Lovable preview already short-circuits saves; the banner is suppressed when `isLovablePreview()` returns true (matches the existing `AutoSaveIndicator` behavior).

#### 4. Tiny ergonomics: include the `IdbSaveError.code` in `setSaveError`

Today's `setSaveError('Local save failed — your changes are NOT stored. Tap to retry.')` is a free-form string. To let the banner pick the right plain-English explanation, change those three call sites to also stash the code:

- Promote `saveError` from `string | null` to `{ message: string; code?: IdbSaveErrorCode } | 'pending_sync' | null` in each form page.
- Update the few comparisons (`saveError === 'pending_sync'`, `saveError && saveError !== 'pending_sync'`) accordingly.
- `AutoSaveIndicator` reads `saveError.message` instead of the raw string.

This is a mechanical sweep contained to the three pages and one component.

### Out of scope

- No changes to `withIndexedDBErrorBoundary` or `withIndexedDBSaveBoundary`. The throwing path is already correct from Gap 2.1.
- No reverse-import path for the JSON draft (admin-side ingestion is separate work; the file is a manual rescue artifact today).
- No persistence of the draft to a server endpoint as a third escape hatch — explicitly excluded because the failure case is "all local + network storage paths are degraded."
- No changes to the silent boundary used by reads/queues/photo helpers.

### Files touched

1. **`src/components/SaveFailureBanner.tsx`** — new (~120 lines).
2. **`src/pages/InspectionForm.tsx`** — add banner mount + `buildDraftSnapshot()`; promote `saveError` shape.
3. **`src/pages/TrainingForm.tsx`** — same.
4. **`src/pages/DailyAssessmentForm.tsx`** — same.
5. **`src/components/AutoSaveIndicator.tsx`** — read `error.message` from the new shape (small).
6. **`src/lib/offline-storage.ts`** — re-export `IdbSaveErrorCode` type if not already exported, so forms can type the new state shape.

