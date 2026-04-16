-- Create equipment_type_options table
CREATE TABLE public.equipment_type_options (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  equipment_category text NOT NULL,
  label text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive unique constraint
CREATE UNIQUE INDEX equipment_type_options_category_label_unique
  ON public.equipment_type_options (equipment_category, LOWER(label));

-- Enable RLS
ALTER TABLE public.equipment_type_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view equipment type options"
  ON public.equipment_type_options FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert equipment type options"
  ON public.equipment_type_options FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Super admins can update equipment type options"
  ON public.equipment_type_options FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete equipment type options"
  ON public.equipment_type_options FOR DELETE TO authenticated
  USING (is_super_admin());

CREATE TRIGGER update_equipment_type_options_updated_at
  BEFORE UPDATE ON public.equipment_type_options
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed from historical data
WITH normalized AS (
  SELECT
    CASE
      WHEN LOWER(TRIM(equipment_category)) IN ('belay device', 'belay') THEN 'belay'
      WHEN LOWER(TRIM(equipment_category)) = 'bags' THEN 'other'
      ELSE LOWER(TRIM(equipment_category))
    END AS norm_category,
    TRIM(equipment_type) AS raw_label,
    LOWER(TRIM(equipment_type)) AS norm_label,
    COUNT(*) AS usage_count
  FROM inspection_equipment
  WHERE is_divider = false
    AND TRIM(equipment_type) != ''
    AND TRIM(equipment_type) NOT LIKE 'Tg%'
  GROUP BY 1, 2, 3
),
ranked AS (
  SELECT norm_category, norm_label, raw_label, usage_count,
    ROW_NUMBER() OVER (PARTITION BY norm_category, norm_label ORDER BY usage_count DESC, raw_label) AS rn
  FROM normalized
),
canonical AS (
  SELECT norm_category, raw_label AS label, SUM(usage_count) AS total_usage
  FROM ranked WHERE rn = 1
  GROUP BY norm_category, raw_label
),
ordered AS (
  SELECT norm_category, label,
    ROW_NUMBER() OVER (PARTITION BY norm_category ORDER BY total_usage DESC, label) AS display_order
  FROM canonical
)
INSERT INTO public.equipment_type_options (equipment_category, label, display_order)
SELECT norm_category, label, display_order::integer
FROM ordered
ON CONFLICT DO NOTHING;