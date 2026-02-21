import { NextResponse } from "next/server";

import {
  GooglePlacesConfigError,
  GooglePlacesLookupError,
  resolveDestinationWithGooglePlaces,
} from "@/lib/google-places";
import { recommendResidentialZonesByCoordinate } from "@/lib/parking-zones";
import { recommendPayByPhoneZonesByCoordinate } from "@/lib/paybyphone-zones";

type RecommendParkingRequest = {
  destination?: string;
  limit?: number;
};

const MAX_DESTINATION_DISTANCE_METERS = 1000;

function normalizeLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.max(1, Math.min(5, Math.floor(numeric)));
}

export async function POST(request: Request) {
  let body: RecommendParkingRequest;
  try {
    body = (await request.json()) as RecommendParkingRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const destination = body.destination?.trim();
  if (!destination) {
    return NextResponse.json({ error: "The `destination` field is required." }, { status: 400 });
  }

  const limit = normalizeLimit(body.limit);

  try {
    const resolvedDestination = await resolveDestinationWithGooglePlaces(destination);
    const paidCandidates = recommendPayByPhoneZonesByCoordinate(
      resolvedDestination.latitude,
      resolvedDestination.longitude,
      {
        limit: 5,
        paidOnly: true,
      },
    );

    if (paidCandidates.length === 0) {
      return NextResponse.json(
        { error: "No paid downtown parking zones were found for this destination." },
        { status: 502 },
      );
    }

    const nearestDistance = paidCandidates[0].distanceMeters;
    if (nearestDistance > MAX_DESTINATION_DISTANCE_METERS) {
      return NextResponse.json(
        {
          error:
            `Destination is too far from downtown paid parking zones (${Math.round(nearestDistance)}m away). Please refine your destination or choose one closer to downtown San Luis Obispo (within ${MAX_DESTINATION_DISTANCE_METERS}m).`,
        },
        { status: 422 },
      );
    }

    const residentialCandidates = recommendResidentialZonesByCoordinate(
      resolvedDestination.latitude,
      resolvedDestination.longitude,
      {
        limit: 5,
        maxDistanceMeters: MAX_DESTINATION_DISTANCE_METERS,
      },
    );

    const combined = [
      ...paidCandidates.map((item) => ({
        type: "paid" as const,
        zoneNumber: item.zoneNumber,
        price: item.price,
        street: resolvedDestination.street,
        intendedDestination: resolvedDestination.destination,
        distanceMeters: item.distanceMeters,
        zoneLat: item.zoneLat,
        zoneLng: item.zoneLng,
      })),
      ...residentialCandidates.map((item) => ({
        type: "residential" as const,
        zoneNumber: item.zoneId,
        price: "Permit required",
        street: resolvedDestination.street,
        intendedDestination: resolvedDestination.destination,
        distanceMeters: item.distanceMeters,
        zoneLat: item.zoneLat,
        zoneLng: item.zoneLng,
        district: item.district,
        hours: item.hours,
        description: item.description,
      })),
    ]
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, limit);

    const recommendations = combined
      .filter((item) => item.type === "paid")
      .map(({ type: _type, ...item }) => item);

    const residentialRecommendations = combined
      .filter((item) => item.type === "residential")
      .map(({ type: _type, ...item }) => item);

    return NextResponse.json(
      {
        destination: resolvedDestination.destination,
        street: resolvedDestination.street,
        destinationLat: resolvedDestination.latitude,
        destinationLng: resolvedDestination.longitude,
        nearestParkingDistanceMeters: nearestDistance,
        recommendations,
        residentialRecommendations,
        warnings: [],
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof GooglePlacesConfigError) {
      console.error("Parking recommend config error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof GooglePlacesLookupError) {
      console.error("Parking recommend Google lookup error:", {
        message: error.message,
        statusCode: error.statusCode,
      });
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error("Parking recommend unexpected error:", error);
    return NextResponse.json({ error: "Unexpected server error while recommending parking zones." }, { status: 500 });
  }
}
