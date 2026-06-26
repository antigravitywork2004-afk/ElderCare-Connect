import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Smile, Zap, Utensils, Droplets, Moon, ShieldAlert } from "lucide-react";

interface WellbeingCheck {
  id?: string;
  ate_meals?: boolean | null;
  took_medicine?: boolean | null;
  feeling?: string | null;
  energy_level?: string | null;
  drank_water?: boolean | null;
  sleep_quality?: string | null;
  pain_status?: boolean | null;
  pain_notes?: string | null;
  meals_logged?: string | null;
  water_intake?: number | null;
}

interface WellbeingCheckCardProps {
  parentId: string;
  isChild: boolean;
  existing: WellbeingCheck | null | undefined;
}

export function WellbeingCheckCard({ parentId, isChild, existing }: WellbeingCheckCardProps) {
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  async function set(field: string, value: any) {
    // If setting meals_logged, also set ate_meals accordingly
    let additionalPayload = {};
    if (field === "meals_logged") {
      additionalPayload = { ate_meals: value === "Completed" || value === "Partially" };
    }
    // If setting water_intake, also set drank_water accordingly
    if (field === "water_intake") {
      additionalPayload = { drank_water: value >= 4 };
    }

    const payload = {
      parent_id: parentId,
      check_date: today,
      [field]: value,
      ...additionalPayload,
    } as any;

    const { error } = await supabase
      .from("wellbeing_checks")
      .upsert(payload, { onConflict: "parent_id,check_date" });
    
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Wellbeing check-in saved successfully");
      qc.invalidateQueries({ queryKey: ["wellbeing"] });
      qc.invalidateQueries({ queryKey: ["wellbeing-history"] });
    }
  }

  if (isChild) {
    return (
      <section className="bg-secondary/5 border border-secondary/10 rounded-3xl p-8 space-y-6">
        <h2 className="text-xl font-display font-bold italic flex items-center gap-2">
          Today's Wellness Status
        </h2>
        {existing ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <Stat label="Energy" value={existing.energy_level ?? "—"} icon={<Zap className="size-4 text-amber-500" />} />
            <Stat label="Mood" value={existing.feeling ?? "—"} icon={<Smile className="size-4 text-emerald-500" />} />
            <Stat label="Meal Status" value={existing.meals_logged ?? (existing.ate_meals ? "Completed" : "—")} icon={<Utensils className="size-4 text-blue-500" />} />
            <Stat label="Water Intake" value={existing.water_intake ? `${existing.water_intake} Glasses` : (existing.drank_water ? "Completed" : "—")} icon={<Droplets className="size-4 text-cyan-500" />} />
            <Stat label="Sleep Quality" value={existing.sleep_quality ?? "—"} icon={<Moon className="size-4 text-indigo-500" />} />
            <Stat label="Pain Status" value={existing.pain_status === false ? "No Pain" : existing.pain_status === true ? "Has Pain" : "—"} icon={<ShieldAlert className="size-4 text-red-500" />} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No check-in submitted yet today.</p>
        )}
      </section>
    );
  }

  return (
    <section className="bg-secondary/5 border border-secondary/10 rounded-3xl p-6 sm:p-8 space-y-6">
      <h2 className="text-xl font-display font-bold italic">Daily Wellness Tracker</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Mood / Feeling */}
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Smile className="size-4 text-emerald-500" /> How is your mood?
          </p>
          <div className="flex flex-wrap gap-2">
            {["Happy", "Great", "Okay", "Tired"].map((f) => (
              <button
                key={f}
                onClick={() => set("feeling", f)}
                className={`px-3 py-1.5 rounded-xl border text-xs sm:text-sm transition-all cursor-pointer ${
                  existing?.feeling === f
                    ? "border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/20"
                    : "border-stone-200 bg-card hover:bg-stone-50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Energy Level */}
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Zap className="size-4 text-amber-500" /> Energy level?
          </p>
          <div className="flex flex-wrap gap-2">
            {["Low", "Med", "High"].map((lvl) => (
              <button
                key={lvl}
                onClick={() => set("energy_level", lvl)}
                className={`px-3 py-1.5 rounded-xl border text-xs sm:text-sm transition-all cursor-pointer ${
                  existing?.energy_level === lvl
                    ? "border-amber-500 bg-amber-500 text-white shadow-sm shadow-amber-500/20"
                    : "border-stone-200 bg-card hover:bg-stone-50"
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        {/* Meal Status */}
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Utensils className="size-4 text-blue-500" /> Meal status?
          </p>
          <div className="flex flex-wrap gap-2">
            {["Completed", "Partially", "Skipped"].map((status) => (
              <button
                key={status}
                onClick={() => set("meals_logged", status)}
                className={`px-3 py-1.5 rounded-xl border text-xs sm:text-sm transition-all cursor-pointer ${
                  existing?.meals_logged === status
                    ? "border-blue-500 bg-blue-500 text-white shadow-sm shadow-blue-500/20"
                    : "border-stone-200 bg-card hover:bg-stone-50"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Water Intake */}
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Droplets className="size-4 text-cyan-500" /> Water intake?
          </p>
          <div className="flex flex-wrap gap-2">
            {[4, 6, 8, 10].map((glasses) => (
              <button
                key={glasses}
                onClick={() => set("water_intake", glasses)}
                className={`px-3 py-1.5 rounded-xl border text-xs sm:text-sm transition-all cursor-pointer ${
                  existing?.water_intake === glasses
                    ? "border-cyan-500 bg-cyan-500 text-white shadow-sm shadow-cyan-500/20"
                    : "border-stone-200 bg-card hover:bg-stone-50"
                }`}
              >
                {glasses} Glasses
              </button>
            ))}
          </div>
        </div>

        {/* Sleep Quality */}
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Moon className="size-4 text-indigo-500" /> Sleep quality?
          </p>
          <div className="flex flex-wrap gap-2">
            {["Poor", "Fair", "Good", "Excellent"].map((q) => (
              <button
                key={q}
                onClick={() => set("sleep_quality", q)}
                className={`px-3 py-1.5 rounded-xl border text-xs sm:text-sm transition-all cursor-pointer ${
                  existing?.sleep_quality === q
                    ? "border-indigo-500 bg-indigo-500 text-white shadow-sm shadow-indigo-500/20"
                    : "border-stone-200 bg-card hover:bg-stone-50"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Pain Status */}
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <ShieldAlert className="size-4 text-red-500" /> Any pain?
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "No Pain", value: false },
              { label: "Has Pain", value: true },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => set("pain_status", p.value)}
                className={`px-3 py-1.5 rounded-xl border text-xs sm:text-sm transition-all cursor-pointer ${
                  existing?.pain_status === p.value
                    ? "border-red-500 bg-red-500 text-white shadow-sm shadow-red-500/20"
                    : "border-stone-200 bg-card hover:bg-stone-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex items-start gap-2.5">
      {icon && <div className="mt-0.5">{icon}</div>}
      <div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-sm sm:text-base font-semibold mt-0.5">{value}</p>
      </div>
    </div>
  );
}
