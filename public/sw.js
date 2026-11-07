// Con Z service worker — handles incoming push notifications and routes a
// tap on one to the relevant page (a specific job's chat/tracking, or the
// app home if there's no job context).

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
