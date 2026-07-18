-- Migration: 00002_users_table.sql
-- Description: Creates a public.users table for RBAC (is_admin) and syncs with auth.users

CREATE TABLE IF NOT EXISTS public.users (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text,
    is_admin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.users OWNER TO postgres;

-- Set david@rainesoft.com as admin if they exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = 'david@rainesoft.com') THEN
        INSERT INTO public.users (id, email, is_admin)
        SELECT id, email, true FROM auth.users WHERE email = 'david@rainesoft.com'
        ON CONFLICT (id) DO UPDATE SET is_admin = true;
    END IF;
END $$;

-- Create trigger to automatically insert into public.users on new signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, is_admin)
  VALUES (
    new.id, 
    new.email, 
    CASE WHEN new.email = 'david@rainesoft.com' THEN true ELSE false END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Backfill existing users
INSERT INTO public.users (id, email, is_admin)
SELECT id, email, CASE WHEN email = 'david@rainesoft.com' THEN true ELSE false END
FROM auth.users
ON CONFLICT (id) DO NOTHING;
