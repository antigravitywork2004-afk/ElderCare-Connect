import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Video,
  Pencil,
  XCircle,
  ShieldAlert,
  Plus,
  Clock,
  CalendarDays,
  Upload,
  FileText,
  Download,
  ExternalLink,
  Stethoscope,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/video")({
  ssr: false,
  component: VideoPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type ConsultStatus =
  | "scheduled"
  | "waiting"
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

type Consult = {
  id: string;
  parent_id: string;
  doctor_name: string;
  specialty: string | null;
  consultation_reason: string | null;
  consultation_date: string | null;
  consultation_time: string | null;
  scheduled_at: string;
  meeting_url: string | null;
  notes: string | null;
  status: ConsultStatus;
  created_at: string;
  updated_at: string;
};

type Prescription = {
  id: string;
  consultation_id: string;
  parent_id: string;
  file_path: string;
  file_url: string | null;
  file_type: string;
  file_name: string | null;
  file_size: number | null;
  uploaded_at: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESCRIPTION_BUCKET = "prescriptions";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png"] as const;
const ALLOWED_EXT = ".pdf,application/pdf,image/jpeg,image/jpg,image/png";

const STATUS_CONFIG: Record<
  ConsultStatus,
  { label: string; bg: string; text: string; dot: string }
> = {
  scheduled: {
    label: "Scheduled",
    bg: "bg-blue-50",
    text: "text-blue-700",
    dot: "bg-blue-500",
  },
  waiting: {
    label: "Waiting",
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-400",
  },
  pending: {
    label: "Pending",
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-400",
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

const CANCELLABLE: ConsultStatus[] = ["scheduled", "waiting", "pending"];
const EDITABLE: ConsultStatus[] = ["scheduled", "waiting", "pending"];
const JOINABLE: ConsultStatus[] = ["scheduled", "waiting", "pending", "in_progress"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayString() {
  return format(new Date(), "yyyy-MM-dd");
}

function formatDisplayDate(d: string | null) {
  if (!d) return "—";
  try { return format(new Date(`${d}T00:00:00`), "EEE, MMM d, yyyy"); } catch { return d; }
}

function formatDisplayTime(t: string | null) {
  if (!t) return "—";
  try {
    const [h, m] = t.split(":");
    const d = new Date();
    d.setHours(parseInt(h), parseInt(m));
    return format(d, "h:mm a");
  } catch { return t; }
}

function generateJitsiRoom() {
  return `eldercare-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ConsultStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide ${cfg.bg} ${cfg.text}`}>
      <span className={`size-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function VideoPage() {
  const { activeParentId, activeParent, isChildView } = useActiveParent();
  const qc = useQueryClient();

  // ── dialogs ──
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingConsult, setEditingConsult] = useState<Consult | null>(null);
  const [uploadConsult, setUploadConsult] = useState<Consult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── form state ──
  const [doctorName, setDoctorName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [consultReason, setConsultReason] = useState("");
  const [consultDate, setConsultDate] = useState("");
  const [consultTime, setConsultTime] = useState("");
  const [notes, setNotes] = useState("");

  // ── upload state ──
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Queries ──────────────────────────────────────────────────────────────



  // Video consultations
  const { data: consults, isLoading } = useQuery({
    queryKey: ["video", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("video_consultations")
        .select("*")
        .eq("parent_id", activeParentId!)
        .order("consultation_date", { ascending: false })
        .order("consultation_time", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Consult[];
    },
  });



  const { data: prescriptions = [] } = useQuery({
    queryKey: ["prescriptions", activeParentId],
    queryFn: async () => {
      const consultIds = (consults ?? []).map((c) => c.id);
      if (consultIds.length === 0) return [] as Prescription[];
      const { data, error } = await supabase
        .from("consultation_prescriptions")
        .select("*")
        .in("consultation_id", consultIds)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Prescription[];
    },
    enabled: !!activeParentId && (consults?.length ?? 0) > 0,
  });

  // ─── Form helpers ──────────────────────────────────────────────────────────

  function resetForm() {
    setDoctorName("");
    setSpecialty("");
    setConsultReason("");
    setConsultDate("");
    setConsultTime("");
    setNotes("");
  }

  function openNew() {
    if (isChildView) {
      toast.error("You do not have permission to manage telehealth consultations.");
      return;
    }
    setEditingConsult(null);
    resetForm();
    setScheduleOpen(true);
  }

  function openEdit(c: Consult) {
    if (isChildView) {
      toast.error("You do not have permission to manage telehealth consultations.");
      return;
    }
    setEditingConsult(c);
    setDoctorName(c.doctor_name);
    setSpecialty(c.specialty ?? "");
    setConsultReason(c.consultation_reason ?? "");
    setConsultDate(c.consultation_date ?? "");
    setConsultTime(c.consultation_time ? c.consultation_time.slice(0, 5) : "");
    setNotes(c.notes ?? "");
    setScheduleOpen(true);
  }

  function closeSchedule() {
    setScheduleOpen(false);
    setEditingConsult(null);
    resetForm();
  }

  function closeUpload() {
    setUploadConsult(null);
    setUploadFile(null);
    setUploading(false);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  function validateConsult(): boolean {
    if (!doctorName.trim()) {
      toast.error("Doctor name is required.");
      return false;
    }
    if (!consultDate) {
      toast.error("Consultation date is required.");
      return false;
    }
    if (consultDate < todayString()) {
      toast.error("Please select a future date.");
      return false;
    }
    if (!consultTime) {
      toast.error("Consultation time is required.");
      return false;
    }
    if (!consultReason.trim()) {
      toast.error("Consultation reason is required.");
      return false;
    }
    return true;
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  const book = useMutation({
    mutationFn: async () => {
      if (isChildView) throw new Error("You do not have permission to manage telehealth consultations.");
      const room = generateJitsiRoom();
      const scheduledAt = new Date(`${consultDate}T${consultTime}`).toISOString();
      const { error } = await supabase.from("video_consultations").insert({
        parent_id: activeParentId!,
        requested_by: activeParentId!,
        doctor_name: doctorName.trim(),
        specialty: specialty.trim() || null,
        consultation_reason: consultReason.trim(),
        consultation_date: consultDate,
        consultation_time: consultTime,
        scheduled_at: scheduledAt,
        meeting_url: `https://meet.jit.si/${room}`,
        notes: notes.trim() || null,
        status: "scheduled",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Consultation scheduled successfully.");
      closeSchedule();
      qc.invalidateQueries({ queryKey: ["video"] });
    },
    onError: (e: Error) => {
      if (e.message.includes("permission")) toast.error(e.message);
      else toast.error("Please try again later.");
    },
  });

  const edit = useMutation({
    mutationFn: async (id: string) => {
      if (isChildView) throw new Error("You do not have permission to manage telehealth consultations.");
      const scheduledAt = new Date(`${consultDate}T${consultTime}`).toISOString();
      const { error } = await supabase
        .from("video_consultations")
        .update({
          doctor_name: doctorName.trim(),
          specialty: specialty.trim() || null,
          consultation_reason: consultReason.trim(),
          consultation_date: consultDate,
          consultation_time: consultTime,
          scheduled_at: scheduledAt,
          notes: notes.trim() || null,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Consultation updated successfully.");
      closeSchedule();
      qc.invalidateQueries({ queryKey: ["video"] });
    },
    onError: (e: Error) => {
      if (e.message.includes("permission")) toast.error(e.message);
      else toast.error("Please try again later.");
    },
  });

  const cancelConsult = useMutation({
    mutationFn: async (id: string) => {
      if (isChildView) throw new Error("You do not have permission to manage telehealth consultations.");
      const { error } = await supabase
        .from("video_consultations")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Consultation cancelled.");
      qc.invalidateQueries({ queryKey: ["video"] });
    },
    onError: (e: Error) => {
      if (e.message.includes("permission")) toast.error(e.message);
      else toast.error("Please try again later.");
    },
  });

  const uploadPrescription = useMutation({
    mutationFn: async () => {
      if (isChildView) throw new Error("You do not have permission to manage telehealth consultations.");
      if (!uploadFile) throw new Error("__validation__");
      if (!ALLOWED_MIME.includes(uploadFile.type as typeof ALLOWED_MIME[number])) {
        throw new Error("Only PDF and image files are allowed.");
      }
      if (uploadFile.size > MAX_BYTES) throw new Error("File exceeds the 25 MB limit.");
      if (!uploadConsult) throw new Error("No consultation selected.");

      setUploading(true);
      setUploadProgress(15);

      const ext = uploadFile.name.split(".").pop() ?? "bin";
      const key = `${activeParentId}/${uploadConsult.id}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(PRESCRIPTION_BUCKET)
        .upload(key, uploadFile, { contentType: uploadFile.type, upsert: false });
      if (upErr) throw new Error("Unable to upload prescription.");

      setUploadProgress(70);

      const { error: dbErr } = await supabase
        .from("consultation_prescriptions")
        .insert({
          consultation_id: uploadConsult.id,
          parent_id: activeParentId!,
          file_path: key,
          file_type: uploadFile.type,
          file_name: uploadFile.name,
          file_size: uploadFile.size,
        } as any);

      if (dbErr) {
        await supabase.storage.from(PRESCRIPTION_BUCKET).remove([key]);
        throw new Error("Unable to upload prescription.");
      }

      setUploadProgress(100);
    },
    onSuccess: () => {
      toast.success("Prescription uploaded successfully.");
      closeUpload();
      qc.invalidateQueries({ queryKey: ["prescriptions"] });
    },
    onError: (e: Error) => {
      setUploading(false);
      setUploadProgress(0);
      if (e.message !== "__validation__") toast.error(e.message);
    },
  });

  // ─── File handler ──────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) { setUploadFile(null); return; }
    if (!ALLOWED_MIME.includes(f.type as typeof ALLOWED_MIME[number])) {
      toast.error("Only PDF and image files are allowed.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("File exceeds the 25 MB limit.");
      e.target.value = "";
      return;
    }
    setUploadFile(f);
  }

  // ─── Open prescription ────────────────────────────────────────────────────

  async function openPrescription(p: Prescription) {
    try {
      const { data, error } = await supabase.storage
        .from(PRESCRIPTION_BUCKET)
        .createSignedUrl(p.file_path, 300);
      if (error || !data?.signedUrl) { toast.error("Unable to open file"); return; }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch { toast.error("Unable to open file"); }
  }

  // ─── Join consultation ────────────────────────────────────────────────────

  async function handleJoin(c: Consult) {
    if (!c.meeting_url) {
      toast.error("Consultation is not available.");
      return;
    }
    if (!JOINABLE.includes(c.status)) {
      toast.error("Consultation is not available.");
      return;
    }
    // Update status to in_progress when joining
    if (c.status !== "in_progress" && !isChildView) {
      await supabase
        .from("video_consultations")
        .update({ status: "in_progress" } as any)
        .eq("id", c.id);
      qc.invalidateQueries({ queryKey: ["video"] });
    }
    window.open(c.meeting_url, "_blank", "noopener,noreferrer");
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const activeConsults = (consults ?? []).filter(
    (c) => c.status !== "cancelled" && c.status !== "completed"
  );
  const historyConsults = (consults ?? []).filter(
    (c) => c.status === "cancelled" || c.status === "completed"
  );

  const getPrescriptions = (consultId: string) =>
    (prescriptions ?? []).filter((p) => p.consultation_id === consultId);

  const isPending = editingConsult ? edit.isPending : book.isPending;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold italic">Telehealth</h1>
          <p className="text-muted-foreground mt-1">
            Video consultations for {activeParent?.full_name ?? "—"}
          </p>
        </div>
        {!isChildView && (
          <Button
            disabled={!activeParentId}
            onClick={openNew}
            className="rounded-xl cursor-pointer"
            id="btn-new-consultation"
          >
            <Plus className="size-4 mr-2" />
            Schedule Consultation
          </Button>
        )}
      </div>

      {/* Child Read-Only Notice */}
      {isChildView && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-sm text-amber-800">
          <ShieldAlert className="size-4 shrink-0" />
          You do not have permission to manage telehealth consultations. Viewing in read-only mode.
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {(["scheduled", "waiting", "in_progress", "completed"] as ConsultStatus[]).map((s) => {
          const count = (consults ?? []).filter((c) => c.status === s).length;
          const cfg = STATUS_CONFIG[s];
          return (
            <div key={s} className="bg-card border border-border p-4 rounded-2xl flex flex-col gap-1">
              <span className={`text-[10px] font-mono uppercase tracking-widest ${cfg.text}`}>
                {cfg.label}
              </span>
              <p className="text-2xl font-bold">{count}</p>
            </div>
          );
        })}
      </div>

      {/* Consultations */}
      <div className="space-y-6">

        {/* Active */}
        <div>
          <h2 className="font-display text-xl font-bold mb-4">Upcoming Consultations</h2>
          {isLoading ? (
            <div className="bg-card border border-border rounded-3xl p-12 text-center text-muted-foreground animate-pulse">
              Loading consultations…
            </div>
          ) : activeConsults.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-3xl p-14 text-center text-muted-foreground">
              <Video className="size-10 mx-auto mb-3 opacity-30" />
              <p className="font-semibold text-base">No consultations found.</p>
              {!isChildView && (
                <p className="text-sm mt-1">Click "Schedule Consultation" to get started.</p>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-3xl overflow-hidden divide-y divide-border">
              {activeConsults.map((c) => (
                <ConsultRow
                  key={c.id}
                  consult={c}
                  isChildView={isChildView}
                  expanded={expandedId === c.id}
                  onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  prescriptions={getPrescriptions(c.id)}
                  onEdit={() => openEdit(c)}
                  onCancel={() => {
                    if (isChildView) { toast.error("You do not have permission to manage telehealth consultations."); return; }
                    if (confirm("Cancel this consultation? It will remain in history.")) cancelConsult.mutate(c.id);
                  }}
                  onJoin={() => handleJoin(c)}
                  onUploadRx={() => {
                    if (isChildView) { toast.error("You do not have permission to manage telehealth consultations."); return; }
                    setUploadConsult(c);
                  }}
                  onOpenRx={openPrescription}
                />
              ))}
            </div>
          )}
        </div>

        {/* History */}
        {historyConsults.length > 0 && (
          <div>
            <h2 className="font-display text-xl font-bold mb-4 text-muted-foreground">History</h2>
            <div className="bg-card border border-border rounded-3xl overflow-hidden divide-y divide-border opacity-75">
              {historyConsults.map((c) => (
                <ConsultRow
                  key={c.id}
                  consult={c}
                  isChildView={isChildView}
                  expanded={expandedId === c.id}
                  onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  prescriptions={getPrescriptions(c.id)}
                  onEdit={() => openEdit(c)}
                  onCancel={() => { }}
                  onJoin={() => handleJoin(c)}
                  onUploadRx={() => {
                    if (isChildView) { toast.error("You do not have permission to manage telehealth consultations."); return; }
                    setUploadConsult(c);
                  }}
                  onOpenRx={openPrescription}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Schedule / Edit Dialog ── */}
      <Dialog open={scheduleOpen} onOpenChange={(v) => { if (!v) closeSchedule(); else setScheduleOpen(true); }}>
        <DialogContent className="sm:max-w-[500px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold">
              {editingConsult ? "Edit Consultation" : "Schedule Consultation"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Doctor Name */}
            <div className="space-y-1.5">
              <Label htmlFor="vc-doctor">
                Doctor Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="vc-doctor"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="e.g. Dr. Sharma"
                maxLength={120}
              />
            </div>

            {/* Specialty */}
            <div className="space-y-1.5">
              <Label htmlFor="vc-specialty">
                Specialty <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="vc-specialty"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="e.g. Diabetologist"
                maxLength={80}
              />
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="vc-reason">
                Consultation Reason <span className="text-destructive">*</span>
              </Label>
              <Input
                id="vc-reason"
                value={consultReason}
                onChange={(e) => setConsultReason(e.target.value)}
                placeholder="e.g. Diabetes Follow-up"
                maxLength={200}
              />
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="vc-date">
                  Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="vc-date"
                  type="date"
                  value={consultDate}
                  min={todayString()}
                  onChange={(e) => setConsultDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vc-time">
                  Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="vc-time"
                  type="time"
                  value={consultTime}
                  onChange={(e) => setConsultTime(e.target.value)}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="vc-notes">
                Notes <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="vc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Patient recently switched insulin dosage"
                rows={3}
                maxLength={400}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeSchedule} disabled={isPending}>
              Cancel
            </Button>
            <Button
              id="btn-submit-consultation"
              onClick={() => {
                if (!validateConsult()) return;
                editingConsult ? edit.mutate(editingConsult.id) : book.mutate();
              }}
              disabled={isPending || !activeParentId}
            >
              {isPending
                ? editingConsult ? "Saving…" : "Scheduling…"
                : editingConsult ? "Save Changes" : "Schedule Consultation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Upload Prescription Dialog ── */}
      <Dialog open={!!uploadConsult} onOpenChange={(v) => { if (!v) closeUpload(); }}>
        <DialogContent className="sm:max-w-[440px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-bold">
              Upload Prescription
            </DialogTitle>
          </DialogHeader>

          {uploadConsult && (
            <div className="space-y-4 py-2">
              {/* Consult reference */}
              <div className="bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-xs text-stone-600">
                <span className="font-semibold">For:</span> Dr. {uploadConsult.doctor_name}
                {uploadConsult.consultation_reason && ` · ${uploadConsult.consultation_reason}`}
              </div>

              {/* File drop zone */}
              <div className="space-y-1.5">
                <Label>
                  File <span className="text-destructive">*</span>{" "}
                  <span className="text-xs text-muted-foreground">PDF, JPG, PNG · max 25 MB</span>
                </Label>
                <label
                  htmlFor="rx-file"
                  className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-6 cursor-pointer hover:bg-stone-50 transition-colors"
                >
                  <Upload className="size-6 text-muted-foreground mb-2" />
                  {uploadFile ? (
                    <span className="text-sm font-medium text-center break-all">
                      {uploadFile.name}{" "}
                      <span className="text-muted-foreground font-normal">
                        ({(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Click to choose a file</span>
                  )}
                  <Input
                    id="rx-file"
                    ref={fileInputRef}
                    type="file"
                    accept={ALLOWED_EXT}
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                </label>
              </div>

              {/* Progress */}
              {uploading && (
                <div className="space-y-1.5">
                  <Label>Uploading…</Label>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeUpload} disabled={uploadPrescription.isPending}>
              Cancel
            </Button>
            <Button
              id="btn-submit-prescription"
              onClick={() => uploadPrescription.mutate()}
              disabled={!uploadFile || uploadPrescription.isPending}
            >
              {uploadPrescription.isPending ? "Uploading…" : "Upload Prescription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// ─── Consult Row Component ────────────────────────────────────────────────────

function ConsultRow({
  consult: c,
  isChildView,
  expanded,
  onToggle,
  prescriptions,
  onEdit,
  onCancel,
  onJoin,
  onUploadRx,
  onOpenRx,
}: {
  consult: Consult;
  isChildView: boolean;
  expanded: boolean;
  onToggle: () => void;
  prescriptions: Prescription[];
  onEdit: () => void;
  onCancel: () => void;
  onJoin: () => void;
  onUploadRx: () => void;
  onOpenRx: (p: Prescription) => void;
}) {
  const canEdit = !isChildView && EDITABLE.includes(c.status);
  const canCancel = !isChildView && CANCELLABLE.includes(c.status);
  const canJoin = JOINABLE.includes(c.status) && !!c.meeting_url;
  const canUpload = !isChildView && (c.status === "completed" || c.status === "in_progress");
  const isActive = c.status === "in_progress" || c.status === "waiting";

  return (
    <div className={`hover:bg-stone-50/50 transition-colors ${isActive ? "border-l-4 border-emerald-400" : ""}`}>
      {/* Main row */}
      <div className="p-5 flex items-start gap-5">
        {/* Icon */}
        <div className={`size-12 rounded-2xl flex items-center justify-center shrink-0 ${isActive ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"
          }`}>
          <Video className="size-5" />
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-base">
              Dr. {c.doctor_name}
              {c.specialty && <span className="text-muted-foreground font-normal text-sm"> · {c.specialty}</span>}
            </p>
            <StatusBadge status={c.status} />
          </div>

          {c.consultation_reason && (
            <p className="text-sm text-stone-600 mt-0.5">{c.consultation_reason}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
            <span className="flex items-center gap-1">
              <CalendarDays className="size-3.5" />
              {formatDisplayDate(c.consultation_date)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {formatDisplayTime(c.consultation_time)}
            </span>
            {prescriptions.length > 0 && (
              <span className="flex items-center gap-1 text-blue-600 font-medium">
                <FileText className="size-3.5" />
                {prescriptions.length} prescription{prescriptions.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {c.notes && (
            <div className="bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 mt-2 text-xs text-stone-600 italic">
              {c.notes}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          {/* Join */}
          {canJoin && (
            <Button
              size="sm"
              id={`btn-join-${c.id}`}
              className="rounded-lg text-xs h-8 gap-1.5"
              onClick={onJoin}
            >
              <ExternalLink className="size-3" />
              Join
            </Button>
          )}

          <div className="flex items-center gap-1">
            {/* Edit */}
            {canEdit && (
              <button
                id={`btn-edit-${c.id}`}
                onClick={onEdit}
                className="p-2 text-stone-400 hover:text-stone-800 transition-colors cursor-pointer rounded-lg hover:bg-stone-100"
                title="Edit consultation"
              >
                <Pencil className="size-4" />
              </button>
            )}

            {/* Cancel */}
            {canCancel && (
              <button
                id={`btn-cancel-${c.id}`}
                onClick={onCancel}
                className="p-2 text-stone-400 hover:text-destructive transition-colors cursor-pointer rounded-lg hover:bg-red-50"
                title="Cancel consultation"
              >
                <XCircle className="size-4" />
              </button>
            )}

            {/* Upload Rx */}
            {canUpload && (
              <button
                id={`btn-upload-rx-${c.id}`}
                onClick={onUploadRx}
                className="p-2 text-stone-400 hover:text-blue-600 transition-colors cursor-pointer rounded-lg hover:bg-blue-50"
                title="Upload prescription"
              >
                <Upload className="size-4" />
              </button>
            )}

            {/* Expand */}
            {prescriptions.length > 0 && (
              <button
                onClick={onToggle}
                className="p-2 text-stone-400 hover:text-stone-700 transition-colors cursor-pointer rounded-lg hover:bg-stone-100"
                title={expanded ? "Collapse" : "View prescriptions"}
              >
                {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Prescriptions panel */}
      {expanded && prescriptions.length > 0 && (
        <div className="mx-5 mb-4 border border-border rounded-2xl overflow-hidden divide-y divide-border bg-stone-50/50">
          <div className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Prescriptions
          </div>
          {prescriptions.map((p) => {
            const isImg = p.file_type?.startsWith("image/");
            return (
              <div key={p.id} className="px-4 py-3 flex items-center gap-3">
                <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${isImg ? "bg-blue-50 text-blue-600" : "bg-stone-100 text-stone-600"}`}>
                  {isImg ? <Stethoscope className="size-4" /> : <FileText className="size-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.file_name ?? "Prescription"}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(p.uploaded_at), "MMM d, yyyy")}
                    {p.file_size && ` · ${(p.file_size / 1024 / 1024).toFixed(2)} MB`}
                  </p>
                </div>
                <button
                  onClick={() => onOpenRx(p)}
                  className="p-1.5 text-primary hover:opacity-80 transition-opacity"
                  title="View prescription"
                >
                  <Download className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
