-- Grant super_admin role to brendareed@ropeworks.com
INSERT INTO public.user_roles (user_id, organization_id, role)
VALUES (
  '0133b249-85f4-467b-8a82-5b3adda961ae',
  '278cc4dc-e7f4-41e5-99c3-1b6537d0021c',
  'super_admin'
)
ON CONFLICT (user_id, organization_id, role) DO NOTHING;