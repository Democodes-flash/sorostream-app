export interface NotificationEventPrefs {
  /** Notify when a stream finishes fully vesting/streaming. */
  streamCompleted: boolean;
  /** Notify ~24 hours before a stream is scheduled to expire. */
  expiringSoon: boolean;
  /** Notify when claimable funds become available to withdraw. */
  withdrawalAvailable: boolean;
  /** Notify when a new incoming stream is received (#523). */
  streamReceived: boolean;
  /** Notify when a sender cancels a stream you are receiving (#523). */
  streamCancelled: boolean;
}

export interface NotificationPrefs {
  /** Master switch — when false, no notifications are sent regardless of the settings below. */
  enabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  email: string;
  events: NotificationEventPrefs;
  /** When true, stream state-change events are POSTed to `webhookUrl`. */
  webhookEnabled: boolean;
  /** Destination for webhook POST events (must be an https:// URL). */
  webhookUrl: string;
}

const STORAGE_KEY = "sorostream_notification_prefs";

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  pushEnabled: false,
  emailEnabled: false,
  email: "",
  events: {
    streamCompleted: true,
    expiringSoon: true,
    withdrawalAvailable: true,
    streamReceived: true,
    streamCancelled: true,
  },
  webhookEnabled: false,
  webhookUrl: "",
};

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Validate a webhook URL. Requires a secure https:// endpoint (no secrets in
 * plain http), and must be a syntactically valid absolute URL.
 */
export function isValidWebhookUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export interface WebhookConfig {
  enabled: boolean;
  url: string;
}

export function getWebhookConfig(): WebhookConfig {
  const prefs = getNotificationPrefs();
  return { enabled: prefs.webhookEnabled, url: prefs.webhookUrl.trim() };
}

export function setWebhookConfig(next: WebhookConfig): NotificationPrefs {
  const prefs = getNotificationPrefs();
  const updated: NotificationPrefs = {
    ...prefs,
    webhookEnabled: next.enabled && isValidWebhookUrl(next.url),
    webhookUrl: next.url.trim(),
  };
  saveNotificationPrefs(updated);
  return updated;
}

export function getNotificationPrefs(): NotificationPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIFICATION_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_NOTIFICATION_PREFS;
    return {
      ...DEFAULT_NOTIFICATION_PREFS,
      ...parsed,
      events: { ...DEFAULT_NOTIFICATION_PREFS.events, ...(parsed.events ?? {}) },
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/** True when the browser supports the Notification API at all. */
export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Requests browser push permission. Resolves to the resulting permission state. */
export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}
