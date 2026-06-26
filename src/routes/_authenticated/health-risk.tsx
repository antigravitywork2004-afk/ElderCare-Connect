import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { predictHealthRisk } from "@/lib/api/healthRisk.functions";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { Activity, Loader2, ShieldAlert, Heart, CalendarDays, User, Weight, Droplets, Dumbbell, Stethoscope } from "lucide-react";

export const Route = createFileRoute("/_authenticated/health-risk")({
  ssr: false,
  component: HealthRiskPage,
});

const riskStyles: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  low: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  medium: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  high: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-500",
  },
};

type RiskAssessment = {
  id: string;
  parent_id: string;
  age: number;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  sugar_level: number | null;
  heart_rate: number | null;
  weight: number | null;
  oxygen_level: number | null;
  activity_level: string | null;
  wellness_data: string | null;
  risk_level: "low" | "medium" | "high";
  risk_score: number | null;
  summary: string | null;
  recommendations: string | null;
  created_at: string;
};

function HealthRiskPage() {
  const { activeParentId, activeParent, isChildView } = useActiveParent();
  const qc = useQueryClient();
  const predict = useServerFn(predictHealthRisk);

  // Form states
  const [age, setAge] = useState("");
  const [sys, setSys] = useState("");
  const [dia, setDia] = useState("");
  const [sugar, setSugar] = useState("");
  const [hr, setHr] = useState("");
  const [activity, setActivity] = useState<"low" | "moderate" | "high">("moderate");
  const [weight, setWeight] = useState("");
  const [o2, setO2] = useState("");
  const [wellnessData, setWellnessData] = useState("");

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["riskHistory", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("health_risk_assessments")
        .select("*")
        .eq("parent_id", activeParentId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RiskAssessment[];
    },
  });

  const latest = history[0];

  function validateInputs(): boolean {
    // 1. Missing Required Fields
    if (!age || !sys || !dia || !sugar || !hr || !activity) {
      toast.error("Please complete all required health information.");
      return false;
    }

    const parsedAge = Number(age);
    const parsedSys = Number(sys);
    const parsedDia = Number(dia);
    const parsedSugar = Number(sugar);
    const parsedHr = Number(hr);
    const parsedWeight = weight ? Number(weight) : null;
    const parsedO2 = o2 ? Number(o2) : null;

    // 2. Invalid numeric values (not positive numbers, or non-numeric characters)
    if (
      isNaN(parsedAge) ||
      isNaN(parsedSys) ||
      isNaN(parsedDia) ||
      isNaN(parsedSugar) ||
      isNaN(parsedHr) ||
      (parsedWeight !== null && isNaN(parsedWeight)) ||
      (parsedO2 !== null && isNaN(parsedO2))
    ) {
      toast.error("Please enter valid health measurements.");
      return false;
    }

    // 3. Reject negative/zero entries for strictly positive measurements
    if (parsedAge < 0 || parsedSys <= 0 || parsedDia <= 0 || parsedSugar <= 0 || parsedHr <= 0 || (parsedWeight !== null && parsedWeight <= 0) || (parsedO2 !== null && parsedO2 < 0)) {
      toast.error("Please enter valid health measurements.");
      return false;
    }

    // 4. Validation bounds for unrealistic values (prevent typos)
    if (
      parsedAge > 125 ||
      parsedSys > 300 || parsedSys < 40 ||
      parsedDia > 200 || parsedDia < 20 ||
      parsedSugar > 800 || parsedSugar < 20 ||
      parsedHr > 300 || parsedHr < 20 ||
      (parsedWeight !== null && (parsedWeight > 1000 || parsedWeight < 1)) ||
      (parsedO2 !== null && (parsedO2 > 100 || parsedO2 < 10))
    ) {
      toast.error("Please enter valid health measurements.");
      return false;
    }

    return true;
  }

  const run = useMutation({
    mutationFn: async () => {
      if (isChildView) {
        throw new Error("You do not have permission to run AI risk checks.");
      }

      const result = await predict({
        data: {
          age: parseInt(age),
          bpSystolic: parseInt(sys),
          bpDiastolic: parseInt(dia),
          sugarLevel: parseInt(sugar),
          heartRate: parseInt(hr),
          activityLevel: activity,
          weight: weight ? parseFloat(weight) : undefined,
          oxygenLevel: o2 ? parseInt(o2) : undefined,
          wellnessData: wellnessData.trim() || undefined,
        },
      });

      const { error } = await supabase.from("health_risk_assessments").insert({
        parent_id: activeParentId!,
        age: parseInt(age),
        bp_systolic: parseInt(sys),
        bp_diastolic: parseInt(dia),
        sugar_level: parseInt(sugar),
        heart_rate: parseInt(hr),
        activity_level: activity,
        weight: weight ? parseFloat(weight) : null,
        oxygen_level: o2 ? parseInt(o2) : null,
        wellness_data: wellnessData.trim() || null,
        risk_level: result.risk_level,
        risk_score: result.risk_score,
        summary: result.summary,
        recommendations: result.recommendations,
      });

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      toast.success("Assessment complete");
      // Reset optional fields only, keep standard values for ease of re-entry
      setWeight("");
      setO2("");
      setWellnessData("");
      qc.invalidateQueries({ queryKey: ["riskHistory"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl font-bold italic">AI Health Risk Check</h1>
        <p className="text-muted-foreground mt-1">
          Predictive risk estimate for {activeParent?.full_name ?? "—"}.
        </p>
      </div>

      {/* Prominent Medical Disclaimer Banner */}
      <div className="mb-8 bg-blue-50 border border-blue-200 rounded-3xl p-5 flex items-start gap-4 text-blue-800 shadow-sm shadow-blue-500/5">
        <ShieldAlert className="size-6 shrink-0 mt-0.5 text-blue-600" />
        <div className="text-sm">
          <span className="font-bold">Important Note:</span> This assessment is not a medical diagnosis and should not replace professional medical advice.
        </div>
      </div>

      {/* Child Read-only Banner */}
      {isChildView && (
        <div className="mb-8 bg-amber-50 border border-amber-200 rounded-3xl p-5 flex items-start gap-4 text-amber-800 shadow-sm shadow-amber-500/5">
          <ShieldAlert className="size-6 shrink-0 mt-0.5 text-amber-600" />
          <div className="text-sm">
            <span className="font-bold">Read-Only Mode:</span> You do not have permission to run AI risk checks. Viewing history and recommendations only.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Input Form Column (Parent Only) */}
        {!isChildView && (
          <div className="lg:col-span-6 bg-card border border-border rounded-3xl p-5 sm:p-8 shadow-sm space-y-6">
            <h2 className="font-display text-xl font-bold text-stone-900 border-b border-stone-100 pb-3 flex items-center gap-2">
              <Stethoscope className="size-5 text-primary" />
              Patient Health Measurements
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Age */}
              <div className="space-y-1.5 col-span-1">
                <Label htmlFor="risk-age">Age <span className="text-destructive">*</span></Label>
                <Input
                  id="risk-age"
                  type="number"
                  placeholder="e.g. 65"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </div>

              {/* Activity Level */}
              <div className="space-y-1.5 col-span-1">
                <Label htmlFor="risk-activity">Activity Level <span className="text-destructive">*</span></Label>
                <Select value={activity} onValueChange={(v) => setActivity(v as typeof activity)}>
                  <SelectTrigger id="risk-activity" className="rounded-xl">
                    <SelectValue placeholder="Select activity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* BP Systolic */}
              <div className="space-y-1.5 col-span-1">
                <Label htmlFor="risk-sys">BP Systolic (mmHg) <span className="text-destructive">*</span></Label>
                <Input
                  id="risk-sys"
                  type="number"
                  placeholder="e.g. 120"
                  value={sys}
                  onChange={(e) => setSys(e.target.value)}
                />
              </div>

              {/* BP Diastolic */}
              <div className="space-y-1.5 col-span-1">
                <Label htmlFor="risk-dia">BP Diastolic (mmHg) <span className="text-destructive">*</span></Label>
                <Input
                  id="risk-dia"
                  type="number"
                  placeholder="e.g. 80"
                  value={dia}
                  onChange={(e) => setDia(e.target.value)}
                />
              </div>

              {/* Fasting Sugar */}
              <div className="space-y-1.5 col-span-1 sm:col-span-2">
                <Label htmlFor="risk-sugar">Fasting Blood Sugar (mg/dL) <span className="text-destructive">*</span></Label>
                <Input
                  id="risk-sugar"
                  type="number"
                  placeholder="e.g. 100"
                  value={sugar}
                  onChange={(e) => setSugar(e.target.value)}
                />
              </div>

              {/* Heart Rate */}
              <div className="space-y-1.5 col-span-1 sm:col-span-2">
                <Label htmlFor="risk-hr">Heart Rate (bpm) <span className="text-destructive">*</span></Label>
                <Input
                  id="risk-hr"
                  type="number"
                  placeholder="e.g. 72"
                  value={hr}
                  onChange={(e) => setHr(e.target.value)}
                />
              </div>

              {/* Optional weight */}
              <div className="space-y-1.5 col-span-1">
                <Label htmlFor="risk-weight">Weight (kg) <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Input
                  id="risk-weight"
                  type="number"
                  placeholder="e.g. 70"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </div>

              {/* Optional oxygen */}
              <div className="space-y-1.5 col-span-1">
                <Label htmlFor="risk-o2">Oxygen Level (%) <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Input
                  id="risk-o2"
                  type="number"
                  placeholder="e.g. 98"
                  value={o2}
                  onChange={(e) => setO2(e.target.value)}
                />
              </div>

              {/* Optional wellness details */}
              <div className="space-y-1.5 col-span-1 sm:col-span-2">
                <Label htmlFor="risk-wellness">Wellness Data / Context <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Input
                  id="risk-wellness"
                  type="text"
                  placeholder="e.g. Daily walks, experiencing mild headaches"
                  value={wellnessData}
                  onChange={(e) => setWellnessData(e.target.value)}
                />
              </div>
            </div>

            <Button
              id="btn-run-risk-analysis"
              disabled={!activeParentId || run.isPending}
              onClick={() => {
                if (validateInputs()) {
                  run.mutate();
                }
              }}
              className="w-full rounded-xl py-6 text-sm font-semibold cursor-pointer shadow-md shadow-primary/10 mt-2"
            >
              {run.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Running AI Risk Check…
                </>
              ) : (
                "Run AI Risk Check"
              )}
            </Button>
          </div>
        )}

        {/* Output & Details Column */}
        <div className={isChildView ? "lg:col-span-12 space-y-8" : "lg:col-span-6 space-y-8"}>
          
          {/* Latest Result Card */}
          {isLoading ? (
            <div className="bg-card border border-border rounded-3xl p-12 text-center text-stone-500 animate-pulse">
              Loading latest risk assessment...
            </div>
          ) : latest ? (
            <div className={`rounded-3xl border-2 p-8 shadow-md relative overflow-hidden transition-all ${
              riskStyles[latest.risk_level]?.bg
            } ${riskStyles[latest.risk_level]?.border} ${riskStyles[latest.risk_level]?.text}`}>
              
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-mono uppercase tracking-widest font-bold">Latest Risk Level</span>
                <Activity className="size-5" />
              </div>
              
              <p className="font-display text-4xl font-extrabold capitalize leading-none">
                {latest.risk_level} Risk
              </p>
              
              {latest.risk_score && (
                <p className="text-xs font-semibold font-mono tracking-wider mt-1.5 opacity-90 uppercase">
                  Assessment Score: {latest.risk_score}/100
                </p>
              )}

              <p className="mt-4 text-sm font-medium leading-relaxed bg-white/40 p-3 rounded-2xl border border-white/60">
                {latest.summary}
              </p>
              
              {/* Recommendations */}
              {latest.recommendations && (
                <div className="mt-6">
                  <span className="text-[10px] font-mono uppercase tracking-widest font-bold block mb-2">AI Recommendations</span>
                  <ul className="space-y-2 text-sm">
                    {latest.recommendations.split("\n").filter(Boolean).map((r, i) => (
                      <li key={i} className="flex items-start gap-2 bg-white/20 p-2.5 rounded-xl">
                        <span className="size-1.5 rounded-full bg-current shrink-0 mt-2" />
                        <span className="font-medium leading-tight">{r.replace(/^[-•]\s*/, "")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Inputs Log details */}
              <div className="mt-6 border-t border-current/10 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] font-semibold opacity-90">
                <div>
                  <span className="block opacity-60 font-mono uppercase text-[9px] tracking-wider">Age</span>
                  <span>{latest.age} yrs</span>
                </div>
                <div>
                  <span className="block opacity-60 font-mono uppercase text-[9px] tracking-wider">Blood Pressure</span>
                  <span>{latest.bp_systolic}/{latest.bp_diastolic} mmHg</span>
                </div>
                <div>
                  <span className="block opacity-60 font-mono uppercase text-[9px] tracking-wider">Fasting Sugar</span>
                  <span>{latest.sugar_level} mg/dL</span>
                </div>
                {latest.heart_rate && (
                  <div>
                    <span className="block opacity-60 font-mono uppercase text-[9px] tracking-wider">Heart Rate</span>
                    <span>{latest.heart_rate} bpm</span>
                  </div>
                )}
                {latest.weight && (
                  <div>
                    <span className="block opacity-60 font-mono uppercase text-[9px] tracking-wider">Weight</span>
                    <span>{latest.weight} kg</span>
                  </div>
                )}
                {latest.oxygen_level && (
                  <div>
                    <span className="block opacity-60 font-mono uppercase text-[9px] tracking-wider">Oxygen</span>
                    <span>{latest.oxygen_level}%</span>
                  </div>
                )}
                {latest.activity_level && (
                  <div>
                    <span className="block opacity-60 font-mono uppercase text-[9px] tracking-wider">Activity</span>
                    <span className="capitalize">{latest.activity_level}</span>
                  </div>
                )}
                {latest.wellness_data && (
                  <div className="col-span-2 sm:col-span-4">
                    <span className="block opacity-60 font-mono uppercase text-[9px] tracking-wider">Context Details</span>
                    <span className="italic block mt-0.5 truncate" title={latest.wellness_data}>{latest.wellness_data}</span>
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <div className="mt-4 text-[10px] font-mono opacity-60 text-right">
                Analyzed at: {format(new Date(latest.created_at), "MMM d, yyyy · h:mm a")}
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-border p-14 text-center text-muted-foreground">
              <Activity className="size-10 mx-auto mb-3 opacity-30 animate-pulse" />
              <p className="font-semibold text-base">No assessments found.</p>
              {!isChildView && (
                <p className="text-sm mt-1">Fill out the vitals form and click "Run AI Risk Check" to start.</p>
              )}
            </div>
          )}

          {/* Past History Logs */}
          {history.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest px-1">Analysis History</h3>
              <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-sm divide-y divide-border">
                {history.map((h) => {
                  const style = riskStyles[h.risk_level] ?? riskStyles.low;
                  return (
                    <div key={h.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/50 transition-colors text-sm">
                      <div className="flex items-center gap-3">
                        <div className={`size-2.5 rounded-full ${style.dot} shrink-0`} />
                        <div>
                          <p className="font-semibold text-stone-900 capitalize">{h.risk_level} Risk</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <CalendarDays className="size-3.5" />
                            {format(new Date(h.created_at), "MMM d, yyyy · h:mm a")}
                          </p>
                        </div>
                      </div>
                      <div className="ml-5 sm:ml-0 sm:text-right">
                        <span className={`text-[10px] font-mono tracking-wider px-2 py-0.5 rounded uppercase font-semibold border ${style.bg} ${style.text} ${style.border}`}>
                          Score: {h.risk_score}
                        </span>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                          BP: {h.bp_systolic}/{h.bp_diastolic} · sugar: {h.sugar_level}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
