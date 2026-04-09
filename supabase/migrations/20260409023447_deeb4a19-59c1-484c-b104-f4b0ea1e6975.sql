
CREATE TABLE public.invoiced_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('inspection', 'training', 'daily')),
  invoiced_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invoiced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, report_type)
);

ALTER TABLE public.invoiced_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage invoiced reports"
  ON public.invoiced_reports FOR ALL TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());
