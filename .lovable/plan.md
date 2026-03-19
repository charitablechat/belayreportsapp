

## Retrieve & Reassign Any Report

### Problem
1. The current tool only shows reports already loaded and filtered by mismatch status — there's no way to search for a specific report by user, organization, or date.
2. The `prevent_inspector_id_change` database trigger blocks ALL `inspector_id` updates, meaning the existing Reassign button silently fails. Super admins need an exception.

### Changes

**1. Database Migration — Allow super admins to reassign ownership**

Update `prevent_inspector_id_change()` to check `is_super_admin()`. If the current user is a super admin, allow the `inspector_id` change; otherwise block it as before.

```sql
CREATE OR REPLACE FUNCTION public.prevent_inspector_id_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.inspector_id IS NOT NULL 
     AND NEW.inspector_id IS DISTINCT FROM OLD.inspector_id 
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'inspector_id cannot be modified after creation.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';
```

**2. UI Enhancement — Add search/filter to ReportOwnershipTool**

Add to the existing `ReportOwnershipTool.tsx`:
- A **search input** (filters by organization name, owner name, or trainer of record across all three report types)
- A **user filter dropdown** (select a specific user to see only their reports)
- Apply these filters in addition to the existing mismatch toggle, so admins can find any report from any user and click Reassign

| Element | Behavior |
|---------|----------|
| Search input | Filters visible reports by text match on organization, owner name, or trainer of record |
| User filter select | Filters to reports owned by that specific user (by `inspector_id`) |
| "Show All Reports" button (existing) | Already shows all reports, not just mismatches — the new filters stack on top |

### Files Modified

| File | Change |
|------|--------|
| Migration SQL | Update `prevent_inspector_id_change()` to allow super admin reassignment |
| `src/components/admin/ReportOwnershipTool.tsx` | Add search input + user filter dropdown, apply filtering to `renderReportTable` |

