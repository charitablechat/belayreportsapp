ALTER TABLE public.inspection_systems ADD COLUMN IF NOT EXISTS is_divider boolean NOT NULL DEFAULT false;
ALTER TABLE public.inspection_systems ADD COLUMN IF NOT EXISTS divider_text text;
ALTER TABLE public.inspection_systems ALTER COLUMN result DROP NOT NULL;
ALTER TABLE public.inspection_systems ALTER COLUMN system_name DROP NOT NULL;