-- Add display_order column to inspection_photos for drag-and-drop reordering
ALTER TABLE public.inspection_photos
ADD COLUMN display_order integer DEFAULT 0;

-- Add index for efficient ordering queries
CREATE INDEX idx_inspection_photos_order 
ON public.inspection_photos(inspection_id, photo_section, display_order);