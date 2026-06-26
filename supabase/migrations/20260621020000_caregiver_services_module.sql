-- ============================================================
-- Caregiver Services Module — schema upgrade
-- ============================================================

-- 1. Extend booking_status enum with new values required by spec
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'assigned'   AFTER 'confirmed';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'in_progress' AFTER 'assigned';

-- 2. Add missing columns to caregiver_bookings
ALTER TABLE public.caregiver_bookings
  ADD COLUMN IF NOT EXISTS booking_date    DATE,
  ADD COLUMN IF NOT EXISTS booking_time    TIME,
  ADD COLUMN IF NOT EXISTS caregiver_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS caregiver_name TEXT;

-- 3. Backfill booking_date / booking_time from scheduled_at for existing rows
UPDATE public.caregiver_bookings
  SET booking_date = scheduled_at::date
  WHERE booking_date IS NULL;

UPDATE public.caregiver_bookings
  SET booking_time = scheduled_at::time
  WHERE booking_time IS NULL;

-- 4. Tighten RLS — restrict mutations (INSERT/UPDATE/DELETE) to the parent only.
--    Children (linked via parent_child_links) may only SELECT.

-- INSERT: only the parent themselves may create a booking
DROP POLICY IF EXISTS "Create bookings" ON public.caregiver_bookings;
CREATE POLICY "Create bookings (parent only)" ON public.caregiver_bookings
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

-- UPDATE: only the parent themselves may update a booking
DROP POLICY IF EXISTS "Update bookings" ON public.caregiver_bookings;
CREATE POLICY "Update bookings (parent only)" ON public.caregiver_bookings
  FOR UPDATE TO authenticated
  USING  (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

-- DELETE: only the parent themselves may delete a booking
DROP POLICY IF EXISTS "Delete bookings" ON public.caregiver_bookings;
CREATE POLICY "Delete bookings (parent only)" ON public.caregiver_bookings
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

-- SELECT: parent + any linked child may view (unchanged)
DROP POLICY IF EXISTS "View bookings" ON public.caregiver_bookings;
CREATE POLICY "View bookings (parent+child)" ON public.caregiver_bookings
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));

-- 5. Enable realtime on caregiver_bookings (idempotent)
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
END
$$;
