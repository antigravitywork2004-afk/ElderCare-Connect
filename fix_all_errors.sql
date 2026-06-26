-- =============================================================================
-- ElderCare Connect — Complete Schema & Storage Fix
-- Run this ENTIRE script in your Supabase SQL Editor (once, top to bottom).
-- Safe to re-run (all statements use IF NOT EXISTS / IF EXISTS guards).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: wellbeing_checks — missing columns (Errors #1-4)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.wellbeing_checks
  ADD COLUMN IF NOT EXISTS sleep_quality  TEXT,
  ADD COLUMN IF NOT EXISTS pain_status    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pain_notes     TEXT,
  ADD COLUMN IF NOT EXISTS meals_logged   TEXT,
  ADD COLUMN IF NOT EXISTS water_intake   INTEGER DEFAULT 0;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: health_risk_assessments — missing heart_rate column (Error #9)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.health_risk_assessments
  ADD COLUMN IF NOT EXISTS heart_rate    INT,
  ADD COLUMN IF NOT EXISTS weight        NUMERIC,
  ADD COLUMN IF NOT EXISTS oxygen_level  INT,
  ADD COLUMN IF NOT EXISTS wellness_data TEXT;

-- Tighten health_risk_assessments RLS
DROP POLICY IF EXISTS "Insert risk" ON public.health_risk_assessments;
DROP POLICY IF EXISTS "Insert risk (parent only)" ON public.health_risk_assessments;
CREATE POLICY "Insert risk (parent only)" ON public.health_risk_assessments
  FOR INSERT TO authenticated
  WITH CHECK (
    parent_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'parent'
    )
  );

DROP POLICY IF EXISTS "Delete risk" ON public.health_risk_assessments;
DROP POLICY IF EXISTS "Delete risk (parent only)" ON public.health_risk_assessments;
CREATE POLICY "Delete risk (parent only)" ON public.health_risk_assessments
  FOR DELETE TO authenticated
  USING (
    parent_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'parent'
    )
  );

DROP POLICY IF EXISTS "View risk" ON public.health_risk_assessments;
CREATE POLICY "View risk" ON public.health_risk_assessments
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: sos_alerts — missing columns (Error #11)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sos_alerts
  ADD COLUMN IF NOT EXISTS parent_name      TEXT,
  ADD COLUMN IF NOT EXISTS address          TEXT,
  ADD COLUMN IF NOT EXISTS alert_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS acknowledged_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Trigger to auto-populate parent_name
CREATE OR REPLACE FUNCTION public.set_sos_parent_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_name IS NULL THEN
    SELECT full_name INTO NEW.parent_name
    FROM public.profiles
    WHERE id = NEW.parent_id;
  END IF;
  IF NEW.alert_timestamp IS NULL THEN
    NEW.alert_timestamp := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sos_alerts_parent_name ON public.sos_alerts;
CREATE TRIGGER trg_sos_alerts_parent_name
  BEFORE INSERT ON public.sos_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_sos_parent_name();

-- SOS RLS
DROP POLICY IF EXISTS "Trigger sos (self)"        ON public.sos_alerts;
DROP POLICY IF EXISTS "Trigger sos (parent only)" ON public.sos_alerts;
CREATE POLICY "Trigger sos (parent only)" ON public.sos_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    parent_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'parent'
    )
  );

DROP POLICY IF EXISTS "Update sos (linked)"       ON public.sos_alerts;
DROP POLICY IF EXISTS "Update sos (parent+child)" ON public.sos_alerts;
CREATE POLICY "Update sos (parent+child)" ON public.sos_alerts
  FOR UPDATE TO authenticated
  USING  (public.can_view_parent(parent_id))
  WITH CHECK (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "View sos" ON public.sos_alerts;
CREATE POLICY "View sos" ON public.sos_alerts
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4: caregiver_bookings — missing columns (Error #5)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'assigned'    AFTER 'confirmed';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'in_progress' AFTER 'assigned';

ALTER TABLE public.caregiver_bookings
  ADD COLUMN IF NOT EXISTS booking_date   DATE,
  ADD COLUMN IF NOT EXISTS booking_time   TIME,
  ADD COLUMN IF NOT EXISTS caregiver_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS caregiver_name TEXT;

UPDATE public.caregiver_bookings
  SET booking_date = scheduled_at::date
  WHERE booking_date IS NULL;

UPDATE public.caregiver_bookings
  SET booking_time = scheduled_at::time
  WHERE booking_time IS NULL;

DROP POLICY IF EXISTS "Create bookings"            ON public.caregiver_bookings;
DROP POLICY IF EXISTS "Create bookings (parent only)" ON public.caregiver_bookings;
CREATE POLICY "Create bookings (parent only)" ON public.caregiver_bookings
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Update bookings"            ON public.caregiver_bookings;
DROP POLICY IF EXISTS "Update bookings (parent only)" ON public.caregiver_bookings;
CREATE POLICY "Update bookings (parent only)" ON public.caregiver_bookings
  FOR UPDATE TO authenticated
  USING  (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Delete bookings"            ON public.caregiver_bookings;
DROP POLICY IF EXISTS "Delete bookings (parent only)" ON public.caregiver_bookings;
CREATE POLICY "Delete bookings (parent only)" ON public.caregiver_bookings
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "View bookings"              ON public.caregiver_bookings;
DROP POLICY IF EXISTS "View bookings (parent+child)" ON public.caregiver_bookings;
CREATE POLICY "View bookings (parent+child)" ON public.caregiver_bookings
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'caregiver_bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.caregiver_bookings;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 5: transport_bookings — missing columns (Error #6)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.trip_type AS ENUM ('one_way', 'round_trip');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'driver_assigned' AFTER 'confirmed';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'en_route'        AFTER 'driver_assigned';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'arrived'         AFTER 'en_route';

ALTER TABLE public.transport_bookings
  ADD COLUMN IF NOT EXISTS trip_type          public.trip_type NOT NULL DEFAULT 'one_way',
  ADD COLUMN IF NOT EXISTS transport_date     DATE,
  ADD COLUMN IF NOT EXISTS transport_time     TIME,
  ADD COLUMN IF NOT EXISTS special_assistance TEXT,
  ADD COLUMN IF NOT EXISTS driver_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.transport_bookings
  SET transport_date = scheduled_at::date
  WHERE transport_date IS NULL;

UPDATE public.transport_bookings
  SET transport_time = scheduled_at::time
  WHERE transport_time IS NULL;

DROP POLICY IF EXISTS "Create transport"             ON public.transport_bookings;
DROP POLICY IF EXISTS "Create transport (parent only)" ON public.transport_bookings;
CREATE POLICY "Create transport (parent only)" ON public.transport_bookings
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Update transport"             ON public.transport_bookings;
DROP POLICY IF EXISTS "Update transport (parent only)" ON public.transport_bookings;
CREATE POLICY "Update transport (parent only)" ON public.transport_bookings
  FOR UPDATE TO authenticated
  USING  (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Delete transport"             ON public.transport_bookings;
DROP POLICY IF EXISTS "Delete transport (parent only)" ON public.transport_bookings;
CREATE POLICY "Delete transport (parent only)" ON public.transport_bookings
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "View transport"               ON public.transport_bookings;
DROP POLICY IF EXISTS "View transport (parent+child)" ON public.transport_bookings;
CREATE POLICY "View transport (parent+child)" ON public.transport_bookings
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'transport_bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transport_bookings;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 6: video_consultations + prescriptions bucket (Errors #7 & #8)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'scheduled' BEFORE 'pending';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'waiting'   AFTER  'scheduled';

ALTER TABLE public.video_consultations
  ADD COLUMN IF NOT EXISTS consultation_reason TEXT,
  ADD COLUMN IF NOT EXISTS consultation_date   DATE,
  ADD COLUMN IF NOT EXISTS consultation_time   TIME;

UPDATE public.video_consultations
  SET consultation_date = scheduled_at::date
  WHERE consultation_date IS NULL;

UPDATE public.video_consultations
  SET consultation_time = scheduled_at::time
  WHERE consultation_time IS NULL;

-- Prescriptions table
CREATE TABLE IF NOT EXISTS public.consultation_prescriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  UUID NOT NULL REFERENCES public.video_consultations(id) ON DELETE CASCADE,
  parent_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_path        TEXT NOT NULL,
  file_url         TEXT,
  file_type        TEXT NOT NULL,
  file_name        TEXT,
  file_size        BIGINT,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultation_prescriptions TO authenticated;
GRANT ALL ON public.consultation_prescriptions TO service_role;
ALTER TABLE public.consultation_prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View prescriptions (parent+child)" ON public.consultation_prescriptions;
CREATE POLICY "View prescriptions (parent+child)" ON public.consultation_prescriptions
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Insert prescriptions (parent only)" ON public.consultation_prescriptions;
CREATE POLICY "Insert prescriptions (parent only)" ON public.consultation_prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Delete prescriptions (parent only)" ON public.consultation_prescriptions;
CREATE POLICY "Delete prescriptions (parent only)" ON public.consultation_prescriptions
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

-- Video consultation RLS
DROP POLICY IF EXISTS "Create video"              ON public.video_consultations;
DROP POLICY IF EXISTS "Create video (parent only)" ON public.video_consultations;
CREATE POLICY "Create video (parent only)" ON public.video_consultations
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Update video"              ON public.video_consultations;
DROP POLICY IF EXISTS "Update video (parent only)" ON public.video_consultations;
CREATE POLICY "Update video (parent only)" ON public.video_consultations
  FOR UPDATE TO authenticated
  USING  (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Delete video"              ON public.video_consultations;
DROP POLICY IF EXISTS "Delete video (parent only)" ON public.video_consultations;
CREATE POLICY "Delete video (parent only)" ON public.video_consultations
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "View video"               ON public.video_consultations;
DROP POLICY IF EXISTS "View video (parent+child)" ON public.video_consultations;
CREATE POLICY "View video (parent+child)" ON public.video_consultations
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));

-- Prescriptions storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'prescriptions',
  'prescriptions',
  false,
  26214400,
  ARRAY['application/pdf','image/jpeg','image/jpg','image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public              = EXCLUDED.public,
  file_size_limit     = EXCLUDED.file_size_limit,
  allowed_mime_types  = EXCLUDED.allowed_mime_types;

-- Storage RLS for prescriptions bucket
DROP POLICY IF EXISTS "prescriptions_read"   ON storage.objects;
CREATE POLICY "prescriptions_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'prescriptions'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "prescriptions_insert" ON storage.objects;
CREATE POLICY "prescriptions_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'prescriptions'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "prescriptions_delete" ON storage.objects;
CREATE POLICY "prescriptions_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'prescriptions'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'video_consultations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.video_consultations;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'consultation_prescriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.consultation_prescriptions;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 7: medicines — missing duration column
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS duration TEXT;


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 8: health-records storage bucket + RLS policies
-- ─────────────────────────────────────────────────────────────────────────────
-- health-records storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'health-records',
  'health-records',
  false,
  26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public              = EXCLUDED.public,
  file_size_limit     = EXCLUDED.file_size_limit,
  allowed_mime_types  = EXCLUDED.allowed_mime_types;

-- Storage RLS for health-records bucket
DROP POLICY IF EXISTS "health_records_read" ON storage.objects;
CREATE POLICY "health_records_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'health-records'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "health_records_insert" ON storage.objects;
CREATE POLICY "health_records_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'health-records'
    AND ((storage.foldername(name))[1])::uuid = auth.uid()
  );

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

DROP POLICY IF EXISTS "health_records_delete" ON storage.objects;
CREATE POLICY "health_records_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'health-records'
    AND ((storage.foldername(name))[1])::uuid = auth.uid()
  );


-- =============================================================================
-- ALL FIXES APPLIED SUCCESSFULLY
-- =============================================================================
