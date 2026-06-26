-- Add allow_child_vitals_input column to elder_settings
ALTER TABLE public.elder_settings ADD COLUMN IF NOT EXISTS allow_child_vitals_input BOOLEAN NOT NULL DEFAULT false;
