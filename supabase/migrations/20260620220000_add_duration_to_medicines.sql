-- Add duration column to medicines
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS duration TEXT;
