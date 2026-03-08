

## Re-apply the Missing Triggers Migration

The migration SQL file exists but the database still has zero triggers. The fix is to execute the same 18-trigger creation SQL via the migration tool to ensure it actually lands on the live database.

### Migration SQL (identical to what was previously generated)

All 18 `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` statements for:
- 3x `update_*_updated_at` (BEFORE UPDATE)
- 1x `trigger_auto_link_organization` (BEFORE INSERT OR UPDATE)  
- 3x `prevent_inspector_id_change_*` (BEFORE UPDATE)
- 3x push notification triggers (AFTER UPDATE / AFTER INSERT)
- 3x email notification triggers (AFTER UPDATE)
- 1x sync conflict trigger (AFTER INSERT)
- 3x audit triggers (AFTER UPDATE / INSERT / DELETE)
- 1x profile name history trigger (AFTER INSERT OR UPDATE)

### No code changes needed

This is database-only. All trigger functions already exist and are verified correct. The only gap is the trigger bindings themselves.

