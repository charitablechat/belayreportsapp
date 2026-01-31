

# Plan: Document Data Recovery Procedures

## Overview
Create a comprehensive `DATA_RECOVERY_GUIDE.md` documentation file that consolidates all recovery procedures for end users and administrators. This addresses audit recommendation #6 by providing clear, actionable documentation for every data recovery scenario.

---

## Current Recovery Systems Analysis

### Existing Recovery Mechanisms (Already Implemented)

| System | Location | Purpose |
|--------|----------|---------|
| **Soft Delete (60-day retention)** | `useSoftDelete.tsx` | Records are marked as deleted but retained for 60 days before permanent removal |
| **Deleted Records Recovery UI** | `DeletedRecordsRecovery.tsx` | Super Admin UI for viewing/restoring soft-deleted records |
| **Local Data Recovery Tool** | `DataRecoveryTool.tsx` | Admin tool to view/sync IndexedDB data stuck on a device |
| **Database RPC Functions** | `restore_deleted_record`, `restore_from_backup` | Database-level restore capabilities |
| **Migration Audit System** | `SAFE_MIGRATION_PRACTICES.md` | Tracks schema changes with backup tables |

### Gap Analysis
- No single document explaining these systems to end users
- No step-by-step troubleshooting for common scenarios
- No clear escalation path when self-service fails
- Recovery procedures scattered across multiple files

---

## Implementation Steps

### Step 1: Create DATA_RECOVERY_GUIDE.md

A new Markdown file in the project root that covers:

1. **End User Recovery** - What users can do themselves
2. **Admin Recovery** - What admins/super admins can access
3. **Developer Recovery** - Database-level procedures
4. **Emergency Escalation** - When to contact support

### Proposed Document Structure

```markdown
# Data Recovery Guide

## Quick Reference

| Scenario | Recovery Method | Access Level |
|----------|----------------|--------------|
| Accidentally deleted a report | Deleted Records Recovery | Super Admin |
| Data not syncing from device | Local Data Recovery Tool | Super Admin |
| Data disappeared after save | Check IndexedDB + Force Sync | User |
| Lost data after browser clear | Contact Admin for DB restore | Super Admin |

## Section 1: End User Self-Service

### Scenario: My data didn't save
1. Check the network indicator
2. Use the Force Sync button (Profile > Settings)
3. If offline, data is stored locally and will sync when online

### Scenario: Report shows as unsynced
1. Wait for automatic sync (every 30 seconds when online)
2. Manually trigger sync from Profile menu
3. Check console for sync errors

## Section 2: Admin Recovery (Super Admin Access)

### Deleted Records Recovery
**Location**: Super Admin Dashboard > Admin Tab > Deleted Records

**Capabilities**:
- View all soft-deleted records (60-day retention)
- Restore individual records with one click
- Permanently delete expired records
- Batch cleanup of expired records

**Steps to Restore**:
1. Navigate to Super Admin Dashboard
2. Click Admin tab
3. Find "Deleted Records Recovery" section
4. Locate the record in the table
5. Click the restore (rotate) icon
6. Confirm restoration

### Local Data Recovery Tool
**Location**: Super Admin Dashboard > Admin Tab > Data Recovery

**Use Cases**:
- User's device has unsynced data
- User cleared browser cache
- Need to force-push local data to database

**Steps**:
1. Access the affected device/browser
2. Navigate to Super Admin Dashboard
3. Click Admin tab > Data Recovery
4. Review unsynced records (marked in red)
5. Click Upload icon to sync individual records
6. Or delete local copies if they're duplicates

## Section 3: Database-Level Recovery (Developer)

### Restore a Single Deleted Record

**Requirements**: Database access via Supabase SQL Editor

```sql
SELECT restore_deleted_record(
  '[record_uuid]',
  '[table_name]'  -- inspections, trainings, or daily_assessments
);
```

### Restore from Migration Backup

```sql
SELECT restore_from_backup(
  '[backup_table_name]',
  '[original_table_name]'
);
```

### Point-in-Time Recovery
See SAFE_MIGRATION_PRACTICES.md for full procedures.

## Section 4: Prevention & Best Practices

### Auto-Save Architecture
- All changes are saved locally to IndexedDB within 1.5 seconds
- Remote sync occurs automatically in background
- 8-second timeout prevents UI freezes
- Data persists even if network fails mid-save

### Sync Verification
- Check "Last Synced" indicator in Profile menu
- Unsynced count shown in network indicator
- Force Sync available as manual override

## Section 5: Emergency Escalation

If self-service recovery fails:
1. Document the record ID (if known)
2. Note the approximate time of data entry
3. Check if the user was online or offline
4. Contact system administrator with above details
5. Admin can check:
   - Soft-deleted records (60-day window)
   - Local device IndexedDB
   - Database audit logs
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `DATA_RECOVERY_GUIDE.md` | **Create** | Comprehensive user-facing recovery documentation |

---

## Testing Checklist

After implementation, verify:
- [ ] All referenced UI paths are accurate
- [ ] SQL commands work in database console
- [ ] Links between documents work correctly
- [ ] Recovery scenarios cover all identified gaps

---

## Technical Notes

- This is purely a documentation task - no code changes required
- The guide references existing functionality that has been audited and confirmed working
- Document follows the existing Markdown conventions in `SAFE_MIGRATION_PRACTICES.md` and `TESTING_GUIDE.md`
- Recovery procedures are currently functional but undocumented, creating support burden

