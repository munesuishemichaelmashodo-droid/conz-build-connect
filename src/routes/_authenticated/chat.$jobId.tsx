import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, Check, CheckCheck, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat/$jobId")({
  component: ChatPage,
});

type Msg = {
  id: string;
  job_id: string;
  sender_id: string;
  body: string | null;
  image_url: string | null;
  created_at: string;
  read_at: string | null;
  // Local-only state for optimistic sending — never persisted.
  pending?: boolean;
  failed?: boolean;
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function ChatPage() {
  const { jobId } = Route.useParams();
  const { userId } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const { data: job } = useQuery({
    queryKey: ["job-chat-meta", jobId],
    queryFn: async () => {
      const { data } = await supabase.from("jobs").select("id,customer_id,driver_id,material,custom_material,status").eq("id", jobId).maybeSingle();
      return data;
    },
  });

  const otherId = job ? (job.customer_id === userId ? job.driver_id : job.customer_id) : null;
  const isAssignedDriver = job ? job.driver_id === userId : false;

  const { data: otherProfile } = useQuery({
    queryKey: ["chat-peer", otherId],
    enabled: !!otherId,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name,avatar_url").eq("id", otherId!).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.from("messages").select("*").eq("job_id", jobId).order("created_at");
      if (mounted && data) setMessages(data as Msg[]);
    })();

    const channel = supabase
      .channel(`chat:${jobId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `job_id=eq.${jobId}` },
        (payload) => {
          const incoming = payload.new as Msg;
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            // Replace a matching optimistic/pending entry from us rather
            // than appending a duplicate.
            const pendingIdx = prev.findIndex((m) => m.pending && m.sender_id === incoming.sender_id && m.body === incoming.body);
            if (pendingIdx !== -1) {
              const next = [...prev];
              next[pendingIdx] = incoming;
              return next;
            }
            return [...prev, incoming];
          });
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `job_id=eq.${jobId}` },
        (payload) => {
          const updated = payload.new as Msg;
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, read_at: updated.read_at } : m)));
        })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [jobId]);

  // Mark the other party's messages as read whenever this page is open and
  // gains focus — closes the "did they even see this" gap.
  useEffect(() => {
    if (!jobId || !userId) return;
    const markRead = () => {
      (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<unknown>)(
        "mark_messages_read",
        { _job_id: jobId },
      ).catch(() => {});
    };
    markRead();
    const onFocus = () => markRead();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [jobId, userId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Msg = {
      id: tempId,
      job_id: jobId,
      sender_id: userId!,
      body: text,
      image_url: null,
      created_at: new Date().toISOString(),
      read_at: null,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);

    const { data, error } = await supabase
      .from("messages")
      .insert({ job_id: jobId, sender_id: userId!, body: text })
      .select()
      .single();

    setSending(false);

    if (error || !data) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === tempId ? (data as Msg) : m)));
  };

  const retry = async (m: Msg) => {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    await sendMessage(m.body ?? "");
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody("");
    await sendMessage(text);
  };

  const quickSend = async (text: string) => {
    await sendMessage(text);
  };

  const grouped = useMemo(() => {
    const out: Array<{ kind: "day"; label: string } | { kind: "msg"; m: Msg }> = [];
    let lastDay: string | null = null;
    for (const m of messages) {
      const day = new Date(m.created_at).toDateString();
      if (day !== lastDay) {
        out.push({ kind: "day", label: dayLabel(m.created_at) });
        lastDay = day;
      }
      out.push({ kind: "msg", m });
    }
    return out;
  }, [messages]);

  return (
    <AppShell title={otherProfile?.full_name ? `Chat · ${otherProfile.full_name}` : "Chat"}>
      <Link to="/jobs/$id" params={{ id: jobId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to job
      </Link>

      <div className="flex flex-col h-[calc(100vh-220px)] rounded-2xl bg-card border overflow-hidden">
        <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {messages.length === 0 && <p className="text-center text-xs text-muted-foreground py-8">No messages yet. Say hi 👋</p>}
          {grouped.map((item, i) =>
            item.kind === "day" ? (
              <div key={`day-${i}`} className="flex items-center justify-center py-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                  {item.label}
                </span>
              </div>
            ) : (
              (() => {
                const m = item.m;
                const mine = m.sender_id === userId;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[75%]">
                      <div
                        className={`rounded-2xl px-3 py-2 text-sm ${
                          mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"
                        } ${m.failed ? "opacity-60 border-2 border-destructive" : m.pending ? "opacity-60" : ""}`}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div className={`flex items-center gap-1 text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          {mine && !m.failed && !m.pending && (
                            m.read_at ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />
                          )}
                        </div>
                      </div>
                      {m.failed && (
                        <button
                          onClick={() => retry(m)}
                          className="mt-1 flex items-center gap-1 text-[11px] text-destructive ml-auto"
                        >
                          <AlertTriangle className="w-3 h-3" /> Not sent — tap to retry <RotateCcw className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()
            ),
          )}
        </div>
        {isAssignedDriver && job?.status === "accepted" && (
          <div className="border-t p-2">
            <Button variant="outline" size="sm" className="w-full" disabled={sending}
              onClick={() => quickSend("📦 I've arrived at the pickup point and I'm loading now.")}>
              I've arrived at pickup
            </Button>
          </div>
        )}
        {isAssignedDriver && job?.status === "in_progress" && (
          <div className="border-t p-2">
            <Button variant="outline" size="sm" className="w-full" disabled={sending}
              onClick={() => quickSend("🚚 I'm outside with your delivery — please send someone to receive it.")}>
              I'm outside with the delivery
            </Button>
          </div>
        )}
        <form onSubmit={send} className="border-t p-2 flex gap-2">
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type a message…" maxLength={1000} />
          <Button type="submit" disabled={sending || !body.trim()} size="icon"><Send className="w-4 h-4" /></Button>
        </form>
      </div>
    </AppShell>
  );
}
