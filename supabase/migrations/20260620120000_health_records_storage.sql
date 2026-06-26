-- Extend health_records with file metadata + uploader
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Private storage bucket for health record files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'health-records',
  'health-records',
  false,
  26214400,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

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
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "health_records_delete" ON storage.objects;
CREATE POLICY "health_records_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'health-records'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );
