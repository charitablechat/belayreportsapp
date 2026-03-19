
-- Create database-backups storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('database-backups', 'database-backups', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for database-backups bucket: super admins only
CREATE POLICY "Super admins can manage database backups"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'database-backups' 
  AND public.is_super_admin()
)
WITH CHECK (
  bucket_id = 'database-backups' 
  AND public.is_super_admin()
);

-- Create backup_history table
CREATE TABLE public.backup_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path text NOT NULL,
  file_size_bytes bigint,
  table_counts jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.backup_history ENABLE ROW LEVEL SECURITY;

-- Super admins can read/write backup_history
CREATE POLICY "Super admins can manage backup history"
ON public.backup_history FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());
