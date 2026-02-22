"use client";

import { useEffect, useMemo, useState } from "react";

type SimulatedMessage = {
  id: string;
  notificationType: "payment_confirmed" | "post_payment_info" | "renew_reminder" | "parking_expired";
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  scheduledAt: string;
  sentAt: string | null;
  messageText: string | null;
  twilioMessageSid: string | null;
  lastError: string | null;
};

type SimulatedSession = {
  id: string;
  status: "captured" | "active" | "renewed" | "expired" | "cancelled";
  zoneNumber: string | null;
  durationMinutes: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type SimulatedMessagesResponse = {
  ok: boolean;
  session: SimulatedSession | null;
  notifications: SimulatedMessage[];
};

const TYPE_LABELS: Record<SimulatedMessage["notificationType"], string> = {
  payment_confirmed: "Payment Confirmed",
  post_payment_info: "Post Payment Info",
  renew_reminder: "Renewal Reminder",
  parking_expired: "Parking Expired",
};

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function fallbackMessage(notification: SimulatedMessage): string {
  if (notification.status === "queued" || notification.status === "sending") {
    return `Scheduled for ${formatTimestamp(notification.scheduledAt)}. Message body appears once sent.`;
  }

  if (notification.status === "failed") {
    return notification.lastError || "Failed to send this message.";
  }

  if (notification.status === "skipped") {
    return notification.lastError || "Skipped.";
  }

  return "Message text unavailable.";
}

function sortByScheduledAscending(a: SimulatedMessage, b: SimulatedMessage): number {
  const timeA = Date.parse(a.scheduledAt);
  const timeB = Date.parse(b.scheduledAt);
  const normalizedA = Number.isFinite(timeA) ? timeA : 0;
  const normalizedB = Number.isFinite(timeB) ? timeB : 0;

  if (normalizedA !== normalizedB) {
    return normalizedA - normalizedB;
  }

  return a.id.localeCompare(b.id);
}

function isOutgoingBubble(status: SimulatedMessage["status"]): boolean {
  return status === "sent";
}

export function SimulatedTextMessagesPanel() {
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<SimulatedMessagesResponse | null>(null);
  const orderedNotifications = useMemo(
    () => [...(result?.notifications || [])].sort(sortByScheduledAscending),
    [result?.notifications],
  );

  const loadMessages = async (sessionId: string) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      const response = await fetch(`/api/parking/session/messages${query}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => ({}))) as SimulatedMessagesResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load simulated text messages.");
      }

      setResult(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load simulated text messages.";
      setErrorMessage(message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sessionIdFromQuery = new URLSearchParams(window.location.search).get("sessionId")?.trim() || "";
    setSessionIdInput(sessionIdFromQuery);
    void loadMessages(sessionIdFromQuery);
  }, []);

  return (
    <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-black">Simulated Text Messages</h2>
          <p className="mt-1 text-sm text-black/70">
            Shows notification rows from DB for your latest parking session (or a specific session ID).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMessages(sessionIdInput.trim())}
          disabled={loading}
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
        <label className="text-sm text-black/80">
          Session ID (optional)
          <input
            value={sessionIdInput}
            onChange={(event) => setSessionIdInput(event.target.value)}
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
            placeholder="Leave blank for latest session"
          />
        </label>
        <button
          type="button"
          onClick={() => void loadMessages(sessionIdInput.trim())}
          disabled={loading}
          className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Load Session
        </button>
        <button
          type="button"
          onClick={() => {
            setSessionIdInput("");
            void loadMessages("");
          }}
          disabled={loading}
          className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Load Latest
        </button>
      </div>

      {errorMessage ? <p className="mt-3 text-sm text-red-700">{errorMessage}</p> : null}

      {result?.session ? (
        <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.02] p-4 text-sm text-black">
          <p>
            Session: <code>{result.session.id}</code>
          </p>
          <p>Status: {result.session.status}</p>
          <p>Zone: {result.session.zoneNumber || "N/A"}</p>
          <p>Duration: {result.session.durationMinutes ?? "N/A"} minutes</p>
          <p>Starts: {formatTimestamp(result.session.startsAt)}</p>
          <p>Expires: {formatTimestamp(result.session.expiresAt)}</p>
        </div>
      ) : null}

      {result && !result.session ? (
        <p className="mt-4 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 text-sm text-black/75">
          No parking session found yet for this account.
        </p>
      ) : null}

      <div className="mt-5 rounded-3xl border border-black/10 bg-zinc-100 p-3">
        <div className="mx-auto max-w-md overflow-hidden rounded-[28px] border border-black/15 bg-white shadow-sm">
          <div className="border-b border-black/10 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-black">ParkOS (Simulated SMS)</p>
            <p className="text-xs text-black/60">Oldest at top, newest at bottom</p>
          </div>

          <div className="max-h-[520px] space-y-3 overflow-y-auto bg-zinc-50/80 p-3">
            {!orderedNotifications.length ? (
              <div className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs text-black/65">
                No messages yet for this session.
              </div>
            ) : null}

            {orderedNotifications.map((notification) => {
              const outgoing = isOutgoingBubble(notification.status);
              const metaTime = notification.sentAt || notification.scheduledAt;

              return (
                <div key={notification.id} className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      outgoing
                        ? "rounded-br-md bg-blue-500 text-white"
                        : "rounded-bl-md border border-black/10 bg-white text-black"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{notification.messageText || fallbackMessage(notification)}</p>
                    <p
                      className={`mt-2 text-[11px] ${
                        outgoing ? "text-blue-100" : "text-black/60"
                      }`}
                    >
                      {TYPE_LABELS[notification.notificationType]} · {notification.status} · {formatTimestamp(metaTime)}
                    </p>
                    {notification.lastError ? (
                      <p className="mt-1 text-[11px] text-red-200">{notification.lastError}</p>
                    ) : null}
                    {notification.twilioMessageSid ? (
                      <p className={`mt-1 text-[11px] ${outgoing ? "text-blue-100" : "text-black/55"}`}>
                        SID: {notification.twilioMessageSid}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </article>
  );
}
