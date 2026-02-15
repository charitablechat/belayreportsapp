

# Admin Read-Only Enforcement: Disable Auto-Modifications for Non-Owner Admins

## Problem

When a Super Admin or Admin opens a report they do not own, the following automatic processes run unchecked and can silently modify the report data:

1. **Debounced auto-save** (1.5s after any state change)
2. **Backup interval auto-save** (every 10-30s)
3. **Summary auto-populate** on initial load (fills empty summary fields)
4. **Real-time summary auto-regeneration** (re-aggregates on status/comment changes)
5. **`last_opened_at` timestamp update** (writes to server on every open)
6. **ACCT number auto-fill** from inspector profile

These processes treat all users equally -- the `useReportEditPermission` hook currently returns `canEdit: true` for Super Admins, meaning no auto-process is gated.

## Solution

Add an `isOwner` check to every automatic data-modification path across all three form pages. Only manual user interactions (clicking Save, editing a field, completing a report) should trigger writes for non-owners.

### Changes by File

---

### 1. `src/hooks/useReportEditPermission.tsx`

Export the existing `isOwner` field (already present in the return type). No code change needed here -- the forms just need to destructure it.

---

### 2. `src/pages/InspectionForm.tsx`

**a) Destructure `isOwner`** from the permission hook (~line 71)

**b) Gate debounced auto-save** (~line 447): Add `isOwner` to the guard condition. If `!isOwner`, skip setting the debounce timer entirely -- state changes from admin browsing will not trigger auto-persistence.

```text
if (!loading && !isInternalUpdateRef.current && isOwner) {
```

**c) Gate backup interval auto-save** (~line 473): Add `isOwner` to the interval's condition.

```text
if (hasUnsavedChanges && !saving && !autoSaving && isOwner) {
```

**d) Gate summary auto-populate** (~line 488): Skip auto-populating summary fields for non-owners. If an admin needs to regenerate the summary, they can click the "Regenerate Summary" button manually.

```text
if (!inspection || loading || !isOwner) return;
```

**e) Gate real-time summary auto-regeneration** (~line 546): Skip the signature-tracking effect for non-owners.

```text
if (loading || !inspection?.id || !isOwner) return;
```

**f) Gate `last_opened_at` update** (~line 869): Skip writing the timestamp for non-owners, since this modifies the record's metadata.

```text
if (isOnline && !id!.startsWith('temp-') && isOwner) {
```

**g) Gate ACCT number auto-fill** (~line 440): Skip for non-owners.

```text
if (inspection && inspectorProfile && !inspection.acct_number && inspectorProfile.acct_number && isOwner) {
```

---

### 3. `src/pages/TrainingForm.tsx`

**a) Destructure `isOwner`** from the permission hook (~line 62)

**b) Gate debounced auto-save** (~line 584): Add `isOwner` check.

**c) Gate backup interval auto-save** (~line 629): Add `isOwner` check.

---

### 4. `src/pages/DailyAssessmentForm.tsx`

**a) Destructure `isOwner`** from the permission hook (~line 63)

**b) Gate debounced auto-save** (~line 253): Add `isOwner` check.

**c) Gate backup interval auto-save** (~line 296): Add `isOwner` check.

---

## What Remains Enabled for Admins

- **Manual Save button**: Still works when clicked explicitly
- **Complete button**: Still works when clicked explicitly  
- **Generate Report**: Still works when clicked explicitly
- **Field editing**: Still allowed (controlled by existing `effectiveReadOnly` / completion lock)
- **Navigation between tabs**: Unaffected
- **Viewing and scrolling**: Unaffected

## What This Prevents

| Auto-Process | Owner | Admin (non-owner) |
|---|---|---|
| Debounced auto-save | Runs | **Blocked** |
| Interval auto-save | Runs | **Blocked** |
| Summary auto-populate | Runs | **Blocked** |
| Summary auto-regenerate | Runs | **Blocked** |
| `last_opened_at` write | Runs | **Blocked** |
| ACCT auto-fill | Runs | **Blocked** |
| Manual Save button | Works | Works |
| Manual Complete | Works | Works |
| Manual Regenerate Summary | Works | Works |

## Files Changed

1. `src/pages/InspectionForm.tsx` -- Gate 6 auto-processes behind `isOwner`
2. `src/pages/TrainingForm.tsx` -- Gate 2 auto-processes behind `isOwner`
3. `src/pages/DailyAssessmentForm.tsx` -- Gate 2 auto-processes behind `isOwner`

No database, RLS, or edge function changes required.

