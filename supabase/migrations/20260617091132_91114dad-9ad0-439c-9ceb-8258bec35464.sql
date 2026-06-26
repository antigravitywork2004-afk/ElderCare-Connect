
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
