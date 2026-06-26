import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TransportRealtimePayload = {
  eventType: "INSERT" | "UPDATE";
  old: Record<string, any>;
  new: Record<string, any>;
};

/**
 * Subscribes to realtime INSERT and UPDATE events on transport_bookings
 * for the active parent.
 *
 * Prerequisites (already applied via migration 20260621080000_transport_realtime.sql):
 *   - ALTER TABLE public.transport_bookings REPLICA IDENTITY FULL;
 *   - ALTER PUBLICATION supabase_realtime ADD TABLE public.transport_bookings;
 *
 * @param parentId  the active parent's ID to filter by.
 *                  Pass undefined/null while loading; the hook no-ops.
 * @param onUpdate  optional handler invoked on each INSERT or UPDATE.
 */
export function useRealtimeTransportBookings(
  parentId: string | null | undefined,
  onUpdate?: (payload: TransportRealtimePayload) => void,
) {
  const qc = useQueryClient();
  const onUpdateRef = useRef(onUpdate);

  // Keep callback reference updated without triggering effect re-runs
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!parentId) return;

    const filter = `parent_id=eq.${parentId}`;

    // Unique channel name on every mount prevents "Cannot add callback after subscribe"
    // collisions when the component remounts (e.g. page navigation).
    const channel = supabase
      .channel(`transport-bookings-${parentId}-${Math.random().toString(36).substr(2, 9)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transport_bookings",
          filter,
        },
        (payload: any) => {
          // Invalidate transport list so new booking appears immediately
          qc.invalidateQueries({ queryKey: ["transport"] });

          if (onUpdateRef.current) {
            onUpdateRef.current({ eventType: "INSERT", old: payload.old ?? {}, new: payload.new });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "transport_bookings",
          filter,
        },
        (payload: any) => {
          const newRow = payload.new as Record<string, any>;
          const oldRow = payload.old as Record<string, any>;

          // Invalidate transport list for status/field changes
          qc.invalidateQueries({ queryKey: ["transport"] });

          // If driver_id was just assigned, also refresh driver profiles
          if (newRow?.driver_id && newRow.driver_id !== oldRow?.driver_id) {
            qc.invalidateQueries({ queryKey: ["driver-profiles"] });
          }

          if (onUpdateRef.current) {
            onUpdateRef.current({ eventType: "UPDATE", old: oldRow ?? {}, new: newRow });
          }
        },
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          // Connected — no action needed
          return;
        }
        if (status === "CHANNEL_ERROR") {
          console.warn("[transport-realtime] channel error:", err);
        }
        if (status === "TIMED_OUT") {
          console.warn("[transport-realtime] subscription timed out, Supabase will retry automatically");
        }
        if (status === "CLOSED") {
          // Channel closed cleanly — no action needed
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [parentId, qc]);
}
