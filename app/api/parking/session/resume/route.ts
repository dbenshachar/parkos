import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedProfile } from "@/lib/parking-agent/auth";
import { fetchParkingSessionByResumeToken } from "@/lib/parking-agent/db";

function isExpired(expiresAtIso: string | null): boolean {
  if (!expiresAtIso) {
    return false;
  }

  const timestamp = Date.parse(expiresAtIso);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return timestamp <= Date.now();
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedProfile(request);
  if (!auth.ok) {
    return auth.response;
  }

  const token = request.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Missing `token` query parameter." }, { status: 400 });
  }

  const sessionResult = await fetchParkingSessionByResumeToken(auth.value.config, token);
  if (!sessionResult.ok) {
    return NextResponse.json({ error: sessionResult.error }, { status: 502 });
  }

  const session = sessionResult.value;
  if (!session) {
    return NextResponse.json({ error: "Parking session not found for this resume token." }, { status: 404 });
  }

  if (session.profile_id !== auth.value.profile.id) {
    return NextResponse.json({ error: "Unauthorized for this parking session." }, { status: 403 });
  }

  const expired = isExpired(session.expires_at);

  return NextResponse.json(
    {
      ok: true,
      session: {
        id: session.id,
        status: session.status,
        lat: session.parked_lat,
        lng: session.parked_lng,
        accuracyMeters: session.parked_accuracy_meters,
        zoneNumber: session.confirmed_zone_number || session.captured_zone_number,
        capturedRate: session.captured_rate,
        durationMinutes: session.duration_minutes,
        startsAt: session.starts_at,
        expiresAt: session.expires_at,
        isExpired: expired,
        rulesRundown: session.rules_rundown_json,
      },
    },
    { status: 200 },
  );
}
