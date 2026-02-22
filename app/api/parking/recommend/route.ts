import { NextResponse } from "next/server";

import {
  GooglePlacesConfigError,
  GooglePlacesLookupError,
  resolveDestinationWithGooglePlaces,
} from "@/lib/google-places";
import {
  normalizeRecommendationLimit,
  ParkingRecommendationError,
  recommendParkingForResolvedDestination,
} from "@/lib/parking-recommendation-engine";

type RecommendParkingRequest = {
  destination?: string;
  limit?: number;
};

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

  const limit = normalizeRecommendationLimit(body.limit);

  try {
    const resolvedDestination = await resolveDestinationWithGooglePlaces(destination);
    const recommendationResult = recommendParkingForResolvedDestination({
      resolvedDestination,
      limit,
      enforceDowntownDistance: true,
    });

    return NextResponse.json(
      {
        destination: recommendationResult.destination,
        street: recommendationResult.street,
        destinationLat: recommendationResult.destinationLat,
        destinationLng: recommendationResult.destinationLng,
        nearestParkingDistanceMeters: recommendationResult.nearestParkingDistanceMeters,
        recommendations: recommendationResult.recommendations,
        residentialRecommendations: recommendationResult.residentialRecommendations,
        warnings: recommendationResult.warnings,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ParkingRecommendationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
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
