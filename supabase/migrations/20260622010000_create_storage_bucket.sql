-- =============================================================================
-- Create health-records Storage Bucket
-- 
-- IMPORTANT: This migration requires the Supabase service role to execute the
-- INSERT into storage.buckets. Run this in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/nyqmbpwprqyovgoobzti/sql
--
-- OR run via Supabase CLI: supabase db push
-- =============================================================================

-- Create the private bucket for health record file uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'health-records',
  'health-records',
  false,
  26214400,  -- 25 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── Storage RLS Policies ────────────────────────────────────────────────────

-- SELECT: The parent and their linked caregivers can view the files
DROP POLICY IF EXISTS "health_records_read" ON storage.objects;
CREATE POLICY "health_records_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'health-records'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );

-- INSERT: Only the parent (folder = auth.uid()) can upload.
-- Root cause fix: removed broken `owner = auth.uid()` check (always NULL in
-- Supabase JS v2 — it sets owner_id not owner). Now uses path-based check only.
DROP POLICY IF EXISTS "health_records_insert" ON storage.objects;
CREATE POLICY "health_records_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'health-records'
    AND ((storage.foldername(name))[1])::uuid = auth.uid()
  );

-- UPDATE: Parent only
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

-- DELETE: Parent only
DROP POLICY IF EXISTS "health_records_delete" ON storage.objects;
CREATE POLICY "health_records_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'health-records'
    AND ((storage.foldername(name))[1])::uuid = auth.uid()
  );

-- Verify the bucket was created
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'health-records') THEN
    RAISE EXCEPTION 'health-records bucket was NOT created. Check service role permissions.';
  ELSE
    RAISE NOTICE 'health-records bucket created successfully.';
  END IF;
END $$;
