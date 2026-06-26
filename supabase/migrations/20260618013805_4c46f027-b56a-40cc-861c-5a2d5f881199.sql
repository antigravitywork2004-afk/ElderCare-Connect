
DO $$ BEGIN
  CREATE TYPE public.transport_purpose AS ENUM ('hospital', 'checkup', 'emergency');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.sos_alerts
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor_name TEXT NOT NULL,
  specialty TEXT,
  location TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_appts_updated ON public.appointments;
CREATE TRIGGER trg_appts_updated BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "View appts" ON public.appointments FOR SELECT TO authenticated USING (public.can_view_parent(parent_id));
CREATE POLICY "Insert appts" ON public.appointments FOR INSERT TO authenticated WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Update appts" ON public.appointments FOR UPDATE TO authenticated USING (public.can_view_parent(parent_id)) WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Delete appts" ON public.appointments FOR DELETE TO authenticated USING (public.can_view_parent(parent_id));

CREATE TABLE IF NOT EXISTS public.transport_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose public.transport_purpose NOT NULL DEFAULT 'checkup',
  pickup_address TEXT NOT NULL,
  destination TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_bookings TO authenticated;
GRANT ALL ON public.transport_bookings TO service_role;
ALTER TABLE public.transport_bookings ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_transport_updated ON public.transport_bookings;
CREATE TRIGGER trg_transport_updated BEFORE UPDATE ON public.transport_bookings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "View transport" ON public.transport_bookings FOR SELECT TO authenticated USING (public.can_view_parent(parent_id));
CREATE POLICY "Create transport" ON public.transport_bookings FOR INSERT TO authenticated WITH CHECK (public.can_view_parent(parent_id) AND requested_by = auth.uid());
CREATE POLICY "Update transport" ON public.transport_bookings FOR UPDATE TO authenticated USING (public.can_view_parent(parent_id)) WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Delete transport" ON public.transport_bookings FOR DELETE TO authenticated USING (public.can_view_parent(parent_id));

CREATE TABLE IF NOT EXISTS public.video_consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor_name TEXT NOT NULL,
  specialty TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending',
  meeting_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_consultations TO authenticated;
GRANT ALL ON public.video_consultations TO service_role;
ALTER TABLE public.video_consultations ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_video_updated ON public.video_consultations;
CREATE TRIGGER trg_video_updated BEFORE UPDATE ON public.video_consultations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "View video" ON public.video_consultations FOR SELECT TO authenticated USING (public.can_view_parent(parent_id));
CREATE POLICY "Create video" ON public.video_consultations FOR INSERT TO authenticated WITH CHECK (public.can_view_parent(parent_id) AND requested_by = auth.uid());
CREATE POLICY "Update video" ON public.video_consultations FOR UPDATE TO authenticated USING (public.can_view_parent(parent_id)) WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Delete video" ON public.video_consultations FOR DELETE TO authenticated USING (public.can_view_parent(parent_id));
