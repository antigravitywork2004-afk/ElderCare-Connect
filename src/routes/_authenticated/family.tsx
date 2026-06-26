import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useCurrentUser, useLinkedChildren, useLinkedParents, useProfile } from "@/hooks/useProfile";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Copy, Trash2, Users, RefreshCw, CheckCircle2, Link2 } from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/family")({
  ssr: false,
  component: FamilyPage,
});

type LinkedProfile = {
  id: string;
  full_name: string;
  email?: string | null;
  linked_at?: string;
};

function FamilyPage() {
  const { data: user } = useCurrentUser();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const [code, setCode] = useState("");

  const { data: linkedParents } = useLinkedParents();
  const { data: linkedChildren } = useLinkedChildren(
    profile?.role === "parent" ? user?.id : undefined
  );

  // ── Child: link to parent ─────────────────────────────────────────────────
  const link = useMutation({
    mutationFn: async () => {
      const trimmed = code.trim().toUpperCase();

      if (!trimmed) {
        throw new Error("Please enter a Family Link Code.");
      }

      // Prevent self-linking
      const parentIdResult = await supabase.rpc("lookup_parent_by_invite_code", { _code: trimmed });
      if (parentIdResult.error) throw new Error("Unable to complete linking. Please try again.");

      const parentId = parentIdResult.data;
      if (!parentId) throw new Error("Invalid Family Link Code.");
      if (parentId === user!.id) throw new Error("You cannot link your own account.");

      // Check if already linked to this parent
      const { data: existingLink } = await supabase
        .from("parent_child_links")
        .select("id")
        .eq("parent_id", parentId)
        .eq("child_id", user!.id)
        .maybeSingle();
      if (existingLink) throw new Error("You are already linked to this parent.");

      // Check if already linked to any parent (one-parent constraint)
      const { data: anyLink } = await supabase
        .from("parent_child_links")
        .select("id")
        .eq("child_id", user!.id)
        .limit(1);
      if (anyLink && anyLink.length > 0) {
        throw new Error("This child is already linked to a parent. Unlink first.");
      }

      const { error } = await supabase
        .from("parent_child_links")
        .insert({ parent_id: parentId, child_id: user!.id });
      if (error) {
        if (error.code === "23505") throw new Error("You are already linked to this parent.");
        throw new Error("Unable to complete linking. Please try again.");
      }
    },
    onSuccess: () => {
      toast.success("Successfully linked to family.");
      setCode("");
      qc.invalidateQueries({ queryKey: ["linkedParents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Child: unlink from parent ─────────────────────────────────────────────
  const unlink = useMutation({
    mutationFn: async (parentId: string) => {
      const { error } = await supabase
        .from("parent_child_links")
        .delete()
        .eq("parent_id", parentId)
        .eq("child_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Unlinked from parent.");
      qc.invalidateQueries({ queryKey: ["linkedParents"] });
    },
    onError: () => toast.error("Unable to unlink. Please try again."),
  });

  // ── Parent: remove a child ────────────────────────────────────────────────
  const removeChild = useMutation({
    mutationFn: async (childId: string) => {
      const { error } = await supabase
        .from("parent_child_links")
        .delete()
        .eq("parent_id", user!.id)
        .eq("child_id", childId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Family member removed.");
      qc.invalidateQueries({ queryKey: ["linkedChildren"] });
    },
    onError: () => toast.error("Unable to remove. Please try again."),
  });

  // ── Parent: regenerate invite code ────────────────────────────────────────
  const regenerate = useMutation({
    mutationFn: async () => {
      const newCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      const { error } = await supabase
        .from("profiles")
        .update({ invite_code: newCode })
        .eq("id", user!.id);
      if (error) throw error;
      return newCode;
    },
    onSuccess: (newCode) => {
      toast.success("New code generated!");
      qc.invalidateQueries({ queryKey: ["profile"] });
      navigator.clipboard.writeText(newCode).catch(() => {});
    },
    onError: () => toast.error("Failed to regenerate code. Please try again."),
  });

  function copy() {
    if (!profile?.invite_code) return;
    navigator.clipboard.writeText(profile.invite_code);
    toast.success("Code copied to clipboard!");
  }

  // ── Parent View ───────────────────────────────────────────────────────────
  if (profile?.role === "parent") {
    return (
      <AppShell>
        <div className="mb-8">
          <h1 className="font-display text-4xl font-bold italic">Family</h1>
          <p className="text-muted-foreground mt-1">Share your code with family members to connect</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Invite Code Card */}
          <section className="bg-stone-900 text-white p-8 rounded-3xl space-y-6">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 block">
              Your Family Link Code
            </span>
            <p className="font-mono text-5xl font-bold tracking-tight">
              {profile.invite_code ?? "——————"}
            </p>
            <p className="text-white/60 text-sm">
              Share this code with your family members. They enter it on their Family page to connect with you.
            </p>
            <div className="flex gap-3">
              <Button
                onClick={copy}
                variant="secondary"
                className="bg-white/10 hover:bg-white/20 text-white rounded-xl flex-1"
              >
                <Copy className="size-4 mr-2" /> Copy code
              </Button>
              <Button
                onClick={() => regenerate.mutate()}
                disabled={regenerate.isPending}
                variant="secondary"
                className="bg-white/10 hover:bg-white/20 text-white rounded-xl"
                title="Generate a new code"
              >
                <RefreshCw className={`size-4 ${regenerate.isPending ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </section>

          {/* Linked Children */}
          <section>
            <h2 className="font-display text-xl font-bold italic mb-4">
              Linked Family Members ({(linkedChildren ?? []).length})
            </h2>
            <div className="bg-card border border-border rounded-3xl overflow-hidden">
              {!linkedChildren || linkedChildren.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground text-sm">
                  <Users className="size-8 mx-auto mb-3 opacity-30" />
                  No one linked yet. Share your code to get started.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {(linkedChildren as LinkedProfile[]).map((c) => (
                    <div key={c.id} className="p-5 flex items-center gap-4">
                      <div className="size-10 rounded-full bg-secondary/10 grid place-items-center text-secondary font-semibold text-sm">
                        {(c.full_name?.[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{c.full_name}</p>
                        {c.email && (
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                        )}
                        {c.linked_at && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Linked {format(new Date(c.linked_at), "MMM d, yyyy")}
                          </p>
                        )}
                      </div>
                      <span className="flex items-center gap-1 text-xs font-mono text-secondary bg-secondary/10 px-2 py-1 rounded-full">
                        <CheckCircle2 className="size-3" /> Linked
                      </span>
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${c.full_name} from your family?`)) {
                            removeChild.mutate(c.id);
                          }
                        }}
                        className="text-muted-foreground hover:text-destructive p-2 transition-colors"
                        title="Remove family member"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </AppShell>
    );
  }

  // ── Child View ────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold italic">Family</h1>
        <p className="text-muted-foreground mt-1">Enter your parent's code to connect</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Link Code Input */}
        <section className="bg-card border border-border p-8 rounded-3xl">
          <Users className="size-7 text-primary mb-4" />
          <h2 className="font-display text-xl font-bold italic mb-2">Accept Parent Invite</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Ask your parent for the 8-character Family Link Code displayed on their Family page.
          </p>
          <div className="space-y-3">
            <Label htmlFor="invite-code">Parent invite code</Label>
            <Input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="A1B2C3D4"
              className="font-mono uppercase tracking-widest h-12 text-lg"
              maxLength={8}
              disabled={link.isPending}
            />
            <Button
              onClick={() => {
                if (!code.trim()) {
                  toast.error("Please enter a Family Link Code.");
                  return;
                }
                link.mutate();
              }}
              disabled={link.isPending}
              className="w-full rounded-xl h-11"
            >
              <Link2 className="size-4 mr-2" />
              {link.isPending ? "Linking…" : "Link account"}
            </Button>
          </div>
        </section>

        {/* Linked Parents */}
        <section>
          <h2 className="font-display text-xl font-bold italic mb-4">
            Parents you monitor ({(linkedParents ?? []).length})
          </h2>
          <div className="bg-card border border-border rounded-3xl overflow-hidden">
            {!linkedParents || linkedParents.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">
                <Users className="size-8 mx-auto mb-3 opacity-30" />
                Not linked to anyone yet. Enter a code to connect.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {(linkedParents as LinkedProfile[]).map((p) => (
                  <div key={p.id} className="p-5 flex items-center gap-4">
                    <div className="size-10 rounded-full bg-primary/10 grid place-items-center text-primary font-semibold text-sm">
                      {(p.full_name?.[0] ?? "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{p.full_name}</p>
                      {p.email && (
                        <p className="text-xs text-muted-foreground">{p.email}</p>
                      )}
                      {p.linked_at && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Linked {format(new Date(p.linked_at), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                    <span className="flex items-center gap-1 text-xs font-mono text-secondary bg-secondary/10 px-2 py-1 rounded-full">
                      <CheckCircle2 className="size-3" /> Linked
                    </span>
                    <button
                      onClick={() => {
                        if (confirm("Unlink from this parent?")) {
                          unlink.mutate(p.id);
                        }
                      }}
                      className="text-muted-foreground hover:text-destructive p-2 transition-colors"
                      title="Unlink"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
