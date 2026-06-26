-- Notification delivery log for SOS email alerts
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES public.sos_alerts(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  status TEXT NOT NULL,
  error TEXT,
  attempt INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_logs TO authenticated;
GRANT ALL ON public.notification_logs TO service_role;

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View notification logs for linked alerts"
  ON public.notification_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sos_alerts a
      WHERE a.id = notification_logs.alert_id
        AND public.can_view_parent(a.parent_id)
    )
  );

CREATE INDEX IF NOT EXISTS idx_notification_logs_alert ON public.notification_logs(alert_id);
