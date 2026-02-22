import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";

import { processPayByPhonePayment } from "@/app/backend/paybyphone";
import { requireAuthenticatedProfile } from "@/lib/parking-agent/auth";
import {
  cancelPendingNotificationsForSession,
  createParkingNotifications,
  fetchParkingSessionById,
  updateParkingSession,
} from "@/lib/parking-agent/db";
import type { ParkingNotificationType } from "@/lib/parking-agent/types";
import { ensureTrustedOrigin } from "@/lib/security/origin";

export const runtime = "nodejs";

type ExecutePaymentRequest = {
  sessionId?: string;
  zoneNumber?: string;
  durationMinutes?: number;
  renewFromSessionId?: string | null;
  paymentDetails?: {
    cardNumber?: string;
    cardCCV?: string;
    cardExpiration?: string;
    zipCode?: string;
    license?: string;
  };
};

type ExecutePaymentInput = {
  zoneNumber: string;
  durationMinutes: number;
  cardNumber: string;
  cardCCV: string;
  cardExpiration: string;
  zipCode: string;
  license: string;
  userName: string;
  email: string;
};

const QUEUED_NOTIFICATION_TYPES: ParkingNotificationType[] = [
  "payment_confirmed",
  "post_payment_info",
  "renew_reminder",
  "parking_expired",
];

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

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

function normalizeDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

function isLuhnValid(cardNumberDigits: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let i = cardNumberDigits.length - 1; i >= 0; i -= 1) {
    let digit = Number(cardNumberDigits[i]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function normalizeExpiration(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{2})\s*\/\s*(\d{2})$/) || trimmed.match(/^(\d{2})(\d{2})$/);
  if (!match) {
    return "";
  }
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) {
    return "";
  }
  const expiry = new Date(2000 + year, month, 0, 23, 59, 59, 999);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() < Date.now()) {
    return "";
  }
  return `${String(month).padStart(2, "0")}/${String(year).padStart(2, "0")}`;
}

function normalizeZipCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9 -]{3,10}$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function normalizeLicense(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9 -]{2,12}$/.test(normalized)) {
    return "";
  }
  return normalized;
}

async function executePayment(input: ExecutePaymentInput): Promise<{ paymentStatus: "confirmed" }> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await processPayByPhonePayment(page, {
      locationNumber: input.zoneNumber,
      duration: String(input.durationMinutes),
      cardNumber: input.cardNumber,
      cardCCV: input.cardCCV,
      cardExpiration: input.cardExpiration,
      userName: input.userName,
      email: input.email,
      zipCode: input.zipCode,
      license: input.license,
    });

    return { paymentStatus: "confirmed" };
  } finally {
    await browser.close();
  }
}

export async function POST(request: NextRequest) {
  const originViolation = ensureTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }

  let body: ExecutePaymentRequest;
  try {
    body = (await request.json()) as ExecutePaymentRequest;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const zoneNumber = typeof body.zoneNumber === "string" ? body.zoneNumber.trim() : "";
  const durationMinutes = parseDurationMinutes(body.durationMinutes);
  const renewFromSessionId = typeof body.renewFromSessionId === "string" ? body.renewFromSessionId.trim() : null;
  const paymentDetails = body.paymentDetails;

  if (!sessionId || !zoneNumber || durationMinutes === null || durationMinutes <= 0) {
    return jsonNoStore(
      { error: "`sessionId`, `zoneNumber`, and positive `durationMinutes` are required." },
      400,
    );
  }

  const sessionResult = await fetchParkingSessionById(auth.value.config, sessionId);
  if (!sessionResult.ok) {
    return jsonNoStore({ error: sessionResult.error }, 502);
  }

  const session = sessionResult.value;
  if (!session) {
    return jsonNoStore({ error: "Parking session not found." }, 404);
  }

  if (session.profile_id !== auth.value.profile.id) {
    return jsonNoStore({ error: "Unauthorized for this parking session." }, 403);
  }

  if (session.status === "cancelled") {
    return jsonNoStore({ error: "Cannot execute payment for a cancelled session." }, 400);
  }

  const cardNumber = typeof paymentDetails?.cardNumber === "string" ? normalizeDigits(paymentDetails.cardNumber) : "";
  const cardCCV = typeof paymentDetails?.cardCCV === "string" ? normalizeDigits(paymentDetails.cardCCV) : "";
  const cardExpiration =
    typeof paymentDetails?.cardExpiration === "string" ? normalizeExpiration(paymentDetails.cardExpiration) : "";
  const zipCode = typeof paymentDetails?.zipCode === "string" ? normalizeZipCode(paymentDetails.zipCode) : "";
  const licenseFromBody = typeof paymentDetails?.license === "string" ? paymentDetails.license.trim() : "";
  const licenseFromProfile = auth.value.profile.license_plate?.trim().toUpperCase() || "";
  const license = normalizeLicense(licenseFromBody || licenseFromProfile);
  const email = auth.value.profile.email?.trim() || "";
  const userName = auth.value.profile.username;

  if (!cardNumber || !cardCCV || !cardExpiration || !zipCode || !license) {
    return jsonNoStore(
      {
        error:
          "Missing payment details. Required: paymentDetails.cardNumber, paymentDetails.cardCCV, paymentDetails.cardExpiration, paymentDetails.zipCode, paymentDetails.license.",
      },
      400,
    );
  }
  if (cardNumber.length < 12 || cardNumber.length > 19 || !isLuhnValid(cardNumber)) {
    return jsonNoStore({ error: "Invalid card number." }, 400);
  }
  if (!/^\d{3,4}$/.test(cardCCV)) {
    return jsonNoStore({ error: "Invalid CCV." }, 400);
  }

  if (!email || !userName) {
    return jsonNoStore(
      { error: "Profile is missing username or email. Update your profile and retry." },
      400,
    );
  }

  try {
    const paymentResult = await executePayment({
      zoneNumber,
      durationMinutes,
      cardNumber,
      cardCCV,
      cardExpiration,
      zipCode,
      license,
      userName,
      email,
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
      return jsonNoStore({ error: updateResult.error }, 502);
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
      return jsonNoStore({ error: notifications.error }, 502);
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

    return jsonNoStore(
      {
        ok: true,
        paymentStatus: paymentResult.paymentStatus,
        expiresAt: expiresAt.toISOString(),
        queuedNotifications: QUEUED_NOTIFICATION_TYPES,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown payment execution error.";
    console.error("Payment execute error:", { message });
    return jsonNoStore({ error: "Failed to execute parking payment." }, 500);
  }
}
