import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent, useCurrentUser } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
export const Route = createFileRoute("/_authenticated/vitals")({
  ssr: false,
  component: VitalsPage,
});
type VitalType =
  | "blood_pressure"
  | "blood_sugar"
  | "heart_rate"
  | "weight"
  | "oxygen_saturation"
  | "temperature";
type VitalRow = {
  id: string;
  parent_id: string;
  vital_type: VitalType;
  value: number;
  value_secondary: number | null;
  unit: string;
  recorded_at: string;
  notes: string | null;
  is_abnormal: boolean;
  created_by: string | null;
  created_at: string;
};
const VITAL_META: Record<VitalType, { label: string; unit: string; hasSecondary?: boolean; placeholder: string }> = {
  blood_pressure: { label: "Blood Pressure", unit: "mmHg", hasSecondary: true, placeholder: "Systolic" },
  blood_sugar: { label: "Blood Sugar", unit: "mg/dL", placeholder: "e.g. 110" },
  heart_rate: { label: "Heart Rate", unit: "bpm", placeholder: "e.g. 72" },
  weight: { label: "Weight", unit: "kg", placeholder: "e.g. 68" },
  oxygen_saturation: { label: "Oxygen (SpO2)", unit: "%", placeholder: "e.g. 98" },
  temperature: { label: "Temperature", unit: "°C", placeholder: "e.g. 36.7" },
};
function checkAbnormal(type: VitalType, value: number, secondary?: number | null): { abnormal: boolean; reason?: string } {
  switch (type) {
    case "blood_pressure":
      if (value >= 140 || (secondary ?? 0) >= 90) return { abnormal: true, reason: "High BP (≥140/90)" };
      if (value < 90 || (secondary ?? 200) < 60) return { abnormal: true, reason: "Low BP (<90/60)" };
      return { abnormal: false };
    case "blood_sugar":
      if (value >= 180) return { abnormal: true, reason: "High blood sugar (≥180 mg/dL)" };
      if (value < 70) return { abnormal: true, reason: "Low blood sugar (<70 mg/dL)" };
      return { abnormal: false };
    case "heart_rate":
      if (value > 120) return { abnormal: true, reason: "High heart rate (>120 bpm)" };
      if (value < 50) return { abnormal: true, reason: "Low heart rate (<50 bpm)" };
      return { abnormal: false };
    case "oxygen_saturation":
      if (value < 95) return { abnormal: true, reason: "Low SpO2 (<95%)" };
      return { abnormal: false };
    case "temperature":
      if (value >= 38) return { abnormal: true, reason: "Fever (≥38°C)" };
      if (value < 35) return { abnormal: true, reason: "Hypothermia (<35°C)" };
      return { abnormal: false };
    case "weight":
      return { abnormal: false };
  }
}
function formatValue(v: VitalRow): string {
  if (v.vital_type === "blood_pressure") return `${v.value}/${v.value_secondary ?? "—"}`;
  return String(v.value);
}
function VitalsPage() {
  const { activeParentId, activeParent } = useActiveParent();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [filterType, setFilterType] = useState<VitalType | "all">("all");
  const [days, setDays] = useState<number>(30);
  const [open, setOpen] = useState(false);
  const { data: vitals = [], isLoading } = useQuery({
    queryKey: ["vitals", activeParentId, days],
    enabled: !!activeParentId,
    queryFn: async () => {
      const since = subDays(new Date(), days).toISOString();
      const { data, error } = await ((supabase as any).from("vitals"))
        .select("*")
        .eq("parent_id", activeParentId!)
        .gte("recorded_at", since)
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as VitalRow[];
    },
  });
  const filtered = useMemo(
    () => (filterType === "all" ? vitals : vitals.filter((v) => v.vital_type === filterType)),
    [vitals, filterType]
  );
  const latestByType = useMemo(() => {
    const map = new Map<VitalType, VitalRow>();
    for (const v of vitals) {
      if (!map.has(v.vital_type)) map.set(v.vital_type, v);
    }
    return map;
  }, [vitals]);
  const addMutation = useMutation({
    mutationFn: async (input: {
      vital_type: VitalType;
      value: number;
      value_secondary: number | null;
      recorded_at: string;
      notes: string;
    }) => {
      if (!activeParentId || !user) throw new Error("Not ready");
      const meta = VITAL_META[input.vital_type];
      const abn = checkAbnormal(input.vital_type, input.value, input.value_secondary);
      const { error } = await ((supabase as any).from("vitals")).insert({
        parent_id: activeParentId,
        vital_type: input.vital_type,
        value: input.value,
        value_secondary: input.value_secondary,
        unit: meta.unit,
        recorded_at: input.recorded_at,
        notes: input.notes || null,
        is_abnormal: abn.abnormal,
        created_by: user.id,
      });
      if (error) throw error;
      return abn;
    },
    onSuccess: (abn) => {
      qc.invalidateQueries({ queryKey: ["vitals"] });
      setOpen(false);
      if (abn.abnormal) toast.warning(`Abnormal reading: ${abn.reason}`);
      else toast.success("Vital recorded");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await ((supabase as any).from("vitals")).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vitals"] });
      toast.success("Deleted");
    },
  });
  return (
    <AppShell>
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold italic">Vitals</h1>
          <p className="text-muted-foreground mt-1">
            Health vitals for {activeParent?.full_name ?? "—"}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={!activeParentId}>
              <Plus className="size-4 mr-1" /> Record vital
            </Button>
          </DialogTrigger>
          <AddVitalDialog onSubmit={(v) => addMutation.mutate(v)} pending={addMutation.isPending} />
        </Dialog>
      </div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {(Object.keys(VITAL_META) as VitalType[]).map((t) => {
          const v = latestByType.get(t);
          return (
            <div key={t} className="bg-card border border-border rounded-2xl p-4">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                {VITAL_META[t].label}
              </p>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-display text-2xl font-bold">
                  {v ? formatValue(v) : "—"}
                </span>
                <span className="text-xs text-muted-foreground">{v?.unit ?? VITAL_META[t].unit}</span>
              </div>
              {v?.is_abnormal && (
                <Badge variant="destructive" className="mt-2 text-[10px]">
                  <AlertTriangle className="size-3 mr-1" /> Abnormal
                </Badge>
              )}
              {v && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {format(new Date(v.recorded_at), "MMM d, HH:mm")}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
          <SelectTrigger className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vitals</SelectItem>
            {(Object.keys(VITAL_META) as VitalType[]).map((t) => (
              <SelectItem key={t} value={t}>{VITAL_META[t].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {/* Chart */}
      {filterType !== "all" && filtered.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4 mb-6 overflow-hidden">
          <p className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Activity className="size-4" /> {VITAL_META[filterType].label} trend
          </p>
          <div className="h-56 sm:h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...filtered].reverse().map((v) => ({
                date: format(new Date(v.recorded_at), "MMM d"),
                value: Number(v.value),
                secondary: v.value_secondary ? Number(v.value_secondary) : undefined,
              }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={10} tick={{ fontSize: 10 }} />
                <YAxis fontSize={10} tick={{ fontSize: 10 }} width={36} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                {filterType === "blood_pressure" && (
                  <Line type="monotone" dataKey="secondary" stroke="hsl(var(--secondary))" strokeWidth={2} dot={{ r: 3 }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {/* History */}
      <div className="bg-card border border-border rounded-3xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No vitals recorded in this period.</div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((v) => (
              <div key={v.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                {/* Type + date */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{VITAL_META[v.vital_type].label}</p>
                  <p className="text-[10px] font-mono uppercase text-muted-foreground">
                    {format(new Date(v.recorded_at), "MMM d, yyyy HH:mm")}
                  </p>
                  {v.notes && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 italic">{v.notes}</p>}
                </div>
                {/* Value */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-lg font-bold">{formatValue(v)}</span>
                  <span className="text-xs text-muted-foreground">{v.unit}</span>
                  {v.is_abnormal ? (
                    <Badge variant="destructive" className="text-[10px]">
                      <AlertTriangle className="size-3 mr-1" /> Abnormal
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">Normal</Badge>
                  )}
                </div>
                {/* Delete */}
                <Button size="icon" variant="ghost" className="shrink-0 self-start sm:self-auto" onClick={() => deleteMutation.mutate(v.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
function AddVitalDialog({
  onSubmit,
  pending,
}: {
  onSubmit: (v: { vital_type: VitalType; value: number; value_secondary: number | null; recorded_at: string; notes: string }) => void;
  pending: boolean;
}) {
  const [type, setType] = useState<VitalType>("blood_pressure");
  const [value, setValue] = useState("");
  const [secondary, setSecondary] = useState("");
  const [notes, setNotes] = useState("");
  const [when, setWhen] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const meta = VITAL_META[type];
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid value");
      return;
    }
    let sec: number | null = null;
    if (meta.hasSecondary) {
      const s = Number(secondary);
      if (!Number.isFinite(s) || s <= 0) {
        toast.error("Enter diastolic value");
        return;
      }
      sec = s;
    }
    onSubmit({
      vital_type: type,
      value: n,
      value_secondary: sec,
      recorded_at: new Date(when).toISOString(),
      notes,
    });
  }
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Record vital</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as VitalType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(VITAL_META) as VitalType[]).map((t) => (
                <SelectItem key={t} value={t}>{VITAL_META[t].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{meta.hasSecondary ? "Systolic" : "Value"} ({meta.unit})</Label>
            <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder={meta.placeholder} required />
          </div>
          {meta.hasSecondary && (
            <div>
              <Label>Diastolic ({meta.unit})</Label>
              <Input type="number" step="any" value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="Diastolic" required />
            </div>
          )}
        </div>
        <div>
          <Label>Date / time</Label>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save vital"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}