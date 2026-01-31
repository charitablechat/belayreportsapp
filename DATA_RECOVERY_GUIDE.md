# 🔄 Data Recovery Guide

**Last Updated:** January 2026  
**Purpose:** Consolidated recovery procedures for all data loss scenarios

---

## Quick Reference

| Scenario | Recovery Method | Access Level | Time Window |
|----------|----------------|--------------|-------------|
| Accidentally deleted a report | Deleted Records Recovery | Super Admin | 60 days |
| Data not syncing from device | Local Data Recovery Tool | Super Admin | Until browser cleared |
| Data disappeared after save | Check IndexedDB + Force Sync | User | Immediate |
| Lost data after browser clear | Contact Admin for DB restore | Super Admin | 60 days (if soft-deleted) |
| Schema migration caused issues | Migration Audit Rollback | Developer | Varies |

---

## Section 1: End User Self-Service

### Scenario: My data didn't save

**Symptoms:**
- Changes made but not visible after refresh
- "Unsynced" badge appears on report card
- Network indicator shows offline

**Steps:**
1. **Check the network indicator** (top-right corner)
   - Green = Online and synced
   - Yellow = Online with pending changes
   - Red = Offline
2. **Wait for auto-sync** - Changes sync automatically every 30 seconds when online
3. **Use Force Sync** if needed:
   - Click your profile avatar (top-right)
   - Select "Force Sync" from the dropdown
   - Wait for confirmation toast

**Technical Background:**
- All changes are saved locally to IndexedDB within 1.5 seconds of input
- Data persists even if network fails mid-save
- Local data syncs automatically when connection restores

---

### Scenario: Report shows as "Unsynced"

**Symptoms:**
- Report card displays "Unsynced" badge
- Cloud icon with number indicates pending items

**Steps:**
1. **Verify internet connection** - Check network indicator
2. **Wait for automatic sync** - Occurs every 30 seconds when online
3. **Manually trigger sync:**
   - Open the report
   - Make any small change (adds a space, removes it)
   - Auto-save will trigger sync
4. **Check for errors:**
   - Open browser DevTools (F12)
   - Look for red errors in Console tab
   - Report specific error messages to admin

---

### Scenario: Data visible on one device but not another

**Cause:** Data is saved locally but hasn't synced to server yet.

**Steps:**
1. On the device with the data:
   - Ensure you're online
   - Use Force Sync (Profile > Force Sync)
   - Wait for "Sync complete" confirmation
2. On the other device:
   - Refresh the page
   - Data should now appear

---

## Section 2: Admin Recovery (Super Admin Access)

### Deleted Records Recovery

**Location:** Super Admin Dashboard → Admin Tab → Deleted Records Recovery

**Capabilities:**
- View all soft-deleted records (inspections, trainings, daily assessments)
- See who deleted each record and when
- View days remaining before permanent deletion (60-day window)
- Restore individual records with one click
- Batch cleanup of expired records

**Steps to Restore a Deleted Record:**

1. Navigate to **Super Admin Dashboard**
2. Click the **Admin** tab
3. Scroll to **Deleted Records Recovery** section
4. Use the table filter to find the record:
   - Filter by table type (inspections/trainings/daily_assessments)
   - Search by organization name
   - Sort by deletion date
5. Locate the record in the table
6. Click the **↻ Restore** icon (rotate arrow)
7. Confirm restoration in the dialog
8. Record is now active and visible to the original owner

**Retention Badge Colors:**
- 🟢 Green (30+ days remaining) - Safe window
- 🟡 Orange (8-30 days remaining) - Approaching expiration
- 🔴 Red (≤7 days remaining) - Urgent, restore soon

**Batch Cleanup:**
- Click "Run Cleanup" to permanently delete all expired records
- This action is irreversible
- Use only when confirmed records are no longer needed

---

### Local Data Recovery Tool

**Location:** Super Admin Dashboard → Admin Tab → Data Recovery

**Purpose:** Recover data stuck in a user's browser that hasn't synced to the database.

**Use Cases:**
- User reports data missing from dashboard but claims they saved it
- User's device went offline during critical data entry
- Need to manually push local data to server
- Investigating sync discrepancies

**How It Works:**
1. Access the **affected device/browser** (must be on the user's machine)
2. Navigate to Super Admin Dashboard → Admin Tab
3. Click **Data Recovery** section
4. The tool displays all data in local IndexedDB:
   - ✅ Green rows = Synced to database
   - 🔴 Red rows = NOT in database (unsynced)
5. For unsynced records:
   - Click **↑ Upload** icon to push to database
   - Or click **🗑 Delete** to remove local copy (if duplicate)

**Important Notes:**
- This tool must be run on the affected device
- Data in IndexedDB persists until:
  - User clears browser data
  - App explicitly deletes it after successful sync
- If user cleared browser data, local recovery is not possible

---

## Section 3: Database-Level Recovery (Developer)

### Prerequisites
- Database access via Lovable Cloud SQL Editor
- Understanding of table relationships
- Backup verification before any restore operation

---

### Restore a Single Soft-Deleted Record

**When to Use:** Record was soft-deleted but needs to be recovered, and the Admin UI is unavailable.

```sql
-- Restore a specific deleted record
SELECT restore_deleted_record(
  'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',  -- record UUID
  'inspections'  -- table: inspections, trainings, or daily_assessments
);

-- Returns: true if successful, false if record not found
```

**What This Does:**
- Sets `deleted_at` to NULL
- Sets `deleted_by` to NULL
- Sets `retention_until` to NULL
- Record becomes visible to the owner again

---

### View All Deleted Records (SQL)

```sql
-- Get all deleted records with details
SELECT * FROM get_deleted_records(NULL);

-- Filter by table
SELECT * FROM get_deleted_records('inspections');
SELECT * FROM get_deleted_records('trainings');
SELECT * FROM get_deleted_records('daily_assessments');
```

**Returns:**
- `table_name` - Which table the record is from
- `record_id` - UUID of the record
- `deleted_at` - When it was deleted
- `deleted_by` - UUID of user who deleted it
- `deleter_name` - Name of the deleting user
- `retention_until` - When permanent deletion occurs
- `days_remaining` - Days until permanent deletion
- `organization` - Organization name
- `record_date` - Original record date

---

### Restore from Migration Backup

**When to Use:** A schema migration caused data issues and you need to restore from the pre-migration backup.

```sql
-- Restore all records from a backup table
SELECT restore_from_backup(
  'inspections_backup_20260115_143022',  -- backup table name
  'inspections'                           -- target table name
);

-- Returns: Number of records restored
```

**Finding Backup Tables:**
```sql
-- List all backup tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE '%_backup_%'
ORDER BY table_name DESC;
```

**Caution:**
- This replaces current table data with backup data
- Changes made after the backup was created will be lost
- Always verify the backup contents before restoring

---

### Manual Cleanup of Expired Records

```sql
-- Preview what would be deleted
SELECT * FROM inspections 
WHERE retention_until < NOW() 
  AND deleted_at IS NOT NULL;

-- Run the cleanup function
SELECT cleanup_expired_deleted_records();

-- Returns count of records permanently deleted per table
```

---

### Audit Log Queries

```sql
-- View recent deletion activity
SELECT 
  al.action_type,
  al.table_name,
  al.record_id,
  al.created_at,
  p.first_name || ' ' || p.last_name as user_name,
  al.old_values
FROM audit_logs al
LEFT JOIN profiles p ON al.user_id = p.id
WHERE al.action_type = 'DELETE'
ORDER BY al.created_at DESC
LIMIT 50;

-- Find specific record history
SELECT * FROM audit_logs 
WHERE record_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
ORDER BY created_at DESC;
```

---

## Section 4: Prevention & Best Practices

### Understanding Auto-Save Architecture

```
User Input → 1.5s Debounce → Local Save (IndexedDB) → Background Sync → Database
                                    ↓
                              Immediate persistence
                              (survives network loss)
```

**Key Timings:**
| Event | Timeout | Purpose |
|-------|---------|---------|
| Debounce | 1.5 seconds | Prevents save spam during typing |
| Local Save | 5 seconds max | IndexedDB write with error boundary |
| Remote Sync | 8 seconds max | Non-blocking database upsert |
| Background Sync | 30 seconds | Automatic retry interval |
| Deadlock Protection | 32 seconds | Force-reset stuck sync state |

### Sync Verification Checklist

For users:
- ✅ Check "Last Synced" indicator in Profile menu
- ✅ Verify no "Unsynced" badges on report cards
- ✅ Network indicator shows green (connected)
- ✅ Force Sync shows "No pending changes"

For admins:
- ✅ Run Data Recovery Tool to scan for unsynced local data
- ✅ Check Deleted Records for accidental deletions
- ✅ Review audit logs for unexpected activity

### Backup Best Practices

1. **Before Migrations:**
   - Migrations automatically create backup tables
   - Format: `{table}_backup_{timestamp}`
   - Retained for 30 days minimum

2. **Manual Backups:**
   ```sql
   SELECT backup_table('inspections');
   -- Returns: backup table name for reference
   ```

3. **Verification:**
   ```sql
   SELECT COUNT(*) FROM inspections;
   SELECT COUNT(*) FROM inspections_backup_XXXXXXXX;
   -- Counts should match
   ```

---

## Section 5: Emergency Escalation

### When Self-Service Fails

If the above procedures don't recover the data, escalate with the following information:

**Required Information:**
1. **Record ID** (if known) - UUID from URL or report
2. **Approximate time** of data entry
3. **User's network state** - Were they online or offline?
4. **Browser used** - Chrome, Safari, Firefox, etc.
5. **Device type** - Desktop, tablet, mobile
6. **Error messages** - Screenshots of any errors
7. **Steps to reproduce** - What actions led to data loss

**Escalation Path:**

```
User Self-Service (Force Sync, etc.)
         ↓ (if fails)
Super Admin Recovery (Deleted Records, Local Data Tool)
         ↓ (if fails)
Developer Recovery (SQL queries, backup restoration)
         ↓ (if fails)
Lovable Support (contact via app)
```

### Recovery Capabilities by Scenario

| Scenario | Recoverable? | Method | Time Limit |
|----------|--------------|--------|------------|
| Soft-deleted record | ✅ Yes | Admin UI or SQL | 60 days |
| Unsynced local data | ✅ Yes | Local Data Recovery | Until browser cleared |
| Hard-deleted record | ❌ No | N/A | N/A |
| Data from cleared browser | ⚠️ Maybe | Check if synced first | If synced, unlimited |
| Pre-migration data | ✅ Yes | Backup restoration | 30+ days |
| Corrupted record | ⚠️ Depends | Audit log + backup | Varies |

---

## Appendix: Related Documentation

- **SAFE_MIGRATION_PRACTICES.md** - Database migration procedures with backup protocols
- **TESTING_GUIDE.md** - Comprehensive testing procedures including offline scenarios
- **COMPREHENSIVE_TEST_PLAN.md** - Full system test coverage

---

## Appendix: Troubleshooting Common Issues

### "Sync Conflict Detected" Error

**Cause:** Same record edited on two devices before sync completed.

**Resolution:**
1. Conflict resolver dialog should appear automatically
2. Choose "Keep Local" or "Keep Remote" version
3. If dialog doesn't appear, check console for errors
4. Force refresh and try editing again

### "Failed to Save" Toast

**Cause:** Network error during database write.

**Resolution:**
1. Data is safe in IndexedDB locally
2. Wait for network to stabilize
3. Force Sync when connection is reliable
4. Check console for specific error codes

### Report Card Shows Wrong Status

**Cause:** UI state mismatch with actual data state.

**Resolution:**
1. Hard refresh the page (Ctrl+Shift+R)
2. Check if report opens correctly
3. If data is missing, use Local Data Recovery Tool
4. Verify sync status in network indicator

---

*For additional support, use the Contact Developer feature in the app.*
