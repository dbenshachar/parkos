import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedProfile } from "@/lib/parking-agent/auth";
import {
  cancelPendingNotificationsForSession,
  createParkingNotifications,
  fetchParkingSessionById,
  updateParkingSession,
} from "@/lib/parking-agent/db";
import type { ParkingNotificationType } from "@/lib/parking-agent/types";

type ExecutePaymentRequest = {
  sessionId?: string;
  zoneNumber?: string;
  durationMinutes?: number;
  renewFromSessionId?: string | null;
};

const QUEUED_NOTIFICATION_TYPES: ParkingNotificationType[] = [
  "payment_confirmed",
  "post_payment_info",
  "renew_reminder",
  "parking_expired",
];

function parseDurationMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function plusSecondsIso(base: Date, seconds: number): string {
  return new Date(base.getTime() + seconds * 1000).toISOString();
}

function computeReminderAt(now: Date, expiresAt: Date, durationMinutes: number): string {
  if (durationMinutes < 10) {
    return plusSecondsIso(now, 60);
  }

  const reminderMillis = expiresAt.getTime() - 10 * 60 * 1000;
  if (reminderMillis <= now.getTime()) {
    return plusSecondsIso(now, 60);
  }

  return new Date(reminderMillis).toISOString();
}

async function executePayment(_input: {
  sessionId: string;
  zoneNumber: string;
  durationMinutes: number;
}): Promise<{ paymentStatus: "confirmed" }> {
  // Placeholder payment execution for hackathon mode.
  return { paymentStatus: "confirmed" };
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: ExecutePaymentRequest;
  try {
    body = (await request.json()) as ExecutePaymentRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const zoneNumber = typeof body.zoneNumber === "string" ? body.zoneNumber.trim() : "";
  const durationMinutes = parseDurationMinutes(body.durationMinutes);
  const renewFromSessionId = typeof body.renewFromSessionId === "string" ? body.renewFromSessionId.trim() : null;

  if (!sessionId || !zoneNumber || durationMinutes === null || durationMinutes <= 0) {
    return NextResponse.json(
      { error: "`sessionId`, `zoneNumber`, and positive `durationMinutes` are required." },
      { status: 400 },
    );
  }

  const sessionResult = await fetchParkingSessionById(auth.value.config, sessionId);
  if (!sessionResult.ok) {
    return NextResponse.json({ error: sessionResult.error }, { status: 502 });
  }

  const session = sessionResult.value;
  if (!session) {
    return NextResponse.json({ error: "Parking session not found." }, { status: 404 });
  }

  if (session.profile_id !== auth.value.profile.id) {
    return NextResponse.json({ error: "Unauthorized for this parking session." }, { status: 403 });
  }

  if (session.status === "cancelled") {
    return NextResponse.json({ error: "Cannot execute payment for a cancelled session." }, { status: 400 });
  }

  try {
    const paymentResult = await executePayment({
      sessionId,
      zoneNumber,
      durationMinutes,
    });

    const now = new Date();
    const startsAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
    const reminderAt = computeReminderAt(now, expiresAt, durationMinutes);

    const updateResult = await updateParkingSession(auth.value.config, session.id, {
      status: "active",
      confirmedZoneNumber: zoneNumber,
      durationMinutes,
      startsAt,
      expiresAt: expiresAt.toISOString(),
      renewParentSessionId: renewFromSessionId,
    });

    if (!updateResult.ok) {
      return NextResponse.json({ error: updateResult.error }, { status: 502 });
    }

    const notifications = await createParkingNotifications(auth.value.config, [
      {
        parkingSessionId: session.id,
        profileId: auth.value.profile.id,
        notificationType: "payment_confirmed",
        scheduledAt: startsAt,
      },
      {
        parkingSessionId: session.id,
        profileId: auth.value.profile.id,
        notificationType: "post_payment_info",
        scheduledAt: plusSecondsIso(now, 30),
      },
      {
        parkingSessionId: session.id,
        profileId: auth.value.profile.id,
        notificationType: "renew_reminder",
        scheduledAt: reminderAt,
      },
      {
        parkingSessionId: session.id,
        profileId: auth.value.profile.id,
        notificationType: "parking_expired",
        scheduledAt: expiresAt.toISOString(),
      },
    ]);

    if (!notifications.ok) {
      return NextResponse.json({ error: notifications.error }, { status: 502 });
    }

    if (renewFromSessionId) {
      const renewSource = await fetchParkingSessionById(auth.value.config, renewFromSessionId);
      if (renewSource.ok && renewSource.value && renewSource.value.profile_id === auth.value.profile.id) {
        await updateParkingSession(auth.value.config, renewFromSessionId, {
          status: "renewed",
        });

        await cancelPendingNotificationsForSession(auth.value.config, renewFromSessionId, [
          "renew_reminder",
          "parking_expired",
        ]);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        paymentStatus: paymentResult.paymentStatus,
        expiresAt: expiresAt.toISOString(),
        queuedNotifications: QUEUED_NOTIFICATION_TYPES,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Payment execute error:", error);
    return NextResponse.json({ error: "Failed to execute parking payment." }, { status: 500 });
  }
}
