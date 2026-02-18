
# Fix: Rocky River Ranch (and Similar Reports) Missing `synced_at` on Server

## Root Cause

When inspections are created or saved **while online**, the code saves data directly to the server but **never sets `synced_at` on the server** -- it only sets `synced_at` in local IndexedDB.

**Affected code paths:**

1. **`NewInspection.tsx` (line 181-189)**: Inserts inspection to server without `synced_at`. Then sets `synced_at` locally only (line 197-200).
2. **`InspectionForm.tsx` (line 1235-1238)**: Updates inspection on server without `synced_at`. Then sets `synced_at` locally only (line 1405-1410).
3. **`NewDailyAssessment.tsx` (line 152-156)**: Same pattern -- server insert lacks `synced_at`, local gets it.
4. **`DailyAssessmentForm.tsx` (line 454-458, 636-646)**: Same pattern.

**Note:** `TrainingForm.tsx` (line 476-480) actually DOES include `synced_at` in the server update, so trainings are not affected.

**Why the auto-sync doesn't catch it:** The auto-sync only picks up records where local `updated_at > synced_at`. Since the direct save path sets them equal locally, the auto-sync never queues these records, leaving the server's `synced_at` permanently NULL.

**Result:** The admin sees `synced_at = NULL` and reports it as "not synced," even though the data is fully present on the server.

## Fix

### 1. `NewInspection.tsx` -- Include `synced_at` in server INSERT

Add `synced_at: new Date().toISOString()` to the `.insert()` call on the server (alongside the existing local set).

### 2. `InspectionForm.tsx` -- Include `synced_at` in server UPDATE

After the `sanitizeInspection()` call, include `synced_at: new Date().toISOString()` in the `.update()` payload sent to the server.

### 3. `NewDailyAssessment.tsx` -- Include `synced_at` in server INSERT

Add `synced_at` to the data inserted into the `daily_assessments` table.

### 4. `DailyAssessmentForm.tsx` -- Include `synced_at` in server UPDATEs

Add `synced_at` to the update payloads in all three save paths (auto-save, manual save, and submit/complete).

### 5. One-time data fix -- Align existing records

Run SQL to set `synced_at` for all records that exist on the server but have `synced_at = NULL` and are not deleted. These records were successfully synced (data is present) but never had the timestamp set:

```sql
-- Inspections created/saved online without synced_at
UPDATE inspections
SET synced_at = updated_at
WHERE synced_at IS NULL AND deleted_at IS NULL;

-- Daily assessments created/saved online without synced_at
UPDATE daily_assessments
SET synced_at = updated_at
WHERE synced_at IS NULL AND deleted_at IS NULL;
```

## Impact

- **Rocky River Ranch** and **Twin Cedars**: Will immediately show as synced after the SQL fix
- **All future** online-created/edited inspections and daily assessments: Will correctly set `synced_at` on the server
- **Risk**: Very low. Any record that exists on the server was either created online or synced -- in both cases, setting `synced_at = updated_at` is correct
