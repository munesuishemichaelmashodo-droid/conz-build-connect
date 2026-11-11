import { useEffect, useState } from "react";

// `navigator.onLine === false` is reliable (the phone has no connection); `true` can still mean no real internet,
// so the banner only ever reports the definite "no signal" case and never claims the connection is good.

export function noSignalCopy(): { title: string; detail: string } {
  return {
    title: "No signal",
    detail:
      "Screens you already have open keep working. Anything that needs the internet, like sending a photo, a message or the PIN, will not go through until you are back online.",
  };
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(navigator.onLine !== false);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
