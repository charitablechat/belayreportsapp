# Safe Migration Template

This template provides a standardized approach to database migrations that includes automatic backups, auditing, and data loss detection.

## Quick Start Template

```sql
-- ============================================================
-- MIGRATION: [Your Migration Name]
-- DATE: [YYYY-MM-DD]
-- DESCRIPTION: [Brief description of what this migration does]
-- AFFECTED TABLE(S): [List tables being modified]
-- ============================================================

-- Step 1: Start Migration Audit (creates automatic backup)
DO $$
DECLARE
  v_audit_id UUID;
BEGIN
  -- Start audit for primary affected table
  v_audit_id := start_migration_audit(
    '[migration_name]',
    '[table_name]',
    jsonb_build_object(
      'description', '[What this migration does]',
      'author', '[Your name]',
      'ticket', '[Ticket/Issue number if applicable]'
    )
  );
  
  -- Store audit ID for later use
  RAISE NOTICE 'Migration audit ID: %', v_audit_id;
END $$;

-- Step 2: Begin Transaction
BEGIN;

  -- Step 3: Your Migration Logic Here
  -- ===================================
  
  -- Example: Adding a new column
  ALTER TABLE [table_name] 
  ADD COLUMN IF NOT EXISTS [column_name] [data_type];
  
  -- Example: Creating new constraints (always add before dropping old)
  -- Add new constraint
  ALTER TABLE [table_name]
  ADD CONSTRAINT [new_constraint_name] [constraint_definition];
  
  -- Only drop old constraint after new one is verified
  -- ALTER TABLE [table_name]
  -- DROP CONSTRAINT IF EXISTS [old_constraint_name];
  
  -- Example: Data migrations
  UPDATE [table_name]
  SET [column_name] = [value]
  WHERE [condition];
  
  -- Step 4: Verify Data Integrity
  DO $$
  DECLARE
    v_expected_count INTEGER := [expected_count];
    v_actual_count INTEGER;
  BEGIN
    SELECT COUNT(*) INTO v_actual_count FROM [table_name];
    
    IF v_actual_count < v_expected_count THEN
      RAISE EXCEPTION 'Data verification failed: expected %, got %', 
        v_expected_count, v_actual_count;
    END IF;
    
    RAISE NOTICE 'Data verification passed: % records', v_actual_count;
  END $$;

-- Step 5: Commit Transaction
COMMIT;

-- Step 6: Complete Migration Audit
DO $$
BEGIN
  -- Complete the audit (checks for data loss automatically)
  PERFORM complete_migration_audit(
    '[audit_id_from_step_1]',  -- Replace with actual UUID from step 1
    'completed'
  );
END $$;

-- Step 7: Final Verification
SELECT * FROM check_data_loss('[table_name]', [records_before_count]);
```

## Migration Checklist

### Pre-Migration
- [ ] Identify all affected tables
- [ ] Document expected record counts
- [ ] Review current constraints and dependencies
- [ ] Test migration on development/staging environment
- [ ] Notify team of scheduled maintenance window

### During Migration
- [ ] Start migration audit (automatic backup created)
- [ ] Begin transaction
- [ ] Execute schema changes
- [ ] Verify data integrity
- [ ] Check for data loss
- [ ] Commit if all checks pass

### Post-Migration
- [ ] Complete migration audit
- [ ] Verify application functionality
- [ ] Monitor for errors
- [ ] Document any issues encountered
- [ ] Keep backup for at least 30 days

## Common Migration Patterns

### Adding a Column with Default Value

```sql
-- Start audit
SELECT start_migration_audit('add_column_[name]', '[table_name]');

BEGIN;
  -- Add column without default first
  ALTER TABLE [table_name] 
  ADD COLUMN IF NOT EXISTS [column_name] [data_type];
  
  -- Set values for existing rows
  UPDATE [table_name]
  SET [column_name] = [default_value]
  WHERE [column_name] IS NULL;
  
  -- Add NOT NULL constraint after data is populated
  ALTER TABLE [table_name]
  ALTER COLUMN [column_name] SET NOT NULL;
COMMIT;

-- Complete audit
SELECT complete_migration_audit('[audit_id]', 'completed');
```

### Renaming a Column (Zero Downtime)

```sql
-- Start audit
SELECT start_migration_audit('rename_column_[old_name]', '[table_name]');

BEGIN;
  -- Step 1: Add new column
  ALTER TABLE [table_name]
  ADD COLUMN IF NOT EXISTS [new_column_name] [data_type];
  
  -- Step 2: Copy data
  UPDATE [table_name]
  SET [new_column_name] = [old_column_name];
  
  -- Step 3: Add constraints to new column
  ALTER TABLE [table_name]
  ALTER COLUMN [new_column_name] SET NOT NULL;
  
  -- Step 4: Update application code to use new column
  -- Deploy updated code here before proceeding
  
  -- Step 5: Drop old column (only after code is deployed!)
  -- ALTER TABLE [table_name]
  -- DROP COLUMN [old_column_name];
COMMIT;

-- Complete audit
SELECT complete_migration_audit('[audit_id]', 'completed');
```

### Changing a Column Type

```sql
-- Start audit
SELECT start_migration_audit('change_column_type_[name]', '[table_name]');

BEGIN;
  -- Add new column with new type
  ALTER TABLE [table_name]
  ADD COLUMN [column_name]_new [new_data_type];
  
  -- Migrate data with type conversion
  UPDATE [table_name]
  SET [column_name]_new = [column_name]::[new_data_type];
  
  -- Verify all data converted successfully
  DO $$
  DECLARE
    v_failed_count INTEGER;
  BEGIN
    SELECT COUNT(*) INTO v_failed_count
    FROM [table_name]
    WHERE [column_name] IS NOT NULL 
      AND [column_name]_new IS NULL;
    
    IF v_failed_count > 0 THEN
      RAISE EXCEPTION 'Type conversion failed for % rows', v_failed_count;
    END IF;
  END $$;
  
  -- Drop old column and rename new one
  ALTER TABLE [table_name]
  DROP COLUMN [column_name];
  
  ALTER TABLE [table_name]
  RENAME COLUMN [column_name]_new TO [column_name];
COMMIT;

-- Complete audit
SELECT complete_migration_audit('[audit_id]', 'completed');
```

### Adding Foreign Key Constraint

```sql
-- Start audit
SELECT start_migration_audit('add_fk_constraint', '[table_name]');

BEGIN;
  -- First, clean up any orphaned records
  DELETE FROM [child_table]
  WHERE [foreign_key_column] NOT IN (
    SELECT id FROM [parent_table]
  );
  
  -- Add the constraint
  ALTER TABLE [child_table]
  ADD CONSTRAINT [constraint_name]
  FOREIGN KEY ([foreign_key_column])
  REFERENCES [parent_table](id)
  ON DELETE CASCADE;  -- or SET NULL, RESTRICT, etc.
COMMIT;

-- Complete audit
SELECT complete_migration_audit('[audit_id]', 'completed');
```

### Removing a Column

```sql
-- Start audit
SELECT start_migration_audit('remove_column_[name]', '[table_name]');

BEGIN;
  -- First, remove any constraints on the column
  ALTER TABLE [table_name]
  DROP CONSTRAINT IF EXISTS [constraint_name];
  
  -- Remove any indexes on the column
  DROP INDEX IF EXISTS [index_name];
  
  -- Finally, drop the column
  ALTER TABLE [table_name]
  DROP COLUMN IF EXISTS [column_name];
COMMIT;

-- Complete audit
SELECT complete_migration_audit('[audit_id]', 'completed');
```

## Rollback Procedure

If a migration fails or causes issues:

### Immediate Rollback (During Migration)

```sql
-- If still in transaction, simply:
ROLLBACK;

-- Mark audit as rolled back
SELECT complete_migration_audit(
  '[audit_id]',
  'rolled_back',
  'Reason for rollback'
);
```

### Rollback After Commit

```sql
-- Find the backup table
SELECT backup_table_name 
FROM migration_audit 
WHERE id = '[audit_id]';

-- Restore from backup
SELECT restore_from_backup(
  '[backup_table_name]',  -- From previous query
  '[original_table_name]'
);

-- Verify restoration
SELECT * FROM check_data_loss(
  '[original_table_name]',
  [original_record_count]
);
```

## Best Practices

1. **Always Use Transactions**: Wrap all DDL and DML in BEGIN/COMMIT
2. **Test First**: Run on development/staging before production
3. **Add Before Removing**: Add new constraints before dropping old ones
4. **Verify Counts**: Check record counts before and after
5. **Document Everything**: Use metadata parameter to store context
6. **Monitor Logs**: Check PostgreSQL logs for warnings
7. **Keep Backups**: Don't delete backup tables for at least 30 days
8. **Staged Rollouts**: For large tables, consider batching updates
9. **Off-Peak Hours**: Run migrations during low-traffic periods
10. **Have a Rollback Plan**: Always test rollback procedure

## Emergency Contacts

- Database Administrator: [Contact Info]
- DevOps Team: [Contact Info]
- On-Call Engineer: [Contact Info]

## Additional Resources

- [PostgreSQL Migration Best Practices](https://wiki.postgresql.org/wiki/Category:Migration)
- [Zero-Downtime Migrations](https://postgres.fm/episodes/schema-migrations)
- Project-specific docs: See SAFE_MIGRATION_PRACTICES.md
