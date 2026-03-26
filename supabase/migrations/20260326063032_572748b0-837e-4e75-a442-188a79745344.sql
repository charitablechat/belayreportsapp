ALTER TABLE public.inspection_equipment ADD COLUMN is_divider boolean NOT NULL DEFAULT false;
ALTER TABLE public.inspection_equipment ADD COLUMN divider_text text;