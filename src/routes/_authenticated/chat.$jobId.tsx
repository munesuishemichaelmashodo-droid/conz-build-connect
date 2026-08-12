import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, Check, CheckCheck, AlertTriangle, RotateCcw, Camera, Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/compress-image";
import { ChatImage, ChatAudio } from "@/components/ChatMedia";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/chat/$jobId")({
  component: ChatPage,
});

type Msg = {
  id: string;
  job_id: string;
  sender_id: string;
  body: string | null;
  image_url: string | null;
  audio_url: string | null;
  audio_duration_seconds: number | null;
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
    // Poll rather than realtime-subscribe: presence is inherently a bit
    // stale, and a 30s refetch keeps "Online"/"Last seen" close enough
    // without an extra channel subscription per chat.
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name,avatar_url,last_active_at").eq("id", otherId!).maybeSingle();
      return data;
    },
  });

  // Re-render every 30s purely to keep "Last seen 2 minutes ago" fresh even
  // if nothing else on the page changes.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Typing / recording indicator: a plain realtime broadcast, not stored
  // anywhere — the other party's browser sees the event live, nothing to
  // clean up if it's missed. We send our own status; peerStatus below is
  // what we've heard from them.
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [peerStatus, setPeerStatus] = useState<"idle" | "typing" | "recording">("idle");
  const peerIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const ch = supabase
      .channel(`typing:${jobId}`)
      .on("broadcast", { event: "status" }, (payload) => {
        const p = payload.payload as { userId: string; state: "idle" | "typing" | "recording" };
        if (p.userId === userId) return;
        setPeerStatus(p.state);
        // Safety net: if a "stopped typing" broadcast is ever dropped
        // (tab closed mid-type, flaky connection), don't leave the peer
        // stuck showing "Typing…" forever — clear it after a few seconds
        // of silence.
        if (peerIdleTimerRef.current) clearTimeout(peerIdleTimerRef.current);
        if (p.state !== "idle") {
          peerIdleTimerRef.current = setTimeout(() => setPeerStatus("idle"), 6000);
        }
      })
      .subscribe();
    typingChannelRef.current = ch;
    return () => {
      if (peerIdleTimerRef.current) clearTimeout(peerIdleTimerRef.current);
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
      // Let the peer know we're gone so they don't see a frozen "Typing…"
      // after we navigate away mid-message.
      ch.send({ type: "broadcast", event: "status", payload: { userId, state: "idle" } });
      supabase.removeChannel(ch);
      typingChannelRef.current = null;
    };
  }, [jobId, userId]);

  const sendStatus = (state: "idle" | "typing" | "recording") => {
    typingChannelRef.current?.send({ type: "broadcast", event: "status", payload: { userId, state } });
  };

  // Debounced typing broadcast: fire "typing" immediately on the first
  // keystroke, then "idle" 2s after the person stops, rather than one
  // broadcast per keystroke.
  const onBodyChange = (value: string) => {
    setBody(value);
    sendStatus("typing");
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = setTimeout(() => sendStatus("idle"), 2000);
  };

  const presence = useMemo(() => {
    if (peerStatus === "typing") return { online: true, label: "Typing…" };
    if (peerStatus === "recording") return { online: true, label: "Recording a voice note…" };
    const lastActive = otherProfile?.last_active_at;
    if (!lastActive) return { online: false, label: null as string | null };
    const diffMs = Date.now() - new Date(lastActive).getTime();
    if (diffMs < 2 * 60 * 1000) return { online: true, label: "Online" };
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return { online: false, label: `Last seen ${mins}m ago` };
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return { online: false, label: `Last seen ${hrs}h ago` };
    const days = Math.floor(hrs / 24);
    return { online: false, label: `Last seen ${days}d ago` };
  }, [otherProfile?.last_active_at, peerStatus]);

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
      Promise.resolve(
        (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<unknown>)(
          "mark_messages_read",
          { _job_id: jobId },
        ),
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

  const sendMessage = async (payload: {
    text?: string;
    imagePath?: string;
    audioPath?: string;
    audioDuration?: number;
  }) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Msg = {
      id: tempId,
      job_id: jobId,
      sender_id: userId!,
      body: payload.text ?? null,
      image_url: payload.imagePath ?? null,
      audio_url: payload.audioPath ?? null,
      audio_duration_seconds: payload.audioDuration ?? null,
      created_at: new Date().toISOString(),
      read_at: null,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);

    const { data, error } = await supabase
      .from("messages")
      .insert({
        job_id: jobId,
        sender_id: userId!,
        body: payload.text ?? null,
        image_url: payload.imagePath ?? null,
        audio_url: payload.audioPath ?? null,
        audio_duration_seconds: payload.audioDuration ?? null,
      } as any)
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
    await sendMessage({
      text: m.body ?? undefined,
      imagePath: m.image_url ?? undefined,
      audioPath: m.audio_url ?? undefined,
      audioDuration: m.audio_duration_seconds ?? undefined,
    });
  };

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const sendPhoto = async (file: File) => {
    setUploadingPhoto(true);
    try {
      const compressed = await compressImage(file);
      const path = `${jobId}/${userId}/${Date.now()}-${compressed.name.replace(/[^a-z0-9.]/gi, "_")}`;
      const { error: uploadErr } = await supabase.storage.from("chat-media").upload(path, compressed, {
        contentType: compressed.type || "image/jpeg",
      });
      if (uploadErr) throw new Error(uploadErr.message);
      await sendMessage({ imagePath: path });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send photo");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      sendStatus("recording");
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Could not access microphone — check your browser permissions.");
    }
  };

  const stopRecording = async (send: boolean) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    const duration = recordSeconds;
    setRecording(false);
    sendStatus("idle");

    const blob: Blob = await new Promise((resolve) => {
      recorder.addEventListener("stop", () => resolve(new Blob(audioChunksRef.current, { type: recorder.mimeType })), { once: true });
      recorder.stop();
    });
    mediaRecorderRef.current = null;

    if (!send || duration < 1) return; // treat as cancelled

    setUploadingAudio(true);
    try {
      const ext = blob.type.includes("webm") ? "webm" : "m4a";
      const path = `${jobId}/${userId}/${Date.now()}-voice.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("chat-media").upload(path, blob, { contentType: blob.type });
      if (uploadErr) throw new Error(uploadErr.message);
      await sendMessage({ audioPath: path, audioDuration: duration });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send voice note");
    } finally {
      setUploadingAudio(false);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody("");
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    sendStatus("idle");
    await sendMessage({ text });
  };

  const quickSend = async (text: string) => {
    await sendMessage({ text });
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
      <div className="flex items-center justify-between mb-3">
        <Link to="/jobs/$id" params={{ id: jobId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to job
        </Link>
        {presence.label && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("w-2 h-2 rounded-full", presence.online ? "bg-green-500" : "bg-muted-foreground/40")} />
            {presence.label}
          </span>
        )}
      </div>

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
                const isImageOnly = !!m.image_url && !m.audio_url && !m.body;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[75%]">
                      <div
                        className={
                          isImageOnly
                            ? `rounded-2xl overflow-hidden ${mine ? "rounded-br-sm" : "rounded-bl-sm"} ${
                                m.failed ? "opacity-60 border-2 border-destructive" : m.pending ? "opacity-60" : ""
                              }`
                            : `rounded-2xl px-3 py-2 text-sm ${
                                mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"
                              } ${m.failed ? "opacity-60 border-2 border-destructive" : m.pending ? "opacity-60" : ""}`
                        }
                      >
                        {m.image_url && <ChatImage path={m.image_url} />}
                        {m.audio_url && <ChatAudio path={m.audio_url} duration={m.audio_duration_seconds} />}
                        {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                        <div
                          className={`flex items-center gap-1 text-[10px] mt-1 ${
                            isImageOnly
                              ? `px-2 pb-1.5 ${mine ? "justify-end text-white drop-shadow" : "text-muted-foreground"}`
                              : mine
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
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
        <form onSubmit={send} className="border-t p-2 flex items-center gap-2">
          <input
            id="chat-photo-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) sendPhoto(f);
              e.target.value = "";
            }}
          />
          {recording ? (
            <div className="flex-1 flex items-center gap-2 rounded-xl border border-destructive bg-destructive/5 px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              <span className="text-sm text-destructive font-medium flex-1">
                Recording… {Math.floor(recordSeconds / 60)}:{(recordSeconds % 60).toString().padStart(2, "0")}
              </span>
              <button type="button" onClick={() => stopRecording(false)} className="text-xs text-muted-foreground">
                Cancel
              </button>
              <Button type="button" size="icon" onClick={() => stopRecording(true)} className="bg-destructive hover:bg-destructive/90">
                <Square className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={uploadingPhoto || uploadingAudio}
                onClick={() => document.getElementById("chat-photo-input")?.click()}
              >
                {uploadingPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              </Button>
              <Input value={body} onChange={(e) => onBodyChange(e.target.value)} placeholder="Type a message…" maxLength={1000} />
              {body.trim() ? (
                <Button type="submit" disabled={sending} size="icon"><Send className="w-4 h-4" /></Button>
              ) : (
                <Button type="button" variant="outline" size="icon" disabled={uploadingAudio || uploadingPhoto} onClick={startRecording}>
                  {uploadingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
            </>
          )}
        </form>
      </div>
    </AppShell>
  );
}
