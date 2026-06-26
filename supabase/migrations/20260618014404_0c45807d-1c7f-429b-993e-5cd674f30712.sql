
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
