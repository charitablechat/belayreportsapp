-- Migrate unique entries from user_field_history to global_field_history
-- This consolidates per-user history into the shared global table
INSERT INTO global_field_history (field_type, value, usage_count, last_used_at)
SELECT 
  field_type, 
  value, 
  SUM(usage_count) as total_usage,
  MAX(last_used_at) as last_used
FROM user_field_history
WHERE field_type IN ('inspector_name', 'onsite_contact', 'trainer_name', 'previous_inspector')
GROUP BY field_type, value
ON CONFLICT (field_type, value) DO UPDATE SET
  usage_count = global_field_history.usage_count + EXCLUDED.usage_count,
  last_used_at = GREATEST(global_field_history.last_used_at, EXCLUDED.last_used_at);

-- Add optimized index for common query pattern if not exists
CREATE INDEX IF NOT EXISTS idx_global_field_history_lookup 
ON global_field_history(field_type, value);

-- Add index for usage-based ordering
CREATE INDEX IF NOT EXISTS idx_global_field_history_usage 
ON global_field_history(field_type, usage_count DESC, last_used_at DESC);

-- Add super_admin-only delete policy if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'global_field_history' 
    AND policyname = 'Super admins can delete global field history'
  ) THEN
    CREATE POLICY "Super admins can delete global field history"
    ON global_field_history
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = auth.uid()
        AND role = 'super_admin'
      )
    );
  END IF;
END $$;