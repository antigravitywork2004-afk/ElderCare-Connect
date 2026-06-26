// Client-side Web Push helpers.
// Calls the server functions in src/lib/api/pushNotify.functions.ts to persist subscriptions.

import { savePushSubscription, deletePushSubscription } from "@/lib/api/pushNotify.functions";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

function bufToBase64Url(buf: ArrayBuffer | null) {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getPushPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("Service workers not supported");
  const existing = await navigator.serviceWorker.getRegistration("/sw.js");
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function enablePushNotifications(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: "Push not supported in this browser" };

  const vapidPublic = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPublic) return { ok: false, reason: "VAPID public key not configured" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Permission denied" };

  const reg = await registerServiceWorker();
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublic),
    });
  }

  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh || bufToBase64Url(sub.getKey("p256dh"));
  const auth = json.keys?.auth || bufToBase64Url(sub.getKey("auth"));

  await savePushSubscription({
    data: {
      endpoint: sub.endpoint,
      p256dh,
      auth,
      userAgent: navigator.userAgent,
    },
  });

  return { ok: true };
}

export async function disablePushNotifications() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  try {
    await deletePushSubscription({ data: { endpoint } });
  } catch {
    /* ignore */
  }
}
