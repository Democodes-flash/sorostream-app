"use client";
/**
 * /settings/notifications — notification preferences (#218, #523).
 *
 * Lets users opt into browser push and email notifications for stream
 * lifecycle events (completion, upcoming expiry, withdrawal availability,
 * stream received, stream cancelled), with a master switch to disable
 * everything at once. Preferences persist in localStorage; push additionally
 * requests OS-level permission via the browser Notification API and
 * registers a Web Push subscription via the service worker.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getNotificationPrefs,
  saveNotificationPrefs,
  requestPushPermission,
  isPushSupported,
  isValidEmail,
  isValidWebhookUrl,
  type NotificationPrefs,
  type NotificationEventPrefs,
} from "@/src/lib/notificationPrefs";
import {
  isWebPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  getActivePushSubscription,
  dispatchPushNotification,
} from "@/src/lib/pushSubscription";
import { dispatchWebhook } from "@/src/lib/webhooks";
import { useToast } from "@/src/lib/toast";

const EVENT_LABELS: { key: keyof NotificationEventPrefs; label: string; description: string }[] = [
  {
    key: "streamReceived",
    label: "Stream received",
    description: "A sender creates a new stream to your wallet address.",
  },
  {
    key: "withdrawalAvailable",
    label: "Withdrawal available",
    description: "New claimable funds are ready to withdraw.",
  },
  {
    key: "streamCancelled",
    label: "Stream cancelled",
    description: "A sender cancels a stream you are receiving.",
  },
  {
    key: "streamCompleted",
    label: "Stream completed",
    description: "A stream you created or receive has fully vested.",
  },
  {
    key: "expiringSoon",
    label: "Expiring soon",
    description: "A stream is scheduled to expire within 24 hours.",
  },
];

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
        checked ? "bg-green-600" : "bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function NotificationSettingsPage() {
  const { addToast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [pushPending, setPushPending] = useState(false);
  const [webhookInput, setWebhookInput] = useState("");
  const [webhookError, setWebhookError] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    const loaded = getNotificationPrefs();
    setPrefs(loaded);
    setEmailInput(loaded.email);
    setWebhookInput(loaded.webhookUrl);

    // Check whether a push subscription is already active so the UI reflects
    // the real browser state even if the saved pref is stale.
    if (isWebPushSupported()) {
      getActivePushSubscription()
        .then((sub) => setIsSubscribed(!!sub))
        .catch(() => setIsSubscribed(false));
    }
  }, []);

  function persist(next: NotificationPrefs) {
    setPrefs(next);
    saveNotificationPrefs(next);
  }

  async function handleTogglePush(next: boolean) {
    if (!prefs) return;
    if (!next) {
      // Unsubscribe from Web Push and update pref.
      try {
        await unsubscribeFromPush();
        setIsSubscribed(false);
      } catch {
        // Non-fatal — still update the pref.
      }
      persist({ ...prefs, pushEnabled: false });
      addToast("Browser push notifications disabled.", "info");
      return;
    }

    if (!isPushSupported()) {
      addToast("Browser push notifications aren't supported in this browser.", "error");
      return;
    }

    setPushPending(true);
    try {
      // Request OS notification permission first.
      const permission = await requestPushPermission();
      if (permission !== "granted") {
        addToast("Push permission was denied. Enable it in your browser settings to opt in.", "error");
        return;
      }

      // Subscribe via the service worker (Web Push API).
      if (isWebPushSupported()) {
        try {
          await subscribeToPush();
          setIsSubscribed(true);
        } catch (err) {
          // Subscription failed but permission is granted — fall back to
          // Notification-API-only mode (tab must be visible).
          const message = err instanceof Error ? err.message : "Push subscription failed.";
          addToast(`${message} Falling back to in-tab notifications.`, "info");
        }
      }

      persist({ ...prefs, pushEnabled: true });
      addToast("Browser push notifications enabled.", "success");
    } finally {
      setPushPending(false);
    }
  }

  async function handleSendTestPush() {
    if (!prefs?.pushEnabled) return;
    try {
      await dispatchPushNotification({
        title: "SoroStream — test notification",
        body: "Web Push is configured correctly. Stream events will appear here.",
        icon: "/icons/icon-192.png",
        url: "/dashboard",
        tag: "sorostream-test",
      });
      addToast("Test push notification sent.", "success");
    } catch {
      addToast("Failed to send test push notification.", "error");
    }
  }

  function handleSaveEmail() {
    if (!prefs) return;
    const trimmed = emailInput.trim();
    if (!trimmed) {
      setEmailError("Email address is required to enable email notifications.");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError("");
    persist({ ...prefs, emailEnabled: true, email: trimmed });
    addToast("Email notifications enabled.", "success");
  }

  function handleToggleEmail(next: boolean) {
    if (!prefs) return;
    if (!next) {
      setEmailError("");
      persist({ ...prefs, emailEnabled: false });
      return;
    }
    handleSaveEmail();
  }

  function handleToggleMaster(next: boolean) {
    if (!prefs) return;
    persist({ ...prefs, enabled: next });
    addToast(next ? "Notifications enabled." : "All notifications disabled.", "info");
  }

  function handleToggleEvent(key: keyof NotificationEventPrefs, next: boolean) {
    if (!prefs) return;
    persist({ ...prefs, events: { ...prefs.events, [key]: next } });
  }

  function handleSaveWebhook(enabled: boolean) {
    if (!prefs) return;
    const trimmed = webhookInput.trim();
    if (enabled && !isValidWebhookUrl(trimmed)) {
      setWebhookError("Enter a valid https:// webhook URL to enable webhooks.");
      return;
    }
    setWebhookError("");
    persist({ ...prefs, webhookEnabled: enabled, webhookUrl: trimmed });
    addToast(
      enabled ? "Webhook notifications enabled." : "Webhook notifications disabled.",
      "info",
    );
  }

  function handleToggleWebhook(next: boolean) {
    if (!prefs) return;
    if (!next) {
      setWebhookError("");
      persist({ ...prefs, webhookEnabled: false });
      return;
    }
    handleSaveWebhook(true);
  }

  async function handleSendTestWebhook() {
    if (!prefs) return;
    const trimmed = webhookInput.trim();
    if (!isValidWebhookUrl(trimmed)) {
      setWebhookError("Enter a valid https:// webhook URL before sending a test.");
      return;
    }
    setWebhookError("");
    setSendingTest(true);
    try {
      await dispatchWebhook({
        type: "stream.created",
        streamId: "test",
        timestamp: new Date().toISOString(),
        message: "SoroStream webhook test event",
      });
      addToast("Test event sent to your webhook.", "success");
    } catch {
      addToast("Failed to deliver test event.", "error");
    } finally {
      setSendingTest(false);
    }
  }

  if (!prefs) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="h-8 w-48 bg-gray-800 rounded animate-pulse" />
          <div className="h-32 bg-gray-800 rounded-xl animate-pulse" />
        </div>
      </main>
    );
  }

  const subControlsDisabled = !prefs.enabled;

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
      <div className="max-w-lg mx-auto">
        <div className="mb-4">
          <Link href="/settings" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← Settings
          </Link>
        </div>

        <h1 className="text-xl sm:text-2xl font-bold mb-6 sm:mb-8">Notification Preferences</h1>

        {/* Master switch */}
        <div className="bg-gray-800 rounded-xl p-6 mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Notifications</h2>
            <p className="text-gray-400 text-sm mt-1">
              Turn off to stop all stream notifications, regardless of the settings below.
            </p>
          </div>
          <Toggle checked={prefs.enabled} onChange={handleToggleMaster} label="Enable all notifications" />
        </div>

        {/* Browser Push (Web Push API) */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Browser Push</h2>
              <p className="text-gray-400 text-sm mt-1">
                Get on-device alerts even when the app isn&apos;t open.
                {isSubscribed && (
                  <span className="ml-2 text-green-400 text-xs font-medium">● Subscribed</span>
                )}
              </p>
            </div>
            <Toggle
              checked={prefs.pushEnabled}
              onChange={(next) => void handleTogglePush(next)}
              disabled={subControlsDisabled || pushPending}
              label="Enable browser push notifications"
            />
          </div>
          {!isPushSupported() && (
            <p className="text-yellow-400 text-xs">Push notifications aren&apos;t supported in this browser.</p>
          )}
          {prefs.pushEnabled && (
            <button
              type="button"
              onClick={() => void handleSendTestPush()}
              disabled={subControlsDisabled}
              className="text-xs text-green-400 hover:text-green-300 underline underline-offset-2 disabled:opacity-50 transition-colors"
            >
              Send test push notification
            </button>
          )}
        </div>

        {/* Email */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Email</h2>
              <p className="text-gray-400 text-sm mt-1">Receive alerts at an email address.</p>
            </div>
            <Toggle
              checked={prefs.emailEnabled}
              onChange={handleToggleEmail}
              disabled={subControlsDisabled}
              label="Enable email notifications"
            />
          </div>
          <div>
            <label htmlFor="notification-email" className="text-gray-200 text-sm font-medium block mb-1">
              Email address
            </label>
            <div className="flex gap-3">
              <input
                id="notification-email"
                type="email"
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setEmailError(""); }}
                placeholder="you@example.com"
                disabled={subControlsDisabled}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "notification-email-error" : undefined}
              />
              <button
                type="button"
                onClick={handleSaveEmail}
                disabled={subControlsDisabled}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                Save
              </button>
            </div>
            {emailError && (
              <p id="notification-email-error" role="alert" className="text-red-400 text-xs mt-1">
                {emailError}
              </p>
            )}
            {prefs.emailEnabled && !emailError && (
              <p className="text-green-400 text-xs mt-1">Email notifications active for {prefs.email}.</p>
            )}
          </div>
        </div>

        {/* Webhook */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Stream Webhook</h2>
              <p className="text-gray-400 text-sm mt-1">
                Receive a POST request whenever a stream changes state (created, withdrawn, cancelled, …).
              </p>
            </div>
            <Toggle
              checked={prefs.webhookEnabled}
              onChange={handleToggleWebhook}
              disabled={subControlsDisabled}
              label="Enable stream webhook notifications"
            />
          </div>
          <div>
            <label htmlFor="notification-webhook" className="text-gray-200 text-sm font-medium block mb-1">
              Webhook URL
            </label>
            <div className="flex gap-3">
              <input
                id="notification-webhook"
                type="url"
                value={webhookInput}
                onChange={(e) => { setWebhookInput(e.target.value); setWebhookError(""); }}
                placeholder="https://example.com/webhook"
                disabled={subControlsDisabled}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                aria-invalid={!!webhookError}
                aria-describedby={webhookError ? "notification-webhook-error" : undefined}
              />
              <button
                type="button"
                onClick={() => handleSendTestWebhook()}
                disabled={subControlsDisabled || sendingTest}
                className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-600 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                {sendingTest ? "Sending…" : "Send test"}
              </button>
            </div>
            {webhookError && (
              <p id="notification-webhook-error" role="alert" className="text-red-400 text-xs mt-1">
                {webhookError}
              </p>
            )}
            {prefs.webhookEnabled && !webhookError && (
              <p className="text-green-400 text-xs mt-1">Webhook events will be POSTed to {prefs.webhookUrl}.</p>
            )}
          </div>
        </div>

        {/* Event types — per-event opt-in controls (#523) */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-8">
          <div>
            <h2 className="text-lg font-semibold">Events</h2>
            <p className="text-gray-500 text-sm mt-1">
              Choose which stream events trigger push, email, and webhook notifications.
            </p>
          </div>
          <div className="space-y-4">
            {EVENT_LABELS.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-200">{label}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{description}</p>
                </div>
                <Toggle
                  checked={prefs.events[key] ?? true}
                  onChange={(next) => handleToggleEvent(key, next)}
                  disabled={subControlsDisabled}
                  label={label}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${
        checked ? "bg-green-600" : "bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function NotificationSettingsPage() {
  const { addToast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [pushPending, setPushPending] = useState(false);
  const [webhookInput, setWebhookInput] = useState("");
  const [webhookError, setWebhookError] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    const loaded = getNotificationPrefs();
    setPrefs(loaded);
    setEmailInput(loaded.email);
    setWebhookInput(loaded.webhookUrl);
  }, []);

  function persist(next: NotificationPrefs) {
    setPrefs(next);
    saveNotificationPrefs(next);
  }

  async function handleTogglePush(next: boolean) {
    if (!prefs) return;
    if (!next) {
      persist({ ...prefs, pushEnabled: false });
      return;
    }
    if (!isPushSupported()) {
      addToast("Browser push notifications aren't supported in this browser.", "error");
      return;
    }
    setPushPending(true);
    try {
      const permission = await requestPushPermission();
      if (permission === "granted") {
        persist({ ...prefs, pushEnabled: true });
        addToast("Browser push notifications enabled.", "success");
      } else {
        addToast("Push permission was denied. Enable it in your browser settings to opt in.", "error");
      }
    } finally {
      setPushPending(false);
    }
  }

  function handleSaveEmail() {
    if (!prefs) return;
    const trimmed = emailInput.trim();
    if (!trimmed) {
      setEmailError("Email address is required to enable email notifications.");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError("");
    persist({ ...prefs, emailEnabled: true, email: trimmed });
    addToast("Email notifications enabled.", "success");
  }

  function handleToggleEmail(next: boolean) {
    if (!prefs) return;
    if (!next) {
      setEmailError("");
      persist({ ...prefs, emailEnabled: false });
      return;
    }
    handleSaveEmail();
  }

  function handleToggleMaster(next: boolean) {
    if (!prefs) return;
    persist({ ...prefs, enabled: next });
    addToast(next ? "Notifications enabled." : "All notifications disabled.", "info");
  }

  function handleToggleEvent(key: keyof NotificationEventPrefs, next: boolean) {
    if (!prefs) return;
    persist({ ...prefs, events: { ...prefs.events, [key]: next } });
  }

  function handleSaveWebhook(enabled: boolean) {
    if (!prefs) return;
    const trimmed = webhookInput.trim();
    if (enabled && !isValidWebhookUrl(trimmed)) {
      setWebhookError("Enter a valid https:// webhook URL to enable webhooks.");
      return;
    }
    setWebhookError("");
    persist({ ...prefs, webhookEnabled: enabled, webhookUrl: trimmed });
    addToast(
      enabled ? "Webhook notifications enabled." : "Webhook notifications disabled.",
      "info",
    );
  }

  function handleToggleWebhook(next: boolean) {
    if (!prefs) return;
    if (!next) {
      setWebhookError("");
      persist({ ...prefs, webhookEnabled: false });
      return;
    }
    handleSaveWebhook(true);
  }

  async function handleSendTestWebhook() {
    if (!prefs) return;
    const trimmed = webhookInput.trim();
    if (!isValidWebhookUrl(trimmed)) {
      setWebhookError("Enter a valid https:// webhook URL before sending a test.");
      return;
    }
    setWebhookError("");
    setSendingTest(true);
    try {
      await dispatchWebhook({
        type: "stream.created",
        streamId: "test",
        timestamp: new Date().toISOString(),
        message: "SoroStream webhook test event",
      });
      addToast("Test event sent to your webhook.", "success");
    } catch {
      addToast("Failed to deliver test event.", "error");
    } finally {
      setSendingTest(false);
    }
  }

  if (!prefs) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="h-8 w-48 bg-gray-800 rounded animate-pulse" />
          <div className="h-32 bg-gray-800 rounded-xl animate-pulse" />
        </div>
      </main>
    );
  }

  const subControlsDisabled = !prefs.enabled;

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8">
      <div className="max-w-lg mx-auto">
        <div className="mb-4">
          <Link href="/settings" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← Settings
          </Link>
        </div>

        <h1 className="text-xl sm:text-2xl font-bold mb-6 sm:mb-8">Notification Preferences</h1>

        {/* Master switch */}
        <div className="bg-gray-800 rounded-xl p-6 mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Notifications</h2>
            <p className="text-gray-400 text-sm mt-1">
              Turn off to stop all stream notifications, regardless of the settings below.
            </p>
          </div>
          <Toggle checked={prefs.enabled} onChange={handleToggleMaster} label="Enable all notifications" />
        </div>

        {/* Push */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Browser Push</h2>
              <p className="text-gray-400 text-sm mt-1">
                Get on-device alerts even when the app isn&apos;t open.
              </p>
            </div>
            <Toggle
              checked={prefs.pushEnabled}
              onChange={(next) => void handleTogglePush(next)}
              disabled={subControlsDisabled || pushPending}
              label="Enable browser push notifications"
            />
          </div>
          {!isPushSupported() && (
            <p className="text-yellow-400 text-xs">Push notifications aren&apos;t supported in this browser.</p>
          )}
        </div>

        {/* Email */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Email</h2>
              <p className="text-gray-400 text-sm mt-1">Receive alerts at an email address.</p>
            </div>
            <Toggle
              checked={prefs.emailEnabled}
              onChange={handleToggleEmail}
              disabled={subControlsDisabled}
              label="Enable email notifications"
            />
          </div>
          <div>
            <label htmlFor="notification-email" className="text-gray-200 text-sm font-medium block mb-1">
              Email address
            </label>
            <div className="flex gap-3">
              <input
                id="notification-email"
                type="email"
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setEmailError(""); }}
                placeholder="you@example.com"
                disabled={subControlsDisabled}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "notification-email-error" : undefined}
              />
              <button
                type="button"
                onClick={handleSaveEmail}
                disabled={subControlsDisabled}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                Save
              </button>
            </div>
            {emailError && (
              <p id="notification-email-error" role="alert" className="text-red-400 text-xs mt-1">
                {emailError}
              </p>
            )}
            {prefs.emailEnabled && !emailError && (
              <p className="text-green-400 text-xs mt-1">Email notifications active for {prefs.email}.</p>
            )}
          </div>
        </div>

        {/* Webhook */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Stream Webhook</h2>
              <p className="text-gray-400 text-sm mt-1">
                Receive a POST request whenever a stream changes state (created, withdrawn, cancelled, …).
              </p>
            </div>
            <Toggle
              checked={prefs.webhookEnabled}
              onChange={handleToggleWebhook}
              disabled={subControlsDisabled}
              label="Enable stream webhook notifications"
            />
          </div>
          <div>
            <label htmlFor="notification-webhook" className="text-gray-200 text-sm font-medium block mb-1">
              Webhook URL
            </label>
            <div className="flex gap-3">
              <input
                id="notification-webhook"
                type="url"
                value={webhookInput}
                onChange={(e) => { setWebhookInput(e.target.value); setWebhookError(""); }}
                placeholder="https://example.com/webhook"
                disabled={subControlsDisabled}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                aria-invalid={!!webhookError}
                aria-describedby={webhookError ? "notification-webhook-error" : undefined}
              />
              <button
                type="button"
                onClick={() => handleSendTestWebhook()}
                disabled={subControlsDisabled || sendingTest}
                className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-600 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                {sendingTest ? "Sending…" : "Send test"}
              </button>
            </div>
            {webhookError && (
              <p id="notification-webhook-error" role="alert" className="text-red-400 text-xs mt-1">
                {webhookError}
              </p>
            )}
            {prefs.webhookEnabled && !webhookError && (
              <p className="text-green-400 text-xs mt-1">Webhook events will be POSTed to {prefs.webhookUrl}.</p>
            )}
          </div>
        </div>

        {/* Event types */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4 mb-8">
          <h2 className="text-lg font-semibold">Events</h2>
          <div className="space-y-4">
            {EVENT_LABELS.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-200">{label}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{description}</p>
                </div>
                <Toggle
                  checked={prefs.events[key]}
                  onChange={(next) => handleToggleEvent(key, next)}
                  disabled={subControlsDisabled}
                  label={label}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
