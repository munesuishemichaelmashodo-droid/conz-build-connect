import { useEffect, useState } from "react";

const KEY = "conz.locationSharingEnabled";

export function getLocationSharingEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(KEY);
  return v === null ? true : v === "true";
}

export function setLocationSharingEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("conz:location-sharing-changed", { detail: enabled }));
}

export function useLocationSharingEnabled(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => getLocationSharingEnabled());
  useEffect(() => {
    const onChange = (e: Event) => setEnabled((e as CustomEvent<boolean>).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setEnabled(e.newValue === null ? true : e.newValue === "true");
    };
    window.addEventListener("conz:location-sharing-changed", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("conz:location-sharing-changed", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [enabled, (v: boolean) => setLocationSharingEnabled(v)];
}
