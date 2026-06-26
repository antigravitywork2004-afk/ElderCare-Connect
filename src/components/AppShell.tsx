import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Pill, Sun, UserPlus, ClipboardList, Siren, Users, LogOut, ChevronDown, CalendarDays, Car, Video, Activity, MessageCircleHeart, PhoneCall, Settings as SettingsIcon, HeartPulse, Bell, Menu, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveParent, useCurrentUser } from "@/hooks/useProfile";
import { useRealtimeSosAlerts } from "@/hooks/useRealtimeSosAlerts";
import { useNotificationEngine } from "@/hooks/useNotificationEngine";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/medicines", label: "Medicines", icon: Pill },
  { to: "/wellbeing", label: "Wellbeing", icon: Sun },
  { to: "/vitals", label: "Vitals", icon: HeartPulse },
  { to: "/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/caregivers", label: "Caregivers", icon: UserPlus },
  { to: "/transport", label: "Transport", icon: Car },
  { to: "/video", label: "Video Consult", icon: Video },
  { to: "/records", label: "Health Records", icon: ClipboardList },
  { to: "/family", label: "Family", icon: Users },
  { to: "/emergency-contacts", label: "Emergency Contacts", icon: PhoneCall },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

const aiItems = [
  { to: "/health-risk", label: "AI Risk Check", icon: Activity },
  { to: "/companion", label: "AI Companion", icon: MessageCircleHeart },
] as const;

// ── Shared nav link component ──────────────────────────────────────────────
function NavLink({
  to,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  to: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
        active ? "bg-primary/5 text-primary font-medium" : "text-muted-foreground hover:bg-black/5"
      }`}
    >
      {active ? <div className="size-1.5 rounded-full bg-primary shrink-0" /> : <Icon className="size-4 shrink-0" />}
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { profile, activeParent, activeParentId, isChildView, linkedParents, setSelectedParentId } = useActiveParent();
  const { data: user } = useCurrentUser();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  // Global realtime SOS listener for caregivers across all linked parents
  const caregiverParentIds =
    profile?.role === "child" ? linkedParents.map((p) => p.id) : [];
  useRealtimeSosAlerts(caregiverParentIds);

  // Global notification engine — auto-generates missed medicine + appointment reminder notifications
  useNotificationEngine({
    parentId: activeParentId ?? null,
    userId: user?.id ?? null,
    isChildView,
  });

  const { data: activeSosAlerts = [] } = useQuery({
    queryKey: ["activeSosAlerts", caregiverParentIds],
    enabled: isChildView && caregiverParentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sos_alerts")
        .select("id, parent_id, parent_name, created_at")
        .in("parent_id", caregiverParentIds)
        .in("status", ["active", "acknowledged"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Unread notification count for bell badge
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifUnread", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("parent_notifications")
        .select("id", { count: "exact", head: true })
        .eq("parent_id", user!.id)
        .eq("is_read", false);
      if (error) return 0;
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });

  // Realtime subscription to update unread count live
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notif-bell-${user.id}-${Math.random().toString(36).substr(2, 9)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "parent_notifications",
          filter: `parent_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["notifUnread", user.id] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient]);

  const getParentName = (parentId: string) => {
    return linkedParents.find((p) => p.id === parentId)?.full_name ?? "Parent";
  };

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const initials = (profile?.full_name || "?")
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Shared nav content (used in both sidebar and drawer)
  const NavContent = ({ onLinkClick }: { onLinkClick?: () => void }) => (
    <>
      <nav className="space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            active={pathname === item.to}
            onClick={onLinkClick}
          />
        ))}
        <div className="pt-4 mt-4 border-t border-border">
          <p className="px-3 pb-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">AI Assist</p>
          {aiItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onLinkClick}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                pathname === item.to ? "bg-secondary/10 text-secondary font-medium" : "text-muted-foreground hover:bg-black/5"
              }`}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          ))}
        </div>
        <div className="pt-4 mt-4 border-t border-border space-y-1">
          <Link
            to="/sos"
            onClick={onLinkClick}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              pathname === "/sos" ? "bg-primary/10 text-primary" : "text-primary hover:bg-primary/5"
            }`}
          >
            <div className="size-4 rounded border-2 border-primary flex items-center justify-center text-[10px] font-bold shrink-0">!</div>
            SOS Alerts
          </Link>
        </div>
      </nav>
    </>
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Critical SOS Alert Bar */}
      {isChildView && activeSosAlerts.length > 0 && (
        <div className="bg-red-600 text-white px-4 py-2.5 text-center text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 select-none z-50 animate-pulse relative shadow-md shrink-0">
          <Siren className="size-4 shrink-0 animate-bounce" />
          <span>
            Emergency Assistance requested by Parent:{" "}
            <strong>
              {activeSosAlerts
                .map((a) => a.parent_name || getParentName(a.parent_id))
                .filter(Boolean)
                .join(", ")}
            </strong>
          </span>
          <Link to="/sos" className="underline hover:text-red-100 ml-1.5 font-bold">
            View Details
          </Link>
        </div>
      )}

      {/* ── Desktop Sidebar ──────────────────────────────────────────────── */}
      <aside className="fixed left-0 top-0 bottom-0 w-64 border-r border-border bg-white/50 backdrop-blur-xl z-20 hidden md:flex flex-col">
        <div className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3">
            <div className="size-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold">E</div>
            <span className="font-display text-xl font-bold tracking-tight">ElderCare</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-4">
          <NavContent />
        </div>
        <div className="mt-auto p-4 border-t border-border bg-white/50 backdrop-blur-xl">
          <button onClick={signOut} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground px-3 py-2 w-full">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile Drawer Overlay ────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile Slide-Out Drawer ──────────────────────────────────────── */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-72 max-w-[85vw] border-r border-border bg-white z-50 md:hidden flex flex-col transition-transform duration-300 ease-out ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Mobile navigation"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="size-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-sm">E</div>
            <span className="font-display text-lg font-bold tracking-tight">ElderCare</span>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-2 rounded-lg text-muted-foreground hover:bg-stone-100 transition-colors"
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Profile info in drawer */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Avatar className="size-9 ring-2 ring-white shrink-0">
              <AvatarFallback className="bg-secondary/20 text-secondary font-semibold text-sm">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{profile?.full_name || "User"}</p>
              <p className="text-xs text-muted-foreground font-mono uppercase truncate">
                {isChildView ? "Monitoring" : "Parent"}
              </p>
            </div>
          </div>
          {isChildView && linkedParents.length > 0 && (
            <div className="mt-3">
              <Select value={activeParent?.id ?? undefined} onValueChange={(v) => setSelectedParentId(v)}>
                <SelectTrigger className="h-8 rounded-lg border-border bg-stone-50 text-xs font-medium w-full">
                  <SelectValue placeholder="Select parent" />
                </SelectTrigger>
                <SelectContent>
                  {linkedParents.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Nav links */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <NavContent onLinkClick={() => setDrawerOpen(false)} />
        </div>

        {/* Sign out */}
        <div className="p-4 border-t border-border">
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground px-3 py-2.5 w-full rounded-lg hover:bg-stone-100 transition-colors"
          >
            <LogOut className="size-4 shrink-0" /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className="md:pl-64 flex flex-col flex-1">
        <header className="h-16 sm:h-20 border-b border-border flex items-center gap-3 px-4 sm:px-6 md:px-10 bg-background/70 sticky top-0 backdrop-blur-md z-10">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden p-2 -ml-1 rounded-lg text-muted-foreground hover:bg-stone-100 transition-colors shrink-0"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>

          {/* Avatar + name */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar className="size-9 sm:size-10 ring-2 ring-white shrink-0">
              <AvatarFallback className="bg-secondary/20 text-secondary font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 hidden sm:block">
              <p className="font-display text-base sm:text-lg font-bold leading-none truncate">
                {profile?.full_name || "Welcome"}
              </p>
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                {isChildView
                  ? `Monitoring · ${activeParent?.full_name ?? "No parent linked"}`
                  : "Active now · Home"}
              </span>
            </div>
            {/* Name visible on very small screens */}
            <p className="font-display text-base font-bold leading-none truncate sm:hidden">
              {profile?.full_name?.split(" ")[0] || "Welcome"}
            </p>
          </div>

          {/* Notification Bell */}
          <Link
            to="/notifications"
            className="relative p-2 rounded-xl hover:bg-stone-100 transition-colors shrink-0"
            aria-label="Notifications"
          >
            <Bell className="size-5 text-muted-foreground" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 shadow">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>

          {/* Parent switcher — desktop only to avoid cramping mobile header */}
          {isChildView && linkedParents.length > 0 && (
            <Select value={activeParent?.id ?? undefined} onValueChange={(v) => setSelectedParentId(v)}>
              <SelectTrigger className="hidden sm:flex h-9 rounded-full border-border bg-stone-100 text-sm font-medium gap-2 px-4 w-auto max-w-[160px]">
                <SelectValue placeholder="Select parent" />
                <ChevronDown className="size-3.5 opacity-50" />
              </SelectTrigger>
              <SelectContent>
                {linkedParents.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </header>

        <div className="p-4 sm:p-6 md:p-10 max-w-7xl mx-auto w-full animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
