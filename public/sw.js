// Con Z service worker. Two jobs:
//  1. Push: shows incoming notifications and routes a tap on one to the relevant page (a specific job's chat/tracking,
//     or the app home if there is no job context).
//  2. No-signal fallback: when a PAGE cannot load, answer with /offline.html, which shows the delivery details saved on
//     this phone (see src/lib/offline-card.ts). It never caches the app and never touches data requests.

const OFFLINE_CACHE = "conz-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  // Best effort: a failed precache must never stop the worker (and push) from installing.
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("conz-offline-") && k !== OFFLINE_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .catch(() => {}),
  );
});

// Same rule as shouldServeOfflinePage in src/lib/offline-fallback.ts: only a page being opened, by a plain GET.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  event.respondWith(
    fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Con Z", body: "", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // ignore malformed payloads
  }

  // One notification per job: a new-job alert and a dispatch offer for the same job replace
  // each other instead of stacking, and the replacement still buzzes the phone.
  const jobMatch = /\/jobs\/([0-9a-f-]{36})/i.exec(data.url || "");
  const options = {
    body: data.body,
    icon: "/conz-icon-192.png",
    badge: "/conz-icon-192.png",
    data: { url: data.url || "/" },
  };
  if (jobMatch) {
    options.tag = "job-" + jobMatch[1];
    options.renotify = true;
  }

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
