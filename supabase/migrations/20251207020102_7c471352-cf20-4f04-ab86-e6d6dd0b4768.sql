-- Create trigger to automatically add user names to field history
CREATE OR REPLACE FUNCTION public.add_name_to_field_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  full_name TEXT;
BEGIN
  full_name := TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
  
  IF full_name != '' AND full_name != ' ' THEN
    -- Add to trainer_name field type
    INSERT INTO user_field_history (user_id, field_type, value, usage_count)
    VALUES (NEW.id, 'trainer_name', full_name, 1)
    ON CONFLICT (user_id, field_type, value) DO NOTHING;
    
    -- Add to inspector_name field type
    INSERT INTO user_field_history (user_id, field_type, value, usage_count)
    VALUES (NEW.id, 'inspector_name', full_name, 1)
    ON CONFLICT (user_id, field_type, value) DO NOTHING;
    
    -- Add to onsite_contact field type
    INSERT INTO user_field_history (user_id, field_type, value, usage_count)
    VALUES (NEW.id, 'onsite_contact', full_name, 1)
    ON CONFLICT (user_id, field_type, value) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger that fires after profile insert or name update
CREATE TRIGGER on_profile_name_updated
  AFTER INSERT OR UPDATE OF first_name, last_name ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.add_name_to_field_history();