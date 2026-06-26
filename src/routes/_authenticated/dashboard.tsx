import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent, useLinkedChildren } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Heart, Siren, MapPin, ShieldAlert } from "lucide-react";
import { useVoiceReminders } from "@/hooks/useVoiceReminders";
import { useServerFn } from "@tanstack/react-start";
import { notifySosAlert } from "@/lib/api/sosNotify.functions";
import { sendPushForAlert } from "@/lib/api/pushNotify.functions";
import { WellbeingCheckCard } from "@/components/WellbeingCheckCard";
import { captureLocation, reverseGeocode } from "@/lib/geolocation";
import { useState, useEffect, useRef } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  component: DashboardPage,
});

function DashboardPage() {
  const { activeParent, activeParentId, profile, isChildView } = useActiveParent();
  const { data: linkedChildren = [] } = useLinkedChildren(profile?.role === "parent" ? profile?.id : undefined);
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const notifyEmail = useServerFn(notifySosAlert);
  const notifyPush = useServerFn(sendPushForAlert);

  // Local cooldown state for the SOS trigger button
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const startCooldown = (seconds: number) => {
    setCooldown(seconds);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const { data: medicines } = useQuery({
    queryKey: ["medicines", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("medicines")
        .select("*")
        .eq("parent_id", activeParentId!)
        .eq("active", true)
        .order("schedule_time");
      return data ?? [];
    },
  });

  const { data: logs } = useQuery({
    queryKey: ["medLogs", activeParentId, today],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("medicine_logs")
        .select("medicine_id")
        .eq("parent_id", activeParentId!)
        .eq("log_date", today);
      return new Set((data ?? []).map((l) => l.medicine_id));
    },
  });

  // Speak medicine reminders for the parent on their own device
  useVoiceReminders(medicines, logs, !isChildView);

  const { data: nextBooking } = useQuery({
    queryKey: ["nextBooking", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("caregiver_bookings")
        .select("*")
        .eq("parent_id", activeParentId!)
        .in("status", ["pending", "confirmed"])
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: recentReports } = useQuery({
    queryKey: ["recentReports", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("health_records")
        .select("*")
        .eq("parent_id", activeParentId!)
        .order("record_date", { ascending: false })
        .limit(3);
      return data ?? [];
    },
  });

  const { data: wellbeing } = useQuery({
    queryKey: ["wellbeing", activeParentId, today],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("wellbeing_checks")
        .select("*")
        .eq("parent_id", activeParentId!)
        .eq("check_date", today)
        .maybeSingle();
      return data;
    },
  });

  // Real-time synchronization subscription
  useEffect(() => {
    if (!activeParentId) return;
    const channel = supabase
      .channel(`dashboard-sync-${activeParentId}-${Math.random().toString(36).substr(2, 9)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wellbeing_checks",
          filter: `parent_id=eq.${activeParentId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["wellbeing", activeParentId] });
          qc.invalidateQueries({ queryKey: ["wellbeing-history", activeParentId] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "medicine_logs",
          filter: `parent_id=eq.${activeParentId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["medLogs", activeParentId] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vitals",
          filter: `parent_id=eq.${activeParentId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["vitals", activeParentId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeParentId, today, qc]);

  const markTaken = useMutation({
    mutationFn: async (medId: string) => {
      const { error } = await supabase.from("medicine_logs").insert({
        medicine_id: medId,
        parent_id: activeParentId!,
        log_date: today,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as taken");
      qc.invalidateQueries({ queryKey: ["medLogs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const triggerSOS = useMutation({
    mutationFn: async () => {
      if (cooldown > 0) {
        throw new Error("__cooldown__");
      }

      // 1. Edge case: No linked children
      if (linkedChildren.length === 0) {
        throw new Error("No linked family member available.");
      }

      // Check for active alerts in the last 10 seconds to prevent double clicks
      const { data: recentActive } = await supabase
        .from("sos_alerts")
        .select("id, created_at")
        .eq("parent_id", profile!.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);

      if (recentActive && recentActive.length > 0) {
        const elapsed = Date.now() - new Date(recentActive[0].created_at).getTime();
        if (elapsed < 10000) {
          throw new Error("__cooldown__");
        }
      }

      // 2. Geolocation capture and Nominatim geocoding
      let coords = null;
      let addressStr = null;
      try {
        coords = await captureLocation(4000);
        if (coords) {
          addressStr = await reverseGeocode(coords.latitude, coords.longitude, 3000);
        }
      } catch (err) {
        console.error("SOS capture location failed:", err);
      }

      // 3. Insert SOS record
      const { data: inserted, error } = await supabase
        .from("sos_alerts")
        .insert({
          parent_id: profile!.id,
          parent_name: profile!.full_name || "Parent",
          message: "Emergency Assistance Requested from Dashboard",
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          address: addressStr ?? "Location unavailable.",
          status: "active",
        } as any)
        .select("id")
        .single();

      if (error) throw error;

      // 4. Notifications
      let emailResult = null;
      let pushResult = null;

      if (inserted?.id) {
        try {
          emailResult = await notifyEmail({ data: { alertId: inserted.id, alertType: "manual" } });
        } catch (e) {
          console.error("SOS email notification failed:", e);
        }
        try {
          pushResult = await notifyPush({ data: { alertId: inserted.id, alertType: "manual" } });
        } catch (e) {
          console.error("SOS push notification failed:", e);
        }

        // Insert in-app notification for each linked child
        if (linkedChildren.length > 0) {
          const childNotifs = linkedChildren.map((child) => ({
            parent_id: child.id,          // recipient = child
            sender_id: profile!.id,
            type: "sos",
            notification_type: "sos",
            message: `Emergency Alert: ${profile!.full_name || "Your parent"} has requested immediate assistance.`,
            is_read: false,
            metadata: {
              alert_id: inserted.id,
              parent_name: profile!.full_name,
              triggered_at: new Date().toISOString(),
            },
          }));
          try {
            await supabase.from("parent_notifications").insert(childNotifs as any);
          } catch (e) {
            console.error("SOS child notification insert failed:", e);
          }
        }
      }
      return { emailResult, pushResult };
    },
    onSuccess: () => {
      startCooldown(10);
      toast.success("Emergency alert sent successfully.");
      qc.invalidateQueries({ queryKey: ["sos"] });
    },
    onError: (e: Error) => {
      if (e.message === "__cooldown__") {
        toast.warning("Please wait a moment before sending another alert.");
      } else if (e.message.includes("No linked family member")) {
        toast.error("No linked family member available.");
      } else {
        toast.error("Unable to send emergency alert. Please try again.");
      }
    },
  });

  const { data: activeSosAlert } = useQuery({
    queryKey: ["activeSosDashboard", activeParentId],
    enabled: !!activeParentId && isChildView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sos_alerts")
        .select("*")
        .eq("parent_id", activeParentId!)
        .in("status", ["active", "acknowledged"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const acknowledgeSos = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("sos_alerts")
        .update({
          status: "acknowledged",
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: profile!.id,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alert acknowledged successfully.");
      qc.invalidateQueries({ queryKey: ["sos"] });
      qc.invalidateQueries({ queryKey: ["activeSosDashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveSos = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("sos_alerts")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: profile!.id,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Emergency alert marked resolved.");
      qc.invalidateQueries({ queryKey: ["sos"] });
      qc.invalidateQueries({ queryKey: ["activeSosDashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!activeParent) {
    return (
      <AppShell>
        <div className="rounded-3xl border border-border bg-card p-12 text-center">
          <Heart className="size-10 mx-auto text-primary mb-4" />
          <h2 className="font-display text-2xl font-bold mb-2">
            {isChildView ? "Connect to a parent" : "Welcome to ElderCare"}
          </h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            {isChildView
              ? "Ask your parent for their invite code, then link your account on the Family page to start monitoring their care."
              : `Your invite code is ${profile?.invite_code}. Share it with family members on the Family page so they can join.`}
          </p>
          <Link to="/family"><Button className="rounded-xl">Open Family page</Button></Link>
        </div>
      </AppShell>
    );
  }

  const allTaken = medicines && medicines.length > 0 && logs && medicines.every((m) => logs.has(m.id));

  return (
    <AppShell>
      {/* Child SOS Emergency Banner */}
      {isChildView && activeSosAlert && (
        <div className="mb-8 bg-red-50 border-2 border-red-200 rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-red-500/5 animate-pulse-slow">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-2xl bg-red-100 text-red-600 grid place-items-center shrink-0">
              <Siren className="size-6" />
            </div>
            <div>
              <h3 className="font-bold text-red-900 text-base">Emergency Assistance requested by Parent</h3>
              <p className="text-sm text-red-700 font-medium mt-0.5">
                Triggered by {activeSosAlert.parent_name || activeParent?.full_name} at {format(new Date(activeSosAlert.created_at), "h:mm a")}
              </p>
              {activeSosAlert.address && (
                <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1.5 font-medium">
                  <MapPin className="size-4 shrink-0" />
                  {activeSosAlert.address}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <Link to="/sos">
              <Button variant="outline" size="sm" className="bg-white hover:bg-stone-50 text-stone-800 rounded-xl text-xs h-8 cursor-pointer">
                Open Details
              </Button>
            </Link>
            {activeSosAlert.status === "active" && (
              <Button
                size="sm"
                onClick={() => acknowledgeSos.mutate(activeSosAlert.id)}
                disabled={acknowledgeSos.isPending}
                className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs h-8 cursor-pointer"
              >
                Acknowledge
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => resolveSos.mutate(activeSosAlert.id)}
              disabled={resolveSos.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs h-8 cursor-pointer"
            >
              Resolve
            </Button>
          </div>
        </div>
      )}

      {/* Warning Banner: No linked child */}
      {!isChildView && linkedChildren.length === 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-3xl p-4 flex items-start gap-3 text-amber-800">
          <ShieldAlert className="size-5 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-semibold">No linked family member available.</span> You must link a child account on the Family page before triggering emergency alerts.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          {/* SOS + Vitals */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <button
              onClick={() => triggerSOS.mutate()}
              disabled={isChildView || triggerSOS.isPending || cooldown > 0}
              className={`sm:col-span-1 p-6 rounded-3xl shadow-xl flex flex-col justify-between aspect-square hover:scale-[1.02] transition-all disabled:opacity-60 disabled:cursor-not-allowed text-left select-none relative overflow-hidden cursor-pointer ${
                cooldown > 0
                  ? "bg-stone-500 text-white shadow-stone-500/10 cursor-not-allowed"
                  : "bg-red-600 text-white shadow-red-600/30"
              }`}
              style={cooldown === 0 && !isChildView ? { animation: "siren-pulse 2s infinite ease-in-out" } : {}}
            >
              <div className="size-12 rounded-full border-2 border-white/30 flex items-center justify-center text-xl font-bold">
                {cooldown > 0 ? cooldown : <Siren className="size-5" />}
              </div>
              <div>
                <p className="text-4xl font-bold font-display tracking-tight leading-none">
                  {cooldown > 0 ? "SENT" : "SOS"}
                </p>
                <p className="text-white/80 text-xs mt-1 font-medium">
                  {cooldown > 0 ? "Cooldown active" : "🔴 Emergency Assistance"}
                </p>
              </div>
            </button>

            <StatCard label="Wellbeing" value={wellbeing?.feeling ?? "—"} sub={wellbeing ? "Today's check-in" : "Not yet today"} />
            <StatCard label="Medicines" value={medicines ? `${medicines.length - (logs?.size ?? 0)}/${medicines.length}` : "—"} sub={allTaken ? "All taken today" : "Remaining today"} />
          </div>

          {/* Today's Schedule */}
          <section className="bg-card border border-border rounded-3xl overflow-hidden shadow-sm">
            <div className="p-6 border-b border-border flex justify-between items-end">
              <h2 className="text-2xl font-display font-bold italic">Today's Schedule</h2>
              <span className="text-xs font-mono text-muted-foreground uppercase">{format(new Date(), "MMMM d, yyyy")}</span>
            </div>
            <div className="divide-y divide-border">
              {!medicines || medicines.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  No medicines added yet. <Link to="/medicines" className="text-primary font-medium">Add one →</Link>
                </div>
              ) : (
                medicines.map((m) => {
                  const taken = logs?.has(m.id);
                  return (
                    <div key={m.id} className={`p-6 flex items-center gap-6 group hover:bg-stone-50 transition-colors ${taken ? "opacity-60" : ""}`}>
                      <button
                        disabled={taken || markTaken.isPending || isChildView}
                        onClick={() => markTaken.mutate(m.id)}
                        className={`size-6 rounded border-2 flex items-center justify-center transition-colors ${
                          taken ? "border-secondary bg-secondary/10 text-secondary" : "border-stone-300 hover:border-primary"
                        }`}
                      >
                        {taken && <div className="size-2 bg-secondary rounded-sm" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold">{m.name} {m.dosage && <span className="text-muted-foreground font-normal">({m.dosage})</span>}</p>
                        <p className="text-sm text-muted-foreground italic">
                          {taken ? "Taken today" : `Scheduled for ${m.schedule_time?.slice(0, 5)}`}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-stone-100 px-2 py-1 rounded capitalize">{m.period}</span>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Wellbeing Check */}
          <WellbeingCheckCard parentId={activeParentId!} isChild={isChildView} existing={wellbeing} />
        </div>

        <aside className="lg:col-span-4 space-y-8">
          {/* Next Appointment */}
          <div className="bg-stone-900 text-white p-8 rounded-3xl shadow-xl">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-4 block">Upcoming Visit</span>
            {nextBooking ? (
              <>
                <p className="text-2xl font-display font-bold mb-1 capitalize">{nextBooking.caregiver_type}</p>
                <p className="text-white/60 text-sm mb-6">{nextBooking.notes ?? "Scheduled visit"}</p>
                <div className="flex items-center gap-3 bg-white/10 p-4 rounded-2xl">
                  <div className="size-10 rounded-xl bg-white/20 flex items-center justify-center text-sm">
                    {format(new Date(nextBooking.scheduled_at), "d")}
                  </div>
                  <div>
                    <p className="font-semibold">{format(new Date(nextBooking.scheduled_at), "EEE, h:mm a")}</p>
                    <p className="text-xs text-white/40 capitalize">{nextBooking.status}</p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-xl font-display font-bold mb-1">No visits scheduled</p>
                <p className="text-white/60 text-sm mb-6">Book a nurse, physiotherapist or companion.</p>
                <Link to="/caregivers"><Button variant="secondary" className="bg-white/10 hover:bg-white/20 text-white rounded-xl">Book a visit</Button></Link>
              </>
            )}
          </div>

          {/* Recent reports */}
          <section className="space-y-4">
            <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest px-2">Recent Health Reports</h3>
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              {!recentReports || recentReports.length === 0 ? (
                <div className="p-5 text-sm text-muted-foreground">No reports yet.</div>
              ) : (
                recentReports.map((r, i) => (
                  <div key={r.id} className={`p-4 flex items-center justify-between hover:bg-stone-50 transition-colors ${i < recentReports.length - 1 ? "border-b border-border" : ""}`}>
                    <span className="text-sm">{r.title}</span>
                    <span className="text-[10px] font-mono text-muted-foreground uppercase">{format(new Date(r.record_date), "MMM d")}</span>
                  </div>
                ))
              )}
            </div>
            <Link to="/records" className="text-xs font-mono text-primary px-2">View all →</Link>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card border border-border p-6 rounded-3xl flex flex-col justify-between min-h-[140px]">
      <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{label}</span>
      <div>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        <p className="text-secondary text-sm font-medium mt-1">{sub}</p>
      </div>
    </div>
  );
}


