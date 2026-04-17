

The user wants to know how to access/create an audit trail viewer in the Super Admin area. Let me check what already exists.

From the schema I can see:
- `audit_logs` table EXISTS with: id, action_type, table_name, record_id, old_values, new_values, metadata, ip_address, user_agent, user_id, created_at
- RLS: Super admins can SELECT; nobody can UPDATE/DELETE (immutable — good for legal evidence)
- INSERT is implicitly blocked at RLS level too (no insert policy) — meaning logs must be written via SECURITY DEFINER triggers/functions
- There's also `admin_edit_snapshots` (already has a recovery UI) which is a related but separate concept

Let me check what's already wired up in the admin dashboard before planning.

I'll look at:
- `SuperAdminDashboard.tsx` — does it already have an Audit Logs tab?
- `AdminTabsSection.tsx` — list of admin tabs
- Any existing audit-log component

Without reading (read-only mode, but I should read to be accurate), I'll plan based on the schema and propose:

## Plan

### What already exists
- `audit_logs` table with proper RLS (super admin read-only, immutable)
- `admin_edit_snapshots` with a recovery UI (separate, for undoing admin edits)
- Need to verify whether anything is currently writing to `audit_logs` and whether a viewer exists

### Audit before building
Read these files to confirm state:
- `src/pages/SuperAdminDashboard.tsx`
- `src/components/admin/AdminTabsSection.tsx`
- Search for `audit_logs` usage across the codebase

### Proposed build (assuming no viewer exists)

**1. New component: `src/components/admin/AuditLogPanel.tsx`**
- Table view of `audit_logs` (newest first, paginated 50/page)
- Columns: Timestamp · User (resolved name) · Action · Table · Record ID · Diff button
- Filters: action type, table, user, date range
- Click a row → side sheet with full `old_values` / `new_values` JSON diff (highlighted), IP, user agent, metadata
- Export to CSV button (super admin only)
- Read-only — no edit/delete UI (matches RLS)

**2. Wire into SuperAdminDashboard**
- Add a new "Audit Logs" tab in `AdminTabsSection.tsx`
- Use existing responsive dual-layout pattern (table on md+, stacked cards on mobile) per memory `admin-dashboard-responsive-layout`

**3. Ensure logs are actually being written**
Since RLS blocks direct INSERT, audit entries must come from DB triggers. Audit which mutations should generate logs and add `SECURITY DEFINER` triggers for:
- `inspections`, `trainings`, `daily_assessments` — INSERT/UPDATE/DELETE/completion_lock
- `user_roles` — role grants/revokes (privilege escalation evidence)
- `profiles` — admin-driven changes
- `admin_edit_snapshots` — already covers admin-edits-other-users; cross-link to audit row
- Reassignments (changing `inspector_id`)
- Soft-delete & restore actions

Trigger writes: `action_type` (e.g. `report.complete`, `role.grant`), `table_name`, `record_id`, `old_values`, `new_values`, `user_id = auth.uid()`, `metadata` (jsonb with context like reason, target user).

**4. Retention & performance**
- Add index on `(created_at DESC)`, `(user_id, created_at DESC)`, `(table_name, created_at DESC)`
- No auto-purge — these are legal/compliance records (matches your liability concerns from earlier discussion)

**5. Access control**
- Hide tab unless `is_super_admin()` (use existing pattern)
- Server enforces via RLS regardless — defense in depth

### Files touched
- NEW: `src/components/admin/AuditLogPanel.tsx`
- EDIT: `src/components/admin/AdminTabsSection.tsx` (add tab)
- EDIT: `src/pages/SuperAdminDashboard.tsx` (mount panel)
- MIGRATION: indexes on `audit_logs` + SECURITY DEFINER triggers on key tables

### What this gives you
- Tamper-evident timeline of every sensitive action — directly supports the liability mitigation discussion from earlier
- Self-serve evidence for disputes ("who changed this Pass to Fail and when?")
- Foundation for compliance reports

### Open question (one)
Should the trigger coverage be **comprehensive** (every mutation on reports + roles + profiles) or **minimal-first** (just role changes + report completion + admin edits) and expand later? Comprehensive is more work but more defensible legally.

Approve and I'll build it. If you want me to ask the scope question first, say so.

