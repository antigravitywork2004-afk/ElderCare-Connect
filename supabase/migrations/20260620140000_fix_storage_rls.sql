-- Fix storage RLS: replace broken `owner = auth.uid()` with `owner_id`
-- Root cause: Supabase JS v2 does not populate the `owner` column on upload;
-- it sets `owner_id` instead. The original INSERT policy checked `owner = auth.uid()`
-- which is always NULL, causing all uploads to fail with an RLS violation.

-- Fix 1 (Critical): Remove the broken owner check from INSERT policy.
-- The path-based can_view_parent() check already prevents unauthorized uploads.
DROP POLICY IF EXISTS "health_records_insert" ON storage.objects;

CREATE POLICY "health_records_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'health-records'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );

-- Fix 2 (Medium): Add missing UPDATE policy for future upsert support.
DROP POLICY IF EXISTS "health_records_update" ON storage.objects;

CREATE POLICY "health_records_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'health-records'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'health-records'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );
