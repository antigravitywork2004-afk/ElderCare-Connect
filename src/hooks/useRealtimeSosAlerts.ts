import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Subscribes the current caregiver to realtime INSERTs on sos_alerts for all
 * linked parents. RLS still applies on the underlying SELECT — only alerts
 * the user is authorized to see arrive. Independent of email/push channels.
 *
 * @param parentIds  list of parent_ids the current user is linked to as caregiver.
 *                   Pass undefined while loading; the hook no-ops.
 * @param onAlert    optional handler invoked on each new alert. Defaults to a toast.
 */
export function useRealtimeSosAlerts(
  parentIds: string[] | undefined,
  onAlert?: (alert: {
    id: string;
    parent_id: string;
    message: string | null;
    created_at: string;
    latitude: number | null;
    longitude: number | null;
  }) => void,
) {
  const qc = useQueryClient();
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!parentIds || parentIds.length === 0) return;

    // One channel per mount, filtered to the user's linked parents.
    // We use `in.(...)` filter syntax supported by Realtime postgres_changes.
    const filter = `parent_id=in.(${parentIds.join(",")})`;

    const channel = supabase
      .channel(`sos-alerts-${parentIds.join("-")}-${Math.random().toString(36).substr(2, 9)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sos_alerts", filter },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new as {
            id: string;
            parent_id: string;
            message: string | null;
            created_at: string;
            latitude: number | null;
            longitude: number | null;
          };
          if (seen.current.has(row.id)) return;
          seen.current.add(row.id);

          qc.invalidateQueries({ queryKey: ["sos"] });
          qc.invalidateQueries({ queryKey: ["activeSosDashboard"] });
          qc.invalidateQueries({ queryKey: ["activeSosAlerts"] });

          if (onAlert) {
            onAlert(row);
          } else {
            toast.error("🚨 New SOS alert", {
              description: row.message ?? "Emergency triggered",
              duration: 15000,
              action: {
                label: "View",
                onClick: () => {
                  window.location.href = "/sos";
                },
              },
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [parentIds?.join(","), qc, onAlert]);
}
