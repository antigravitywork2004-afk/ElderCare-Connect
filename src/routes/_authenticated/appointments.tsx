import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { Calendar as UI_Calendar } from "@/components/ui/calendar";
import { 
  CalendarDays, 
  Pencil, 
  Trash2, 
  Clock, 
  MapPin, 
  Bell, 
  BellOff, 
  ShieldAlert, 
  Plus, 
  List, 
  Info,
  Calendar as CalendarIcon
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/appointments")({
  ssr: false,
  component: AppointmentsPage,
});

type AppointmentRow = {
  id: string;
  parent_id: string;
  title: string;
  doctor_name: string;
  specialty: string | null;
  location: string | null;
  scheduled_at: string;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  notes: string | null;
  appointment_date: string;
  appointment_time: string | null;
  reminder_enabled: boolean;
  created_at: string;
  updated_at: string;
};

function AppointmentsPage() {
  const { activeParentId, activeParent, isChildView } = useActiveParent();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingAppt, setEditingAppt] = useState<AppointmentRow | null>(null);
  
  const [title, setTitle] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [location, setLocation] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [notes, setNotes] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(false);

  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

  const todayStr = format(new Date(), "yyyy-MM-dd");

  // Fetch appointments
  const { data: appts } = useQuery({
    queryKey: ["appointments", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .eq("parent_id", activeParentId!)
        .order("appointment_date", { ascending: true })
        .order("appointment_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AppointmentRow[];
    },
  });

  // KPI Calculations
  const upcomingCount = (appts ?? []).filter((a) => a.appointment_date >= todayStr && a.status !== "cancelled").length;
  const todayCount = (appts ?? []).filter((a) => a.appointment_date === todayStr && a.status !== "cancelled").length;

  // Filtered upcoming vs past appointments
  const upcomingAppts = (appts ?? [])
    .filter((a) => a.appointment_date >= todayStr)
    .sort((a, b) => {
      const dateTimeA = new Date(`${a.appointment_date}T${a.appointment_time || "00:00"}`).getTime();
      const dateTimeB = new Date(`${b.appointment_date}T${b.appointment_time || "00:00"}`).getTime();
      return dateTimeA - dateTimeB;
    });

  const pastAppts = (appts ?? [])
    .filter((a) => a.appointment_date < todayStr)
    .sort((a, b) => {
      const dateTimeA = new Date(`${a.appointment_date}T${a.appointment_time || "00:00"}`).getTime();
      const dateTimeB = new Date(`${b.appointment_date}T${b.appointment_time || "00:00"}`).getTime();
      return dateTimeB - dateTimeA;
    });

  // Calendar dates with active appointments
  const apptDates = (appts ?? [])
    .filter((a) => a.status !== "cancelled")
    .map((a) => a.appointment_date);

  const modifiers = {
    hasAppointment: (date: Date) => {
      const formattedDate = format(date, "yyyy-MM-dd");
      return apptDates.includes(formattedDate);
    },
  };

  const modifiersClassNames = {
    hasAppointment: "underline decoration-primary decoration-2 font-bold text-primary",
  };

  const selectedDateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const dayAppts = (appts ?? [])
    .filter((a) => a.appointment_date === selectedDateStr)
    .sort((a, b) => {
      const timeA = a.appointment_time || "00:00";
      const timeB = b.appointment_time || "00:00";
      return timeA.localeCompare(timeB);
    });

  const validateForm = (): boolean => {
    if (isChildView) {
      toast.error("You do not have permission to modify appointments.");
      return false;
    }
    if (!title.trim()) {
      toast.error("Appointment title is required");
      return false;
    }
    if (!doctorName.trim()) {
      toast.error("Doctor name is required");
      return false;
    }
    if (!appointmentDate) {
      toast.error("Appointment date is required");
      return false;
    }
    return true;
  };

  const add = useMutation({
    mutationFn: async () => {
      if (isChildView) throw new Error("You do not have permission to modify appointments.");
      
      const timeStr = appointmentTime ? appointmentTime : "12:00";
      let scheduledAt: string;
      try {
        const dateObj = new Date(`${appointmentDate}T${timeStr}`);
        if (isNaN(dateObj.getTime())) {
          throw new Error();
        }
        scheduledAt = dateObj.toISOString();
      } catch {
        throw new Error("Invalid date/time");
      }

      const { error } = await supabase.from("appointments").insert({
        parent_id: activeParentId!,
        title: title.trim(),
        doctor_name: doctorName.trim(),
        specialty: specialty.trim() || null,
        location: location.trim() || null,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime || null,
        scheduled_at: scheduledAt,
        notes: notes.trim() || null,
        reminder_enabled: reminderEnabled,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Appointment added");
      setOpen(false);
      resetFormState();
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["nextBooking"] });
    },
    onError: (e: Error) => {
      if (e.message === "Invalid date/time") {
        toast.error("Please enter a valid date and time");
      } else {
        toast.error("Unable to save appointment. Please try again.");
      }
    },
  });

  const edit = useMutation({
    mutationFn: async (apptId: string) => {
      if (isChildView) throw new Error("You do not have permission to modify appointments.");
      
      // Check if editing a deleted appointment
      const exists = appts?.some((a) => a.id === apptId);
      if (!exists) {
        throw new Error("Appointment not found");
      }

      const timeStr = appointmentTime ? appointmentTime : "12:00";
      let scheduledAt: string;
      try {
        const dateObj = new Date(`${appointmentDate}T${timeStr}`);
        if (isNaN(dateObj.getTime())) {
          throw new Error();
        }
        scheduledAt = dateObj.toISOString();
      } catch {
        throw new Error("Invalid date/time");
      }

      const { error } = await supabase
        .from("appointments")
        .update({
          title: title.trim(),
          doctor_name: doctorName.trim(),
          specialty: specialty.trim() || null,
          location: location.trim() || null,
          appointment_date: appointmentDate,
          appointment_time: appointmentTime || null,
          scheduled_at: scheduledAt,
          notes: notes.trim() || null,
          reminder_enabled: reminderEnabled,
        })
        .eq("id", apptId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Appointment updated");
      setOpen(false);
      setEditingAppt(null);
      resetFormState();
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["nextBooking"] });
    },
    onError: (e: Error) => {
      if (e.message === "Appointment not found") {
        toast.error("Appointment not found");
      } else if (e.message === "Invalid date/time") {
        toast.error("Please enter a valid date and time");
      } else {
        toast.error("Unable to save appointment. Please try again.");
      }
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isChildView) throw new Error("You do not have permission to modify appointments.");
      
      const { error } = await supabase.from("appointments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Appointment deleted");
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["nextBooking"] });
    },
    onError: (e: Error) => {
      toast.error("Unable to save appointment. Please try again.");
    },
  });

  const resetFormState = () => {
    setTitle("");
    setDoctorName("");
    setSpecialty("");
    setLocation("");
    setAppointmentDate("");
    setAppointmentTime("");
    setNotes("");
    setReminderEnabled(false);
  };

  const handleEditClick = (appt: AppointmentRow) => {
    if (isChildView) {
      toast.error("You do not have permission to modify appointments.");
      return;
    }
    // Verify existence in local state (Edge Case: Editing deleted appointment)
    const exists = appts?.some((a) => a.id === appt.id);
    if (!exists) {
      toast.error("Appointment not found");
      return;
    }

    setEditingAppt(appt);
    setTitle(appt.title);
    setDoctorName(appt.doctor_name);
    setSpecialty(appt.specialty ?? "");
    setLocation(appt.location ?? "");
    setAppointmentDate(appt.appointment_date);
    setAppointmentTime(appt.appointment_time?.slice(0, 5) ?? "");
    setNotes(appt.notes ?? "");
    setReminderEnabled(appt.reminder_enabled);
    setOpen(true);
  };

  const handleDeleteClick = (appt: AppointmentRow) => {
    if (isChildView) {
      toast.error("You do not have permission to modify appointments.");
      return;
    }
    if (confirm(`Delete appointment "${appt.title}"? This cannot be undone.`)) {
      remove.mutate(appt.id);
    }
  };

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold italic">Appointments</h1>
          <p className="text-muted-foreground mt-1">Schedule and visits for {activeParent?.full_name ?? "—"}</p>
        </div>
        <Button
          disabled={!activeParentId}
          onClick={() => {
            if (isChildView) {
              toast.error("You do not have permission to modify appointments.");
              return;
            }
            setEditingAppt(null);
            resetFormState();
            setOpen(true);
          }}
          className="rounded-xl cursor-pointer"
        >
          <Plus className="size-4 mr-2" /> New appointment
        </Button>
      </div>

      {/* Child Read-Only Notice */}
      {isChildView && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-sm text-amber-800">
          <ShieldAlert className="size-4 shrink-0" />
          You are viewing {activeParent?.full_name}&apos;s schedule in read-only mode. You cannot create, edit, or delete appointments.
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div className="bg-card border border-border p-6 rounded-3xl flex flex-col justify-between min-h-[120px]">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Upcoming Visits</span>
          <div>
            <p className="text-3xl font-bold tracking-tight">{upcomingCount}</p>
            <p className="text-secondary text-sm font-medium mt-1">Scheduled appointments</p>
          </div>
        </div>
        <div className="bg-card border border-border p-6 rounded-3xl flex flex-col justify-between min-h-[120px]">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Today's Schedule</span>
          <div>
            <p className="text-3xl font-bold tracking-tight">{todayCount}</p>
            <p className="text-secondary text-sm font-medium mt-1">
              {todayCount === 1 ? "1 appointment today" : `${todayCount} appointments today`}
            </p>
          </div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex border-b border-border mb-6">
        <button
          onClick={() => setViewMode("list")}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium text-sm transition-colors cursor-pointer ${
            viewMode === "list"
              ? "border-stone-900 text-stone-900 font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <List className="size-4" /> Schedule List
        </button>
        <button
          onClick={() => setViewMode("calendar")}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium text-sm transition-colors cursor-pointer ${
            viewMode === "calendar"
              ? "border-stone-900 text-stone-900 font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CalendarIcon className="size-4" /> Calendar View
        </button>
      </div>

      {/* Content Area */}
      {!appts || appts.length === 0 ? (
        <div className="bg-card border border-border rounded-3xl p-16 text-center text-muted-foreground">
          <CalendarDays className="size-10 mx-auto mb-3 opacity-30" />
          <p className="font-semibold text-lg">No appointments scheduled.</p>
          {!isChildView && <p className="text-sm mt-1">Click the button above to add a new appointment.</p>}
        </div>
      ) : (
        <>
          {viewMode === "list" ? (
            <div className="space-y-6">
              {/* Upcoming Section */}
              {upcomingAppts.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest px-2">Upcoming</h3>
                  <div className="bg-card border border-border rounded-3xl overflow-hidden divide-y divide-border">
                    {upcomingAppts.map((appt) => {
                      const isToday = appt.appointment_date === todayStr;
                      return (
                        <div 
                          key={appt.id} 
                          className={`p-4 sm:p-6 flex items-start gap-4 sm:gap-6 hover:bg-stone-50/50 transition-colors ${
                            isToday ? "border-l-4 border-primary bg-primary/[0.02]" : ""
                          }`}
                        >
                          {/* Left date block */}
                          <div className="size-12 sm:size-14 rounded-2xl bg-stone-100 flex flex-col items-center justify-center shrink-0">
                            <span className="text-[10px] font-mono uppercase text-muted-foreground">
                              {format(new Date(`${appt.appointment_date}T00:00:00`), "MMM")}
                            </span>
                            <span className="text-lg font-bold font-display leading-none">
                              {format(new Date(`${appt.appointment_date}T00:00:00`), "d")}
                            </span>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-base truncate">{appt.title}</p>
                              {isToday && (
                                <span className="text-[10px] font-bold font-mono bg-primary text-primary-foreground px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  Today
                                </span>
                              )}
                              {appt.reminder_enabled ? (
                                <span className="flex items-center gap-1 text-[10px] font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                                  <Bell className="size-2.5" /> Reminder Active
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-[10px] font-medium bg-stone-50 text-stone-500 px-2 py-0.5 rounded-full border border-stone-200">
                                  <BellOff className="size-2.5" /> Reminders Off
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-stone-600 font-medium mt-0.5">
                              Dr. {appt.doctor_name}
                              {appt.specialty && <span className="text-muted-foreground font-normal"> ({appt.specialty})</span>}
                            </p>
                            <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-muted-foreground mt-2">
                              <span className="flex items-center gap-1">
                                <Clock className="size-3.5" /> 
                                {appt.appointment_time ? appt.appointment_time.slice(0, 5) : "TBD"}
                              </span>
                              {appt.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="size-3.5" /> {appt.location}
                                </span>
                              )}
                            </div>
                            {appt.notes && (
                              <div className="bg-stone-50 rounded-xl p-3 mt-3 text-xs text-stone-600 border border-stone-100 italic">
                                {appt.notes}
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleEditClick(appt)}
                              className="p-2 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
                              title="Edit appointment"
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteClick(appt)}
                              className="p-2 text-stone-400 hover:text-destructive transition-colors cursor-pointer"
                              title="Delete appointment"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Past Section */}
              {pastAppts.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest px-2">Past & Cancelled</h3>
                  <div className="bg-card border border-border rounded-3xl overflow-hidden divide-y divide-border opacity-70">
                    {pastAppts.map((appt) => (
                      <div key={appt.id} className="p-4 sm:p-6 flex items-start gap-4 sm:gap-6 hover:bg-stone-50/50 transition-colors">
                        <div className="size-14 rounded-2xl bg-stone-100 flex flex-col items-center justify-center shrink-0">
                          <span className="text-[10px] font-mono uppercase text-muted-foreground">
                            {format(new Date(`${appt.appointment_date}T00:00:00`), "MMM")}
                          </span>
                          <span className="text-lg font-bold font-display leading-none text-muted-foreground">
                            {format(new Date(`${appt.appointment_date}T00:00:00`), "d")}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-base text-muted-foreground truncate">{appt.title}</p>
                            {appt.reminder_enabled && (
                              <span className="flex items-center gap-1 text-[10px] font-medium bg-stone-50 text-stone-400 px-2 py-0.5 rounded-full border border-stone-200">
                                <BellOff className="size-2.5" /> Reminders Off (Past)
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-stone-500 font-medium mt-0.5">
                            Dr. {appt.doctor_name}
                            {appt.specialty && <span className="text-stone-400 font-normal"> ({appt.specialty})</span>}
                          </p>
                          <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-muted-foreground mt-2">
                            <span className="flex items-center gap-1">
                              <Clock className="size-3.5" /> 
                              {appt.appointment_time ? appt.appointment_time.slice(0, 5) : "TBD"}
                            </span>
                            {appt.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="size-3.5" /> {appt.location}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleEditClick(appt)}
                            className="p-2 text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                            title="Edit appointment"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(appt)}
                            className="p-2 text-stone-300 hover:text-destructive transition-colors cursor-pointer"
                            title="Delete appointment"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
              {/* Calendar Section */}
              <div className="md:col-span-5 bg-card border border-border p-6 rounded-3xl flex justify-center shadow-sm">
                <UI_Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  modifiers={modifiers}
                  modifiersClassNames={modifiersClassNames}
                  className="w-full"
                />
              </div>

              {/* Day Appointments Panel */}
              <div className="md:col-span-7 space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3 px-2">
                  <h3 className="text-lg font-bold font-display italic">
                    Schedule for {selectedDate ? format(selectedDate, "MMMM d, yyyy") : "Selected Date"}
                  </h3>
                  <span className="text-xs font-mono bg-stone-100 px-2.5 py-1 rounded-full text-stone-600 font-semibold">
                    {dayAppts.length} {dayAppts.length === 1 ? "visit" : "visits"}
                  </span>
                </div>

                {dayAppts.length === 0 ? (
                  <div className="bg-stone-50 border border-dashed border-stone-200 rounded-2xl p-12 text-center text-muted-foreground">
                    <CalendarDays className="size-8 mx-auto mb-2 opacity-30" />
                    No appointments scheduled for this date.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {dayAppts.map((appt) => {
                      const isToday = appt.appointment_date === todayStr;
                      return (
                        <div 
                          key={appt.id} 
                          className={`bg-card border border-border p-5 rounded-2xl flex items-start gap-4 shadow-sm hover:shadow transition-shadow ${
                            isToday ? "border-l-4 border-primary" : ""
                          }`}
                        >
                          <div className="size-10 rounded-xl bg-stone-100 text-stone-700 flex items-center justify-center shrink-0">
                            <Clock className="size-5" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold text-stone-900 truncate">{appt.title}</h4>
                              {appt.reminder_enabled ? (
                                <span className="flex items-center gap-0.5 text-[9px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-150">
                                  <Bell className="size-2" /> Active
                                </span>
                              ) : (
                                <span className="flex items-center gap-0.5 text-[9px] font-semibold bg-stone-50 text-stone-400 px-2 py-0.5 rounded-full border border-stone-200">
                                  <BellOff className="size-2" /> Off
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-stone-600 font-medium mt-0.5">
                              Dr. {appt.doctor_name}
                              {appt.specialty && <span className="text-muted-foreground font-normal"> ({appt.specialty})</span>}
                            </p>
                            <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-muted-foreground mt-2">
                              <span className="font-mono text-stone-950 font-bold bg-stone-100 px-1.5 py-0.5 rounded">
                                {appt.appointment_time ? appt.appointment_time.slice(0, 5) : "TBD"}
                              </span>
                              {appt.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="size-3" /> {appt.location}
                                </span>
                              )}
                            </div>
                            {appt.notes && (
                              <p className="text-xs text-stone-500 mt-2 bg-stone-50 p-2 rounded-lg italic">
                                {appt.notes}
                              </p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex flex-col gap-1 shrink-0">
                            <button
                              onClick={() => handleEditClick(appt)}
                              className="p-1 text-stone-400 hover:text-stone-800 transition-colors cursor-pointer"
                              title="Edit appointment"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteClick(appt)}
                              className="p-1 text-stone-300 hover:text-destructive transition-colors cursor-pointer"
                              title="Delete appointment"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Add / Edit Dialog */}
      <Dialog 
        open={open} 
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setEditingAppt(null);
            resetFormState();
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold">
              {editingAppt ? "Edit Appointment" : "New Appointment"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="appt-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="appt-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Diabetes Checkup"
                maxLength={80}
              />
            </div>

            {/* Doctor */}
            <div className="space-y-1.5">
              <Label htmlFor="appt-doctor">
                Doctor / Hospital Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="appt-doctor"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="e.g. Dr. Sharma"
                maxLength={100}
              />
            </div>

            {/* Specialty */}
            <div className="space-y-1.5">
              <Label htmlFor="appt-specialty">
                Doctor Specialty <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="appt-specialty"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="e.g. Cardiologist"
                maxLength={80}
              />
            </div>

            {/* Location */}
            <div className="space-y-1.5">
              <Label htmlFor="appt-location">
                Location <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="appt-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. City Hospital, Room 102"
                maxLength={150}
              />
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="appt-date">
                  Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="appt-date"
                  type="date"
                  value={appointmentDate}
                  onChange={(e) => setAppointmentDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="appt-time">
                  Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="appt-time"
                  type="time"
                  value={appointmentTime}
                  onChange={(e) => setAppointmentTime(e.target.value)}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="appt-notes">
                Notes <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="appt-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Bring fasting blood reports"
                maxLength={200}
              />
            </div>

            {/* Reminders Toggle */}
            <div className="flex items-center justify-between p-3 bg-stone-50 rounded-2xl border border-stone-100">
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-stone-600" />
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">Enable Notifications</span>
                  <span className="text-[10px] text-muted-foreground">Receive reminders before visit</span>
                </div>
              </div>
              <input
                id="appt-reminders"
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
                className="size-4 accent-primary rounded cursor-pointer"
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              onClick={() => {
                if (!validateForm()) return;
                if (editingAppt) {
                  edit.mutate(editingAppt.id);
                } else {
                  add.mutate();
                }
              }}
              disabled={add.isPending || edit.isPending}
              className="w-full sm:w-auto"
            >
              {add.isPending || edit.isPending ? "Saving..." : "Save appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
