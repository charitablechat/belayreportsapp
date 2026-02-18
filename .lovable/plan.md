

# Final Audit: Remaining Data Loss Vectors

After tracing every write path, delete path, sign-out flow, and error boundary across the entire persistence layer, I identified **5 remaining vectors** where report data can still be lost.

---

## Finding 1: Sign Out on Form Pages Does Not Flush Unsaved Changes

**Risk: HIGH**

**Location:** `InspectionForm.tsx:250-254`, `TrainingForm.tsx:280-283`, `DailyAssessmentForm.tsx:277-280`

All three form pages have a `handleSignOut` that immediately calls `supabase.auth.signOut()` and navigates to `/` without checking `hasUnsavedChanges` or triggering a save. If the user has been editing for less than 1.5 seconds (within the auto-save debounce window), those changes are lost permanently. The `useUnsavedChanges` dialog only intercepts browser navigation (popstate), not programmatic `navigate("/")` calls.

```typescript
// Current code — no save guard
const handleSignOut = async () => {
  setSigningOut(true);
  await supabase.auth.signOut();
  navigate("/");
};
```

**Fix:** Before signing out, check `hasUnsavedChanges`. If true, call `performSaveRef.current?.(true)` and await it (or at minimum fire the localStorage snapshot), then proceed with sign-out. Alternatively, show the `UnsavedChangesDialog` before signing out.

---

## Finding 2: Circuit Breaker Silently Drops Writes

**Risk: MEDIUM-HIGH**

**Location:** `offline-storage.ts:347-358`

When IndexedDB fails 3 times, the circuit breaker trips for 60 seconds. During this window, ALL IndexedDB operations — including **saves** — silently return `fallbackValue` (`undefined` for saves) without any user-visible error or notification. The user continues typing, believing auto-save is working, but every save is silently discarded for up to 60 seconds.

After the circuit breaker resets, the auto-save picks up from the **current** React state (which is fine), but if the user navigates away or closes the tab during the 60-second window, the emergency save also silently fails because it routes through `performSave` which calls the same circuit-breaker-guarded functions.

**Fix:** When the circuit breaker is open and a **write** operation is attempted, surface a user-visible warning (toast or banner) like "Offline storage temporarily unavailable — your changes may not be saved." Additionally, the emergency save's `onEmergencySnapshot` (localStorage) already bypasses IndexedDB, so it provides partial protection — but only if it's wired up (verify all 3 forms pass `onEmergencySnapshot`).

---

## Finding 3: Offline Photo Deletion is Silently Lost

**Risk: MEDIUM**

**Location:** `PhotoGallery.tsx:335-356`

When a user deletes a photo while **offline** (`!isOnline || !photo.uploaded`), the `handleDelete` function skips the soft-delete server call and only calls `loadPhotos()` to refresh the UI. But `loadPhotos` re-reads from IndexedDB/server, so the photo reappears on the next load. The delete action is effectively a no-op.

However, for **local-only** photos (not yet uploaded), there is no path to actually remove them — neither the server soft-delete nor a local IndexedDB delete is executed. The photo persists in IndexedDB and reappears on reload, confusing the user.

Conversely, if the photo WAS uploaded and the user is offline, the soft-delete never reaches the server. When the user comes back online and `loadPhotos` runs, the photo reappears because no offline queue mechanism captures the pending delete.

**Fix:** For local-only photos (not uploaded), call `deleteOfflinePhoto(photo.id)` directly. For uploaded photos deleted while offline, queue the soft-delete operation for replay when connectivity returns (similar to how inspection operations are queued).

---

## Finding 4: `deleteOfflinePhoto` Has No WAL Backup

**Risk: LOW**

**Location:** `offline-storage.ts:866-873`

Unlike `deleteOfflineInspection`, `deleteOfflineTraining`, and `deleteOfflineDailyAssessment` (which now have WAL backups), `deleteOfflinePhoto` performs a raw `db.delete('photos', id)` without snapshotting the photo blob first. If a photo is accidentally removed from IndexedDB (e.g., during orphan cleanup or a bug), the blob is permanently lost — especially for unuploaded photos that only exist locally.

**Fix:** Before deleting, read the photo record and write it to the `report_backups` store (or a dedicated `photo_backups` store). This is particularly important for photos with `uploaded === false`.

---

## Finding 5: Browser Storage Pressure Can Evict IndexedDB Without Warning

**Risk: LOW (environmental, not code)**

**Location:** Architectural — affects all IndexedDB data

On iOS Safari and some Android browsers, if the user hasn't granted persistent storage (`navigator.storage.persist()`), the browser can evict the entire IndexedDB database under storage pressure (low disk space). The app requests persistent storage in `ensureStorage()`, but if the request is denied (which Safari often does), all local-only data (unsynced reports, unuploaded photos) can be silently wiped by the OS.

The existing `storageWarningShown` flag logs a console warning but never surfaces it to the user.

**Fix:** If `requestPersistentStorage()` returns `false`, show a one-time user-facing banner: "Your browser may clear offline data. Please stay connected to sync your work." This is a UX improvement, not a code fix — the data loss is caused by the browser, not the app.

---

## Summary Table

```text
+----+---------------------------------------------------+-----------+----------------------------------+
| #  | Finding                                           | Risk      | Location                         |
+----+---------------------------------------------------+-----------+----------------------------------+
| 1  | Sign out does not flush unsaved changes            | HIGH      | InspectionForm.tsx:250           |
|    |                                                    |           | TrainingForm.tsx:280             |
|    |                                                    |           | DailyAssessmentForm.tsx:277      |
+----+---------------------------------------------------+-----------+----------------------------------+
| 2  | Circuit breaker silently drops IndexedDB writes    | MED-HIGH  | offline-storage.ts:347-358       |
+----+---------------------------------------------------+-----------+----------------------------------+
| 3  | Offline photo deletion is lost / no-op             | MEDIUM    | PhotoGallery.tsx:335-356          |
+----+---------------------------------------------------+-----------+----------------------------------+
| 4  | deleteOfflinePhoto has no WAL backup               | LOW       | offline-storage.ts:866-873       |
+----+---------------------------------------------------+-----------+----------------------------------+
| 5  | Browser storage eviction not surfaced to user      | LOW       | offline-storage.ts:315-336       |
+----+---------------------------------------------------+-----------+----------------------------------+
```

## Proposed Fixes

| File | Changes |
|------|---------|
| `src/pages/InspectionForm.tsx` | Guard `handleSignOut` — flush pending save before signing out |
| `src/pages/TrainingForm.tsx` | Same sign-out guard |
| `src/pages/DailyAssessmentForm.tsx` | Same sign-out guard |
| `src/lib/offline-storage.ts` | Add user-visible toast when circuit breaker drops a write; add WAL backup to `deleteOfflinePhoto` |
| `src/components/PhotoGallery.tsx` | Handle offline photo deletion properly — delete local-only photos from IndexedDB; queue server soft-deletes for offline replay |

## Security

- No API keys, secrets, or credentials are involved in any of these changes
- All fixes operate on client-side storage (IndexedDB, localStorage) and React state
- No database schema changes required

