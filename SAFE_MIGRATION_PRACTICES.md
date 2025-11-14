# Safe Migration Practices

## Core Principles

### 1. Never Drop Constraints Without Replacements

**❌ DANGEROUS:**
```sql
-- Don't do this!
ALTER TABLE users DROP CONSTRAINT check_email_format;
-- Now there's a period where invalid data can be inserted
ALTER TABLE users ADD CONSTRAINT check_email_format_new CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$');
```

**✅ SAFE:**
```sql
-- Add new constraint first
ALTER TABLE users ADD CONSTRAINT check_email_format_new CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$');
-- Verify it works
-- Then drop old constraint
ALTER TABLE users DROP CONSTRAINT check_email_format;
```

### 2. Always Use Transactions

**❌ DANGEROUS:**
```sql
ALTER TABLE products ADD COLUMN price_new DECIMAL(10,2);
UPDATE products SET price_new = price * 1.1;  -- What if this fails?
ALTER TABLE products DROP COLUMN price;
ALTER TABLE products RENAME COLUMN price_new TO price;
```

**✅ SAFE:**
```sql
BEGIN;
  ALTER TABLE products ADD COLUMN price_new DECIMAL(10,2);
  UPDATE products SET price_new = price * 1.1;
  
  -- Verify
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM products WHERE price_new IS NULL AND price IS NOT NULL) THEN
      RAISE EXCEPTION 'Price migration failed';
    END IF;
  END $$;
  
  ALTER TABLE products DROP COLUMN price;
  ALTER TABLE products RENAME COLUMN price_new TO price;
COMMIT;
```

### 3. Check for Data Conflicts Before Applying Constraints

**❌ DANGEROUS:**
```sql
-- This will fail if any NULL values exist
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
```

**✅ SAFE:**
```sql
-- First, check for conflicts
DO $$
DECLARE
  v_null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_null_count
  FROM users
  WHERE email IS NULL;
  
  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'Cannot add NOT NULL constraint: % rows have NULL email', v_null_count;
  END IF;
END $$;

-- Then apply constraint
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
```

### 4. Verify Record Counts

**✅ ALWAYS DO THIS:**
```sql
DO $$
DECLARE
  v_before INTEGER;
  v_after INTEGER;
BEGIN
  -- Get count before
  SELECT COUNT(*) INTO v_before FROM my_table;
  
  -- Perform migration
  -- ... your changes here ...
  
  -- Get count after
  SELECT COUNT(*) INTO v_after FROM my_table;
  
  -- Verify
  IF v_after < v_before THEN
    RAISE WARNING 'Record count decreased: % -> %', v_before, v_after;
  END IF;
  
  RAISE NOTICE 'Migration complete: % records', v_after;
END $$;
```

### 5. Keep Backups for At Least 30 Days

```sql
-- Automatic backups are created by start_migration_audit()
-- But you can also create manual backups:
SELECT backup_table('critical_table');

-- List all backups
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename LIKE '%_backup_%'
ORDER BY tablename DESC;

-- Backups older than 30 days can be dropped:
DO $$
DECLARE
  backup_table RECORD;
  backup_date DATE;
BEGIN
  FOR backup_table IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename LIKE '%_backup_%'
  LOOP
    -- Extract date from backup name (format: table_backup_YYYYMMDD_HHMMSS)
    backup_date := TO_DATE(
      SUBSTRING(backup_table.tablename FROM '_backup_(\d{8})'),
      'YYYYMMDD'
    );
    
    IF backup_date < CURRENT_DATE - INTERVAL '30 days' THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', backup_table.tablename);
      RAISE NOTICE 'Dropped old backup: %', backup_table.tablename;
    END IF;
  END LOOP;
END $$;
```

## Common Pitfalls to Avoid

### Pitfall 1: Altering Large Tables Without Locking Strategy

**Problem:** `ALTER TABLE` locks the entire table, blocking reads and writes.

**Solution:**
```sql
-- For large tables, consider these strategies:

-- Option 1: Use concurrent index creation
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

-- Option 2: Add column with NULL, populate in batches, then set NOT NULL
BEGIN;
  ALTER TABLE large_table ADD COLUMN new_col TEXT;
COMMIT;

-- Populate in batches (outside transaction)
DO $$
DECLARE
  v_batch_size INTEGER := 1000;
  v_offset INTEGER := 0;
  v_updated INTEGER;
BEGIN
  LOOP
    UPDATE large_table
    SET new_col = old_col
    WHERE id IN (
      SELECT id FROM large_table
      WHERE new_col IS NULL
      LIMIT v_batch_size
    );
    
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    EXIT WHEN v_updated = 0;
    
    v_offset := v_offset + v_batch_size;
    RAISE NOTICE 'Updated % rows', v_offset;
    
    -- Small delay to let other queries through
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;

-- Then add constraint
BEGIN;
  ALTER TABLE large_table ALTER COLUMN new_col SET NOT NULL;
COMMIT;
```

### Pitfall 2: Forgetting Foreign Key Cascades

**Problem:** Deleting a parent record fails because children exist.

**Solution:**
```sql
-- Always specify cascade behavior
ALTER TABLE child_table
ADD CONSTRAINT fk_parent
FOREIGN KEY (parent_id)
REFERENCES parent_table(id)
ON DELETE CASCADE;  -- or SET NULL, RESTRICT, NO ACTION

-- Clean up orphaned records before adding constraint
DELETE FROM child_table
WHERE parent_id NOT IN (SELECT id FROM parent_table);
```

### Pitfall 3: Not Testing with Production-Like Data Volume

**Problem:** Migration works on small test data but times out on production.

**Solution:**
- Always test with production-like data volumes
- Use `EXPLAIN ANALYZE` to check query performance
- Consider batching large updates
- Monitor lock duration with `pg_stat_activity`

```sql
-- Check for long-running locks
SELECT 
  pid,
  usename,
  application_name,
  state,
  query,
  age(clock_timestamp(), query_start) as query_duration
FROM pg_stat_activity
WHERE state != 'idle'
  AND query NOT LIKE '%pg_stat_activity%'
ORDER BY query_start;
```

### Pitfall 4: Mixing DDL and DML in One Transaction

**Problem:** Data modification failures cause schema changes to rollback.

**Solution:**
```sql
-- ❌ DON'T MIX:
BEGIN;
  ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';
  UPDATE users SET status = 'inactive' WHERE last_login < NOW() - INTERVAL '1 year';
  -- If UPDATE fails, column is still added because of DEFAULT
COMMIT;

-- ✅ SEPARATE CONCERNS:
BEGIN;
  ALTER TABLE users ADD COLUMN status TEXT;
COMMIT;

-- Populate in separate transaction
BEGIN;
  UPDATE users SET status = 'active';
  UPDATE users SET status = 'inactive' WHERE last_login < NOW() - INTERVAL '1 year';
COMMIT;

-- Add constraints in final transaction
BEGIN;
  ALTER TABLE users ALTER COLUMN status SET NOT NULL;
COMMIT;
```

### Pitfall 5: Not Handling Null Values in Unique Constraints

**Problem:** Multiple NULL values violate unique constraint.

**Solution:**
```sql
-- PostgreSQL allows multiple NULLs in unique constraints
-- If you need to prevent this:

-- Option 1: Use partial unique index
CREATE UNIQUE INDEX unique_email_when_not_null 
ON users(email) 
WHERE email IS NOT NULL;

-- Option 2: Use a default value
ALTER TABLE users 
ALTER COLUMN email SET DEFAULT '';

-- Then add unique constraint
ALTER TABLE users 
ADD CONSTRAINT unique_email UNIQUE (email);
```

## Zero-Downtime Migration Strategies

### Strategy 1: Expand-Contract Pattern

```sql
-- Phase 1: EXPAND - Add new schema
BEGIN;
  ALTER TABLE users ADD COLUMN email_new TEXT;
COMMIT;

-- Phase 2: DUAL WRITE - Update application to write to both
-- Deploy application code that writes to both email and email_new

-- Phase 3: BACKFILL - Migrate existing data
UPDATE users SET email_new = email WHERE email_new IS NULL;

-- Phase 4: VALIDATE - Ensure data consistency
SELECT COUNT(*) FROM users WHERE email != email_new;

-- Phase 5: CONTRACT - Remove old schema
-- Deploy application code to only use email_new
BEGIN;
  ALTER TABLE users DROP COLUMN email;
  ALTER TABLE users RENAME COLUMN email_new TO email;
COMMIT;
```

### Strategy 2: Shadow Tables

```sql
-- Create shadow table with new schema
CREATE TABLE users_new (LIKE users INCLUDING ALL);

-- Add your schema changes to users_new
ALTER TABLE users_new ADD COLUMN new_field TEXT;

-- Set up trigger to dual-write
CREATE OR REPLACE FUNCTION sync_to_users_new()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO users_new SELECT NEW.*;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE users_new SET ... WHERE id = NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM users_new WHERE id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_users_to_new
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION sync_to_users_new();

-- Backfill historical data
INSERT INTO users_new SELECT * FROM users;

-- Switch atomically
BEGIN;
  ALTER TABLE users RENAME TO users_old;
  ALTER TABLE users_new RENAME TO users;
COMMIT;

-- Clean up
DROP TRIGGER sync_users_to_new ON users_old;
DROP TABLE users_old;
```

## Migration Safety Checklist

### Pre-Migration Review
- [ ] Migration tested on staging with production-like data
- [ ] Backup strategy confirmed
- [ ] Rollback procedure documented and tested
- [ ] Team notified of migration window
- [ ] Monitoring and alerts configured
- [ ] Dependent services identified
- [ ] Performance impact estimated
- [ ] Lock duration acceptable

### Migration Execution
- [ ] Start migration audit (backup created automatically)
- [ ] Transaction boundaries defined
- [ ] Data validation checks in place
- [ ] Progress logging implemented
- [ ] Error handling configured
- [ ] Timeout limits set appropriately
- [ ] Record counts verified

### Post-Migration Validation
- [ ] Complete migration audit
- [ ] Data integrity checks passed
- [ ] Application functionality verified
- [ ] Performance metrics normal
- [ ] No error spikes in logs
- [ ] Rollback procedure remains available
- [ ] Documentation updated
- [ ] Team notified of completion

## Monitoring Migration Health

```sql
-- View recent migrations
SELECT 
  migration_name,
  table_affected,
  records_before,
  records_after,
  status,
  started_at,
  completed_at,
  completed_at - started_at as duration
FROM migration_audit
ORDER BY started_at DESC
LIMIT 10;

-- Check for data loss across all migrations
SELECT 
  migration_name,
  table_affected,
  records_before,
  records_after,
  ROUND(((records_before - records_after)::NUMERIC / records_before) * 100, 2) as loss_percentage
FROM migration_audit
WHERE records_before > 0 
  AND records_after < records_before
ORDER BY loss_percentage DESC;

-- Find failed migrations
SELECT *
FROM migration_audit
WHERE status IN ('failed', 'rolled_back')
ORDER BY started_at DESC;
```

## Recovery Procedures

### Procedure 1: Quick Rollback

```sql
-- Get the backup table name
SELECT id, backup_table_name, table_affected
FROM migration_audit
WHERE migration_name = '[your_migration_name]'
ORDER BY started_at DESC
LIMIT 1;

-- Restore from backup
SELECT restore_from_backup(
  '[backup_table_name]',
  '[original_table_name]'
);
```

### Procedure 2: Partial Rollback

```sql
-- If only specific records need to be restored
BEGIN;
  -- Copy specific records from backup
  INSERT INTO original_table
  SELECT * FROM backup_table
  WHERE [condition];
  
  -- Update existing records
  UPDATE original_table o
  SET column_name = b.column_name
  FROM backup_table b
  WHERE o.id = b.id
    AND [condition];
COMMIT;
```

### Procedure 3: Point-in-Time Recovery

```sql
-- If you need to recover to a specific state
-- First, identify all changes since that point
SELECT *
FROM migration_audit
WHERE started_at > '[timestamp]'
ORDER BY started_at;

-- Then rollback each migration in reverse order
-- Using their backup tables
```

## Best Practices Summary

1. **ALWAYS** use the migration audit system
2. **ALWAYS** wrap changes in transactions
3. **ALWAYS** verify record counts before and after
4. **ALWAYS** test on production-like data first
5. **NEVER** drop constraints before adding replacements
6. **NEVER** mix DDL and DML in one transaction without careful consideration
7. **NEVER** skip data validation checks
8. **NEVER** delete backup tables before 30 days
9. **ALWAYS** have a tested rollback plan
10. **ALWAYS** communicate with the team

## Additional Resources

- PostgreSQL documentation: https://www.postgresql.org/docs/current/ddl.html
- Migration audit system: See `migration_audit` table documentation
- Emergency contacts: See MIGRATION_TEMPLATE.md
- Team Slack channel: #database-migrations
