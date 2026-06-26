// ElderCare Connect — Web Push service worker
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: "ElderCare alert", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "🚨 ElderCare SOS";
  const options = {
    body: payload.body || "Emergency alert received.",
    icon: payload.icon || "/favicon.ico",
    badge: payload.badge || "/favicon.ico",
    tag: payload.tag || "sos-alert",
    data: { url: payload.url || "/sos", alertId: payload.alertId || null },
    requireInteraction: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/sos";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      for (const c of all) {
        if ("focus" in c) {
          c.focus();
          if ("navigate" in c) c.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
