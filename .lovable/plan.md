

## Data Retention System Implementation

### Current State Analysis

Your application currently uses **hard deletion** for all data tables (`inspections`, `trainings`, `daily_assessments`). When a user deletes a record, it's immediately and permanently removed from the database. There's no mechanism to:
- Recover accidentally deleted data
- Enforce retention periods
- Differentiate between completed vs deleted data lifecycle states

---

### Requirements Summary

| Data State | Retention Policy |
|------------|------------------|
| **Completed** | Indefinite (never auto-deleted) |
| **Deleted** | Minimum 60 days, then eligible for permanent removal |

---

### Solution Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        SOFT DELETE PATTERN                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    Delete Action    ┌──────────────────────┐         │
│  │ Active Data  │ ─────────────────▶  │ Soft-Deleted Data    │         │
│  │ status:      │                     │ deleted_at: NOW()    │         │
│  │ 'draft' or   │                     │ retention_until:     │         │
│  │ 'completed'  │ ◀──────────────────│ NOW() + 60 days      │         │
│  └──────────────┘    Restore Action   └──────────────────────┘         │
│                                                 │                       │
│                                                 │ After 60 days        │
│                                                 ▼                       │
│                                        ┌──────────────────────┐         │
│                                        │ Permanent Deletion   │         │
│                                        │ (via cleanup job)    │         │
│                                        └──────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Implementation Steps

#### Step 1: Database Schema Updates

Add soft-delete columns to all three data tables:

| Column | Type | Purpose |
|--------|------|---------|
| `deleted_at` | `timestamp with time zone` | Records when deletion occurred (NULL = active) |
| `deleted_by` | `uuid` | User who performed the deletion |
| `retention_until` | `timestamp with time zone` | Calculated date when permanent deletion is allowed |

**Tables affected:**
- `inspections`
- `trainings`
- `daily_assessments`

#### Step 2: Update RLS Policies

Modify existing Row Level Security policies to automatically filter out soft-deleted records from normal queries:

```sql
-- Users only see active (non-deleted) records
WHERE deleted_at IS NULL
```

Super admins in the Data Recovery section will query with special logic to include deleted records.

#### Step 3: Modify Application Delete Logic

Replace hard `DELETE` statements with soft-delete `UPDATE` statements:

**Before:**
```typescript
await supabase.from('inspections').delete().eq('id', id);
```

**After:**
```typescript
await supabase.from('inspections').update({
  deleted_at: new Date().toISOString(),
  deleted_by: userId,
  retention_until: addDays(new Date(), 60).toISOString()
}).eq('id', id);
```

**Files requiring updates:**
- `src/pages/Dashboard.tsx` - User deletion actions
- `src/pages/SuperAdminDashboard.tsx` - Admin deletion actions
- `src/hooks/useEmptyReportCleanup.tsx` - Auto-cleanup logic
- `src/lib/offline-storage.ts` - Offline deletion queue

#### Step 4: Create Restore Functionality

Add restore capability to the Data Recovery tool:

```typescript
// Restore a soft-deleted record
await supabase.from('inspections').update({
  deleted_at: null,
  deleted_by: null,
  retention_until: null
}).eq('id', id);
```

This allows admins to recover accidentally deleted data within the 60-day window.

#### Step 5: Implement Cleanup Mechanism

Create a scheduled database function or Edge Function to permanently delete records past their retention period:

```sql
-- Delete records where retention period has expired
DELETE FROM inspections 
WHERE deleted_at IS NOT NULL 
AND retention_until < NOW();
```

**Two options for scheduling:**

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | pg_cron database extension | Runs automatically, no external dependencies | Requires enabling extension |
| **B** | Manual admin action | Simple to implement | Requires admin to remember |

Recommended: **Option A** with a daily cleanup job running at 3:00 AM.

---

### Data Recovery UI Enhancements

Enhance the existing Data Recovery tool to show:

1. **Deleted Records Tab** - List all soft-deleted items with:
   - Original data (organization, date, etc.)
   - When deleted and by whom
   - Days remaining until permanent deletion
   - Restore button

2. **Permanent Delete Option** - Allow super admins to immediately purge specific records (bypassing 60-day wait)

3. **Visual Indicators**:
   - Red badge for items nearing permanent deletion (< 7 days)
   - Orange badge for items mid-retention (7-30 days)
   - Green badge for recently deleted (> 30 days remaining)

---

### Cascade Considerations

When a parent record is soft-deleted, related child records need handling:

| Parent Table | Related Tables |
|--------------|----------------|
| `inspections` | `inspection_equipment`, `inspection_photos`, `inspection_standards`, `inspection_summary`, `inspection_systems`, `inspection_ziplines`, `inspection_reports` |
| `trainings` | `training_items`, `training_summary`, `training_reports` |
| `daily_assessments` | Related assessment tables |

**Strategy:** When soft-deleting a parent, all child records remain linked. If the parent is restored, children are automatically available. If parent is permanently deleted, children cascade-delete via existing FK constraints.

---

### Migration Safety

Following your existing migration practices:
1. Create backup tables before schema changes
2. Use migration audit functions (`start_migration_audit`, `complete_migration_audit`)
3. Check for data loss after migration
4. New columns will default to NULL (no impact on existing records)

---

### Summary of Changes

| Component | Change Type |
|-----------|-------------|
| Database schema | Add 3 columns to 3 tables |
| RLS policies | Update to exclude deleted_at IS NOT NULL |
| Frontend delete handlers | Change DELETE to UPDATE |
| Data Recovery Tool | Add restore UI and deleted items view |
| Cleanup job | New pg_cron scheduled function |
| Offline storage | Update queue to handle soft deletes |

