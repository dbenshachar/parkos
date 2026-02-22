import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedProfile } from "@/lib/parking-agent/auth";
import { buildParkingContext } from "@/lib/parking-agent/context";
import { createParkingSession } from "@/lib/parking-agent/db";
import { generateRulesRundown } from "@/lib/parking-agent/llm";

const FALLBACK_RATE_BY_CATEGORY: Record<string, string | null> = {
  paid: "$2.75/hr",
  residential: "Permit required",
  none: null,
};

type CaptureRequest = {
  lat?: number;
  lng?: number;
  accuracyMeters?: number | null;
};

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeAccuracy(value: unknown): number | null {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) {
    return null;
  }
  return parsed >= 0 ? parsed : null;
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function generateResumeToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: CaptureRequest;
  try {
    body = (await request.json()) as CaptureRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const lat = parseFiniteNumber(body.lat);
  const lng = parseFiniteNumber(body.lng);
  const accuracyMeters = normalizeAccuracy(body.accuracyMeters);

  if (lat === null || lng === null || !isValidCoordinate(lat, lng)) {
    return NextResponse.json({ error: "Invalid or missing `lat`/`lng` coordinates." }, { status: 400 });
  }

  try {
    const context = await buildParkingContext({
      config: auth.value.config,
      lat,
      lng,
      accuracyMeters,
    });

    const rulesRundown = await generateRulesRundown(context);
    const resumeToken = generateResumeToken();

    const createdSession = await createParkingSession(auth.value.config, {
      profileId: auth.value.profile.id,
      status: "captured",
      parkedLat: lat,
      parkedLng: lng,
      parkedAccuracyMeters: accuracyMeters,
      capturedZoneNumber: context.session.zoneNumber,
      capturedRate:
        context.session.rate ||
        FALLBACK_RATE_BY_CATEGORY[context.session.category] ||
        null,
      capturedCategory: context.session.category,
      resumeToken,
      rulesContext: context,
      rulesRundown,
      renewParentSessionId: null,
    });

    if (!createdSession.ok) {
      return NextResponse.json({ error: createdSession.error }, { status: 502 });
    }

    return NextResponse.json(
      {
        ok: true,
        sessionId: createdSession.value.id,
        resumeToken,
        captured: {
          zoneNumber: context.session.zoneNumber,
          rate: context.session.rate,
          category: context.session.category,
        },
        rulesRundown,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Parking session capture error:", error);
    return NextResponse.json(
      { error: "Unexpected server error while capturing parking session." },
      { status: 500 },
    );
  }
}
