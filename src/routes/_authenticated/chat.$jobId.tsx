import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat/$jobId")({
  component: ChatPage,
});

type Msg = { id: string; job_id: string; sender_id: string; body: string | null; image_url: string | null; created_at: string };

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
        (payload) => setMessages((prev) => [...prev, payload.new as Msg]))
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [jobId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    const { error } = await supabase.from("messages").insert({ job_id: jobId, sender_id: userId!, body: text });
    setSending(false);
    if (error) return toast.error(error.message);
    setBody("");
  };

  return (
    <AppShell title={otherProfile?.full_name ? `Chat · ${otherProfile.full_name}` : "Chat"}>
      <Link to="/jobs/$id" params={{ id: jobId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to job
      </Link>

      <div className="flex flex-col h-[calc(100vh-220px)] rounded-2xl bg-card border overflow-hidden">
        <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {messages.length === 0 && <p className="text-center text-xs text-muted-foreground py-8">No messages yet. Say hi 👋</p>}
          {messages.map((m) => {
            const mine = m.sender_id === userId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <form onSubmit={send} className="border-t p-2 flex gap-2">
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type a message…" maxLength={1000} />
          <Button type="submit" disabled={sending || !body.trim()} size="icon"><Send className="w-4 h-4" /></Button>
        </form>
      </div>
    </AppShell>
  );
}
