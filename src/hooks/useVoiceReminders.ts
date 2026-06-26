import { useEffect, useRef } from "react";

type Medicine = {
  id: string;
  name: string;
  dosage?: string | null;
  schedule_time: string | null;
};

/**
 * Speaks a friendly reminder when a medicine's scheduled time arrives and it
 * hasn't been logged yet today. Runs only in the browser, only for the parent.
 */
export function useVoiceReminders(
  medicines: Medicine[] | undefined,
  takenIds: Set<string> | undefined,
  enabled: boolean,
) {
  const announced = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !medicines || typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;

    const tick = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const current = `${hh}:${mm}`;
      const dateKey = now.toISOString().slice(0, 10);

      for (const med of medicines) {
        if (!med.schedule_time) continue;
        const sched = med.schedule_time.slice(0, 5);
        if (sched !== current) continue;
        if (takenIds?.has(med.id)) continue;
        const key = `${dateKey}:${med.id}`;
        if (announced.current.has(key)) continue;
        announced.current.add(key);

        const text = `Reminder: it's time to take your ${med.name}${
          med.dosage ? `, ${med.dosage}` : ""
        }.`;
        try {
          const utter = new SpeechSynthesisUtterance(text);
          utter.rate = 0.95;
          utter.pitch = 1;
          window.speechSynthesis.speak(utter);
        } catch {
          // ignore
        }
      }
    };

    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [medicines, takenIds, enabled]);
}

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
  } catch {
    // ignore
  }
}
