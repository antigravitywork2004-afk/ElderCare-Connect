import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useActiveParent } from "@/hooks/useProfile";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { askCompanion } from "@/lib/api/companion.functions";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  MessageCircleHeart,
  Send,
  Loader2,
  Clock,
  ListOrdered,
  Activity,
  HeartPulse,
  BookOpen,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Trash2,
  History,
  CalendarDays,
  ChevronLeft,
} from "lucide-react";
import { useVapi } from "@/hooks/useVapi";
import { format, isToday, isYesterday, parseISO } from "date-fns";

export const Route = createFileRoute("/_authenticated/companion")({
  ssr: false,
  component: CompanionPage,
});

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const MAX_QUEUE_SIZE = 10;

type QueuedMessage = {
  id: string;
  text: string;
  addedAt: number;
};

type ChatMessage = {
  id: string;
  parent_id: string;
  role: string;
  content: string;
  created_at: string;
};

/** Format a date string as a friendly label */
function formatDateLabel(dateStr: string): string {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d, yyyy");
}

function CompanionPage() {
  const { activeParentId, activeParent, isChildView } = useActiveParent();
  const qc = useQueryClient();
  const ask = useServerFn(askCompanion);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const { status: vapiStatus, startCall, stopCall, isMuted, toggleMute, isAvailable: vapiAvailable } = useVapi();

  // Chat history sidebar state
  const [showHistory, setShowHistory] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  // Rate-limit state
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [retryingIn, setRetryingIn] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);

  // Queue state
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const processingQueueRef = useRef(false);

  const isRateLimited = cooldownEnd !== null && Date.now() < cooldownEnd;

  // ── Fetch ALL messages for history ────────────────────────────────────────
  const { data: allMessages } = useQuery({
    queryKey: ["aiChat", activeParentId],
    enabled: !!activeParentId && !isChildView,
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_chat_messages")
        .select("*")
        .eq("parent_id", activeParentId!)
        .order("created_at");
      return (data ?? []) as ChatMessage[];
    },
  });

  // ── Group messages by date for history sidebar ─────────────────────────
  const messagesByDate = useMemo(() => {
    const grouped: Record<string, ChatMessage[]> = {};
    for (const m of allMessages ?? []) {
      const date = format(parseISO(m.created_at), "yyyy-MM-dd");
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(m);
    }
    return grouped;
  }, [allMessages]);

  // Dates sorted newest first for sidebar
  const historyDates = useMemo(
    () => Object.keys(messagesByDate).sort((a, b) => b.localeCompare(a)),
    [messagesByDate],
  );

  // Messages currently shown (filtered by selectedDate)
  const messages = useMemo(
    () => messagesByDate[selectedDate] ?? [],
    [messagesByDate, selectedDate],
  );

  // Auto-select today when a new message arrives in a different date view
  useEffect(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    if (historyDates.length > 0 && !messagesByDate[selectedDate]) {
      setSelectedDate(today);
    }
  }, [historyDates, messagesByDate, selectedDate]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, queue]);

  // ── Countdown timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!cooldownEnd) { setCountdown(0); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) setCooldownEnd(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownEnd]);

  function waitWithCountdown(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const totalSeconds = Math.ceil(ms / 1000);
      setRetryingIn(totalSeconds);
      let remaining = totalSeconds;
      const id = setInterval(() => {
        remaining -= 1;
        setRetryingIn(remaining);
        if (remaining <= 0) { clearInterval(id); setRetryingIn(0); resolve(); }
      }, 1000);
    });
  }

  // ── Core send with exponential backoff ────────────────────────────────────
  const sendWithRetry = useCallback(
    async (
      text: string,
      historyOverride?: { role: "user" | "assistant"; content: string }[],
    ): Promise<boolean> => {
      if (!activeParentId) return false;

      const history = historyOverride ?? [
        ...(allMessages ?? []).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: text },
      ];

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          setRetryAttempt(attempt);
          const result = await ask({
            data: {
              parentName: activeParent?.full_name,
              messages: history.slice(-20),
            },
          });

          if (result.error) {
            if (result.error === "rate_limit") {
              const waitSec = result.retryAfter ?? Math.pow(2, attempt + 1);
              if (attempt < MAX_RETRIES) {
                toast.warning(`Companion is busy — retrying in ${waitSec}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await waitWithCountdown(waitSec * 1000);
                continue;
              }
              const cooldownSec = result.retryAfter ?? 60;
              setCooldownEnd(Date.now() + cooldownSec * 1000);
              toast.error(`Companion is busy. Try again in ${cooldownSec}s.`);
              return false;
            }
            if (result.error === "credits_exhausted") {
              toast.error("AI credits exhausted. Please add credits to your OpenAI account.");
              return false;
            }
            if (result.error === "not_configured") {
              toast.error("AI Companion is not configured. Please add an OPENAI_API_KEY to your environment.");
              return false;
            }
            toast.error(result.message ?? "Something went wrong with the AI request.");
            return false;
          }

          if (result.reply) {
            await supabase
              .from("ai_chat_messages")
              .insert({ parent_id: activeParentId, role: "assistant", content: result.reply });
            await qc.invalidateQueries({ queryKey: ["aiChat"] });
            setRetryAttempt(0);
            return true;
          }
          return false;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Companion is unavailable";
          if (attempt < MAX_RETRIES && (msg.includes("429") || msg.includes("busy"))) {
            const delaySec = Math.pow(2, attempt + 1);
            toast.warning(`Companion is busy — retrying in ${delaySec}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await waitWithCountdown(delaySec * 1000);
            continue;
          }
          toast.error(msg);
          return false;
        }
      }
      setRetryAttempt(0);
      return false;
    },
    [activeParentId, activeParent, allMessages, ask, qc],
  );

  // ── Process queue ─────────────────────────────────────────────────────────
  const processQueue = useCallback(async () => {
    if (processingQueueRef.current || queue.length === 0) return;
    if (cooldownEnd && Date.now() < cooldownEnd) return;
    processingQueueRef.current = true;
    const remaining = [...queue];
    while (remaining.length > 0) {
      if (cooldownEnd && Date.now() < cooldownEnd) break;
      const item = remaining[0];
      setSending(true);
      await supabase.from("ai_chat_messages").insert({ parent_id: activeParentId!, role: "user", content: item.text });
      await qc.invalidateQueries({ queryKey: ["aiChat"] });
      const success = await sendWithRetry(item.text);
      if (success) {
        remaining.shift();
        setQueue((prev) => prev.filter((q) => q.id !== item.id));
        toast.success("Queued message sent!");
      } else { break; }
    }
    setSending(false);
    processingQueueRef.current = false;
  }, [queue, cooldownEnd, activeParentId, sendWithRetry, qc]);

  useEffect(() => {
    if (countdown === 0 && queue.length > 0 && !processingQueueRef.current) processQueue();
  }, [countdown, queue.length, processQueue]);

  // ── Send handler ──────────────────────────────────────────────────────────
  async function send() {
    const text = input.trim();
    if (!text || !activeParentId || isChildView) return;
    setInput("");
    // When sending, always switch to today's view so the response is visible
    const today = format(new Date(), "yyyy-MM-dd");
    setSelectedDate(today);

    if (isRateLimited) {
      if (queue.length >= MAX_QUEUE_SIZE) {
        toast.error(`Queue is full (max ${MAX_QUEUE_SIZE} messages). Please wait for the cooldown.`);
        return;
      }
      const queueItem: QueuedMessage = { id: crypto.randomUUID(), text, addedAt: Date.now() };
      setQueue((prev) => [...prev, queueItem]);
      await supabase.from("ai_chat_messages").insert({ parent_id: activeParentId, role: "user", content: text });
      await qc.invalidateQueries({ queryKey: ["aiChat"] });
      toast.info(`Message queued (${queue.length + 1}). Will send when companion is available.`);
      return;
    }

    setSending(true);
    try {
      await supabase.from("ai_chat_messages").insert({ parent_id: activeParentId, role: "user", content: text });
      await qc.invalidateQueries({ queryKey: ["aiChat"] });
      const history = [
        ...(allMessages ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: text },
      ];
      await sendWithRetry(text, history);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Companion is unavailable");
    } finally {
      setSending(false);
      setRetryAttempt(0);
    }
  }

  // ── Clear Chat mutation (clears messages for selected date only) ───────────
  const clearChat = useMutation({
    mutationFn: async () => {
      const toDelete = (messagesByDate[selectedDate] ?? []).map((m) => m.id);
      if (toDelete.length === 0) return;
      const { error } = await supabase
        .from("ai_chat_messages")
        .delete()
        .in("id", toDelete);
      if (error) throw new Error(error.message ?? "Failed to clear chat");
    },
    onSuccess: () => {
      toast.success("Chat cleared.");
      qc.invalidateQueries({ queryKey: ["aiChat"] });
      // If today was cleared, stay on today (will show empty state)
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to clear chat"),
  });

  function formatCooldownTime(): string {
    if (!cooldownEnd) return "";
    return new Date(cooldownEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const isViewingToday = selectedDate === format(new Date(), "yyyy-MM-dd");

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold italic">AI Companion</h1>
          <p className="text-muted-foreground mt-1">
            A friendly chat helper for {activeParent?.full_name ?? "you"}.
          </p>
        </div>
        {!isChildView && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory((v) => !v)}
            className="rounded-xl gap-2 shrink-0"
          >
            <History className="size-4" />
            {showHistory ? "Hide History" : "Chat History"}
          </Button>
        )}
      </div>

      <div className={`flex gap-4 ${showHistory ? "flex-col md:flex-row" : ""}`}>

        {/* ── History Sidebar ─────────────────────────────────────────── */}
        {showHistory && !isChildView && (
          <aside className="w-full md:w-56 shrink-0">
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="p-3 border-b border-border">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Conversations
                </p>
              </div>
              <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
                {/* "Today (new)" always shown at top if it doesn't exist yet */}
                {!messagesByDate[format(new Date(), "yyyy-MM-dd")] && (
                  <button
                    onClick={() => setSelectedDate(format(new Date(), "yyyy-MM-dd"))}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                      isViewingToday ? "bg-primary/5 text-primary font-medium" : "text-muted-foreground hover:bg-stone-50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <CalendarDays className="size-3.5 shrink-0" />
                      Today (new)
                    </span>
                  </button>
                )}
                {historyDates.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">No conversations yet</div>
                ) : (
                  historyDates.map((date) => {
                    const msgs = messagesByDate[date];
                    const isSelected = date === selectedDate;
                    return (
                      <button
                        key={date}
                        onClick={() => setSelectedDate(date)}
                        className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                          isSelected ? "bg-primary/5 text-primary font-medium" : "text-muted-foreground hover:bg-stone-50"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <CalendarDays className="size-3.5 shrink-0" />
                          <span className="truncate">{formatDateLabel(date)}</span>
                        </span>
                        <span className="text-xs text-muted-foreground/60 pl-5 mt-0.5 block">
                          {msgs.length} message{msgs.length !== 1 ? "s" : ""}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        )}

        {/* ── Main Chat Panel ──────────────────────────────────────────── */}
        <div className={`flex-1 bg-card border border-border rounded-3xl flex flex-col overflow-hidden ${showHistory ? "h-[65vh]" : "h-[65vh]"}`}>

          {/* Chat header with date + Clear button */}
          {!isChildView && (
            <div className="border-b border-border px-4 py-2 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {showHistory && (
                  <button
                    onClick={() => setSelectedDate(format(new Date(), "yyyy-MM-dd"))}
                    className="md:hidden p-1 hover:text-foreground"
                    title="Back to today"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                )}
                <CalendarDays className="size-4 shrink-0" />
                <span className="font-medium text-foreground">
                  {isViewingToday ? "Today" : formatDateLabel(selectedDate)}
                </span>
                {!isViewingToday && (
                  <button
                    onClick={() => setSelectedDate(format(new Date(), "yyyy-MM-dd"))}
                    className="text-xs text-primary hover:underline"
                  >
                    Back to today
                  </button>
                )}
              </div>
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={clearChat.isPending}
                  onClick={() => {
                    if (confirm(`Clear ${isViewingToday ? "today's" : "this"} chat? This cannot be undone.`)) {
                      clearChat.mutate();
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive gap-1.5 rounded-lg text-xs h-7 px-2"
                >
                  <Trash2 className="size-3.5" />
                  {clearChat.isPending ? "Clearing…" : "Clear chat"}
                </Button>
              )}
            </div>
          )}

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {isChildView ? (
              <div className="h-full grid place-items-center text-center text-muted-foreground p-6">
                <div className="max-w-sm">
                  <div className="size-16 rounded-3xl bg-secondary/10 text-secondary grid place-items-center mx-auto mb-4">
                    <MessageCircleHeart className="size-8" />
                  </div>
                  <p className="font-display text-xl font-bold text-foreground">Private Chat History</p>
                  <p className="text-sm mt-2 leading-relaxed">
                    To protect privacy, the personal AI Companion conversation history is private and not viewable by family members or caregivers.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {messages.length === 0 && !sending && (
                  <div className="h-full grid place-items-center text-center text-muted-foreground">
                    <div>
                      <MessageCircleHeart className="size-10 mx-auto mb-3 text-secondary" />
                      {isViewingToday ? (
                        <>
                          <p className="font-medium">Say hello to your companion</p>
                          <p className="text-sm mt-1">Ask anything, or get a gentle reminder about medicines and water.</p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium">No messages on this day</p>
                          <button onClick={() => setSelectedDate(format(new Date(), "yyyy-MM-dd"))} className="text-sm text-primary hover:underline mt-1">
                            Go to today's chat
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-accent text-accent-foreground"
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {sending && retryingIn > 0 && (
                  <div className="flex justify-start">
                    <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded-2xl px-4 py-2.5 text-sm flex items-center gap-2">
                      <Clock className="size-4 animate-pulse" />
                      Retrying in {retryingIn}s… <span className="text-xs opacity-70">(attempt {retryAttempt + 1}/{MAX_RETRIES})</span>
                    </div>
                  </div>
                )}
                {sending && retryingIn === 0 && (
                  <div className="flex justify-start">
                    <div className="bg-accent text-accent-foreground rounded-2xl px-4 py-2.5 text-sm flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> thinking…
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </>
            )}
          </div>

          {/* Rate limit banner */}
          {isRateLimited && !isChildView && (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
              <div className="flex items-center gap-2 text-sm text-amber-800 font-medium">
                <Clock className="size-4 shrink-0" />
                <span>Rate limited until {formatCooldownTime()} ({countdown}s remaining)</span>
              </div>
              {queue.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-700">
                  <ListOrdered className="size-3.5 shrink-0" />
                  <span>{queue.length} message{queue.length > 1 ? "s" : ""} queued — will send automatically</span>
                </div>
              )}
              <div className="text-xs text-amber-700 space-y-1">
                <p className="font-medium">While you wait, try:</p>
                <div className="flex flex-wrap gap-2">
                  <a href="/vitals" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/70 border border-amber-200 hover:bg-white transition-colors">
                    <Activity className="size-3" /> Check your vitals
                  </a>
                  <a href="/wellbeing" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/70 border border-amber-200 hover:bg-white transition-colors">
                    <HeartPulse className="size-3" /> Log wellness
                  </a>
                  <a href="/health-risk" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/70 border border-amber-200 hover:bg-white transition-colors">
                    <BookOpen className="size-3" /> AI Health Check
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Active voice call banner */}
          {vapiStatus === "active" && !isChildView && (
            <div className="border-t border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-green-800 font-medium">
                <span className="relative flex size-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full size-2.5 bg-green-500" />
                </span>
                Voice call active
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={toggleMute} className="rounded-full gap-1.5 text-xs border-green-300 text-green-800 hover:bg-green-100">
                  {isMuted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
                  {isMuted ? "Unmute" : "Mute"}
                </Button>
                <Button size="sm" variant="destructive" onClick={stopCall} className="rounded-full gap-1.5 text-xs">
                  <PhoneOff className="size-3.5" /> End call
                </Button>
              </div>
            </div>
          )}

          {/* Input bar — only shown when viewing today and not child */}
          {!isChildView && (
            <div className="border-t border-border p-4 flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !sending) send(); }}
                placeholder={
                  !isViewingToday
                    ? "Switch to Today to send a new message…"
                    : isRateLimited
                    ? `Type to queue a message (${queue.length}/${MAX_QUEUE_SIZE})…`
                    : "Type a message…"
                }
                disabled={!activeParentId || (sending && !isRateLimited) || !isViewingToday}
              />
              <Button
                onClick={send}
                disabled={
                  !activeParentId ||
                  !isViewingToday ||
                  (sending && !isRateLimited) ||
                  !input.trim() ||
                  (isRateLimited && queue.length >= MAX_QUEUE_SIZE)
                }
                className="rounded-xl px-4"
              >
                {isRateLimited ? <ListOrdered className="size-4" /> : <Send className="size-4" />}
              </Button>
              {vapiAvailable && vapiStatus === "idle" && (
                <Button
                  variant="outline"
                  onClick={startCall}
                  disabled={!activeParentId}
                  className="rounded-xl px-3 border-primary/30 text-primary hover:bg-primary/5"
                  title="Start a voice call with your companion"
                >
                  <PhoneCall className="size-4" />
                </Button>
              )}
              {vapiAvailable && vapiStatus === "connecting" && (
                <Button variant="outline" disabled className="rounded-xl px-3">
                  <Loader2 className="size-4 animate-spin" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
