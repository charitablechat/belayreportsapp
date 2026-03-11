

## Remaining Gaps Found

After a thorough audit of the import-to-save flow, the `AutoSaveIndicator`, the `performSave` guard logic, and the child data lifecycle, I identified **three gaps**. Two are in the import handler, one is in the `AutoSaveIndicator` state precedence.

---

### Gap 1: Empty child arrays from imports leave stale React state (All three forms)

**Severity: High — causes data corruption on save after import**

Both `importReportBackup` (local-backup-ledger.ts, line 478) and all three form import handlers use `if (array.length > 0)` guards. If the imported snapshot legitimately contains empty child arrays (e.g., a report with no systems added yet), the import:
1. Skips writing empty arrays to IndexedDB (line 478: `if (Array.isArray(data) && data.length > 0)`)
2. Reads from IndexedDB and gets the OLD data back
3. Skips updating React state (handler: `if (offSystems.length > 0)`)

Result: stale React state from the previous load persists. On next save, those stale child items are written back — corrupting the imported report.

**Fix:**

**`src/lib/local-backup-ledger.ts`** — In `importReportBackup`, write ALL child arrays to IndexedDB, including empty ones. Change the guard from `if (data.length > 0)` to always write. Empty arrays should clear old data.

**All three form handlers** — Update the `if (arr.length > 0)` guards to unconditionally update React state and `childDataLoadedRef`. Use pattern:
```ts
setSystems(offSystems); // Always set, even if empty
childDataLoadedRef.current.systems = true; // Mark as loaded either way
```

This aligns with how the `performSave` guard works (line 1401): `if (systems.length > 0 || childDataLoadedRef.current.systems)` — an empty array IS saved to IndexedDB as long as `childDataLoadedRef` is `true`.

---

### Gap 2: `AutoSaveIndicator` shows "Saving..." during auto-save but user only wants manual save feedback

**Severity: Low — cosmetic confusion**

`AutoSaveIndicator` receives `isSaving={autoSaving}` (InspectionForm line 2505). When auto-save fires, the spinner and "Saving..." text appear even though the user explicitly asked the visible indicator to only reflect manual saves. This contradicts the intent of the `lastManuallySaved` change.

**Fix:** Pass `isSaving={saving}` instead of `isSaving={autoSaving}` so the spinner only appears during manual save clicks. The `autoSaving` state should remain invisible to the user.

Apply to all three forms.

---

### Gap 3: Photo metadata not refreshed on import (All three forms)

**Severity: Medium — photos from imported backup don't appear until form reload**

The import handler reloads parent + child data from IndexedDB but does NOT reload photo data. Photos are managed by `PhotoCapture`/`PhotoGallery` components with their own queries. If the imported file contains photo metadata (in `snapshot.children.photos`), the IndexedDB gets the data but the React photo state is stale.

**Fix:** In each form's import handler, also reload photos from IndexedDB and trigger a refresh of the photo components. This can be done by dispatching a state change or incrementing a refresh key that the photo components depend on.

---

### Summary of changes

| File | Change |
|------|--------|
| `src/lib/local-backup-ledger.ts` | Remove `data.length > 0` guard in `importReportBackup` — always write child arrays |
| `src/pages/InspectionForm.tsx` | Import handler: unconditionally set child state + `childDataLoadedRef`; change `isSaving={autoSaving}` → `isSaving={saving}` |
| `src/pages/TrainingForm.tsx` | Same two changes |
| `src/pages/DailyAssessmentForm.tsx` | Same two changes |

Gap 3 (photos) requires additional investigation into how photo components load their data before determining the exact refresh mechanism.

