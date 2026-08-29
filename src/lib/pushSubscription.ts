/**
 * Web Push subscription management (#523)
 *
 * Handles the full lifecycle of a Web Push subscription:
 *   1. Register (or retrieve) the service worker.
 *   2. Subscribe to push messages using the server's VAPID public key.
 *   3. Store the subscription in localStorage for later reference.
 *   4. Provide helpers to unsubscribe and to send a local push via the SW.
 *
 * In production, the PushSubscription object would be sent to a back-end
 * endpoint that stores it and later calls `webpush.sendNotification()`.  For
 * the current mock implementation we rely on the service worker's
 * `showNotification()` directly via the broadcast channel so the full code
 * path is exercisable without a server.
 */

const SW_PATH = "/sw.js";
const SUBSCRIPTION_STORAGE_KEY = "sorostream_push_subscription";

/** VAPID public key from environment. Defaults to an empty string when absent. */
export const VAPID_PUBLIC_KEY =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "")
    : "";

/** True when the browser supports all the APIs required for Web Push. */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Convert a URL-safe base64 VAPID public key to the Uint8Array that
 *  PushManager.subscribe() expects as `applicationServerKey`. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/**
 * Register the service worker (idempotent) and return its registration.
 * Throws if service workers are not supported.
 */
async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }
  // Use an existing registration if available, otherwise register.
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_PATH);
}

/**
 * Subscribe the current browser to Web Push notifications.
 *
 * Returns the serialised PushSubscription so callers can POST it to the
 * server.  In the mock implementation we just persist it locally.
 *
 * Throws when:
 *   - The browser doesn't support Web Push.
 *   - Notification permission is denied.
 *   - No VAPID public key is configured.
 */
export async function subscribeToPush(): Promise<PushSubscription> {
  if (!isWebPushSupported()) {
    throw new Error("Web Push is not supported in this browser.");
  }
  if (Notification.permission === "denied") {
    throw new Error(
      "Notification permission was denied. Enable it in your browser settings.",
    );
  }
  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") {
      throw new Error(
        "Notification permission was denied. Enable it in your browser settings.",
      );
    }
  }

  const registration = await getServiceWorkerRegistration();

  // Unsubscribe any stale subscription before creating a fresh one.
  const existing = await registration.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();

  const subscribeOptions: PushSubscriptionOptionsInit = {
    userVisibleOnly: true,
    ...(VAPID_PUBLIC_KEY
      ? { applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }
      : {}),
  };

  const subscription = await registration.pushManager.subscribe(subscribeOptions);

  // Persist locally (production would POST to /api/push/subscribe).
  try {
    localStorage.setItem(
      SUBSCRIPTION_STORAGE_KEY,
      JSON.stringify(subscription.toJSON()),
    );
  } catch {
    // Non-fatal — the active subscription object is what matters.
  }

  return subscription;
}

/**
 * Unsubscribe the current browser from Web Push notifications and clear the
 * locally stored subscription.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  try {
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Returns the active PushSubscription for this browser, or null when not
 * subscribed.
 */
export async function getActivePushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

// ── Local notification dispatch ──────────────────────────────────────────────
// In the absence of a real push server, we send notifications by posting a
// message directly to the service worker, which then calls showNotification().

export interface PushPayload {
  title: string;
  body: string;
  /** Icon path relative to the public directory. */
  icon?: string;
  /** Absolute URL to open when the notification is clicked. */
  url?: string;
  /** Arbitrary tag used to deduplicate or replace a previous notification. */
  tag?: string;
}

/**
 * Dispatch a visible notification via the service worker.  The SW listens for
 * `sorostream-show-notification` messages and calls `self.registration.showNotification()`.
 *
 * Falls back to the Notification API directly when no SW is active yet.
 */
export async function dispatchPushNotification(payload: PushPayload): Promise<void> {
  if (!isWebPushSupported()) return;
  if (Notification.permission !== "granted") return;

  const registration = await navigator.serviceWorker.getRegistration(SW_PATH).catch(() => null);

  if (registration?.active) {
    registration.active.postMessage({
      type: "sorostream-show-notification",
      payload,
    });
    return;
  }

  // Fallback: direct Notification API (tab must be in focus for this to work).
  try {
    new Notification(payload.title, {
      body: payload.body,
      icon: payload.icon ?? "/icons/icon-192.png",
      tag: payload.tag,
    });
  } catch {
    // Silently ignore — notifications are non-critical.
  }
}
