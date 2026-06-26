
-- Roles enum
CREATE TYPE public.user_role AS ENUM ('parent', 'child');
CREATE TYPE public.caregiver_type AS ENUM ('nurse', 'caretaker', 'physiotherapist', 'companion');
CREATE TYPE public.booking_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');
CREATE TYPE public.sos_status AS ENUM ('active', 'acknowledged', 'resolved');
CREATE TYPE public.med_period AS ENUM ('morning', 'noon', 'evening', 'night');

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  role public.user_role NOT NULL DEFAULT 'parent',
  avatar_url TEXT,
  invite_code TEXT UNIQUE,
  date_of_birth DATE,
  medical_conditions TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- LINKS
CREATE TABLE public.parent_child_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(parent_id, child_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parent_child_links TO authenticated;
GRANT ALL ON public.parent_child_links TO service_role;
ALTER TABLE public.parent_child_links ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user linked to the given parent?
CREATE OR REPLACE FUNCTION public.is_linked_child(_parent UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.parent_child_links
    WHERE parent_id = _parent AND child_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_parent(_parent UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _parent = auth.uid() OR public.is_linked_child(_parent);
$$;

-- PROFILES policies
CREATE POLICY "Read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY "Read linked profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.can_view_parent(id) OR EXISTS (
    SELECT 1 FROM public.parent_child_links l
    WHERE (l.parent_id = profiles.id AND l.child_id = auth.uid())
       OR (l.child_id  = profiles.id AND l.parent_id = auth.uid())
  ));
CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- LINKS policies
CREATE POLICY "View own links" ON public.parent_child_links FOR SELECT TO authenticated
  USING (parent_id = auth.uid() OR child_id = auth.uid());
CREATE POLICY "Child can create link to self" ON public.parent_child_links FOR INSERT TO authenticated
  WITH CHECK (child_id = auth.uid());
CREATE POLICY "Either party can delete link" ON public.parent_child_links FOR DELETE TO authenticated
  USING (parent_id = auth.uid() OR child_id = auth.uid());

-- MEDICINES
CREATE TABLE public.medicines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dosage TEXT NOT NULL DEFAULT '',
  period public.med_period NOT NULL DEFAULT 'morning',
  schedule_time TIME NOT NULL DEFAULT '08:00',
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicines TO authenticated;
GRANT ALL ON public.medicines TO service_role;
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_meds_updated BEFORE UPDATE ON public.medicines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "View meds (self+linked)" ON public.medicines FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));
CREATE POLICY "Parent or linked child manage meds" ON public.medicines FOR INSERT TO authenticated
  WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Update meds (self+linked)" ON public.medicines FOR UPDATE TO authenticated
  USING (public.can_view_parent(parent_id)) WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Delete meds (self+linked)" ON public.medicines FOR DELETE TO authenticated
  USING (public.can_view_parent(parent_id));

-- MEDICINE LOGS
CREATE TABLE public.medicine_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medicine_id, log_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicine_logs TO authenticated;
GRANT ALL ON public.medicine_logs TO service_role;
ALTER TABLE public.medicine_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View med logs" ON public.medicine_logs FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));
CREATE POLICY "Insert med logs" ON public.medicine_logs FOR INSERT TO authenticated
  WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Delete med logs" ON public.medicine_logs FOR DELETE TO authenticated
  USING (public.can_view_parent(parent_id));

-- WELLBEING
CREATE TABLE public.wellbeing_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  check_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ate_meals BOOLEAN,
  took_medicine BOOLEAN,
  feeling TEXT,
  energy_level TEXT,
  drank_water BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(parent_id, check_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wellbeing_checks TO authenticated;
GRANT ALL ON public.wellbeing_checks TO service_role;
ALTER TABLE public.wellbeing_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View wellbeing" ON public.wellbeing_checks FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));
CREATE POLICY "Insert wellbeing (self)" ON public.wellbeing_checks FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());
CREATE POLICY "Update wellbeing (self)" ON public.wellbeing_checks FOR UPDATE TO authenticated
  USING (parent_id = auth.uid()) WITH CHECK (parent_id = auth.uid());

-- SOS ALERTS
CREATE TABLE public.sos_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT,
  status public.sos_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sos_alerts TO authenticated;
GRANT ALL ON public.sos_alerts TO service_role;
ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View sos" ON public.sos_alerts FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));
CREATE POLICY "Trigger sos (self)" ON public.sos_alerts FOR INSERT TO authenticated
  WITH CHECK (parent_id = auth.uid());
CREATE POLICY "Update sos (linked)" ON public.sos_alerts FOR UPDATE TO authenticated
  USING (public.can_view_parent(parent_id)) WITH CHECK (public.can_view_parent(parent_id));

-- CAREGIVER BOOKINGS
CREATE TABLE public.caregiver_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  caregiver_type public.caregiver_type NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_hours INT NOT NULL DEFAULT 2,
  status public.booking_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caregiver_bookings TO authenticated;
GRANT ALL ON public.caregiver_bookings TO service_role;
ALTER TABLE public.caregiver_bookings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON public.caregiver_bookings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "View bookings" ON public.caregiver_bookings FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));
CREATE POLICY "Create bookings" ON public.caregiver_bookings FOR INSERT TO authenticated
  WITH CHECK (public.can_view_parent(parent_id) AND requested_by = auth.uid());
CREATE POLICY "Update bookings" ON public.caregiver_bookings FOR UPDATE TO authenticated
  USING (public.can_view_parent(parent_id)) WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Delete bookings" ON public.caregiver_bookings FOR DELETE TO authenticated
  USING (public.can_view_parent(parent_id));

-- HEALTH RECORDS
CREATE TABLE public.health_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  record_type TEXT NOT NULL DEFAULT 'report',
  doctor_name TEXT,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  file_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_records TO authenticated;
GRANT ALL ON public.health_records TO service_role;
ALTER TABLE public.health_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View records" ON public.health_records FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));
CREATE POLICY "Insert records" ON public.health_records FOR INSERT TO authenticated
  WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Update records" ON public.health_records FOR UPDATE TO authenticated
  USING (public.can_view_parent(parent_id)) WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Delete records" ON public.health_records FOR DELETE TO authenticated
  USING (public.can_view_parent(parent_id));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
BEGIN
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.profiles (id, full_name, role, invite_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'parent'),
    v_code
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();




REVOKE EXECUTE ON FUNCTION public.is_linked_child(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_parent(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_linked_child(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_parent(UUID) TO authenticated;




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




DO $$ BEGIN
  CREATE TYPE public.risk_level AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.health_risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  age INT NOT NULL,
  bp_systolic INT,
  bp_diastolic INT,
  sugar_level INT,
  activity_level TEXT,
  risk_level public.risk_level NOT NULL DEFAULT 'low',
  risk_score INT,
  summary TEXT,
  recommendations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_risk_assessments TO authenticated;
GRANT ALL ON public.health_risk_assessments TO service_role;
ALTER TABLE public.health_risk_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View risk" ON public.health_risk_assessments FOR SELECT TO authenticated USING (public.can_view_parent(parent_id));
CREATE POLICY "Insert risk" ON public.health_risk_assessments FOR INSERT TO authenticated WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Delete risk" ON public.health_risk_assessments FOR DELETE TO authenticated USING (public.can_view_parent(parent_id));

CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_chat_messages TO authenticated;
GRANT ALL ON public.ai_chat_messages TO service_role;
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View ai chat" ON public.ai_chat_messages FOR SELECT TO authenticated USING (public.can_view_parent(parent_id));
CREATE POLICY "Insert ai chat" ON public.ai_chat_messages FOR INSERT TO authenticated WITH CHECK (public.can_view_parent(parent_id));
CREATE POLICY "Delete ai chat" ON public.ai_chat_messages FOR DELETE TO authenticated USING (public.can_view_parent(parent_id));




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




REVOKE ALL ON FUNCTION public.detect_care_issues() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_care_issues() TO postgres, service_role;



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



-- Extend health_records with file metadata + uploader
ALTER TABLE public.health_records
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Storage bucket for health-records
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'health-records',
  'health-records',
  false,
  26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "health_records_read" ON storage.objects;
CREATE POLICY "health_records_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'health-records'
    AND public.can_view_parent(((storage.foldername(name))[1])::uuid)
  );

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



-- Create enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'vital_type'
  ) THEN
    CREATE TYPE vital_type AS ENUM (
      'blood_pressure',
      'blood_sugar',
      'heart_rate',
      'weight',
      'oxygen_saturation',
      'temperature'
    );
  END IF;
END $$;

-- Create table
CREATE TABLE IF NOT EXISTS public.vitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  parent_id UUID NOT NULL,

  vital_type vital_type NOT NULL,

  value NUMERIC NOT NULL,

  value_secondary NUMERIC,

  unit TEXT,

  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  notes TEXT,

  is_abnormal BOOLEAN DEFAULT FALSE,

  created_by UUID NOT NULL DEFAULT auth.uid(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vitals_parent_recorded
ON public.vitals(parent_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_vitals_parent_type_recorded
ON public.vitals(parent_id, vital_type, recorded_at DESC);

-- Enable RLS
ALTER TABLE public.vitals ENABLE ROW LEVEL SECURITY;

-- Read access
CREATE POLICY "linked users can view vitals"
ON public.vitals
FOR SELECT
USING (
  can_view_parent(parent_id)
);

-- Insert access
CREATE POLICY "linked users can insert vitals"
ON public.vitals
FOR INSERT
WITH CHECK (
  can_view_parent(parent_id)
);

-- Update access
CREATE POLICY "linked users can update vitals"
ON public.vitals
FOR UPDATE
USING (
  can_view_parent(parent_id)
);

-- Delete access
CREATE POLICY "linked users can delete vitals"
ON public.vitals
FOR DELETE
USING (
  can_view_parent(parent_id)
);



-- =====================================================
-- Emergency Contacts + Elder Settings
-- (Moved from supabase/manual_sql so it auto-applies.)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  phone TEXT,
  email TEXT,
  priority INT NOT NULL DEFAULT 5,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_contacts TO authenticated;
GRANT ALL ON public.emergency_contacts TO service_role;

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_emergency_contacts_updated ON public.emergency_contacts;
CREATE TRIGGER trg_emergency_contacts_updated BEFORE UPDATE ON public.emergency_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "View emergency contacts for linked parent" ON public.emergency_contacts;
CREATE POLICY "View emergency contacts for linked parent" ON public.emergency_contacts
  FOR SELECT TO authenticated USING (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Insert emergency contact for linked parent" ON public.emergency_contacts;
CREATE POLICY "Insert emergency contact for linked parent" ON public.emergency_contacts
  FOR INSERT TO authenticated WITH CHECK (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Update emergency contact for linked parent" ON public.emergency_contacts;
CREATE POLICY "Update emergency contact for linked parent" ON public.emergency_contacts
  FOR UPDATE TO authenticated
  USING (public.can_view_parent(parent_id))
  WITH CHECK (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Delete emergency contact for linked parent" ON public.emergency_contacts;
CREATE POLICY "Delete emergency contact for linked parent" ON public.emergency_contacts
  FOR DELETE TO authenticated USING (public.can_view_parent(parent_id));

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_parent
  ON public.emergency_contacts(parent_id, priority);

-- ELDER SETTINGS
CREATE TABLE IF NOT EXISTS public.elder_settings (
  parent_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_email BOOLEAN NOT NULL DEFAULT true,
  notify_push BOOLEAN NOT NULL DEFAULT true,
  notify_sms BOOLEAN NOT NULL DEFAULT false,
  med_reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  med_reminder_lead_minutes INT NOT NULL DEFAULT 10,
  med_voice_reminders BOOLEAN NOT NULL DEFAULT false,
  sos_escalation_minutes INT NOT NULL DEFAULT 5,
  sos_auto_call_primary BOOLEAN NOT NULL DEFAULT false,
  sos_share_location BOOLEAN NOT NULL DEFAULT true,
  preferred_contact_method TEXT NOT NULL DEFAULT 'phone',
  language TEXT NOT NULL DEFAULT 'en',
  large_text BOOLEAN NOT NULL DEFAULT false,
  high_contrast BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.elder_settings TO authenticated;
GRANT ALL ON public.elder_settings TO service_role;

ALTER TABLE public.elder_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_elder_settings_updated ON public.elder_settings;
CREATE TRIGGER trg_elder_settings_updated BEFORE UPDATE ON public.elder_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "View settings for linked parent" ON public.elder_settings;
CREATE POLICY "View settings for linked parent" ON public.elder_settings
  FOR SELECT TO authenticated USING (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Insert own elder settings" ON public.elder_settings;
CREATE POLICY "Insert own elder settings" ON public.elder_settings
  FOR INSERT TO authenticated WITH CHECK (public.can_view_parent(parent_id));

DROP POLICY IF EXISTS "Update elder settings for linked parent" ON public.elder_settings;
CREATE POLICY "Update elder settings for linked parent" ON public.elder_settings
  FOR UPDATE TO authenticated
  USING (public.can_view_parent(parent_id))
  WITH CHECK (public.can_view_parent(parent_id));


-- =====================================================
-- Web Push subscriptions (referenced by src/lib/api/pushNotify.functions.ts)
-- Missing in earlier migrations â€” push notifications cannot work without it.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "View own push subscriptions" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Insert own push subscription" ON public.push_subscriptions;
CREATE POLICY "Insert own push subscription" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Update own push subscription" ON public.push_subscriptions;
CREATE POLICY "Update own push subscription" ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Delete own push subscription" ON public.push_subscriptions;
CREATE POLICY "Delete own push subscription" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions(user_id);


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

-- Create wellbeing_entries view alias for wellbeing_checks
CREATE OR REPLACE VIEW public.wellbeing_entries AS SELECT * FROM public.wellbeing_checks;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wellbeing_entries TO authenticated;
GRANT ALL ON public.wellbeing_entries TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- APPOINTMENTS: columns + tightened parent-only write RLS
-- Migration: 20260621010000_appointments_module
-- ─────────────────────────────────────────────────────────────────────────────

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




