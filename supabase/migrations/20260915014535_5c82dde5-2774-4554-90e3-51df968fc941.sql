DROP POLICY IF EXISTS "Users can read their own reports" ON storage.objects;

CREATE POLICY "Users can read their own reports"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'inspection-reports'
  AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.inspection_reports ir
      JOIN public.inspections i ON i.id = ir.inspection_id
      WHERE i.inspector_id = auth.uid()
        AND (
          ir.pdf_url = objects.name
          OR ir.pdf_url LIKE '%/inspection-reports/' || objects.name
          OR ir.pdf_url LIKE '%/inspection-reports/' || objects.name || '?%'
        )
    )
  )
);