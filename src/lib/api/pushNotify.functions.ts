import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Web Push (VAPID) over Web Crypto — works in Cloudflare Workers and Node.
 * No SMS providers, no paid services. Requires VAPID keys in env.
 *
 * Required env:
 *   VAPID_PUBLIC_KEY   (base64url, also exposed to client as VITE_VAPID_PUBLIC_KEY)
 *   VAPID_PRIVATE_KEY  (base64url)
 *   VAPID_SUBJECT      (mailto:you@example.com)
 *
 * Generate locally with:
 *   npx web-push generate-vapid-keys
 */

// ---------- crypto helpers ----------
function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Convert raw P-256 public key (65 bytes uncompressed) to JWK
function rawP256PubToJwk(raw: Uint8Array): JsonWebKey {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error("Invalid P-256 raw public key");
  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(raw.slice(1, 33)),
    y: bytesToB64url(raw.slice(33, 65)),
    ext: true,
  };
}

async function importVapidPrivateKey(privB64url: string, pubB64url: string) {
  const d = privB64url;
  const pub = b64urlToBytes(pubB64url);
  const jwk: JsonWebKey = {
    ...rawP256PubToJwk(pub),
    d,
    key_ops: ["sign"],
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

async function signVapidJwt(audience: string): Promise<string> {
  const pub = process.env.VAPID_PUBLIC_KEY!;
  const priv = process.env.VAPID_PRIVATE_KEY!;
  const sub = process.env.VAPID_SUBJECT || "mailto:admin@eldercare.local";

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub,
  };
  const enc = (o: object) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const key = await importVapidPrivateKey(priv, pub);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned) as BufferSource,
  );
  return `${unsigned}.${bytesToB64url(sig)}`;
}

// ---------- aes128gcm payload encryption (RFC 8291) ----------
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const baseKey = await crypto.subtle.importKey("raw", ikm as BufferSource, { name: "HKDF" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayloadAes128Gcm(
  payload: Uint8Array,
  recipientPubRaw: Uint8Array,
  recipientAuth: Uint8Array,
): Promise<{ body: Uint8Array; appServerPubRaw: Uint8Array }> {
  // Generate ephemeral ECDH key pair
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const appServerPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeral.publicKey),
  );

  // Import recipient public key for ECDH
  const recipientPubKey = await crypto.subtle.importKey(
    "raw",
    recipientPubRaw as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );

  // Shared secret
  const ecdhSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientPubKey },
    ephemeral.privateKey,
    256,
  );
  const ecdhSecret = new Uint8Array(ecdhSecretBits);

  // PRK_key = HKDF-Expand(HKDF-Extract(auth, ecdh_secret), key_info, 32)
  const keyInfo = concatBytes(
    new TextEncoder().encode("WebPush: info\0"),
    recipientPubRaw,
    appServerPubRaw,
  );
  const ikm2 = await hkdf(recipientAuth, ecdhSecret, keyInfo, 32);

  // Salt and CEK / nonce
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm2, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm2, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  // Plaintext = payload || 0x02 (last record delimiter)
  const plaintext = concatBytes(payload, new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, plaintext as BufferSource),
  );

  // aes128gcm header: salt(16) || rs(4 big-endian) || idlen(1) || keyid(idlen)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + appServerPubRaw.length);
  header.set(salt, 0);
  const dv = new DataView(header.buffer);
  dv.setUint32(16, rs, false);
  header[20] = appServerPubRaw.length;
  header.set(appServerPubRaw, 21);

  return { body: concatBytes(header, ciphertext), appServerPubRaw };
}

async function sendWebPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payloadObj: Record<string, unknown>,
): Promise<{ status: number; body?: string }> {
  const url = new URL(sub.endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const jwt = await signVapidJwt(aud);

  const recipientPubRaw = b64urlToBytes(sub.p256dh);
  const recipientAuth = b64urlToBytes(sub.auth);
  const payload = new TextEncoder().encode(JSON.stringify(payloadObj));
  const { body } = await encryptPayloadAes128Gcm(payload, recipientPubRaw, recipientAuth);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "60",
      Urgency: "high",
      Authorization: `vapid t=${jwt}, k=${process.env.VAPID_PUBLIC_KEY}`,
    },
    body: body as BodyInit,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { status: res.status, body: text.slice(0, 300) };
  }
  return { status: res.status };
}

// ---------- server functions ----------

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      endpoint: z.string().url(),
      p256dh: z.string().min(1),
      auth: z.string().min(1),
      userAgent: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("push_subscriptions")
      .upsert(
        {
          user_id: context.userId,
          endpoint: data.endpoint,
          p256dh: data.p256dh,
          auth: data.auth,
          user_agent: data.userAgent ?? null,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ endpoint: z.string().url() }))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendPushForAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      alertId: z.string().uuid(),
      alertType: z.string().default("manual"),
    }),
  )
  .handler(async ({ data, context }) => {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return { sent: 0, failed: 0, skipped: 0, recipients: 0, reason: "vapid_not_configured" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const logs = (supabaseAdmin as any).from("notification_logs");

    // Verify caller can see this alert (RLS) then read with admin to skip RLS for logging
    const { data: alert, error: alertErr } = await context.supabase
      .from("sos_alerts")
      .select("id, parent_id, message, created_at, latitude, longitude")
      .eq("id", data.alertId)
      .single();
    if (alertErr || !alert) throw new Error("Alert not found or not accessible");

    const { data: elder } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", alert.parent_id)
      .single();
    const elderName = elder?.full_name || "Your family member";

    // Linked caregivers (children of this parent)
    const { data: links } = await supabaseAdmin
      .from("parent_child_links")
      .select("child_id")
      .eq("parent_id", alert.parent_id);
    const childIds = (links ?? []).map((l: { child_id: string }) => l.child_id);

    if (childIds.length === 0) {
      return { sent: 0, failed: 0, skipped: 0, recipients: 0 };
    }

    // Fetch all push subscriptions for those caregivers
    const { data: subs } = await (supabaseAdmin as any)
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", childIds);

    const subscriptions = (subs ?? []) as Array<{
      id: string;
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>;

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0, skipped: childIds.length, recipients: 0 };
    }

    const mapsUrl =
      alert.latitude != null && alert.longitude != null
        ? `https://www.google.com/maps?q=${alert.latitude},${alert.longitude}`
        : null;
    const payloadObj = {
      title: `🚨 SOS from ${elderName}`,
      body: alert.message ?? "Emergency triggered",
      tag: `sos-${alert.id}`,
      url: "/sos",
      alertId: alert.id,
      mapsUrl,
      alertType: data.alertType,
    };

    let sent = 0;
    let failed = 0;
    const skipped = 0;

    // Independent per-subscription delivery — failures don't affect others
    const results = await Promise.allSettled(
      subscriptions.map(async (s) => {
        try {
          const r = await sendWebPush(s, payloadObj);
          if (r.status >= 200 && r.status < 300) {
            await logs.insert({
              alert_id: data.alertId,
              recipient: s.endpoint,
              channel: "push",
              status: "sent",
              attempt: 1,
            });
            return { ok: true };
          }
          // 404/410 → stale subscription; remove it
          if (r.status === 404 || r.status === 410) {
            await (supabaseAdmin as any)
              .from("push_subscriptions")
              .delete()
              .eq("id", s.id);
          }
          await logs.insert({
            alert_id: data.alertId,
            recipient: s.endpoint,
            channel: "push",
            status: "failed",
            error: `HTTP ${r.status} ${r.body ?? ""}`.slice(0, 500),
            attempt: 1,
          });
          return { ok: false };
        } catch (e) {
          await logs.insert({
            alert_id: data.alertId,
            recipient: s.endpoint,
            channel: "push",
            status: "failed",
            error: e instanceof Error ? e.message.slice(0, 500) : String(e),
            attempt: 1,
          });
          return { ok: false };
        }
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) sent++;
      else failed++;
    }

    return {
      sent,
      failed,
      skipped,
      recipients: subscriptions.length,
    };
  });
