import type { ResolvedDestination } from "@/lib/google-places";
import { recommendResidentialZonesByCoordinate } from "@/lib/parking-zones";
import { recommendPayByPhoneZonesByCoordinate } from "@/lib/paybyphone-zones";

export const MAX_DESTINATION_DISTANCE_METERS = 1000;
export const MAX_RESIDENTIAL_RECOMMENDATION_DISTANCE_METERS = 500;
export const NO_NEARBY_RESIDENTIAL_WARNING =
  `No residential zones found within ${MAX_RESIDENTIAL_RECOMMENDATION_DISTANCE_METERS}m of the destination.`;

const DEFAULT_RECOMMENDATION_LIMIT = 5;

export type PaidParkingRecommendation = {
  zoneNumber: string;
  price: string;
  street: string;
  intendedDestination: string;
  distanceMeters: number;
  zoneLat: number;
  zoneLng: number;
};

export type ResidentialParkingRecommendation = {
  zoneNumber: string;
  price: string;
  street: string;
  intendedDestination: string;
  distanceMeters: number;
  zoneLat: number;
  zoneLng: number;
  district: string;
  hours: string;
  description: string;
};

export type ParkingRecommendationResponse = {
  destination: string;
  street: string;
  destinationLat: number;
  destinationLng: number;
  nearestParkingDistanceMeters: number;
  recommendations: PaidParkingRecommendation[];
  residentialRecommendations: ResidentialParkingRecommendation[];
  warnings: string[];
};

export type ParkingRecommendationEngineResult = ParkingRecommendationResponse & {
  hasPaidCandidates: boolean;
  withinDowntownDistance: boolean;
  maxDowntownDistanceMeters: number;
};

type ParkingRecommendationErrorCode = "NO_PAID_ZONES" | "DESTINATION_TOO_FAR";

export class ParkingRecommendationError extends Error {
  code: ParkingRecommendationErrorCode;
  statusCode: number;

  constructor(message: string, code: ParkingRecommendationErrorCode, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizeRecommendationLimit(value: unknown, fallback = DEFAULT_RECOMMENDATION_LIMIT): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(1, Math.min(5, Math.floor(fallback)));
  }
  return Math.max(1, Math.min(5, Math.floor(numeric)));
}

export function recommendParkingForResolvedDestination(input: {
  resolvedDestination: ResolvedDestination;
  limit?: number;
  enforceDowntownDistance?: boolean;
  maxDowntownDistanceMeters?: number;
}): ParkingRecommendationEngineResult {
  const limit = normalizeRecommendationLimit(input.limit, DEFAULT_RECOMMENDATION_LIMIT);
  const maxDowntownDistanceMeters = Math.max(100, Math.floor(input.maxDowntownDistanceMeters ?? MAX_DESTINATION_DISTANCE_METERS));
  const enforceDowntownDistance = input.enforceDowntownDistance ?? true;
  const { resolvedDestination } = input;

  const paidCandidates = recommendPayByPhoneZonesByCoordinate(
    resolvedDestination.latitude,
    resolvedDestination.longitude,
    {
      limit,
      paidOnly: true,
    },
  );

  if (paidCandidates.length === 0) {
    throw new ParkingRecommendationError(
      "No paid downtown parking zones were found for this destination.",
      "NO_PAID_ZONES",
      502,
    );
  }

  const nearestParkingDistanceMeters = paidCandidates[0].distanceMeters;
  const withinDowntownDistance = nearestParkingDistanceMeters <= maxDowntownDistanceMeters;

  if (!withinDowntownDistance && enforceDowntownDistance) {
    throw new ParkingRecommendationError(
      `Destination is too far from downtown paid parking zones (${Math.round(nearestParkingDistanceMeters)}m away). Please refine your destination or choose one closer to downtown San Luis Obispo (within ${maxDowntownDistanceMeters}m).`,
      "DESTINATION_TOO_FAR",
      422,
    );
  }

  const residentialCandidates = recommendResidentialZonesByCoordinate(
    resolvedDestination.latitude,
    resolvedDestination.longitude,
    {
      limit,
      maxDistanceMeters: MAX_RESIDENTIAL_RECOMMENDATION_DISTANCE_METERS,
    },
  );

  const recommendations = paidCandidates.slice(0, limit).map((item) => ({
    zoneNumber: item.zoneNumber,
    price: item.price,
    street: resolvedDestination.street,
    intendedDestination: resolvedDestination.destination,
    distanceMeters: item.distanceMeters,
    zoneLat: item.zoneLat,
    zoneLng: item.zoneLng,
  }));

  const residentialRecommendations = residentialCandidates.slice(0, limit).map((item) => ({
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
  }));

  const warnings: string[] = [];
  if (residentialRecommendations.length === 0) {
    warnings.push(NO_NEARBY_RESIDENTIAL_WARNING);
  }

  return {
    destination: resolvedDestination.destination,
    street: resolvedDestination.street,
    destinationLat: resolvedDestination.latitude,
    destinationLng: resolvedDestination.longitude,
    nearestParkingDistanceMeters,
    recommendations,
    residentialRecommendations,
    warnings,
    hasPaidCandidates: true,
    withinDowntownDistance,
    maxDowntownDistanceMeters,
  };
}
