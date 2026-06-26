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
