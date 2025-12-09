-- Create notification preferences for existing super admins with email notifications enabled by default
-- This makes email notifications retroactive for existing super admins

INSERT INTO notification_preferences (
  user_id,
  email_notifications_enabled,
  email_inspection_completed,
  email_training_completed,
  email_sync_conflicts,
  inspection_completed,
  training_completed,
  sync_conflicts
)
SELECT 
  ur.user_id,
  true as email_notifications_enabled,
  true as email_inspection_completed,
  true as email_training_completed,
  false as email_sync_conflicts,
  true as inspection_completed,
  true as training_completed,
  true as sync_conflicts
FROM user_roles ur
WHERE ur.role = 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM notification_preferences np 
    WHERE np.user_id = ur.user_id
  )
ON CONFLICT (user_id) DO NOTHING;