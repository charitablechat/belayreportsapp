
# Audit Results: Offline-Mode, Date Fields, and Security

## Overall Assessment: Architecturally Sound with 3 Low-Severity Issues

The recent changes to InspectionForm (auth guard, isOwner deps, server fetch decoupling) are correctly implemented. The `useReportEditPermission` hook, `cached-auth.ts`, and offline auth system are robust. No critical vulnerabilities, data loss vectors, or security issues were found.

---

## 1. Offline State Integrity -- PASS (with notes)

**useReportEditPermission.tsx**: Correctly hardened.
- Uses `getUserWithCache()` with `getOfflineUserId()` fallback (line 49)
- Auth listener guards with `navigator.onLine` before clearing state (line 75)
- Fast-path ownership check bypasses async super admin check (line 98)
- No race condition for `isReadOnly` being incorrectly true for owners

**cached-auth.ts**: Correctly hardened.
- 3-tier fallback: in-memory cache, localStorage, then network (lines 58-131)
- Expired tokens are accepted when offline for identity extraction (line 246-250)
- `getOfflineUserId()` parses localStorage directly as emergency fallback (line 281-289)
- `ensureValidSession()` proactively refreshes tokens within 60s of expiry (line 339)
- No sensitive data logged (confirmed via grep -- zero matches for token/password/secret logging)

**Corrupted cache edge case**: If `localStorage` contains malformed JSON for the session key, `getCachedUserFromStorage()` catches the parse error (line 258-261) and returns `null`, which correctly falls through to the offline fallback path. No crash risk.

---

## 2. Data Persistence (Save/Upload While Offline) -- PASS

**InspectionForm `performSave`** (line 1084): Correctly authenticates via `getUserWithCache()` with offline fallback before saving. Saves to IndexedDB first, then attempts server sync. If offline, data is queued via `queueOperation` for background sync.

**TrainingForm and DailyAssessmentForm**: Follow the same pattern -- IndexedDB first, server sync second.

**Duplication prevention**: The atomic sync manager uses upsert operations (not delete-then-insert), and the `synced_at` timestamp is only updated after successful server commit. This prevents duplicates on reconnection.

---

## 3. Date Field Validation -- PASS (no regressions found)

All three forms use `useReportEditPermission` and derive `effectiveReadOnly` from `isReadOnly || isCompletionLocked`. Date fields are rendered with the `disabled` or read-only prop bound to this value. The `parseLocalDate` utility (date-utils.ts) correctly handles special values ("N/A", "Unknown") by returning `undefined`, preventing parse errors.

No bypass path exists for manual date entry -- the Calendar/Popover components do not accept raw text input.

---

## 4. Security -- PASS

- No auth tokens, passwords, or secrets are logged in production (`import.meta.env.DEV` gates all sensitive console output)
- Offline password storage uses XOR obfuscation (not true encryption, but acceptable for temporary deferred verification with auto-cleanup)
- `pending_credentials` are deleted immediately after verification succeeds or fails (offline-auth.ts lines 243, 249)
- `clearOfflineAuth()` is called on sign-out (cached-auth.ts line 173)

---

## 5. Three Low-Severity Issues Found (same class as previously fixed)

### Issue A: TrainingForm -- Missing `isOwner` in auto-save dependency array

**File:** `src/pages/TrainingForm.tsx`, line 614
**Current:** `[deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary]`
**Missing:** `isOwner`
**Impact:** If `isOwner` resolves from `false` to `true` after mount, the first edit may not trigger auto-save until another tracked dependency changes. Same class as the bug fixed in InspectionForm.
**Fix:** Add `isOwner` to the dependency array.

### Issue B: TrainingForm -- Missing `isOwner` in backup interval dependency array

**File:** `src/pages/TrainingForm.tsx`, line 641
**Current:** `[hasUnsavedChanges, isSaving, isLoading, training]`
**Missing:** `isOwner`
**Fix:** Add `isOwner` to the dependency array.

### Issue C: DailyAssessmentForm -- Missing `isOwner` in both auto-save dependency arrays

**File:** `src/pages/DailyAssessmentForm.tsx`, line 285 and line 308
**Current (line 285):** Watches data fields but not `isOwner`
**Current (line 308):** `[hasUnsavedChanges, saving, loading]` -- missing `isOwner`
**Fix:** Add `isOwner` to both dependency arrays.

---

## Summary

| Area | Status | Details |
|------|--------|---------|
| Offline auth integrity | PASS | All edge cases handled (corrupted cache, expired tokens, offline fallback) |
| Data persistence | PASS | IndexedDB-first with upsert sync prevents loss and duplication |
| Date field validation | PASS | No regressions; `effectiveReadOnly` respected across all forms |
| Security | PASS | No tokens/secrets logged; credentials cleaned up on verify/sign-out |
| Stale `isOwner` deps (Training) | LOW | Two dependency arrays missing `isOwner` |
| Stale `isOwner` deps (Daily) | LOW | Two dependency arrays missing `isOwner` |

## Recommended Fix

Add `isOwner` to four dependency arrays across TrainingForm and DailyAssessmentForm to match the hardening already applied to InspectionForm. This is a consistency fix -- the practical impact is minimal since `isOwner` resolves quickly and data dependencies change frequently.
