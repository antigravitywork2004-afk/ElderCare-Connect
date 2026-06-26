import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Stethoscope,
  Activity,
  Users,
  HeartPulse,
  Pencil,
  XCircle,
  ShieldAlert,
  Plus,
  Clock,
  CalendarDays,
  UserCheck,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/caregivers")({
  ssr: false,
  component: CaregiversPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type BookingStatus =
  | "pending"
  | "confirmed"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled";

type ServiceType = "nurse" | "physiotherapist" | "companion" | "caretaker";

type Booking = {
  id: string;
  parent_id: string;
  caregiver_type: ServiceType;
  booking_date: string | null;
  booking_time: string | null;
  scheduled_at: string;
  duration_hours: number;
  notes: string | null;
  status: BookingStatus;
  caregiver_id: string | null;
  caregiver_name: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_TYPES: {
  id: ServiceType;
  label: string;
  icon: React.ElementType;
  desc: string;
  color: string;
}[] = [
  {
    id: "nurse",
    label: "Nurse",
    icon: Stethoscope,
    desc: "Certified medical care at home",
    color: "text-blue-600",
  },
  {
    id: "physiotherapist",
    label: "Physiotherapist",
    icon: Activity,
    desc: "Mobility & recovery support",
    color: "text-emerald-600",
  },
  {
    id: "companion",
    label: "Companion",
    icon: Users,
    desc: "Conversation & social company",
    color: "text-violet-600",
  },
  {
    id: "caretaker",
    label: "Caretaker",
    icon: HeartPulse,
    desc: "Help with daily living",
    color: "text-rose-600",
  },
];

const SERVICE_LABELS: Record<ServiceType, string> = {
  nurse: "Nurse",
  physiotherapist: "Physiotherapist",
  companion: "Companion",
  caretaker: "Caretaker",
};

const STATUS_CONFIG: Record<
  BookingStatus,
  { label: string; bg: string; text: string; dot: string }
> = {
  pending: {
    label: "Pending",
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-400",
  },
  confirmed: {
    label: "Confirmed",
    bg: "bg-blue-50",
    text: "text-blue-700",
    dot: "bg-blue-500",
  },
  assigned: {
    label: "Assigned",
    bg: "bg-violet-50",
    text: "text-violet-700",
    dot: "bg-violet-500",
  },
  in_progress: {
    label: "In Progress",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  completed: {
    label: "Completed",
    bg: "bg-stone-100",
    text: "text-stone-600",
    dot: "bg-stone-400",
  },
  cancelled: {
    label: "Cancelled",
    bg: "bg-red-50",
    text: "text-red-600",
    dot: "bg-red-400",
  },
};

const CANCELLABLE_STATUSES: BookingStatus[] = [
  "pending",
  "confirmed",
  "assigned",
  "in_progress",
];
const EDITABLE_STATUSES: BookingStatus[] = ["pending", "confirmed", "assigned"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayString() {
  return format(new Date(), "yyyy-MM-dd");
}

function formatDisplayDate(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    return format(new Date(`${dateStr}T00:00:00`), "EEE, MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

function formatDisplayTime(timeStr: string | null) {
  if (!timeStr) return "—";
  try {
    const [h, m] = timeStr.split(":");
    const d = new Date();
    d.setHours(parseInt(h), parseInt(m));
    return format(d, "h:mm a");
  } catch {
    return timeStr;
  }
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: BookingStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide ${cfg.bg} ${cfg.text}`}
    >
      <span className={`size-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function CaregiversPage() {
  const { activeParentId, activeParent, isChildView } = useActiveParent();
  const qc = useQueryClient();

  // ── dialog state ──
  const [open, setOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);

  // ── form state ──
  const [serviceType, setServiceType] = useState<ServiceType>("nurse");
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [duration, setDuration] = useState<number | "">(2);
  const [notes, setNotes] = useState("");

  // ─── Query ──────────────────────────────────────────────────────────────────

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["caregiver_bookings", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caregiver_bookings")
        .select("*")
        .eq("parent_id", activeParentId!)
        .order("booking_date", { ascending: false })
        .order("booking_time", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Booking[];
    },
  });

  // ─── Form helpers ───────────────────────────────────────────────────────────

  function resetForm() {
    setServiceType("nurse");
    setBookingDate("");
    setBookingTime("");
    setDuration(2);
    setNotes("");
  }

  function openNew(type: ServiceType = "nurse") {
    if (isChildView) {
      toast.error("You do not have permission to manage caregiver services.");
      return;
    }
    setEditingBooking(null);
    resetForm();
    setServiceType(type);
    setOpen(true);
  }

  function openEdit(b: Booking) {
    if (isChildView) {
      toast.error("You do not have permission to manage caregiver services.");
      return;
    }
    setEditingBooking(b);
    setServiceType(b.caregiver_type);
    setBookingDate(b.booking_date ?? "");
    setBookingTime(b.booking_time ? b.booking_time.slice(0, 5) : "");
    setDuration(b.duration_hours ?? 2);
    setNotes(b.notes ?? "");
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setEditingBooking(null);
    resetForm();
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  function validate(): boolean {
    if (!serviceType) {
      toast.error("Please select a service.");
      return false;
    }
    if (!bookingDate) {
      toast.error("Please select a preferred date.");
      return false;
    }
    if (bookingDate < todayString()) {
      toast.error("Booking date cannot be in the past.");
      return false;
    }
    if (!bookingTime) {
      toast.error("Please select a preferred time.");
      return false;
    }
    return true;
  }

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const book = useMutation({
    mutationFn: async () => {
      if (isChildView) {
        throw new Error("You do not have permission to manage caregiver services.");
      }
      const scheduledAt = new Date(`${bookingDate}T${bookingTime}`).toISOString();
      const { error } = await supabase.from("caregiver_bookings").insert({
        parent_id: activeParentId!,
        requested_by: activeParentId!,
        caregiver_type: serviceType,
        scheduled_at: scheduledAt,
        booking_date: bookingDate,
        booking_time: bookingTime,
        duration_hours: duration === "" ? 1 : duration,
        notes: notes.trim() || null,
        status: "pending",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Caregiver service booked successfully.");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["caregiver_bookings"] });
      qc.invalidateQueries({ queryKey: ["nextBooking"] });
    },
    onError: (e: Error) => {
      if (e.message.includes("permission")) {
        toast.error(e.message);
      } else {
        toast.error("Unable to create booking. Please try again.");
      }
    },
  });

  const edit = useMutation({
    mutationFn: async (id: string) => {
      if (isChildView) {
        throw new Error("You do not have permission to manage caregiver services.");
      }
      const scheduledAt = new Date(`${bookingDate}T${bookingTime}`).toISOString();
      const { error } = await supabase
        .from("caregiver_bookings")
        .update({
          caregiver_type: serviceType,
          scheduled_at: scheduledAt,
          booking_date: bookingDate,
          booking_time: bookingTime,
          duration_hours: duration === "" ? 1 : duration,
          notes: notes.trim() || null,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Booking updated successfully.");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["caregiver_bookings"] });
      qc.invalidateQueries({ queryKey: ["nextBooking"] });
    },
    onError: (e: Error) => {
      if (e.message.includes("permission")) {
        toast.error(e.message);
      } else {
        toast.error("Unable to update booking. Please try again.");
      }
    },
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      if (isChildView) {
        throw new Error("You do not have permission to manage caregiver services.");
      }
      const { error } = await supabase
        .from("caregiver_bookings")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Booking cancelled.");
      qc.invalidateQueries({ queryKey: ["caregiver_bookings"] });
    },
    onError: (e: Error) => {
      if (e.message.includes("permission")) {
        toast.error(e.message);
      } else {
        toast.error("Unable to cancel booking. Please try again.");
      }
    },
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function handleSubmit() {
    if (!validate()) return;
    if (editingBooking) {
      edit.mutate(editingBooking.id);
    } else {
      book.mutate();
    }
  }

  function handleCancel(b: Booking) {
    if (isChildView) {
      toast.error("You do not have permission to manage caregiver services.");
      return;
    }
    if (confirm(`Cancel this ${SERVICE_LABELS[b.caregiver_type]} booking? It will remain in your history.`)) {
      cancel.mutate(b.id);
    }
  }

  // ─── Derived data ───────────────────────────────────────────────────────────

  const activeBookings = (bookings ?? []).filter(
    (b) => b.status !== "cancelled" && b.status !== "completed"
  );
  const historyBookings = (bookings ?? []).filter(
    (b) => b.status === "cancelled" || b.status === "completed"
  );

  const isPending = editingBooking ? edit.isPending : book.isPending;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      {/* ── Header ── */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold italic">Caregiver Services</h1>
          <p className="text-muted-foreground mt-1">
            Book and manage care services for {activeParent?.full_name ?? "—"}
          </p>
        </div>
        {!isChildView && (
          <Button
            disabled={!activeParentId}
            onClick={() => openNew()}
            className="rounded-xl cursor-pointer"
            id="btn-new-booking"
          >
            <Plus className="size-4 mr-2" />
            New Booking
          </Button>
        )}
      </div>

      {/* ── Child Read-Only Notice ── */}
      {isChildView && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-sm text-amber-800">
          <ShieldAlert className="size-4 shrink-0" />
          You do not have permission to manage caregiver services. Viewing in read-only mode.
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {(["pending", "confirmed", "assigned", "in_progress"] as BookingStatus[]).map(
          (s) => {
            const count = (bookings ?? []).filter((b) => b.status === s).length;
            const cfg = STATUS_CONFIG[s];
            return (
              <div
                key={s}
                className="bg-card border border-border p-4 rounded-2xl flex flex-col gap-1"
              >
                <span className={`text-[10px] font-mono uppercase tracking-widest ${cfg.text}`}>
                  {cfg.label}
                </span>
                <p className="text-2xl font-bold">{count}</p>
              </div>
            );
          }
        )}
      </div>

      {/* ── Service Type Cards (Parent only) ── */}
      {!isChildView && (
        <div className="mb-8">
          <h2 className="font-display text-xl font-bold mb-4">Book a Service</h2>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SERVICE_TYPES.map((t) => (
              <button
                key={t.id}
                id={`btn-book-${t.id}`}
                disabled={!activeParentId}
                onClick={() => openNew(t.id)}
                className="text-left bg-card border border-border rounded-3xl p-5 hover:border-primary hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed group cursor-pointer"
              >
                <div className={`size-10 rounded-2xl bg-stone-50 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform ${t.color}`}>
                  <t.icon className="size-5" />
                </div>
                <p className="font-display text-base font-bold">{t.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Bookings List ── */}
      <div className="space-y-6">

        {/* Active Bookings */}
        <div>
          <h2 className="font-display text-xl font-bold mb-4">Active Bookings</h2>

          {isLoading ? (
            <div className="bg-card border border-border rounded-3xl p-12 text-center text-muted-foreground animate-pulse">
              Loading bookings…
            </div>
          ) : activeBookings.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-3xl p-12 text-center text-muted-foreground">
              <CalendarDays className="size-10 mx-auto mb-3 opacity-30" />
              <p className="font-semibold text-base">No caregiver bookings found.</p>
              {!isChildView && (
                <p className="text-sm mt-1 text-muted-foreground">
                  Use the cards above to book a service.
                </p>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-3xl overflow-hidden divide-y divide-border">
              {activeBookings.map((b) => (
                <BookingRow
                  key={b.id}
                  booking={b}
                  isChildView={isChildView}
                  onEdit={() => openEdit(b)}
                  onCancel={() => handleCancel(b)}
                  isCancelling={cancel.isPending}
                />
              ))}
            </div>
          )}
        </div>

        {/* History */}
        {historyBookings.length > 0 && (
          <div>
            <h2 className="font-display text-xl font-bold mb-4 text-muted-foreground">
              History
            </h2>
            <div className="bg-card border border-border rounded-3xl overflow-hidden divide-y divide-border opacity-75">
              {historyBookings.map((b) => (
                <BookingRow
                  key={b.id}
                  booking={b}
                  isChildView={isChildView}
                  onEdit={() => openEdit(b)}
                  onCancel={() => handleCancel(b)}
                  isCancelling={cancel.isPending}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Book / Edit Dialog ── */}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) closeDialog();
          else setOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-[460px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold">
              {editingBooking ? "Edit Booking" : "Book a Caregiver Service"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Service Type */}
            <div className="space-y-1.5">
              <Label htmlFor="cg-service-type">
                Service Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={serviceType}
                onValueChange={(v) => setServiceType(v as ServiceType)}
                disabled={!!editingBooking}
              >
                <SelectTrigger id="cg-service-type">
                  <SelectValue placeholder="Select a service…" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cg-date">
                  Preferred Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cg-date"
                  type="date"
                  value={bookingDate}
                  min={todayString()}
                  onChange={(e) => setBookingDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cg-time">
                  Preferred Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cg-time"
                  type="time"
                  value={bookingTime}
                  onChange={(e) => setBookingTime(e.target.value)}
                />
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-1.5">
              <Label htmlFor="cg-duration">
                Duration (hours){" "}
                <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="cg-duration"
                type="number"
                min={1}
                max={24}
                value={duration}
                onChange={(e) =>
                  setDuration(e.target.value === "" ? "" : parseInt(e.target.value) || 1)
                }
                placeholder="e.g. 2"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="cg-notes">
                Notes / Special Requirements{" "}
                <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="cg-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Daily blood pressure monitoring"
                rows={3}
                maxLength={300}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button
              id="btn-submit-booking"
              onClick={handleSubmit}
              disabled={isPending || !activeParentId}
            >
              {isPending
                ? editingBooking
                  ? "Saving…"
                  : "Booking…"
                : editingBooking
                ? "Save Changes"
                : "Book Service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// ─── Booking Row Component ────────────────────────────────────────────────────

function BookingRow({
  booking: b,
  isChildView,
  onEdit,
  onCancel,
  isCancelling,
}: {
  booking: Booking;
  isChildView: boolean;
  onEdit: () => void;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  const svc = SERVICE_TYPES.find((t) => t.id === b.caregiver_type);
  const Icon = svc?.icon ?? Stethoscope;
  const canEdit = !isChildView && EDITABLE_STATUSES.includes(b.status);
  const canCancel = !isChildView && CANCELLABLE_STATUSES.includes(b.status);

  return (
    <div className="p-4 sm:p-5 flex items-start gap-4 sm:gap-5 hover:bg-stone-50/50 transition-colors">
      {/* Icon block */}
      <div
        className={`size-12 rounded-2xl bg-stone-100 flex items-center justify-center shrink-0 ${svc?.color ?? "text-stone-600"}`}
      >
        <Icon className="size-5" />
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-base">{SERVICE_LABELS[b.caregiver_type]}</p>
          <StatusBadge status={b.status} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3.5" />
            {formatDisplayDate(b.booking_date)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {formatDisplayTime(b.booking_time)}
          </span>
          {b.duration_hours && (
            <span className="flex items-center gap-1 font-medium">
              {b.duration_hours}h session
            </span>
          )}
          {b.caregiver_name && (
            <span className="flex items-center gap-1 text-violet-600 font-medium">
              <UserCheck className="size-3.5" />
              {b.caregiver_name}
            </span>
          )}
        </div>

        {b.notes && (
          <div className="bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 mt-2 text-xs text-stone-600 italic">
            {b.notes}
          </div>
        )}
      </div>

      {/* Actions (parent only) */}
      {!isChildView && (
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {canEdit && (
            <button
              id={`btn-edit-${b.id}`}
              onClick={onEdit}
              className="p-2 text-stone-400 hover:text-stone-800 transition-colors cursor-pointer rounded-lg hover:bg-stone-100"
              title="Edit booking"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {canCancel && (
            <button
              id={`btn-cancel-${b.id}`}
              onClick={onCancel}
              disabled={isCancelling}
              className="p-2 text-stone-400 hover:text-destructive transition-colors cursor-pointer rounded-lg hover:bg-red-50 disabled:opacity-40"
              title="Cancel booking"
            >
              <XCircle className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
