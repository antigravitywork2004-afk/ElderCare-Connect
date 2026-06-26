-- Add phone column to profiles table for caregivers/users to store their contact number
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;
