-- Add new columns to public.appointments
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS appointment_date DATE,
  ADD COLUMN IF NOT EXISTS appointment_time TIME,
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill columns from scheduled_at if possible
UPDATE public.appointments
  SET title = COALESCE(specialty, 'Doctor Visit')
  WHERE title IS NULL;

UPDATE public.appointments
  SET appointment_date = scheduled_at::date
  WHERE appointment_date IS NULL;

UPDATE public.appointments
  SET appointment_time = scheduled_at::time
  WHERE appointment_time IS NULL;

-- Enforce constraints
ALTER TABLE public.appointments
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN appointment_date SET NOT NULL;

-- Restrict mutations (INSERT, UPDATE, DELETE) to parents only (owner matches auth.uid)
DROP POLICY IF EXISTS "Insert appts" ON public.appointments;
CREATE POLICY "Insert appts (parent only)" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Update appts" ON public.appointments;
CREATE POLICY "Update appts (parent only)" ON public.appointments
  FOR UPDATE TO authenticated
  USING (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "Delete appts" ON public.appointments;
CREATE POLICY "Delete appts (parent only)" ON public.appointments
  FOR DELETE TO authenticated
  USING (parent_id = auth.uid());
