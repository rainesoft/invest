-- Add triggers to auth.users (Not dumped by supabase db dump)

DROP TRIGGER IF EXISTS on_auth_user_email_welcome ON auth.users;
CREATE TRIGGER on_auth_user_email_welcome
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_email_onboarding();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_subscription();

-- Automatically grant admin privileges to kobequagraine@yahoo.com upon sign-up
CREATE OR REPLACE FUNCTION public.handle_admin_creation()
RETURNS trigger AS $$
BEGIN
  IF NEW.email = 'kobequagraine@yahoo.com' THEN
    -- Insert risk settings with admin = true
    INSERT INTO public.user_risk_settings (user_id, is_admin)
    VALUES (NEW.id, true)
    ON CONFLICT (user_id) DO UPDATE SET is_admin = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_admin_grant ON auth.users;
CREATE TRIGGER on_auth_user_admin_grant
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_admin_creation();
