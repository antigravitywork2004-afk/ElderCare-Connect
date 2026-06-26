-- Add required category column to health_records
-- Categories: blood_test | prescription | ecg
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS category TEXT
    CHECK (category IN ('blood_test', 'prescription', 'ecg'));

-- Back-fill existing rows so the NOT NULL constraint below is safe
UPDATE public.health_records
  SET category = 'blood_test'
  WHERE category IS NULL;

-- Now make it non-nullable with a default
ALTER TABLE public.health_records
  ALTER COLUMN category SET DEFAULT 'blood_test',
  ALTER COLUMN category SET NOT NULL;

-- Tighten RLS: only the parent themselves can insert / delete records
-- (children are read-only).  View policy already covers both via can_view_parent.
DROP POLICY IF EXISTS "Insert records" ON public.health_records;
CREATE POLICY "Insert records (parent only)" ON public.health_records
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Delete records" ON public.health_records;
CREATE POLICY "Delete records (parent only)" ON public.health_records
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "Update records" ON public.health_records;
CREATE POLICY "Update records (parent only)" ON public.health_records
  FOR UPDATE TO authenticated
  USING (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

-- Storage: restrict INSERT/UPDATE/DELETE to parent only (parent folder = auth.uid())
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
