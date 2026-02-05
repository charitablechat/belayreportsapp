-- Add optimized partial index for super admin lookups
-- This index will be very small (only super admin entries) and provide direct lookup
CREATE INDEX IF NOT EXISTS idx_user_roles_super_admin_lookup 
ON public.user_roles (user_id, role) 
WHERE role = 'super_admin';

-- Analyze to update query planner statistics
ANALYZE public.user_roles;