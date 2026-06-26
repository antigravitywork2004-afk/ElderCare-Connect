
-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Extend sos_alerts with type + dedup key (additive, defaults preserve existing rows)
ALTER TABLE public.sos_alerts
  ADD COLUMN IF NOT EXISTS alert_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS sos_alerts_dedup_key_uidx
  ON public.sos_alerts (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Detector: scans medicines/medicine_logs and wellbeing_checks, inserts alerts.
-- SECURITY DEFINER so pg_cron (no auth context) can write through RLS.
CREATE OR REPLACE FUNCTION public.detect_care_issues()
RETURNS TABLE(missed_medicine_alerts int, no_checkin_alerts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missed int := 0;
  v_nocheck int := 0;
BEGIN
  -- ---- Missed medicine ----
  -- A scheduled dose is missed when:
  --   * medicine is active
  --   * today's schedule_time is at least 1 hour in the past (grace window)
  --   * no medicine_logs row exists for (medicine_id, today)
  WITH inserted AS (
    INSERT INTO public.sos_alerts (parent_id, message, alert_type, dedup_key)
    SELECT
      m.parent_id,
      'Missed medicine: ' || m.name ||
        COALESCE(' (' || NULLIF(m.dosage, '') || ')', '') ||
        ' scheduled at ' || to_char(m.schedule_time, 'HH24:MI'),
      'missed_medicine',
      'missed_medicine:' || m.id::text || ':' || CURRENT_DATE::text
    FROM public.medicines m
    WHERE m.active = true
      AND (CURRENT_DATE + m.schedule_time) <= (now() - interval '1 hour')
      AND NOT EXISTS (
        SELECT 1 FROM public.medicine_logs ml
        WHERE ml.medicine_id = m.id
          AND ml.log_date = CURRENT_DATE
      )
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_missed FROM inserted;

  -- ---- No daily check-in ----
  -- After 20:00 (server time), any parent with no wellbeing_check row for today
  -- gets a single 'no_checkin' alert. Limited to users with at least one medicine
  -- or wellbeing history (i.e. actively using the app) to avoid noise for brand
  -- new accounts.
  IF EXTRACT(HOUR FROM now()) >= 20 THEN
    WITH active_parents AS (
      SELECT DISTINCT p.id AS parent_id
      FROM public.profiles p
      WHERE p.role = 'parent'
        AND (
          EXISTS (SELECT 1 FROM public.medicines m WHERE m.parent_id = p.id AND m.active)
          OR EXISTS (SELECT 1 FROM public.wellbeing_checks w WHERE w.parent_id = p.id)
        )
    ),
    inserted AS (
      INSERT INTO public.sos_alerts (parent_id, message, alert_type, dedup_key)
      SELECT
        ap.parent_id,
        'No wellbeing check-in recorded today',
        'no_checkin',
        'no_checkin:' || ap.parent_id::text || ':' || CURRENT_DATE::text
      FROM active_parents ap
      WHERE NOT EXISTS (
        SELECT 1 FROM public.wellbeing_checks w
        WHERE w.parent_id = ap.parent_id
          AND w.check_date = CURRENT_DATE
      )
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_nocheck FROM inserted;
  END IF;

  RAISE NOTICE 'detect_care_issues: missed=% no_checkin=%', v_missed, v_nocheck;
  RETURN QUERY SELECT v_missed, v_nocheck;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'detect_care_issues failed: %', SQLERRM;
  RETURN QUERY SELECT 0, 0;
END;
$$;

-- Schedule: every 15 minutes. Unschedule prior version (idempotent) then schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('detect-care-issues');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'detect-care-issues',
  '*/15 * * * *',
  $$SELECT public.detect_care_issues();$$
);
