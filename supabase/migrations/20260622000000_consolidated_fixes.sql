-- =============================================================================
-- Consolidated fixes migration — safe to run multiple times (idempotent)
-- Covers:
--   1. phone column on profiles
--   2. health-records storage bucket + correct RLS policies
--   3. elder_settings table + RLS (if not already created)
--   4. emergency_contacts table + RLS (if not already created)
-- =============================================================================

-- ─── 1. Phone column on profiles ─────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- ─── 2. Health Records Storage Bucket ────────────────────────────────────────
-- Create the bucket if it doesn't exist yet
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'health-records',
  'health-records',
  false,
  26214400,
  ARRAY['application/pdf','image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public            = EXCLUDED.public,
  file_size_limit   = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage SELECT: parent and their linked children can view
DROP POLICY IF EXISTS "health_records_read" ON storage.objects;
CREATE POLICY "health_records_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'health-records'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );

-- Storage INSERT: only the parent themselves can upload to their own folder.
-- Root cause: original policy used `owner = auth.uid()` which Supabase JS v2
-- never sets (it uses owner_id). Fixed to path-based auth.uid() check only.
DROP POLICY IF EXISTS "health_records_insert" ON storage.objects;
CREATE POLICY "health_records_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'health-records'
    AND ((storage.foldername(name))[1])::uuid = auth.uid()
  );

-- Storage UPDATE: parent only
DROP POLICY IF EXISTS "health_records_update" ON storage.objects;
CREATE POLICY "health_records_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'health-records'
    AND ((storage.foldername(name))[1])::uuid = auth.uid()
  )
  WITH CHECK (
    bucket_id = 'health-records'
    AND ((storage.foldername(name))[1])::uuid = auth.uid()
  );

-- Storage DELETE: parent only
DROP POLICY IF EXISTS "health_records_delete" ON storage.objects;
CREATE POLICY "health_records_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'health-records'
    AND ((storage.foldername(name))[1])::uuid = auth.uid()
  );

-- ─── 3. Health Records table RLS (parent-only write) ─────────────────────────
-- Ensure category column exists
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS category TEXT
    CHECK (category IN ('blood_test', 'prescription', 'ecg'));
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS file_type TEXT;
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Back-fill NULL categories
UPDATE public.health_records SET category = 'blood_test' WHERE category IS NULL;

DROP POLICY IF EXISTS "Insert records (parent only)" ON public.health_records;
CREATE POLICY "Insert records (parent only)" ON public.health_records
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Delete records (parent only)" ON public.health_records;
CREATE POLICY "Delete records (parent only)" ON public.health_records
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "Update records (parent only)" ON public.health_records;
CREATE POLICY "Update records (parent only)" ON public.health_records
  FOR UPDATE TO authenticated
  USING (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

-- ─── 4. Emergency Contacts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  phone TEXT,
  email TEXT,
  priority INT NOT NULL DEFAULT 5,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_contacts TO authenticated;
GRANT ALL ON public.emergency_contacts TO service_role;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View emergency contacts for linked parent" ON public.emergency_contacts;
CREATE POLICY "View emergency contacts for linked parent" ON public.emergency_contacts
  FOR SELECT TO authenticated USING (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Insert emergency contact for linked parent" ON public.emergency_contacts;
CREATE POLICY "Insert emergency contact for linked parent" ON public.emergency_contacts
  FOR INSERT TO authenticated WITH CHECK (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Update emergency contact for linked parent" ON public.emergency_contacts;
CREATE POLICY "Update emergency contact for linked parent" ON public.emergency_contacts
  FOR UPDATE TO authenticated
  USING (public.can_view_parent(parent_id))
  WITH CHECK (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Delete emergency contact for linked parent" ON public.emergency_contacts;
CREATE POLICY "Delete emergency contact for linked parent" ON public.emergency_contacts
  FOR DELETE TO authenticated USING (public.can_view_parent(parent_id));

-- ─── 5. Elder Settings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.elder_settings (
  parent_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_email BOOLEAN NOT NULL DEFAULT true,
  notify_push BOOLEAN NOT NULL DEFAULT true,
  notify_sms BOOLEAN NOT NULL DEFAULT false,
  med_reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  med_reminder_lead_minutes INT NOT NULL DEFAULT 10,
  med_voice_reminders BOOLEAN NOT NULL DEFAULT false,
  sos_escalation_minutes INT NOT NULL DEFAULT 5,
  sos_auto_call_primary BOOLEAN NOT NULL DEFAULT false,
  sos_share_location BOOLEAN NOT NULL DEFAULT true,
  preferred_contact_method TEXT NOT NULL DEFAULT 'phone',
  language TEXT NOT NULL DEFAULT 'en',
  large_text BOOLEAN NOT NULL DEFAULT false,
  high_contrast BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.elder_settings TO authenticated;
GRANT ALL ON public.elder_settings TO service_role;
ALTER TABLE public.elder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View settings for linked parent" ON public.elder_settings;
CREATE POLICY "View settings for linked parent" ON public.elder_settings
  FOR SELECT TO authenticated USING (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Insert own elder settings" ON public.elder_settings;
CREATE POLICY "Insert own elder settings" ON public.elder_settings
  FOR INSERT TO authenticated WITH CHECK (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Update elder settings for linked parent" ON public.elder_settings;
CREATE POLICY "Update elder settings for linked parent" ON public.elder_settings
  FOR UPDATE TO authenticated
  USING (public.can_view_parent(parent_id))
  WITH CHECK (public.can_view_parent(parent_id));
