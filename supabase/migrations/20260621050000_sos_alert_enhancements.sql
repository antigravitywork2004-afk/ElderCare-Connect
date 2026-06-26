-- ============================================================
-- Emergency Assistance (SOS Alert System) — schema upgrade
-- ============================================================

-- 1. Add new columns to public.sos_alerts
ALTER TABLE public.sos_alerts
  ADD COLUMN IF NOT EXISTS parent_name       TEXT,
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS alert_timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS acknowledged_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Trigger function to auto-populate parent_name from profiles BEFORE INSERT
CREATE OR REPLACE FUNCTION public.set_sos_parent_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_name IS NULL THEN
    SELECT full_name INTO NEW.parent_name
    FROM public.profiles
    WHERE id = NEW.parent_id;
  END IF;
  
  -- Set alert_timestamp to now() if not set
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

-- 3. Update RLS policies to restrict SOS trigger to authenticated parents only
--    and allow linked child/parent to update statuses.
DROP POLICY IF EXISTS "Trigger sos (self)" ON public.sos_alerts;
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

DROP POLICY IF EXISTS "Update sos (linked)" ON public.sos_alerts;
DROP POLICY IF EXISTS "Update sos (parent+child)" ON public.sos_alerts;

CREATE POLICY "Update sos (parent+child)" ON public.sos_alerts
  FOR UPDATE TO authenticated
  USING (public.can_view_parent(parent_id))
  WITH CHECK (public.can_view_parent(parent_id));

-- SELECT is already: View sos -> can_view_parent(parent_id)
-- If not present, create it
DROP POLICY IF EXISTS "View sos" ON public.sos_alerts;
CREATE POLICY "View sos" ON public.sos_alerts
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));
