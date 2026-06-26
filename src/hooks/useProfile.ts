import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export type Profile = {
  id: string;
  full_name: string;
  role: "parent" | "child";
  avatar_url: string | null;
  invite_code: string | null;
  date_of_birth: string | null;
  medical_conditions: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
};

export function useCurrentUser() {
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });
}

export function useProfile() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data as Profile;
    },
  });
}

export function useLinkedParents() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ["linkedParents", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: links } = await supabase
        .from("parent_child_links")
        .select("parent_id, created_at")
        .eq("child_id", user!.id);
      const ids = (links ?? []).map((l) => l.parent_id);
      if (ids.length === 0) return [] as (Profile & { linked_at?: string })[];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("*")
        .in("id", ids);
      return (links ?? []).map((link) => {
        const prof = (profiles ?? []).find((p) => p.id === link.parent_id);
        return {
          ...prof,
          linked_at: link.created_at,
        } as Profile & { linked_at: string };
      });
    },
  });
}

export function useLinkedChildren(parentId: string | undefined) {
  return useQuery({
    queryKey: ["linkedChildren", parentId],
    enabled: !!parentId,
    queryFn: async () => {
      const { data: links } = await supabase
        .from("parent_child_links")
        .select("child_id, created_at")
        .eq("parent_id", parentId!);
      const ids = (links ?? []).map((l) => l.child_id);
      if (ids.length === 0) return [] as (Profile & { linked_at?: string })[];
      const { data: profiles } = await supabase.from("profiles").select("*").in("id", ids);
      return (links ?? []).map((link) => {
        const prof = (profiles ?? []).find((p) => p.id === link.child_id);
        return {
          ...prof,
          linked_at: link.created_at,
        } as Profile & { linked_at: string };
      });
    },
  });
}

/** Returns the parent profile currently being viewed/managed. */
export function useActiveParent() {
  const { data: profile, isLoading: pLoad } = useProfile();
  const { data: linkedParents, isLoading: lLoad } = useLinkedParents();
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role === "child" && linkedParents && linkedParents.length > 0 && !selectedParentId) {
      setSelectedParentId(linkedParents[0].id);
    }
  }, [profile, linkedParents, selectedParentId]);

  const activeParent: Profile | null =
    profile?.role === "parent"
      ? profile
      : (linkedParents ?? []).find((p) => p.id === selectedParentId) ?? null;

  return {
    profile,
    activeParent,
    activeParentId: activeParent?.id ?? null,
    isLoading: pLoad || lLoad,
    isChildView: profile?.role === "child",
    setSelectedParentId,
    linkedParents: linkedParents ?? [],
  };
}
