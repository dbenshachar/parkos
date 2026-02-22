import { NextRequest, NextResponse } from "next/server";

import { getAuthSession } from "@/lib/account-session";
import { getSupabaseConfig } from "@/lib/account-store";
import {
  claimParkingNotification,
  fetchDueParkingNotifications,
  fetchParkingSessionById,
  fetchSmsDeliveryProfileById,
  markParkingNotificationFailed,
  markParkingNotificationSent,
  markParkingNotificationSkipped,
  updateParkingSession,
} from "@/lib/parking-agent/db";
import { buildPostPaymentTopRules, generateSmsText } from "@/lib/parking-agent/llm";
import { sendSmsMessage } from "@/lib/parking-agent/sms";
import type { ParkingNotificationRow } from "@/lib/parking-agent/types";

const DEFAULT_BASE_URL = "http://localhost:3000";
const LOCAL_TIMEZONE = "America/Los_Angeles";

function formatLocalTimestamp(iso: string | null): string {
  if (!iso) {
    return "Unknown time";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function minutesRemainingUntil(iso: string | null): number {
  if (!iso) {
    return 0;
  }

  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.floor((timestamp - Date.now()) / 60_000));
}

function appBaseUrl(): string {
  return process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

function cronAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return false;
  }

  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

function userTriggerAuthorized(request: NextRequest): { allowed: boolean; profileId: string | null } {
  if (request.headers.get("x-parkos-user-trigger") !== "1") {
    return { allowed: false, profileId: null };
  }

  const session = getAuthSession(request);
  if (!session?.profileId) {
    return { allowed: false, profileId: null };
  }

  return { allowed: true, profileId: session.profileId };
}

function notificationSkipReason(notification: ParkingNotificationRow): string {
  return `Notification ${notification.notification_type} skipped because SMS delivery is unavailable.`;
}

async function runTick(request: NextRequest) {
  const cronAllowed = cronAuthorized(request);
  const userTrigger = userTriggerAuthorized(request);
  if (!cronAllowed && !userTrigger.allowed) {
    return NextResponse.json({ error: "Unauthorized cron invocation." }, { status: 401 });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL or SUPABASE_API_KEY environment variables." },
      { status: 500 },
    );
  }

  const nowIso = new Date().toISOString();
  const dueNotifications = await fetchDueParkingNotifications(
    config,
    nowIso,
    cronAllowed ? 100 : 30,
    cronAllowed ? undefined : userTrigger.profileId || undefined,
  );
  if (!dueNotifications.ok) {
    return NextResponse.json({ error: dueNotifications.error }, { status: 502 });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let claimed = 0;

  for (const notification of dueNotifications.value) {
    const claimResult = await claimParkingNotification(config, notification);
    if (!claimResult.ok) {
      failed += 1;
      continue;
    }

    if (!claimResult.value) {
      continue;
    }
    claimed += 1;

    const activeNotification = claimResult.value;

    try {
      const sessionResult = await fetchParkingSessionById(config, activeNotification.parking_session_id);
      if (!sessionResult.ok || !sessionResult.value) {
        await markParkingNotificationFailed(
          config,
          activeNotification.id,
          sessionResult.ok ? "Associated parking session was not found." : sessionResult.error,
        );
        failed += 1;
        continue;
      }

      const session = sessionResult.value;
      if (session.status === "cancelled" || session.status === "renewed") {
        await markParkingNotificationSkipped(config, activeNotification.id, "Session is no longer active.");
        skipped += 1;
        continue;
      }

      const profileResult = await fetchSmsDeliveryProfileById(config, activeNotification.profile_id);
      if (!profileResult.ok || !profileResult.value) {
        await markParkingNotificationSkipped(config, activeNotification.id, notificationSkipReason(activeNotification));
        skipped += 1;
        continue;
      }

      const profile = profileResult.value;
      if (!profile.sms_opt_in || !profile.phone_e164) {
        await markParkingNotificationSkipped(config, activeNotification.id, notificationSkipReason(activeNotification));
        skipped += 1;
        continue;
      }

      const zone = session.confirmed_zone_number || session.captured_zone_number || "unknown";
      const renewUrl = `${appBaseUrl()}/parking?resume=${encodeURIComponent(session.resume_token)}`;

      let messageText = "";
      if (activeNotification.notification_type === "payment_confirmed") {
        messageText = await generateSmsText({
          type: "payment_confirmed",
          zone,
          durationMinutes: session.duration_minutes || 0,
          expiresLocal: formatLocalTimestamp(session.expires_at),
        });
      } else if (activeNotification.notification_type === "post_payment_info") {
        messageText = await generateSmsText({
          type: "post_payment_info",
          zone,
          topRules: buildPostPaymentTopRules(session.rules_rundown_json),
          timeLimitSummary:
            session.rules_rundown_json?.timeLimitSummary ||
            "Check posted signs for exact limits at your stall.",
          renewUrl,
        });
      } else if (activeNotification.notification_type === "renew_reminder") {
        messageText = await generateSmsText({
          type: "renew_reminder",
          zone,
          expiresLocal: formatLocalTimestamp(session.expires_at),
          minutesRemaining: minutesRemainingUntil(session.expires_at),
          renewUrl,
        });
      } else {
        messageText = await generateSmsText({
          type: "parking_expired",
          zone,
          expiredLocal: formatLocalTimestamp(session.expires_at),
          renewUrl,
        });
      }

      const sms = await sendSmsMessage({
        toPhoneE164: profile.phone_e164,
        text: messageText,
      });

      const markSent = await markParkingNotificationSent(config, activeNotification.id, messageText, sms.sid);
      if (!markSent.ok) {
        failed += 1;
        continue;
      }

      if (activeNotification.notification_type === "parking_expired") {
        await updateParkingSession(config, session.id, {
          status: "expired",
        });
      }

      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown notification error.";
      await markParkingNotificationFailed(config, activeNotification.id, message);
      failed += 1;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      scanned: dueNotifications.value.length,
      claimed,
      sent,
      skipped,
      failed,
    },
    { status: 200 },
  );
}

export async function GET(request: NextRequest) {
  return runTick(request);
}

export async function POST(request: NextRequest) {
  return runTick(request);
}
