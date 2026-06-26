import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent, useCurrentUser } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  FileText,
  Plus,
  Trash2,
  Download,
  Image as ImageIcon,
  TestTube2,
  Pill,
  Activity,
  FolderOpen,
  Upload,
  ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/records")({
  ssr: false,
  component: RecordsPage,
});

const BUCKET = "health-records";
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/jpg",   // some browsers report this; we normalise below
  "image/webp",
] as const;
const ALLOWED_EXT = ".pdf,application/pdf,image/jpeg,image/jpg,image/png,image/webp";

// Root cause fix: Some browsers report .jpg files as "image/jpg" but Supabase storage
// only allows "image/jpeg". Normalise before upload so the bucket MIME check passes.
function normaliseMime(type: string): string {
  return type === "image/jpg" ? "image/jpeg" : type;
}

type Category = "all" | "blood_test" | "prescription" | "ecg";

const categoryMeta: Record<
  Exclude<Category, "all">,
  { label: string; Icon: React.ElementType; bg: string; text: string; border: string }
> = {
  blood_test:   { label: "Blood Test",   Icon: TestTube2, bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200"   },
  prescription: { label: "Prescription", Icon: Pill,      bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200"  },
  ecg:          { label: "ECG",          Icon: Activity,  bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
};

type RecordRow = {
  id: string;
  title: string | null;
  record_type: string;
  category: Exclude<Category, "all">;
  record_date: string;
  doctor_name: string | null;
  notes: string | null;
  description: string | null;
  file_url: string | null;
  file_path: string | null;
  file_type: string | null;
  file_size: number | null;
};

type UploadForm = {
  title: string;
  category: Exclude<Category, "all"> | "";
  record_date: string;
  file: File | null;
};

const EMPTY_FORM: UploadForm = {
  title: "",
  category: "",
  record_date: format(new Date(), "yyyy-MM-dd"),
  file: null,
};

function RecordsPage() {
  const { data: user } = useCurrentUser();
  const { activeParentId, activeParent, isChildView } = useActiveParent();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<UploadForm>(EMPTY_FORM);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: records } = useQuery({
    queryKey: ["records", activeParentId],
    enabled: !!activeParentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("health_records")
        .select("*")
        .eq("parent_id", activeParentId!)
        .order("record_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RecordRow[];
    },
  });

  const filtered =
    activeCategory === "all"
      ? (records ?? [])
      : (records ?? []).filter((r) => r.category === activeCategory);

  function resetForm() {
    setForm(EMPTY_FORM);
    setProgress(0);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function validateUpload(): boolean {
    if (!form.category) {
      toast.error("Please select a category");
      return false;
    }
    if (!form.file) {
      toast.error("Please choose a file to upload.");
      return false;
    }
    // Check against normalised MIME type
    const normalisedType = normaliseMime(form.file.type);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(normalisedType)) {
      toast.error("Only PDF and image files (JPG, PNG, WebP) are allowed.");
      return false;
    }
    if (form.file.size > MAX_BYTES) {
      toast.error("File exceeds the 25 MB limit.");
      return false;
    }
    return true;
  }

  const upload = useMutation({
    mutationFn: async () => {
      if (isChildView) throw new Error("You do not have permission to modify health records.");
      if (!activeParentId || !user) throw new Error("Session error. Please refresh.");
      if (!validateUpload()) throw new Error("__validation__");

      const f = form.file!;
      const normType = normaliseMime(f.type);
      setUploading(true);
      setProgress(15);

      const ext = f.name.split(".").pop() ?? "bin";
      // Upload key: activeParentId must be the first folder segment so storage
      // RLS policy `(storage.foldername(name))[1] = auth.uid()` passes.
      const key = `${activeParentId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(key, f, { contentType: normType, upsert: false });

      if (upErr) {
        // Surface the actual Supabase error for diagnosis instead of generic message
        const msg = upErr.message || String(upErr);
        if (msg.toLowerCase().includes("bucket") || msg.toLowerCase().includes("not found")) {
          throw new Error("Storage bucket 'health-records' not found. Please apply database migrations and try again.");
        }
        if (msg.toLowerCase().includes("policy") || msg.toLowerCase().includes("rls") || msg.toLowerCase().includes("unauthorized")) {
          throw new Error("Upload permission denied. Ensure storage policies are applied. Details: " + msg);
        }
        throw new Error("Storage upload failed: " + msg);
      }
      setProgress(70);

      const title = form.title.trim() || f.name;
      const { error: dbErr } = await (supabase.from("health_records") as any).insert({
        parent_id: activeParentId,
        uploaded_by: user.id,
        title,
        record_type: form.category,
        category: form.category,
        record_date: form.record_date,
        file_path: key,
        file_type: normType,
        file_size: f.size,
      });

      if (dbErr) {
        // Best-effort cleanup of orphaned file
        await supabase.storage.from(BUCKET).remove([key]).catch(() => {});
        throw new Error("Database save failed: " + (dbErr.message || String(dbErr)));
      }
      setProgress(100);
    },
    onSuccess: () => {
      toast.success("Health record uploaded successfully.");
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ["records"] });
      qc.invalidateQueries({ queryKey: ["recentReports"] });
    },
    onError: (e: Error) => {
      setUploading(false);
      setProgress(0);
      if (e.message !== "__validation__") toast.error(e.message);
    },
  });

  const remove = useMutation({
    mutationFn: async (rec: RecordRow) => {
      if (isChildView) throw new Error("You do not have permission to modify health records.");
      if (rec.file_path) {
        const { error: stErr } = await supabase.storage.from(BUCKET).remove([rec.file_path]);
        // Log storage error but don't block DB delete
        if (stErr) console.warn("Storage remove error:", stErr.message);
      }
      const { error } = await supabase
        .from("health_records")
        .delete()
        .eq("id", rec.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Record deleted.");
      qc.invalidateQueries({ queryKey: ["records"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function openFile(rec: RecordRow) {
    try {
      if (rec.file_path) {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(rec.file_path, 300);
        if (error || !data?.signedUrl) {
          toast.error("Unable to open file: " + (error?.message ?? "unknown error"));
          return;
        }
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      } else if (rec.file_url) {
        window.open(rec.file_url, "_blank", "noopener,noreferrer");
      } else {
        toast.error("No file attached to this record.");
      }
    } catch (e) {
      toast.error("Unable to open file");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) { setForm({ ...form, file: null }); return; }
    const normType = normaliseMime(f.type);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(normType)) {
      toast.error("Only PDF and image files (JPG, PNG, WebP) are allowed.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("File exceeds the 25 MB limit.");
      e.target.value = "";
      return;
    }
    setForm({ ...form, file: f });
  }

  const counts = (records ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold italic">Health Records</h1>
          <p className="text-muted-foreground mt-1">
            Medical documents for {activeParent?.full_name ?? "—"}
          </p>
        </div>

        {!isChildView && activeParentId && (
          <Dialog
            open={open}
            onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}
          >
            <DialogTrigger asChild>
              <Button className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="size-4 mr-2" /> Upload record
              </Button>
            </DialogTrigger>

            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display">Upload health record</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Category <span className="text-destructive">*</span></Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) => setForm({ ...form, category: v as Exclude<Category, "all"> })}
                  >
                    <SelectTrigger id="record-category">
                      <SelectValue placeholder="Select a category…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blood_test">🩸 Blood Test</SelectItem>
                      <SelectItem value="prescription">💊 Prescription</SelectItem>
                      <SelectItem value="ecg">💓 ECG</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Title{" "}
                    <span className="text-xs text-muted-foreground">(optional — defaults to file name)</span>
                  </Label>
                  <Input
                    id="record-title"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. CBC Report June 2026"
                    maxLength={120}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Record date</Label>
                  <Input
                    type="date"
                    id="record-date"
                    value={form.record_date}
                    onChange={(e) => setForm({ ...form, record_date: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>
                    File <span className="text-destructive">*</span>{" "}
                    <span className="text-xs text-muted-foreground">PDF, JPG, PNG, WebP · max 25 MB</span>
                  </Label>
                  <label
                    htmlFor="record-file"
                    className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-6 cursor-pointer hover:bg-stone-50 transition-colors"
                  >
                    <Upload className="size-6 text-muted-foreground mb-2" />
                    {form.file ? (
                      <span className="text-sm font-medium text-foreground text-center break-all">
                        {form.file.name}{" "}
                        <span className="text-muted-foreground font-normal">
                          ({(form.file.size / 1024 / 1024).toFixed(2)} MB)
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Click to choose a file</span>
                    )}
                    <Input
                      id="record-file"
                      ref={fileInputRef}
                      type="file"
                      accept={ALLOWED_EXT}
                      className="sr-only"
                      onChange={handleFileChange}
                    />
                  </label>
                </div>

                {uploading && (
                  <div className="space-y-1.5">
                    <Label>Uploading…</Label>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button disabled={upload.isPending} onClick={() => upload.mutate()}>
                  {upload.isPending ? "Uploading…" : "Upload record"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Child read-only notice */}
      {isChildView && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-sm text-amber-800">
          <ShieldAlert className="size-4 shrink-0" />
          You are viewing {activeParent?.full_name}&apos;s health records in read-only mode.
        </div>
      )}

      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(
          [
            { value: "all" as const,          label: "All",         count: (records ?? []).length },
            { value: "blood_test" as const,   label: "Blood Test",  count: counts.blood_test ?? 0  },
            { value: "prescription" as const, label: "Prescription",count: counts.prescription ?? 0 },
            { value: "ecg" as const,          label: "ECG",         count: counts.ecg ?? 0          },
          ] as { value: Category; label: string; count: number }[]
        ).map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveCategory(tab.value)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all flex items-center gap-2 ${
              activeCategory === tab.value
                ? "bg-stone-900 text-white border-stone-900"
                : "bg-white text-muted-foreground border-border hover:bg-stone-50"
            }`}
          >
            {tab.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeCategory === tab.value ? "bg-white/20 text-white" : "bg-stone-100 text-stone-600"
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Records list */}
      <div className="bg-card border border-border rounded-3xl overflow-hidden">
        {!filtered || filtered.length === 0 ? (
          <div className="p-16 text-center text-muted-foreground">
            <FolderOpen className="size-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No health records found</p>
            {activeCategory !== "all" && (
              <p className="text-sm mt-1">
                No {categoryMeta[activeCategory as Exclude<Category,"all">]?.label} records yet.
              </p>
            )}
            {!isChildView && activeCategory === "all" && (
              <p className="text-sm mt-1">Upload the first record using the button above.</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((r) => {
              const isImg = r.file_type?.startsWith("image/");
              const meta = categoryMeta[r.category];
              const Icon = meta?.Icon ?? FileText;

              return (
                <div
                  key={r.id}
                  className="p-4 sm:p-6 flex items-start gap-4 hover:bg-stone-50/60 transition-colors group"
                >
                  <div className={`size-10 sm:size-12 rounded-2xl grid place-items-center shrink-0 ${
                    meta ? `${meta.bg} ${meta.text}` : "bg-stone-100 text-stone-600"
                  }`}>
                    {isImg ? <ImageIcon className="size-4 sm:size-5" /> : <Icon className="size-4 sm:size-5" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold truncate">{r.title || "Untitled record"}</p>
                      {meta && (
                        <span className={`text-xs font-mono px-2 py-0.5 rounded-full border shrink-0 ${meta.bg} ${meta.text} ${meta.border}`}>
                          {meta.label}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {format(new Date(r.record_date), "MMM d, yyyy")}
                      {r.doctor_name && ` · ${r.doctor_name}`}
                      {r.file_size != null && ` · ${(r.file_size / 1024 / 1024).toFixed(2)} MB`}
                    </p>
                    {(r.description || r.notes) && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 italic">
                        {r.description ?? r.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {(r.file_path || r.file_url) && (
                      <button
                        onClick={() => openFile(r)}
                        className="text-primary hover:opacity-80 p-2 transition-opacity"
                        title="Preview / download"
                      >
                        <Download className="size-4" />
                      </button>
                    )}
                    {isChildView ? (
                      <button
                        onClick={() => toast.error("You do not have permission to modify health records.")}
                        className="text-muted-foreground/30 cursor-not-allowed p-2"
                        title="Read-only"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${r.title || "this record"}"? This cannot be undone.`)) {
                            remove.mutate(r);
                          }
                        }}
                        disabled={remove.isPending}
                        className="text-muted-foreground hover:text-destructive p-2 transition-colors"
                        title="Delete record"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
