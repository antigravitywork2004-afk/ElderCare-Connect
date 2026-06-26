-- =====================================================
-- Enable realtime on sos_alerts + add missing hot-path indexes.
-- Without REPLICA IDENTITY FULL and the supabase_realtime publication,
-- caregivers never receive realtime INSERT events.
-- =====================================================

-- Realtime: sos_alerts INSERTs reach subscribed caregivers
ALTER TABLE public.sos_alerts REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sos_alerts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_alerts';
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- publication may not exist in some local environments; ignore
  NULL;
END $$;

-- Hot-path indexes
CREATE INDEX IF NOT EXISTS idx_parent_child_links_parent
  ON public.parent_child_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_child_links_child
  ON public.parent_child_links(child_id);

CREATE INDEX IF NOT EXISTS idx_sos_alerts_parent_created
  ON public.sos_alerts(parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_status
  ON public.sos_alerts(status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_medicines_parent_active
  ON public.medicines(parent_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_medicine_logs_parent_date
  ON public.medicine_logs(parent_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_wellbeing_parent_date
  ON public.wellbeing_checks(parent_id, check_date DESC);

CREATE INDEX IF NOT EXISTS idx_health_records_parent
  ON public.health_records(parent_id, record_date DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_parent_sched
  ON public.appointments(parent_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_caregiver_bookings_parent
  ON public.caregiver_bookings(parent_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_transport_bookings_parent
  ON public.transport_bookings(parent_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_consultations_parent
  ON public.video_consultations(parent_id, scheduled_at DESC);
