
-- Audit/recovery table for deleted child rows during sync reconciliation
CREATE TABLE public.report_deleted_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('inspection', 'training', 'daily_assessment')),
  report_id UUID NOT NULL,
  child_table TEXT NOT NULL,
  deleted_item_id UUID NOT NULL,
  deleted_item_data JSONB NOT NULL,
  deleted_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  restored_by UUID REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.report_deleted_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can log their own deletions"
  ON public.report_deleted_items FOR INSERT
  WITH CHECK (deleted_by = auth.uid());

CREATE POLICY "Super admins can view all deleted items"
  ON public.report_deleted_items FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "Users can view their own deleted items"
  ON public.report_deleted_items FOR SELECT
  USING (deleted_by = auth.uid());

CREATE POLICY "Super admins can restore deleted items"
  ON public.report_deleted_items FOR UPDATE
  USING (public.is_super_admin());

-- Indexes for efficient lookups
CREATE INDEX idx_deleted_items_report ON public.report_deleted_items(report_type, report_id);
CREATE INDEX idx_deleted_items_lookup ON public.report_deleted_items(child_table, deleted_item_id);
