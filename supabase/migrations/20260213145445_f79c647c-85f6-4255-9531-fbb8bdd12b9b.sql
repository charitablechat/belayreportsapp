ALTER TABLE public.inspection_equipment
  ALTER COLUMN quantity TYPE text
  USING quantity::text;