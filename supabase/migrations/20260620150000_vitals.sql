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