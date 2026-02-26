
-- Table: admin_edit_snapshots
-- Stores a full JSON copy of report data BEFORE a super admin modifies it
CREATE TABLE public.admin_edit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type text NOT NULL,
  report_id uuid NOT NULL,
  original_owner_id uuid NOT NULL,
  edited_by uuid NOT NULL,
  snapshot_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_edit_snapshots ENABLE ROW LEVEL SECURITY;

-- Super admins can read and insert
CREATE POLICY "Super admins can manage admin edit snapshots"
ON public.admin_edit_snapshots
FOR ALL
TO authenticated
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Regular users can read snapshots of their own reports
CREATE POLICY "Users can view snapshots of their own reports"
ON public.admin_edit_snapshots
FOR SELECT
TO authenticated
USING (original_owner_id = auth.uid());

-- Index for fast lookups by report
CREATE INDEX idx_admin_edit_snapshots_report ON public.admin_edit_snapshots (report_type, report_id);
CREATE INDEX idx_admin_edit_snapshots_owner ON public.admin_edit_snapshots (original_owner_id);
