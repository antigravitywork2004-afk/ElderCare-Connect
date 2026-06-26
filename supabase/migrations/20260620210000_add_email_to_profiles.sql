-- Add email column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Update trigger function to store email on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
BEGIN
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.profiles (id, full_name, role, invite_code, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'parent'),
    v_code,
    NEW.email
  );
  RETURN NEW;
END;
$$;

-- Backfill existing profiles with email from auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;
