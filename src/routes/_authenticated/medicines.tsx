import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent, useCurrentUser } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, Bell, Phone, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/medicines")({
  ssr: false,
  component: MedicinesPage,
});

type MedForm = {
  name: string;
  dosage: string;
  period: string;
  schedule_time: string;
  duration: string;
  notes: string;
};

const EMPTY_FORM: MedForm = {
  name: "",
  dosage: "",
  period: "morning",
  schedule_time: "08:00",
  duration: "",
  notes: "",
};

function MedicinesPage() {
  const { activeParentId, activeParent, isChildView } = useActiveParent();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<any | null>(null);
  const [form, setForm] = useState<MedForm>(EMPTY_FORM);

  // ── Fetch medicines ────────────────────────────────────────────────────────
  const { data: meds } = useQuery({
    queryKey: ["medicines-all", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medicines")
        .select("*")
        .eq("parent_id", activeParentId!)
        .order("schedule_time");
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Today's taken set ─────────────────────────────────────────────────────
  const today = format(new Date(), "yyyy-MM-dd");
  const { data: takenToday } = useQuery({
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

  // ── Validate form ─────────────────────────────────────────────────────────
  function validateForm(): boolean {
    if (!form.name.trim()) { toast.error("Please enter a medication name."); return false; }
    if (!form.dosage.trim()) { toast.error("Please enter a dosage."); return false; }
    if (!form.schedule_time) { toast.error("Please enter a valid time."); return false; }
    return true;
  }

  // ── Add ───────────────────────────────────────────────────────────────────
  const add = useMutation({
    mutationFn: async () => {
      if (isChildView) throw new Error("You do not have permission to perform this action.");
      if (!validateForm()) throw new Error("__validation__");
      const { error } = await supabase.from("medicines").insert({
        parent_id: activeParentId!,
        name: form.name.trim(),
        dosage: form.dosage.trim(),
        period: form.period as "morning" | "noon" | "evening" | "night",
        schedule_time: form.schedule_time,
        duration: form.duration.trim() || null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Medication added successfully.");
      setOpen(false);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["medicines-all"] });
      qc.invalidateQueries({ queryKey: ["medicines"] });
    },
    onError: (e: Error) => { if (e.message !== "__validation__") toast.error(e.message); },
  });

  // ── Edit ──────────────────────────────────────────────────────────────────
  const edit = useMutation({
    mutationFn: async (medId: string) => {
      if (isChildView) throw new Error("You do not have permission to perform this action.");
      if (!validateForm()) throw new Error("__validation__");
      // Verify still exists
      const { data: existing } = await supabase
        .from("medicines")
        .select("id")
        .eq("id", medId)
        .maybeSingle();
      if (!existing) throw new Error("Medication not found.");
      const { error } = await supabase.from("medicines").update({
        name: form.name.trim(),
        dosage: form.dosage.trim(),
        period: form.period as "morning" | "noon" | "evening" | "night",
        schedule_time: form.schedule_time,
        duration: form.duration.trim() || null,
        notes: form.notes.trim() || null,
      }).eq("id", medId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Medication updated successfully.");
      setOpen(false);
      setEditingMed(null);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["medicines-all"] });
      qc.invalidateQueries({ queryKey: ["medicines"] });
    },
    onError: (e: Error) => { if (e.message !== "__validation__") toast.error(e.message); },
  });

  // ── Delete ────────────────────────────────────────────────────────────────
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isChildView) throw new Error("You do not have permission to perform this action.");
      const { error } = await supabase.from("medicines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Medication removed.");
      qc.invalidateQueries({ queryKey: ["medicines-all"] });
      qc.invalidateQueries({ queryKey: ["medicines"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Mark Taken (Parent-only) ───────────────────────────────────────────────
  const markTaken = useMutation({
    mutationFn: async (medId: string) => {
      if (isChildView) throw new Error("You do not have permission to perform this action.");
      const { error } = await supabase.from("medicine_logs").insert({
        medicine_id: medId,
        parent_id: activeParentId!,
        log_date: today,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as taken.");
      qc.invalidateQueries({ queryKey: ["medLogs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Child: Send Reminder ───────────────────────────────────────────────────
  const sendReminder = useMutation({
    mutationFn: async (medName: string) => {
      if (!user || !activeParentId) throw new Error("Not ready");
      const { error } = await (supabase as any).from("parent_notifications").insert({
        parent_id: activeParentId,
        sender_id: user.id,
        type: "reminder",
        message: `Medication reminder: Please take your ${medName}.`,
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Reminder sent successfully."),
    onError: () => toast.error("Unable to send reminder. Please try again."),
  });

  // ── Child: Call Parent ────────────────────────────────────────────────────
  const callParent = useMutation({
    mutationFn: async () => {
      if (!user || !activeParentId) throw new Error("Not ready");
      const { error } = await (supabase as any).from("parent_notifications").insert({
        parent_id: activeParentId,
        sender_id: user.id,
        type: "call",
        message: `Your family member is trying to reach you regarding medication.`,
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Call alert sent to parent successfully."),
    onError: () => toast.error("Unable to send call alert. Please try again."),
  });

  function openAdd() {
    setEditingMed(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(m: any) {
    setEditingMed(m);
    setForm({
      name: m.name,
      dosage: m.dosage,
      period: m.period,
      schedule_time: m.schedule_time?.slice(0, 5) ?? "08:00",
      duration: m.duration ?? "",
      notes: m.notes ?? "",
    });
    setOpen(true);
  }

  const periodColors: Record<string, string> = {
    morning: "bg-amber-50 text-amber-700",
    noon: "bg-blue-50 text-blue-700",
    evening: "bg-purple-50 text-purple-700",
    night: "bg-slate-100 text-slate-700",
  };

  return (
    <AppShell>
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold italic">Medication Care</h1>
          <p className="text-muted-foreground mt-1">
            Daily medication schedule for {activeParent?.full_name ?? "—"}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Child quick actions */}
          {isChildView && activeParentId && (
            <>
              <Button
                variant="outline"
                onClick={() => callParent.mutate()}
                disabled={callParent.isPending}
                className="rounded-xl"
              >
                <Phone className="size-4 mr-2" />
                {callParent.isPending ? "Sending…" : "Call Parent"}
              </Button>
              <Button
                variant="outline"
                onClick={() => sendReminder.mutate("their medication")}
                disabled={sendReminder.isPending}
                className="rounded-xl"
              >
                <Bell className="size-4 mr-2" />
                {sendReminder.isPending ? "Sending…" : "Send Reminder"}
              </Button>
            </>
          )}

          {/* Parent: Add medicine */}
          {!isChildView && activeParentId && (
            <Dialog open={open} onOpenChange={(o) => {
              setOpen(o);
              if (!o) { setEditingMed(null); setForm(EMPTY_FORM); }
            }}>
              <DialogTrigger asChild>
                <Button onClick={openAdd} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="size-4 mr-2" /> Add medication
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display">
                    {editingMed ? "Edit medication" : "Add a medication"}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label>Medication name *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Metformin"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Dosage *</Label>
                    <Input
                      value={form.dosage}
                      onChange={(e) => setForm({ ...form, dosage: e.target.value })}
                      placeholder="e.g. 500mg"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Period</Label>
                      <Select value={form.period} onValueChange={(v) => setForm({ ...form, period: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="morning">Morning</SelectItem>
                          <SelectItem value="noon">Noon</SelectItem>
                          <SelectItem value="evening">Evening</SelectItem>
                          <SelectItem value="night">Night</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Time *</Label>
                      <Input
                        type="time"
                        value={form.schedule_time}
                        onChange={(e) => setForm({ ...form, schedule_time: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Duration</Label>
                    <Select
                      value={form.duration}
                      onValueChange={(v) => setForm({ ...form, duration: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select duration…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1 week">1 week</SelectItem>
                        <SelectItem value="2 weeks">2 weeks</SelectItem>
                        <SelectItem value="1 month">1 month</SelectItem>
                        <SelectItem value="3 months">3 months</SelectItem>
                        <SelectItem value="6 months">6 months</SelectItem>
                        <SelectItem value="1 year">1 year</SelectItem>
                        <SelectItem value="Indefinite">Indefinite</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notes</Label>
                    <Textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="e.g. Take after food"
                      rows={2}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={add.isPending || edit.isPending}
                    onClick={() => {
                      if (editingMed) edit.mutate(editingMed.id);
                      else add.mutate();
                    }}
                  >
                    {(add.isPending || edit.isPending) ? "Saving…" : "Save medication"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Read-only notice for child */}
      {isChildView && (
        <div className="mb-6 bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center gap-3 text-sm text-blue-700">
          <Bell className="size-4 shrink-0" />
          You are viewing {activeParent?.full_name}&apos;s medications in read-only mode. Use the buttons above to send reminders or call.
        </div>
      )}

      {/* Medication list */}
      <div className="bg-card border border-border rounded-3xl overflow-hidden">
        {!meds || meds.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            No medications yet.{!isChildView && " Add the first one."}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {meds.map((m) => {
              const taken = takenToday?.has(m.id);
              return (
                <div key={m.id} className={`p-4 sm:p-6 flex flex-wrap items-center gap-3 group hover:bg-stone-50 transition-colors ${taken ? "opacity-70" : ""}`}>
                  {/* Taken indicator */}
                  <div className={`size-10 rounded-2xl grid place-items-center font-bold text-sm shrink-0 ${taken ? "bg-secondary/10 text-secondary" : "bg-primary/10 text-primary"}`}>
                    {taken ? <CheckCircle2 className="size-5" /> : m.name[0].toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">
                        {m.name}{" "}
                        <span className="text-muted-foreground font-normal text-sm">({m.dosage})</span>
                      </p>
                      {m.duration && (
                        <Badge variant="outline" className="text-[10px] font-semibold px-2 py-0.5 rounded-full border-primary/30 text-primary bg-primary/5">
                          {m.duration}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Clock className="size-3 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {m.schedule_time?.slice(0, 5)}
                      </p>
                    </div>
                    {m.notes && <p className="text-xs text-muted-foreground italic mt-0.5">{m.notes}</p>}
                  </div>

                  <span className={`text-xs font-mono px-2 py-1 rounded capitalize ${periodColors[m.period] ?? "bg-stone-100 text-stone-700"}`}>
                    {m.period}
                  </span>

                  {taken && (
                    <span className="text-xs font-mono text-secondary bg-secondary/10 px-2 py-1 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Taken
                    </span>
                  )}

                  {/* Parent: mark taken */}
                  {!isChildView && !taken && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={markTaken.isPending}
                      onClick={() => markTaken.mutate(m.id)}
                      className="rounded-xl text-xs"
                    >
                      Mark taken
                    </Button>
                  )}

                  {/* Child: send reminder per medicine */}
                  {isChildView && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sendReminder.isPending}
                      onClick={() => sendReminder.mutate(m.name)}
                      className="rounded-xl text-xs"
                    >
                      <Bell className="size-3 mr-1" /> Remind
                    </Button>
                  )}

                  {/* Parent: edit & delete */}
                  {!isChildView && (
                    <>
                      <button
                        onClick={() => openEdit(m)}
                        className="text-muted-foreground hover:text-foreground p-2 cursor-pointer transition-colors"
                        title="Edit medication"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete ${m.name}?`)) remove.mutate(m.id);
                        }}
                        className="text-muted-foreground hover:text-destructive p-2 cursor-pointer transition-colors"
                        title="Delete medication"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
