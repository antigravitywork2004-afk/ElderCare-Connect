# ElderCare Connect — Runtime Setup Required

This document lists every step needed to get all features working after extracting the project.

---

## Step 1 — Run migrations in Supabase SQL Editor

**URL:** https://supabase.com/dashboard/project/nyqmbpwprqyovgoobzti/sql

Open the SQL editor and run these two migration files in order:

1. **`supabase/migrations/20260622000000_consolidated_fixes.sql`**  
   Creates all missing tables, adds missing columns, and sets up RLS policies.

2. **`supabase/migrations/20260622010000_create_storage_bucket.sql`**  
   Creates the `health-records` private storage bucket with correct RLS policies.  
   ⚠️ This **MUST** be run — without it, all file uploads will fail.

---

## Step 2 — Add missing environment variables to `.env`

Your current `.env` is missing these required keys:

### Critical (features will fail without these)

| Variable | Where to get it | Feature |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → `service_role` (secret) | SOS email admin lookups, push notifications |
| `VAPID_PUBLIC_KEY` | Run `npx web-push generate-vapid-keys` | Push notifications |
| `VAPID_PRIVATE_KEY` | Same command as above | Push notifications |
| `VAPID_SUBJECT` | Set to `mailto:your@email.com` | Push notifications |

### Optional (already handled with fallback)

| Variable | Purpose |
|---|---|
| `LOVABLE_API_KEY` | Use Lovable's AI/Resend gateway — falls back to direct API if absent |

### How to add to `.env`

```bash
# Add to your .env file:
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

VAPID_PUBLIC_KEY=BExxxxxxxxxxxxxxxxxx...
VAPID_PRIVATE_KEY=xxxxxxxxxx...
VAPID_SUBJECT=mailto:admin@yourapp.com

# Also expose VAPID public key to the browser:
VITE_VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
```

### How to get the Supabase service role key

1. Go to: https://supabase.com/dashboard/project/nyqmbpwprqyovgoobzti/settings/api
2. Scroll to "Project API keys"
3. Copy the `service_role` key (it starts with `eyJ...`)
4. Add it as `SUPABASE_SERVICE_ROLE_KEY=eyJ...` in your `.env`

### How to generate VAPID keys

```bash
npx web-push generate-vapid-keys --curve prime256v1
```

---

## Step 3 — OpenAI API Quota

The current `OPENAI_API_KEY` in `.env` has **exceeded its quota** (HTTP 429 / insufficient_quota).

To fix AI Companion:
1. Go to: https://platform.openai.com/account/billing
2. Add billing/credits to your account
3. OR generate a new API key from a funded account

The app already handles this gracefully — users see a clear error toast and can still use all other features.

---

## Runtime Test Results

| Feature | Status | Root Cause |
|---|---|---|
| Health Records Upload | ❌ Broken | `health-records` storage bucket does not exist |
| Emergency Phone Calls | ✅ Working | Native `tel:` links — no backend required |
| Emergency SMS | ✅ Working | Native `sms:` links — no backend required |
| SOS Email Notifications | ⚠️ Partial | Resend API key valid, but `SUPABASE_SERVICE_ROLE_KEY` missing for admin email lookup. **Fixed in code** to use `profiles.email` as fallback. |
| Settings Persistence | ✅ Working | All tables exist, all columns correct |
| AI Companion Responses | ❌ Broken | OpenAI API key has no remaining quota |
| AI Companion Clear Chat | ✅ Working | Implemented, DB connection confirmed |
| AI Companion History | ✅ Working | Implemented, date-grouped from existing messages |
| SOS Push Notifications | ❌ Broken | VAPID keys not configured in `.env` |
| SOS Phone Calls | ✅ Working | Native `tel:` links |
| Emergency Contact SMS | ✅ Working | Native `sms:` links |

---

## Files Modified in This Fix

| File | What Changed |
|---|---|
| `src/components/EmergencyCallButtons.tsx` | Added SMS (`sms:`) buttons alongside existing Call buttons |
| `src/routes/_authenticated/emergency-contacts.tsx` | Added SMS buttons to every contact with a phone number |
| `src/routes/_authenticated/records.tsx` | Fixed error messages (shows actual Supabase error), fixed `image/jpg`→`image/jpeg` MIME normalisation |
| `src/routes/_authenticated/settings.tsx` | Fixed phone save using `(supabase as any)` cast, improved all error messages |
| `src/routes/_authenticated/companion.tsx` | Added Clear Chat button (date-scoped), added Chat History sidebar |
| `src/lib/api/sosNotify.functions.ts` | **Critical fix**: no longer requires `SUPABASE_SERVICE_ROLE_KEY` — uses `profiles.email` as fallback |
| `supabase/migrations/20260622000000_consolidated_fixes.sql` | Idempotent migration for all missing tables/columns/policies |
| `supabase/migrations/20260622010000_create_storage_bucket.sql` | Creates `health-records` bucket with correct RLS |

