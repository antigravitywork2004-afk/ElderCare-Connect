import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent } from "@/hooks/useProfile";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays } from "date-fns";
import { WellbeingCheckCard } from "@/components/WellbeingCheckCard";

export const Route = createFileRoute("/_authenticated/wellbeing")({
  ssr: false,
  component: WellbeingPage,
});

function WellbeingPage() {
  const { activeParentId, activeParent, isChildView } = useActiveParent();
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: checks } = useQuery({
    queryKey: ["wellbeing-history", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const since = format(subDays(new Date(), 14), "yyyy-MM-dd");
      const { data } = await supabase
        .from("wellbeing_checks")
        .select("*")
        .eq("parent_id", activeParentId!)
        .gte("check_date", since)
        .order("check_date", { ascending: false });
      return data ?? [];
    },
  });

  const todayCheck = checks?.find((c) => c.check_date === today);

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold italic">Wellbeing</h1>
        <p className="text-muted-foreground mt-1">Daily check-ins from {activeParent?.full_name ?? "—"} · last 14 days</p>
      </div>

      {activeParentId && (
        <div className="mb-8">
          <WellbeingCheckCard parentId={activeParentId} isChild={isChildView} existing={todayCheck} />
        </div>
      )}

      <div className="bg-card border border-border rounded-3xl overflow-hidden">
        {!checks || checks.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No check-ins logged yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {checks.map((c) => (
              <div key={c.id} className="p-6 grid grid-cols-2 sm:grid-cols-5 gap-4 items-center">
                <div>
                  <p className="font-display text-lg font-bold">{format(new Date(c.check_date), "EEE, MMM d")}</p>
                  <p className="text-xs font-mono text-muted-foreground uppercase">{c.check_date}</p>
                </div>
                <Pill label="Energy" value={c.energy_level} />
                <Pill label="Feeling" value={c.feeling} />
                <Pill label="Meals" value={c.ate_meals === true ? "Yes" : c.ate_meals === false ? "No" : "—"} />
                <Pill label="Water" value={c.drank_water === true ? "Yes" : c.drank_water === false ? "No" : "—"} />
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Pill({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold mt-1">{value ?? "—"}</p>
    </div>
  );
}
