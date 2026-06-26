-- ============================================================
-- Telehealth Consultation Module — schema upgrade
-- ============================================================

-- 1. Extend booking_status for consultation-specific values
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'scheduled'   BEFORE 'pending';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'waiting'     AFTER 'scheduled';

-- 2. Add new columns to video_consultations
ALTER TABLE public.video_consultations
  ADD COLUMN IF NOT EXISTS consultation_reason TEXT,
  ADD COLUMN IF NOT EXISTS consultation_date   DATE,
  ADD COLUMN IF NOT EXISTS consultation_time   TIME;

-- 3. Backfill consultation_date / consultation_time from scheduled_at
UPDATE public.video_consultations
  SET consultation_date = scheduled_at::date
  WHERE consultation_date IS NULL;

UPDATE public.video_consultations
  SET consultation_time = scheduled_at::time
  WHERE consultation_time IS NULL;

-- 4. Create prescriptions table (linked to a consultation)
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

-- Prescription RLS: view = parent + linked child; write = parent only
CREATE POLICY "View prescriptions (parent+child)" ON public.consultation_prescriptions
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));

CREATE POLICY "Insert prescriptions (parent only)" ON public.consultation_prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

CREATE POLICY "Delete prescriptions (parent only)" ON public.consultation_prescriptions
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

-- 5. Tighten RLS on video_consultations (parent-only mutations)
DROP POLICY IF EXISTS "Create video" ON public.video_consultations;
CREATE POLICY "Create video (parent only)" ON public.video_consultations
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Update video" ON public.video_consultations;
CREATE POLICY "Update video (parent only)" ON public.video_consultations
  FOR UPDATE TO authenticated
  USING  (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Delete video" ON public.video_consultations;
CREATE POLICY "Delete video (parent only)" ON public.video_consultations
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

-- SELECT unchanged
DROP POLICY IF EXISTS "View video" ON public.video_consultations;
CREATE POLICY "View video (parent+child)" ON public.video_consultations
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));

-- 6. Private storage bucket for prescription files (reuse health-records bucket path pattern)
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
DROP POLICY IF EXISTS "prescriptions_read" ON storage.objects;
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

-- 7. Enable realtime on both tables
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
