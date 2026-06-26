import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format, isAfter, isBefore, addHours, parseISO } from "date-fns";

interface UseNotificationEngineOptions {
  parentId: string | null;
  userId: string | null;
  isChildView: boolean;
}

/**
 * Auto-generates notifications for:
 * 1. Missed medicines (scheduled time passed, not marked taken today)
 * 2. Upcoming appointment reminders (within 24 hours)
 *
 * Runs once on mount for the active parent session.
 * Uses metadata.dedup_key to prevent duplicate notifications on re-renders/refreshes.
 */
export function useNotificationEngine({
  parentId,
  userId,
  isChildView,
}: UseNotificationEngineOptions) {
  const ranRef = useRef(false);

  useEffect(() => {
    // Only run for parents about their own account, or children viewing a parent
    if (!parentId || !userId) return;
    // Don't re-run on the same mount cycle
    if (ranRef.current) return;
    ranRef.current = true;

    runEngine(parentId, userId).catch(console.error);
  }, [parentId, userId, isChildView]);
}

async function runEngine(parentId: string, userId: string) {
  const today = format(new Date(), "yyyy-MM-dd");
  const now = new Date();

  await Promise.all([
    checkMissedMedicines(parentId, userId, today, now),
    checkAppointmentReminders(parentId, userId, now),
  ]);
}

// ── Missed Medicines ──────────────────────────────────────────────────────────

async function checkMissedMedicines(
  parentId: string,
  userId: string,
  today: string,
  now: Date
) {
  // Fetch active medicines for today
  const { data: medicines, error: medErr } = await supabase
    .from("medicines")
    .select("id, name, dosage, schedule_time, period")
    .eq("parent_id", parentId)
    .eq("active", true);

  if (medErr || !medicines || medicines.length === 0) return;

  // Fetch what's already been taken today
  const { data: logs } = await supabase
    .from("medicine_logs")
    .select("medicine_id")
    .eq("parent_id", parentId)
    .eq("log_date", today);

  const takenSet = new Set((logs ?? []).map((l) => l.medicine_id));

  // Find missed: schedule_time passed and not taken
  const missed = medicines.filter((m) => {
    if (takenSet.has(m.id)) return false;
    if (!m.schedule_time) return false;
    const [h, min] = m.schedule_time.split(":").map(Number);
    const scheduledToday = new Date();
    scheduledToday.setHours(h, min, 0, 0);
    // Only notify if the scheduled time has passed by at least 5 minutes
    return now.getTime() > scheduledToday.getTime() + 5 * 60 * 1000;
  });

  if (missed.length === 0) return;

  // Fetch existing missed-medicine notifications from today to dedup
  const { data: existingNotifs } = await supabase
    .from("parent_notifications")
    .select("metadata")
    .eq("parent_id", parentId)
    .eq("notification_type", "missed_medicine")
    .gte("created_at", `${today}T00:00:00.000Z`);

  const alreadyNotifiedIds = new Set(
    (existingNotifs ?? [])
      .map((n) => (n.metadata as any)?.medicine_id as string | undefined)
      .filter(Boolean)
  );

  const toInsert = missed
    .filter((m) => !alreadyNotifiedIds.has(m.id))
    .map((m) => {
      const timeLabel = m.schedule_time?.slice(0, 5) ?? "scheduled time";
      return {
        parent_id: parentId,
        sender_id: userId,
        type: "missed_medicine",
        notification_type: "missed_medicine",
        message: `Medication Reminder: ${m.name}${m.dosage ? ` ${m.dosage}` : ""} was missed at ${timeLabel}.`,
        is_read: false,
        metadata: { medicine_id: m.id, medicine_name: m.name, schedule_time: m.schedule_time },
      };
    });

  if (toInsert.length === 0) return;

  await supabase.from("parent_notifications").insert(toInsert as any);
}

// ── Appointment Reminders ─────────────────────────────────────────────────────

async function checkAppointmentReminders(
  parentId: string,
  userId: string,
  now: Date
) {
  const in24h = addHours(now, 24);

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("id, title, doctor_name, appointment_date, appointment_time, scheduled_at")
    .eq("parent_id", parentId)
    .in("status", ["pending", "confirmed", "scheduled"])
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", in24h.toISOString());

  if (error || !appointments || appointments.length === 0) return;

  // Fetch existing appointment reminders for today to dedup
  const today = format(now, "yyyy-MM-dd");
  const { data: existingNotifs } = await supabase
    .from("parent_notifications")
    .select("metadata")
    .eq("parent_id", parentId)
    .eq("notification_type", "appointment_reminder")
    .gte("created_at", `${today}T00:00:00.000Z`);

  const alreadyNotifiedApptIds = new Set(
    (existingNotifs ?? [])
      .map((n) => (n.metadata as any)?.appointment_id as string | undefined)
      .filter(Boolean)
  );

  const toInsert = appointments
    .filter((a) => !alreadyNotifiedApptIds.has(a.id))
    .map((a) => {
      const timeLabel = a.appointment_time
        ? ` at ${a.appointment_time.slice(0, 5)}`
        : "";
      const dateLabel = a.appointment_date
        ? format(parseISO(a.appointment_date), "MMM d")
        : "soon";
      return {
        parent_id: parentId,
        sender_id: userId,
        type: "appointment_reminder",
        notification_type: "appointment_reminder",
        message: `Appointment Reminder: ${a.title || "Appointment"} with ${a.doctor_name}${timeLabel} on ${dateLabel}.`,
        is_read: false,
        metadata: {
          appointment_id: a.id,
          title: a.title,
          doctor_name: a.doctor_name,
          appointment_date: a.appointment_date,
          appointment_time: a.appointment_time,
        },
      };
    });

  if (toInsert.length === 0) return;

  await supabase.from("parent_notifications").insert(toInsert as any);
}
