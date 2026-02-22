import { NextResponse } from "next/server";

import { lookupParkingZoneByCoordinate } from "@/lib/parking-zones";
import { lookupPayByPhoneZoneByCoordinate } from "@/lib/paybyphone-zones";

type CurrentZoneRequest = {
  lat?: number;
  lng?: number;
  accuracyMeters?: number;
};

type ZoneResponse = {
  category: "paid" | "residential" | "none";
  matchType: "inside" | "nearest" | "none";
  distanceMeters: number | null;
  zoneNumber: string | null;
  rate: string | null;
  paymentEligible: boolean;
  paymentEntryLabel: string;
  message: string;
};

const NEAREST_FALLBACK_METERS = 100;
const POOR_GPS_WARNING_METERS = 100;

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function normalizeAccuracy(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return value >= 0 ? value : null;
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function distanceLabel(matchType: "inside" | "nearest" | "none", distanceMeters: number | null): string {
  if (matchType !== "nearest" || distanceMeters === null) {
    return "";
  }
  return ` (~${Math.round(distanceMeters)}m away)`;
}

function buildSuccessPayload(
  lat: number,
  lng: number,
  accuracyMeters: number | null,
  zone: ZoneResponse,
  warnings: string[],
) {
  return {
    location: {
      lat,
      lng,
      accuracyMeters,
    },
    zone,
    snapshotAt: new Date().toISOString(),
    warnings,
  };
}

export async function POST(request: Request) {
  let body: CurrentZoneRequest;
  try {
    body = (await request.json()) as CurrentZoneRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const lat = parseFiniteNumber(body.lat);
  const lng = parseFiniteNumber(body.lng);
  const accuracyMeters = normalizeAccuracy(parseFiniteNumber(body.accuracyMeters));

  if (lat === null || lng === null || !isValidCoordinate(lat, lng)) {
    return NextResponse.json({ error: "Invalid or missing `lat`/`lng` coordinates." }, { status: 400 });
  }

  try {
    const warnings: string[] = [];
    if (accuracyMeters !== null && accuracyMeters > POOR_GPS_WARNING_METERS) {
      warnings.push(
        `GPS accuracy is currently low (${Math.round(accuracyMeters)}m). Zone detection may be approximate.`,
      );
    }

    const paidLookup = lookupPayByPhoneZoneByCoordinate(lat, lng, {
      nearestFallbackMeters: NEAREST_FALLBACK_METERS,
    });

    if (paidLookup.zone?.payByPhoneZone) {
      return NextResponse.json(
        buildSuccessPayload(
          lat,
          lng,
          accuracyMeters,
          {
            category: "paid",
            matchType: paidLookup.matchType,
            distanceMeters: paidLookup.distanceMeters,
            zoneNumber: paidLookup.zone.payByPhoneZone,
            rate: paidLookup.zone.meterZone,
            paymentEligible: true,
            paymentEntryLabel: "Proceed to Payment",
            message: `Paid Zone ${paidLookup.zone.payByPhoneZone} at ${paidLookup.zone.meterZone}${distanceLabel(
              paidLookup.matchType,
              paidLookup.distanceMeters,
            )}`,
          },
          warnings,
        ),
        { status: 200 },
      );
    }

    const residentialLookup = lookupParkingZoneByCoordinate(lat, lng, {
      nearestFallbackMeters: NEAREST_FALLBACK_METERS,
    });

    if (residentialLookup.zone) {
      return NextResponse.json(
        buildSuccessPayload(
          lat,
          lng,
          accuracyMeters,
          {
            category: "residential",
            matchType: residentialLookup.matchType,
            distanceMeters: residentialLookup.distanceMeters,
            zoneNumber: residentialLookup.zone.zoneId,
            rate: "Permit required",
            paymentEligible: false,
            paymentEntryLabel: "Residential permit area",
            message: `Residential Zone ${residentialLookup.zone.zoneId} (Permit required)${distanceLabel(
              residentialLookup.matchType,
              residentialLookup.distanceMeters,
            )}`,
          },
          warnings,
        ),
        { status: 200 },
      );
    }

    return NextResponse.json(
      buildSuccessPayload(
        lat,
        lng,
        accuracyMeters,
        {
          category: "none",
          matchType: "none",
          distanceMeters: null,
          zoneNumber: null,
          rate: null,
          paymentEligible: false,
          paymentEntryLabel: "No payment available",
          message:
            "No nearby paid or residential zone found within 100m. Move closer to marked parking streets/blocks.",
        },
        warnings,
      ),
      { status: 200 },
    );
  } catch (error) {
    console.error("Current zone lookup unexpected error:", error);
    return NextResponse.json({ error: "Unexpected server error while resolving current zone." }, { status: 500 });
  }
}
