# ElderCare Connect — Free Notification Stack

Three independent channels — no SMS or paid calling providers:

1. **Email** (existing) — Resend via Lovable connector
2. **Web Push** (new) — VAPID Web Push, encrypted with Web Crypto in the edge runtime
3. **Realtime** (new) — Supabase Realtime postgres_changes for instant in-app toasts
4. **Emergency call buttons** (new) — native `tel:` links on linked caregivers + emergency contact

Each channel is fired independently from `src/routes/_authenticated/sos.tsx`. A failure in one channel cannot affect the others (everything is `.catch()`-isolated and uses `Promise.allSettled` on the server).

---

## Files added

- `supabase/migrations/20260619140000_push_subscriptions.sql` — `push_subscriptions` table + RLS + realtime publication for `sos_alerts`
- `src/lib/api/pushNotify.functions.ts` — server functions: `savePushSubscription`, `deletePushSubscription`, `sendPushForAlert`. Web Push (VAPID) implemented with Web Crypto (Cloudflare Worker compatible — no Node-only deps)
- `src/lib/push.ts` — browser helpers: `enablePushNotifications`, `disablePushNotifications`, `getPushPermission`, `isPushSupported`
- `public/sw.js` — service worker handling `push` and `notificationclick` events
- `src/hooks/useRealtimeSosAlerts.ts` — subscribes to `sos_alerts` INSERT events filtered by linked parent ids
- `src/components/EmergencyCallButtons.tsx` — `tel:` links for caregivers and emergency contact

## Files modified

- `src/routes/_authenticated/sos.tsx` — adds Enable/Disable push button, fires email + push in parallel, mounts emergency call buttons, subscribes to realtime alerts for the active parent
- `src/components/AppShell.tsx` — global realtime listener so caregivers receive toast alerts on any page

## Database changes

| Object | Type | Purpose |
|---|---|---|
| `public.push_subscriptions` | table | Stores PushSubscription endpoints per user |
| RLS policy `Users manage own push subscriptions` | policy | Users can only see/modify their own |
| `supabase_realtime` publication | publication | Adds `sos_alerts` so caregivers receive INSERTs |
| `idx_push_subscriptions_user` | index | |
| `idx_notification_logs_alert_channel` | index | Faster per-channel log lookups |

`notification_logs` is reused — the new `push` channel writes rows with `channel = 'push'`, `status` of `sent` / `failed` / `skipped`, and the error message in `error`.

---

## Setup instructions

### 1. Generate VAPID keys (free, one time)

```bash
npx web-push generate-vapid-keys
```

You'll get a public key and a private key (both base64url).

### 2. Add three secrets in Lovable Cloud → Project Settings → Secrets

| Name | Value | Notes |
|---|---|---|
| `VAPID_PUBLIC_KEY` | the public key | Server-only copy |
| `VAPID_PRIVATE_KEY` | the private key | **Never expose to browser** |
| `VAPID_SUBJECT` | `mailto:you@yourdomain.com` | Required by push services |

### 3. Add the public key to client env (`.env`)

```
VITE_VAPID_PUBLIC_KEY=<same value as VAPID_PUBLIC_KEY>
```

The client needs this to call `pushManager.subscribe()`. The public key is, by design, public.

### 4. Run the migration

The new migration `20260619140000_push_subscriptions.sql` is included in `supabase/migrations/`. It will apply automatically on the next deploy, or you can apply it through your normal Supabase migration flow.

### 5. (Optional) Add a `phone` column to `profiles`

The emergency call buttons display:
- The parent's `emergency_contact_phone` (already in `profiles`)
- Each linked caregiver's `phone` (optional column — falls back to no call action if missing)

If you want one-tap calling to linked family members, add:

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
```

---

## Testing instructions

### Web Push
1. Sign in as a **caregiver** (child role) on a desktop browser (Chrome/Firefox/Edge — Safari only supports Web Push on macOS 13+ / iOS 16.4+ as a PWA).
2. Open the SOS page. Click **Enable push alerts** and grant permission.
3. Sign in as a **parent** in another browser/incognito window.
4. Trigger an SOS. Within ~1 second the caregiver browser should display a system notification.
5. Inspect `notification_logs` — there should be a `channel = 'push'`, `status = 'sent'` row for the caregiver's endpoint.

### Realtime
1. Sign in as a caregiver. Stay on any page (e.g. Dashboard).
2. From a second session as the parent, trigger an SOS.
3. The caregiver tab should immediately show a red toast "🚨 New SOS alert" with a View action — no refresh.

### Emergency call
1. On the SOS page (parent view), the "Call for help" list shows any caregivers with a phone number and the profile's emergency contact.
2. Tap a Call button on a phone → native dialer opens. On desktop the OS handler opens.

### Reliability
- Temporarily set an invalid `RESEND_API_KEY` → email logs `failed` but push + realtime still work.
- Temporarily remove `VAPID_PUBLIC_KEY` from secrets → push returns `{ reason: "vapid_not_configured" }` and skips; email + realtime still work.

---

## Security

- `push_subscriptions` RLS: each user can only read/write their own rows (`user_id = auth.uid()`).
- `sendPushForAlert` uses the authenticated `context.supabase` to verify the caller can see the alert (via `can_view_parent` RLS on `sos_alerts`) **before** loading recipient subscriptions with the admin client.
- Realtime channel filter (`parent_id=in.(...)`) plus existing `sos_alerts` RLS means caregivers only receive INSERTs for parents they're already linked to.
- VAPID private key never leaves the server runtime.
- No third-party SMS, calling, or push provider — only:
  - The browser's standard Push API (uses Mozilla, Google, Apple endpoints — all free)
  - Supabase Realtime (already part of Lovable Cloud)
  - Native `tel:` URI handler (no provider)

---

## Final Status

**PARTIAL** — code is complete and shippable, but two configuration steps must be done by the operator before push notifications actually deliver:

1. Generate VAPID keys with `npx web-push generate-vapid-keys`.
2. Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` secrets, plus `VITE_VAPID_PUBLIC_KEY` to `.env`.

Until those are set, `sendPushForAlert` returns `{ reason: "vapid_not_configured" }` and the email + realtime + tel: channels continue to work normally.
