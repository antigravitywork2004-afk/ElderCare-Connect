-- ============================================================
-- Medical Transport Module — schema upgrade
-- ============================================================

-- 1. Create trip_type enum
DO $$ BEGIN
  CREATE TYPE public.trip_type AS ENUM ('one_way', 'round_trip');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Extend booking_status enum with transport-specific values
--    (these are safe to add even if already present via the caregiver migration)
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'assigned'    AFTER 'confirmed';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'in_progress' AFTER 'assigned';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'driver_assigned' AFTER 'confirmed';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'en_route'    AFTER 'driver_assigned';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'arrived'     AFTER 'en_route';

-- 3. Add missing columns to transport_bookings
ALTER TABLE public.transport_bookings
  ADD COLUMN IF NOT EXISTS trip_type        public.trip_type NOT NULL DEFAULT 'one_way',
  ADD COLUMN IF NOT EXISTS transport_date   DATE,
  ADD COLUMN IF NOT EXISTS transport_time   TIME,
  ADD COLUMN IF NOT EXISTS special_assistance TEXT,
  ADD COLUMN IF NOT EXISTS driver_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. Backfill transport_date / transport_time from scheduled_at for existing rows
UPDATE public.transport_bookings
  SET transport_date = scheduled_at::date
  WHERE transport_date IS NULL;

UPDATE public.transport_bookings
  SET transport_time = scheduled_at::time
  WHERE transport_time IS NULL;

-- 5. Tighten RLS — restrict mutations (INSERT/UPDATE/DELETE) to parent only.
--    Children (linked via parent_child_links) may only SELECT.

-- INSERT: only the parent themselves may create a booking
DROP POLICY IF EXISTS "Create transport" ON public.transport_bookings;
CREATE POLICY "Create transport (parent only)" ON public.transport_bookings
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

-- UPDATE: only the parent themselves may update
DROP POLICY IF EXISTS "Update transport" ON public.transport_bookings;
CREATE POLICY "Update transport (parent only)" ON public.transport_bookings
  FOR UPDATE TO authenticated
  USING  (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

-- DELETE: only the parent themselves may delete
DROP POLICY IF EXISTS "Delete transport" ON public.transport_bookings;
CREATE POLICY "Delete transport (parent only)" ON public.transport_bookings
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());

-- SELECT: parent + any linked child may view (unchanged)
DROP POLICY IF EXISTS "View transport" ON public.transport_bookings;
CREATE POLICY "View transport (parent+child)" ON public.transport_bookings
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));

-- 6. Enable realtime on transport_bookings (idempotent)
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
END
$$;
