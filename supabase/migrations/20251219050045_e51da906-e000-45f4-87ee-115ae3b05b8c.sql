INSERT INTO public.app_announcements (announcement_type, content)
VALUES ('developer_notes', '')
ON CONFLICT DO NOTHING;