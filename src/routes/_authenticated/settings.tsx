import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent, useCurrentUser } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/settings")({
  ssr: false,
  component: SettingsPage,
});

type Settings = {
  parent_id: string;
  notify_email: boolean;
  notify_push: boolean;
  notify_sms: boolean;
  med_reminders_enabled: boolean;
  med_reminder_lead_minutes: number;
  med_voice_reminders: boolean;
  sos_escalation_minutes: number;
  sos_auto_call_primary: boolean;
  sos_share_location: boolean;
  preferred_contact_method: string;
  language: string;
  large_text: boolean;
  high_contrast: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
};

const DEFAULTS: Omit<Settings, "parent_id"> = {
  notify_email: true,
  notify_push: true,
  notify_sms: false,
  med_reminders_enabled: true,
  med_reminder_lead_minutes: 10,
  med_voice_reminders: false,
  sos_escalation_minutes: 5,
  sos_auto_call_primary: false,
  sos_share_location: true,
  preferred_contact_method: "phone",
  language: "en",
  large_text: false,
  high_contrast: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
};

function SettingsPage() {
  const { activeParentId, activeParent } = useActiveParent();
  const { data: currentUser } = useCurrentUser();
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");

  // ── My Phone Number ──────────────────────────────────────────────────────
  // Root cause fix: use (supabase as any) to bypass stale type definitions
  // and also handle the case where the phone column may not yet exist on older
  // Supabase projects that haven't run the add_phone migration.
  const { data: myProfile } = useQuery({
    queryKey: ["myProfile", currentUser?.id],
    enabled: !!currentUser?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("phone")
        .eq("id", currentUser!.id)
        .single();
      if (error) throw error;
      return data as { phone: string | null } | null;
    },
  });

  useEffect(() => {
    if (myProfile?.phone !== undefined) setPhone(myProfile?.phone ?? "");
  }, [myProfile]);

  const savePhone = useMutation({
    mutationFn: async () => {
      if (!currentUser?.id) throw new Error("Not signed in");
      const trimmed = phone.trim() || null;
      // Validate format if provided
      if (trimmed && trimmed.replace(/[^0-9]/g, "").length < 7) {
        throw new Error("Please enter a valid phone number (at least 7 digits)");
      }
      // Use (supabase as any) to handle the phone column which may be absent
      // from auto-generated types if types.ts was not regenerated after migration.
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ phone: trimmed })
        .eq("id", currentUser.id);
      if (error) {
        // Surface the real error message for diagnosis
        throw new Error(error.message ?? "Failed to save phone number");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myProfile", currentUser?.id] });
      qc.invalidateQueries({ queryKey: ["profile", currentUser?.id] });
      qc.invalidateQueries({ queryKey: ["linkedChildren"] });
      qc.invalidateQueries({ queryKey: ["linkedParents"] });
      toast.success("Phone number saved.");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save phone number."),
  });

  // ── Elder Settings ────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["elder_settings", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("elder_settings")
        .select("*")
        .eq("parent_id", activeParentId!)
        .maybeSingle();
      if (error) throw new Error(error.message ?? "Failed to load settings");
      return (data ?? { ...DEFAULTS, parent_id: activeParentId! }) as Settings;
    },
  });

  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async (values: Settings) => {
      const { error } = await (supabase as any)
        .from("elder_settings")
        .upsert(values, { onConflict: "parent_id" });
      if (error) throw new Error(error.message ?? "Failed to save settings");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["elder_settings"] });
      toast.success("Settings saved.");
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to save settings"),
  });

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    if (form) setForm({ ...form, [k]: v });
  };

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold italic">Elder Settings</h1>
        <p className="text-muted-foreground mt-1">
          Preferences for {activeParent?.full_name ?? "—"}
        </p>
      </div>

      <div className="space-y-8 max-w-3xl">
        {/* ── My Phone Number ─────────────────────────────────────────────── */}
        <Section title="My phone number">
          <p className="text-sm text-muted-foreground -mt-2">
            Your phone number is visible to linked family members and enables emergency one-tap calling and SMS.
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="my-phone">Phone number</Label>
              <Input
                id="my-phone"
                type="tel"
                placeholder="+1 555 000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={30}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                disabled={savePhone.isPending || !currentUser}
                onClick={() => savePhone.mutate()}
                className="shrink-0"
              >
                {savePhone.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </Section>

        {/* ── Elder Settings ───────────────────────────────────────────────── */}
        {!activeParentId ? (
          <div className="text-sm text-muted-foreground bg-stone-50 border border-border rounded-2xl p-4">
            Link a parent account on the Family page to manage elder settings here.
          </div>
        ) : isLoading || !form ? (
          <div className="text-muted-foreground">Loading settings…</div>
        ) : (
          <form
            className="space-y-8"
            onSubmit={(e) => { e.preventDefault(); save.mutate(form!); }}
          >
            {/* Notification Preferences */}
            <Section title="Notification preferences">
              <ToggleRow label="Email notifications"
                checked={form.notify_email} onChange={(v) => set("notify_email", v)} />
              <ToggleRow label="Push notifications"
                checked={form.notify_push} onChange={(v) => set("notify_push", v)} />
              <ToggleRow label="SMS notifications"
                checked={form.notify_sms} onChange={(v) => set("notify_sms", v)} />
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <Label>Quiet hours start</Label>
                  <Input type="time" value={form.quiet_hours_start ?? ""}
                    onChange={(e) => set("quiet_hours_start", e.target.value || null)} />
                </div>
                <div>
                  <Label>Quiet hours end</Label>
                  <Input type="time" value={form.quiet_hours_end ?? ""}
                    onChange={(e) => set("quiet_hours_end", e.target.value || null)} />
                </div>
              </div>
            </Section>

            {/* Medication Reminders */}
            <Section title="Medication reminders">
              <ToggleRow label="Enable medication reminders"
                checked={form.med_reminders_enabled} onChange={(v) => set("med_reminders_enabled", v)} />
              <ToggleRow label="Voice spoken reminders"
                checked={form.med_voice_reminders} onChange={(v) => set("med_voice_reminders", v)} />
              <div>
                <Label>Remind this many minutes before dose</Label>
                <Input type="number" min={0} max={120} value={form.med_reminder_lead_minutes}
                  onChange={(e) => set("med_reminder_lead_minutes", Number(e.target.value) || 0)} />
              </div>
            </Section>

            {/* Emergency Escalation */}
            <Section title="Emergency escalation">
              <ToggleRow label="Share live location with SOS alerts"
                checked={form.sos_share_location} onChange={(v) => set("sos_share_location", v)} />
              <ToggleRow label="Auto-call primary contact on SOS"
                checked={form.sos_auto_call_primary} onChange={(v) => set("sos_auto_call_primary", v)} />
              <div>
                <Label>Escalate to next contact after (minutes)</Label>
                <Input type="number" min={1} max={60} value={form.sos_escalation_minutes}
                  onChange={(e) => set("sos_escalation_minutes", Number(e.target.value) || 5)} />
              </div>
            </Section>

            {/* Preferred Contact Method */}
            <Section title="Preferred contact method">
              <Select value={form.preferred_contact_method}
                onValueChange={(v) => set("preferred_contact_method", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">Phone call</SelectItem>
                  <SelectItem value="sms">Text message (SMS)</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="push">Push notification</SelectItem>
                </SelectContent>
              </Select>
            </Section>

            {/* Profile Preferences */}
            <Section title="Profile preferences">
              <div>
                <Label>Language</Label>
                <Select value={form.language} onValueChange={(v) => set("language", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="hi">हिन्दी</SelectItem>
                    <SelectItem value="zh">中文</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ToggleRow label="Larger text"
                checked={form.large_text} onChange={(v) => set("large_text", v)} />
              <ToggleRow label="High contrast"
                checked={form.high_contrast} onChange={(v) => set("high_contrast", v)} />
            </Section>

            <div className="flex justify-end">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
      <h2 className="font-display text-xl font-bold italic">{title}</h2>
      {children}
    </section>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
