import { expect, test } from "@playwright/test";

import {
  MAX_DESTINATION_DISTANCE_METERS,
  MAX_RESIDENTIAL_RECOMMENDATION_DISTANCE_METERS,
  NO_NEARBY_RESIDENTIAL_WARNING,
  ParkingRecommendationError,
  recommendParkingForResolvedDestination,
} from "../lib/parking-recommendation-engine";

function resolvedDestination(lat: number, lng: number, name = "Test Destination") {
  return {
    destination: name,
    street: `${name} Street`,
    formattedAddress: `${name}, San Luis Obispo, CA`,
    latitude: lat,
    longitude: lng,
    placeId: null,
  };
}

test("returns residential recommendations even when paid zones are closer", () => {
  const result = recommendParkingForResolvedDestination({
    resolvedDestination: resolvedDestination(35.281, -120.661, "Luna Red"),
    limit: 5,
    enforceDowntownDistance: true,
  });

  expect(result.recommendations.length).toBeGreaterThan(0);
  expect(result.residentialRecommendations.length).toBeGreaterThan(0);
  expect(result.residentialRecommendations[0]?.distanceMeters ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    MAX_RESIDENTIAL_RECOMMENDATION_DISTANCE_METERS,
  );
});

test("enforces 500m residential distance cap and emits deterministic warning", () => {
  const result = recommendParkingForResolvedDestination({
    resolvedDestination: resolvedDestination(35.27, -120.67, "Distance Cap Probe"),
    limit: 5,
    enforceDowntownDistance: true,
  });

  expect(result.nearestParkingDistanceMeters).toBeLessThanOrEqual(MAX_DESTINATION_DISTANCE_METERS);
  expect(result.residentialRecommendations).toEqual([]);
  expect(result.warnings).toContain(NO_NEARBY_RESIDENTIAL_WARNING);
});

test("applies limit per list", () => {
  const result = recommendParkingForResolvedDestination({
    resolvedDestination: resolvedDestination(35.281, -120.663, "Mission Plaza"),
    limit: 1,
    enforceDowntownDistance: true,
  });

  expect(result.recommendations).toHaveLength(1);
  expect(result.residentialRecommendations).toHaveLength(1);
});

test("keeps downtown enforcement behavior unchanged", () => {
  let thrown: unknown;
  try {
    recommendParkingForResolvedDestination({
      resolvedDestination: resolvedDestination(35.26, -120.67, "Far Destination"),
      enforceDowntownDistance: true,
    });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ParkingRecommendationError);
  expect((thrown as ParkingRecommendationError).code).toBe("DESTINATION_TOO_FAR");

  const relaxed = recommendParkingForResolvedDestination({
    resolvedDestination: resolvedDestination(35.26, -120.67, "Far Destination"),
    enforceDowntownDistance: false,
  });

  expect(relaxed.withinDowntownDistance).toBe(false);
  expect(relaxed.recommendations.length).toBeGreaterThan(0);
  expect(relaxed.warnings).toContain(NO_NEARBY_RESIDENTIAL_WARNING);
});

test("returns valid finite coordinates for all recommendation markers", () => {
  const result = recommendParkingForResolvedDestination({
    resolvedDestination: resolvedDestination(35.281, -120.661, "Coordinate Sanity"),
    limit: 5,
    enforceDowntownDistance: true,
  });

  const allPoints = [...result.recommendations, ...result.residentialRecommendations];
  expect(allPoints.length).toBeGreaterThan(0);

  for (const point of allPoints) {
    expect(Number.isFinite(point.zoneLat)).toBe(true);
    expect(Number.isFinite(point.zoneLng)).toBe(true);
    expect(point.zoneLat).toBeGreaterThanOrEqual(-90);
    expect(point.zoneLat).toBeLessThanOrEqual(90);
    expect(point.zoneLng).toBeGreaterThanOrEqual(-180);
    expect(point.zoneLng).toBeLessThanOrEqual(180);
  }
});
