-- =====================================================
-- Web Push subscriptions (referenced by src/lib/api/pushNotify.functions.ts)
-- Missing in earlier migrations — push notifications cannot work without it.
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
