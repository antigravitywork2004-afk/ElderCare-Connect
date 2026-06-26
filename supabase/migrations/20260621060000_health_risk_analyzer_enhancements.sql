-- ============================================================
-- AI Health Risk Analyzer — schema upgrade
-- ============================================================

-- 1. Add new columns to public.health_risk_assessments
ALTER TABLE public.health_risk_assessments
  ADD COLUMN IF NOT EXISTS heart_rate    INT,
  ADD COLUMN IF NOT EXISTS weight        NUMERIC,
  ADD COLUMN IF NOT EXISTS oxygen_level  INT,
  ADD COLUMN IF NOT EXISTS wellness_data TEXT;

-- 2. Restrict INSERT and DELETE to authenticated Parents only
DROP POLICY IF EXISTS "Insert risk" ON public.health_risk_assessments;
CREATE POLICY "Insert risk (parent only)" ON public.health_risk_assessments
  FOR INSERT TO authenticated
  WITH CHECK (
    parent_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'parent'
    )
  );

DROP POLICY IF EXISTS "Delete risk" ON public.health_risk_assessments;
CREATE POLICY "Delete risk (parent only)" ON public.health_risk_assessments
  FOR DELETE TO authenticated
  USING (
    parent_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'parent'
    )
  );

-- SELECT is open to parent and linked child (already defined, let's keep or recreate it)
DROP POLICY IF EXISTS "View risk" ON public.health_risk_assessments;
CREATE POLICY "View risk" ON public.health_risk_assessments
  FOR SELECT TO authenticated
  USING (public.can_view_parent(parent_id));
