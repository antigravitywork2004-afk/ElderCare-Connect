import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

async function sendEmail(to: string, subject: string, html: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  let res: Response;
  if (lovableKey) {
    res = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey ?? "",
      },
      body: JSON.stringify({
        from: "ElderCare Connect <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
      }),
    });
  } else if (resendKey) {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: "ElderCare Connect <onboarding@resend.dev>",
        to: [to],
        subject,
        html,
      }),
    });
  } else {
    throw new Error("Email service not configured. Add RESEND_API_KEY to your .env file.");
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function buildHtml(opts: {
  elderName: string;
  alertType: string;
  message: string;
  timestamp: string;
  mapsUrl?: string | null;
}) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff;color:#1a1a1a">
    <h1 style="color:#b91c1c;margin:0 0 12px">🚨 Emergency alert</h1>
    <p style="font-size:16px;margin:0 0 16px">
      <strong>${opts.elderName}</strong> has triggered an SOS alert.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
      <tr><td style="padding:6px 0;color:#666">Type</td><td style="padding:6px 0"><strong>${opts.alertType}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666">Message</td><td style="padding:6px 0">${opts.message}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Time</td><td style="padding:6px 0">${opts.timestamp}</td></tr>
    </table>
    ${opts.mapsUrl ? `<p><a href="${opts.mapsUrl}" style="display:inline-block;background:#b91c1c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">View live location</a></p>` : ""}
    <p style="color:#666;font-size:12px;margin-top:24px">Sent by ElderCare Connect</p>
  </div>`;
}

export const notifySosAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      alertId: z.string().uuid(),
      alertType: z.string().default("manual"),
      emergencyContactEmails: z.array(z.string().email()).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    // ── Load alert (verify caller has access) ─────────────────────────────
    const { data: alert, error: alertErr } = await context.supabase
      .from("sos_alerts")
      .select("id, parent_id, message, created_at, latitude, longitude")
      .eq("id", data.alertId)
      .single();
    if (alertErr || !alert) throw new Error("Alert not found or not accessible");

    // ── Elder profile ─────────────────────────────────────────────────────
    // FIX: Use context.supabase instead of supabaseAdmin so SERVICE_ROLE_KEY
    // is not required. The authenticated user can view linked profiles.
    const { data: elder } = await context.supabase
      .from("profiles")
      .select("full_name")
      .eq("id", alert.parent_id)
      .maybeSingle();
    const elderName = elder?.full_name || "Your family member";

    // ── Find linked caregivers (children) ────────────────────────────────
    const { data: links } = await context.supabase
      .from("parent_child_links")
      .select("child_id")
      .eq("parent_id", alert.parent_id);
    const childIds = (links ?? []).map((l) => l.child_id);
    if (childIds.length === 0) return { sent: 0, failed: 0, recipients: 0, skipped: "no_linked_children" };

    // ── FIX: Resolve recipient emails from profiles.email ─────────────────
    // This avoids needing supabaseAdmin (SERVICE_ROLE_KEY) entirely.
    // profiles.email is populated on sign-up by the database trigger.
    // Falls back to supabaseAdmin.auth.admin if SERVICE_ROLE_KEY is available.
    const recipients: string[] = [];

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      // Admin path: look up auth emails (most reliable)
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      for (const id of childIds) {
        try {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
          if (u?.user?.email) recipients.push(u.user.email);
        } catch {
          // fall through to profile email below
        }
      }
    }

    // If admin path didn't work (no SERVICE_ROLE_KEY or admin failed),
    // fall back to profiles.email — readable via authenticated RLS
    if (recipients.length === 0 && childIds.length > 0) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("id, email")
        .in("id", childIds);
      for (const p of profiles ?? []) {
        if (p.email) recipients.push(p.email);
      }
    }

    // Also include emergency contact emails passed from the client
    if (data.emergencyContactEmails && data.emergencyContactEmails.length > 0) {
      for (const email of data.emergencyContactEmails) {
        if (!recipients.includes(email)) {
          recipients.push(email);
        }
      }
    }

    if (recipients.length === 0) {
      return { sent: 0, failed: 0, recipients: 0, skipped: "no_email_addresses_found" };
    }

    const timestamp = new Date(alert.created_at).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const mapsUrl =
      alert.latitude != null && alert.longitude != null
        ? `https://www.google.com/maps?q=${alert.latitude},${alert.longitude}`
        : null;
    const html = buildHtml({
      elderName,
      alertType: data.alertType,
      message: alert.message ?? "Emergency triggered",
      timestamp,
      mapsUrl,
    });
    const subject = `🚨 SOS from ${elderName}`;

    // Notification logs (best-effort — doesn't block if table is missing)
    const logsClient = serviceKey
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : context.supabase;
    const logs = (logsClient as any).from("notification_logs");

    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      let attempt = 0;
      let lastError: string | null = null;
      let success = false;
      while (attempt < 2 && !success) {
        attempt++;
        try {
          await sendEmail(to, subject, html);
          success = true;
          await logs.insert({
            alert_id: data.alertId,
            channel: "email",
            recipient: to,
            status: "sent",
            attempt,
          }).catch(() => {}); // don't throw if logging fails
          sent++;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      if (!success) {
        failed++;
        await logs.insert({
          alert_id: data.alertId,
          channel: "email",
          recipient: to,
          status: "failed",
          error: lastError,
          attempt,
        }).catch(() => {});
      }
    }

    return { sent, failed, recipients: recipients.length };
  });
