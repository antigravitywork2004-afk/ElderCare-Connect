-- Add wellness tracking columns to wellbeing_checks
ALTER TABLE public.wellbeing_checks 
  ADD COLUMN IF NOT EXISTS sleep_quality TEXT,
  ADD COLUMN IF NOT EXISTS pain_status BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pain_notes TEXT,
  ADD COLUMN IF NOT EXISTS meals_logged TEXT,
  ADD COLUMN IF NOT EXISTS water_intake INTEGER DEFAULT 0;
