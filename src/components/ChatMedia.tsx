import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { signedChatMediaUrl } from "@/lib/chat-media";

export function ChatImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    signedChatMediaUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  if (!url) return <div className="w-40 h-40 rounded-lg bg-black/10 animate-pulse" />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Shared photo" className="max-w-[240px] max-h-[320px] rounded-lg object-cover" />
    </a>
  );
}

export function ChatAudio({ path, duration }: { path: string; duration: number | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    signedChatMediaUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const fmt = (s: number | null) => {
    if (!s && s !== 0) return "";
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (!url) return <div className="w-48 h-10 rounded-full bg-black/10 animate-pulse" />;

  return (
    <div className="flex items-center gap-2 w-48">
      <audio
        ref={audioRef}
        src={url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <button type="button" onClick={toggle} className="w-8 h-8 rounded-full bg-current/10 flex items-center justify-center shrink-0">
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex-1 h-1 rounded-full bg-current/20" />
      <span className="text-[10px] shrink-0">{fmt(duration)}</span>
    </div>
  );
}
