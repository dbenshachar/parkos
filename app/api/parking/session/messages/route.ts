import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedProfile } from "@/lib/parking-agent/auth";
import {
  fetchLatestParkingSessionForProfile,
  fetchParkingNotificationsBySessionId,
  fetchParkingSessionById,
} from "@/lib/parking-agent/db";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) {
    return auth.response;
  }

  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() || "";
  let sessionResult;

  if (sessionId) {
    sessionResult = await fetchParkingSessionById(auth.value.config, sessionId);
  } else {
    sessionResult = await fetchLatestParkingSessionForProfile(auth.value.config, auth.value.profile.id);
  }

  if (!sessionResult.ok) {
    return NextResponse.json({ error: sessionResult.error }, { status: 502 });
  }

  const session = sessionResult.value;
  if (!session) {
    return NextResponse.json(
      {
        ok: true,
        session: null,
        notifications: [],
      },
      { status: 200 },
    );
  }

  if (session.profile_id !== auth.value.profile.id) {
    return NextResponse.json({ error: "Unauthorized for this parking session." }, { status: 403 });
  }

  const notificationsResult = await fetchParkingNotificationsBySessionId(auth.value.config, session.id);
  if (!notificationsResult.ok) {
    return NextResponse.json({ error: notificationsResult.error }, { status: 502 });
  }

  return NextResponse.json(
    {
      ok: true,
      session: {
        id: session.id,
        status: session.status,
        zoneNumber: session.confirmed_zone_number || session.captured_zone_number,
        durationMinutes: session.duration_minutes,
        startsAt: session.starts_at,
        expiresAt: session.expires_at,
        createdAt: session.created_at,
      },
      notifications: notificationsResult.value.map((item) => ({
        id: item.id,
        notificationType: item.notification_type,
        status: item.status,
        scheduledAt: item.scheduled_at,
        sentAt: item.sent_at,
        messageText: item.message_text,
        twilioMessageSid: item.twilio_message_sid,
        lastError: item.last_error,
      })),
    },
    { status: 200 },
  );
}
