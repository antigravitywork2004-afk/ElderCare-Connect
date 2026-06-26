import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent, useLinkedChildren, useProfile } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import { Siren, MapPin, Bell, BellOff, ShieldAlert, CheckCircle2, Clock, CalendarDays, Eye, Check } from "lucide-react";
import { captureLocation, mapsLink, reverseGeocode } from "@/lib/geolocation";
import { useServerFn } from "@tanstack/react-start";
import { notifySosAlert } from "@/lib/api/sosNotify.functions";
import { sendPushForAlert } from "@/lib/api/pushNotify.functions";
import { useRealtimeSosAlerts } from "@/hooks/useRealtimeSosAlerts";
import { EmergencyCallButtons } from "@/components/EmergencyCallButtons";
import { enablePushNotifications, disablePushNotifications, getPushPermission, isPushSupported } from "@/lib/push";
import { useEffect, useState, useRef } from "react";

export const Route = createFileRoute("/_authenticated/sos")({
  ssr: false,
  component: SOSPage,
});

type SOSAlert = {
  id: string;
  parent_id: string;
  parent_name: string | null;
  message: string | null;
  status: "active" | "acknowledged" | "resolved";
  created_at: string;
  resolved_at: string | null;
  alert_type: string;
  dedup_key: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  alert_timestamp: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_by: string | null;
};

function SOSPage() {
  const { activeParentId, activeParent, isChildView, profile } = useActiveParent();
  const { data: linkedChildren = [] } = useLinkedChildren(profile?.role === "parent" ? profile?.id : undefined);
  const qc = useQueryClient();
  const notifyEmail = useServerFn(notifySosAlert);
  const notifyPush = useServerFn(sendPushForAlert);

  // Realtime: caregivers (children) get instant invalidation for active alerts
  const caregiverParentIds = profile?.role === "child" ? (activeParentId ? [activeParentId] : []) : [];
  useRealtimeSosAlerts(caregiverParentIds);

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

  // Push permission UI
  const [pushState, setPushState] = useState<string>("loading");
  useEffect(() => {
    setPushState(getPushPermission());
  }, []);

  async function togglePush() {
    if (pushState === "granted") {
      await disablePushNotifications();
      setPushState(getPushPermission());
      toast.success("Push notifications disabled");
      return;
    }
    const r = await enablePushNotifications();
    setPushState(getPushPermission());
    if (r.ok) toast.success("Push notifications enabled");
    else toast.error(r.reason || "Could not enable push");
  }

  // Fetch profiles of users involved (parents & children)
  const { data: userProfiles = [] } = useQuery({
    queryKey: ["profiles-lookup"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name");
      return data ?? [];
    },
  });

  const getProfileName = (id: string | null) => {
    if (!id) return null;
    return userProfiles.find((p) => p.id === id)?.full_name ?? "Unknown Family Member";
  };

  // Fetch alerts depending on view
  const { data: alerts = [] } = useQuery({
    queryKey: ["sos", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      let query = supabase.from("sos_alerts").select("*");
      if (profile?.role === "child") {
        // Child views alerts for the active parent
        query = query.eq("parent_id", activeParentId!);
      } else {
        // Parent views their own alerts
        query = query.eq("parent_id", profile!.id);
      }
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SOSAlert[];
    },
  });

  const { data: emergencyContacts = [] } = useQuery({
    queryKey: ["emergency_contacts", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("emergency_contacts")
        .select("id,name,phone,relationship,priority")
        .eq("parent_id", activeParentId!)
        .order("priority", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; phone: string | null; relationship: string | null; priority: number }>;
    },
  });

  // SOS Trigger Mutation for Parent
  const trigger = useMutation({
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

      // 2. Geolocation logic
      let coords = null;
      let addressStr = null;
      try {
        coords = await captureLocation(4000); // 4 seconds timeout
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
          message: "Emergency Assistance Requested",
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          address: addressStr ?? "Location unavailable.",
          status: "active",
        } as any)
        .select("id")
        .single();

      if (error) throw error;

      // 4. Dispatch Email and Push notifications via Server Functions
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

      return { coords, addressStr, emailResult, pushResult };
    },
    onSuccess: (res) => {
      startCooldown(10); // Start 10-second button freeze
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

  // Acknowledge Alert Mutation for Child
  const acknowledge = useMutation({
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
      qc.invalidateQueries({ queryKey: ["activeSosAlerts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Resolve Alert Mutation for Parent/Child
  const resolve = useMutation({
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
      qc.invalidateQueries({ queryKey: ["activeSosAlerts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Derived alert statuses
  const activeAlerts = alerts.filter((a) => a.status === "active" || a.status === "acknowledged");
  const resolvedAlerts = alerts.filter((a) => a.status === "resolved");

  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold italic">Emergency SOS</h1>
          <p className="text-muted-foreground mt-1">
            {isChildView ? `Emergency assistance monitoring for ${activeParent?.full_name ?? "—"}` : "One tap notifies linked family members"}
          </p>
        </div>
        {isPushSupported() && (
          <Button variant="outline" size="sm" onClick={togglePush} className="shrink-0 rounded-xl cursor-pointer">
            {pushState === "granted" ? (
              <>
                <BellOff className="size-4 mr-2" />
                Disable push
              </>
            ) : (
              <>
                <Bell className="size-4 mr-2" />
                Enable push alerts
              </>
            )}
          </Button>
        )}
      </div>

      {/* Role-specific content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Parent SOS Trigger Action Area */}
        {!isChildView && (
          <div className="lg:col-span-12 space-y-6">
            
            {/* Warning Banner: No linked child */}
            {linkedChildren.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 flex items-start gap-4 text-amber-800">
                <ShieldAlert className="size-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">No linked family member available</p>
                  <p className="text-xs mt-1">You must link a child account on the Family page before you can trigger emergency notifications.</p>
                </div>
              </div>
            )}

            {/* Giant SOS Siren Button */}
            <button
              onClick={() => trigger.mutate()}
              disabled={trigger.isPending || cooldown > 0}
              className={`w-full text-white rounded-3xl p-8 sm:p-14 shadow-2xl transition-all relative overflow-hidden group select-none cursor-pointer ${
                cooldown > 0
                  ? "bg-stone-500 shadow-stone-500/10 cursor-not-allowed"
                  : "bg-red-600 shadow-red-600/30 hover:scale-[1.01] active:scale-[0.99]"
              }`}
              style={cooldown === 0 ? { animation: "siren-pulse 2s infinite ease-in-out" } : {}}
            >
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
                <div className={`size-16 sm:size-24 rounded-full border-4 border-white/30 grid place-items-center shrink-0 ${cooldown === 0 && "animate-spin-slow"}`}>
                  <Siren className="size-8 sm:size-12" />
                </div>
                <div className="text-center sm:text-left">
                  <p className="font-display text-3xl sm:text-5xl font-black tracking-tight uppercase">
                    {cooldown > 0 ? `SOS SENT (${cooldown}s)` : trigger.isPending ? "SENDING..." : "SEND SOS"}
                  </p>
                  <p className="text-white/80 text-sm mt-1.5 font-medium">
                    {cooldown > 0
                      ? "Cooldown active to prevent duplicate triggers."
                      : "Tap to alert all linked family members instantly"}
                  </p>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Child Monitoring - Active Alert details screen */}
        {isChildView && (
          <div className="lg:col-span-12 space-y-6">
            {activeAlerts.length > 0 ? (
              <div className="space-y-6">
                <h2 className="font-display text-2xl font-bold text-destructive flex items-center gap-2">
                  <Siren className="size-6 animate-pulse" />
                  Active Emergency Request
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {activeAlerts.map((alert) => (
                    <div key={alert.id} className="bg-red-50/50 border-2 border-red-200 rounded-3xl p-6 shadow-lg shadow-red-500/5 relative overflow-hidden">
                      <div className="absolute right-0 top-0 size-24 bg-red-100 rounded-bl-full flex items-center justify-center opacity-40">
                        <Siren className="size-10 text-red-500" />
                      </div>
                      
                      <div className="space-y-4">
                        {/* Parent Info */}
                        <div>
                          <span className="text-[10px] font-mono uppercase tracking-widest text-red-600 font-semibold block mb-1">Parent</span>
                          <h3 className="text-xl font-bold text-stone-900">{alert.parent_name || getProfileName(alert.parent_id)}</h3>
                        </div>

                        {/* Emergency Info */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-0.5">Date & Time</span>
                            <p className="text-sm font-semibold flex items-center gap-1.5">
                              <CalendarDays className="size-4 text-stone-500" />
                              {format(new Date(alert.created_at), "MMM d, yyyy")}
                            </p>
                            <p className="text-sm font-semibold flex items-center gap-1.5 mt-1">
                              <Clock className="size-4 text-stone-500" />
                              {format(new Date(alert.created_at), "h:mm a")}
                            </p>
                          </div>
                          <div>
                            <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-0.5">Status</span>
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                              alert.status === "active" ? "bg-red-100 text-red-700 animate-pulse" : "bg-amber-100 text-amber-700"
                            }`}>
                              <span className={`size-1.5 rounded-full ${alert.status === "active" ? "bg-red-600" : "bg-amber-500"}`} />
                              {alert.status}
                            </span>
                          </div>
                        </div>

                        {/* Geolocation/Location */}
                        <div>
                          <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500 block mb-1">Location</span>
                          {alert.latitude != null && alert.longitude != null ? (
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-stone-800 bg-white/80 border border-red-100 p-2.5 rounded-xl flex items-start gap-2">
                                <MapPin className="size-4 text-red-500 shrink-0 mt-0.5" />
                                <span>{alert.address || "Fetching address..."}</span>
                              </p>
                              <a
                                href={mapsLink(alert.latitude, alert.longitude)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 text-xs font-semibold text-red-600 hover:text-red-700 hover:underline"
                              >
                                View map coordinates ({alert.latitude.toFixed(5)}, {alert.longitude.toFixed(5)}) →
                              </a>
                            </div>
                          ) : (
                            <p className="text-sm font-medium text-stone-500 italic bg-white/60 p-2.5 rounded-xl flex items-center gap-2">
                              <ShieldAlert className="size-4 text-stone-400 shrink-0" />
                              Location unavailable.
                            </p>
                          )}
                        </div>

                        {/* Audit Details */}
                        {alert.status === "acknowledged" && (
                          <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-800 flex items-center gap-2">
                            <Eye className="size-4 shrink-0 text-amber-500" />
                            <span>
                              Acknowledged by <strong>{getProfileName(alert.acknowledged_by)}</strong> at {format(new Date(alert.acknowledged_at!), "h:mm a")}
                            </span>
                          </div>
                        )}

                        {/* Status Actions */}
                        <div className="flex gap-3 pt-2">
                          {alert.status === "active" && (
                            <Button
                              onClick={() => acknowledge.mutate(alert.id)}
                              disabled={acknowledge.isPending}
                              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs h-9 cursor-pointer"
                            >
                              <Eye className="size-4 mr-1.5" />
                              Acknowledge
                            </Button>
                          )}
                          <Button
                            onClick={() => resolve.mutate(alert.id)}
                            disabled={resolve.isPending}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs h-9 cursor-pointer"
                          >
                            <Check className="size-4 mr-1.5" />
                            Mark Resolved
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 flex items-center gap-4 text-emerald-800">
                <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />
                <div>
                  <h3 className="font-semibold text-base">All clear</h3>
                  <p className="text-sm mt-0.5">No active emergency alerts at this time.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Parent & Child Call Buttons */}
        <div className="lg:col-span-12">
          <EmergencyCallButtons
            caregivers={(linkedChildren ?? []).map((c: { id: string; full_name: string | null; phone?: string | null }) => ({
              id: c.id,
              name: c.full_name,
              phone: c.phone ?? null,
            }))}
            emergencyContacts={emergencyContacts.map((c) => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              relation: c.relationship,
            }))}
            profileEmergency={
              activeParent
                ? {
                    name: activeParent.emergency_contact_name ?? null,
                    phone: activeParent.emergency_contact_phone ?? null,
                  }
                : null
            }
          />
        </div>

        {/* Parent / Child History Logs */}
        <div className="lg:col-span-12">
          <h2 className="font-display text-2xl font-bold italic mb-4">
            {isChildView ? `Emergency History for ${activeParent?.full_name ?? "—"}` : "My Emergency History"}
          </h2>
          <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-sm">
            {resolvedAlerts.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground text-sm font-medium">No previous alerts found.</div>
            ) : (
              <div className="divide-y divide-border">
                {resolvedAlerts.map((alert) => (
                  <div key={alert.id} className="p-6 hover:bg-stone-50/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="size-11 rounded-2xl bg-stone-100 text-stone-500 grid place-items-center shrink-0 mt-0.5">
                        <Siren className="size-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-stone-900">{alert.parent_name || getProfileName(alert.parent_id)}</p>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-stone-100 text-stone-600 font-semibold uppercase tracking-wider">
                            RESOLVED
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <CalendarDays className="size-3.5" />
                          {format(new Date(alert.created_at), "MMM d, yyyy")}
                          <Clock className="size-3.5 ml-1.5" />
                          {format(new Date(alert.created_at), "h:mm a")}
                        </p>
                        {alert.latitude != null && alert.longitude != null && (
                          <p className="text-xs text-stone-600 flex items-start gap-1">
                            <MapPin className="size-3.5 text-stone-400 shrink-0 mt-0.5" />
                            <span>{alert.address || `${alert.latitude.toFixed(5)}, ${alert.longitude.toFixed(5)}`}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-left md:text-right text-xs text-stone-500 bg-stone-50 border border-stone-100 p-3 rounded-2xl md:min-w-[280px]">
                      {alert.acknowledged_by && (
                        <p className="mb-1">
                          👁️ Acknowledged by: <strong>{getProfileName(alert.acknowledged_by)}</strong> at {format(new Date(alert.acknowledged_at!), "h:mm a")}
                        </p>
                      )}
                      {alert.resolved_by && (
                        <p>
                          ✅ Resolved by: <strong>{getProfileName(alert.resolved_by)}</strong> at {format(new Date(alert.resolved_at!), "h:mm a")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
      </div>
    </AppShell>
  );
}
