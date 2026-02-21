import parkingZonesGeoJson from "@/data/slo-street-parking.json";
import payByParkZoneCrosswalk from "@/data/paybypark-zone-crosswalk.json";

type Position = [number, number];
type LinearRing = Position[];
type PolygonCoordinates = LinearRing[];
type MultiPolygonCoordinates = PolygonCoordinates[];

type PolygonGeometry = {
  type: "Polygon";
  coordinates: PolygonCoordinates;
};

type MultiPolygonGeometry = {
  type: "MultiPolygon";
  coordinates: MultiPolygonCoordinates;
};

type SupportedGeometry = PolygonGeometry | MultiPolygonGeometry;

type ZoneProperties = {
  zoneID?: string;
  code?: string;
  description?: string;
  DISTRICT?: string;
  HOURS?: string;
  label?: string;
};

type ZoneFeature = {
  geometry: SupportedGeometry | null;
  properties: ZoneProperties;
};

type ParkingZoneRecord = {
  zoneId: string;
  code: string;
  description: string;
  district: string;
  hours: string;
  label: string;
  geometry: SupportedGeometry;
  centerLat: number;
  centerLng: number;
  payByParkZone: string | null;
};

export type ParkingZoneLookup = {
  matchType: "inside" | "nearest" | "none";
  distanceMeters: number | null;
  zone: {
    zoneId: string;
    code: string;
    description: string;
    district: string;
    hours: string;
    label: string;
    payByParkZone: string | null;
  } | null;
};

export type ParkingLookupOptions = {
  nearestFallbackMeters?: number | null;
};

export type ResidentialRecommendOptions = {
  limit?: number;
  maxDistanceMeters?: number | null;
};

export type ResidentialZoneRecommendation = {
  zoneId: string;
  description: string;
  district: string;
  hours: string;
  distanceMeters: number;
  zoneLat: number;
  zoneLng: number;
};

const rawFeatures = (parkingZonesGeoJson.features ?? []) as unknown as ZoneFeature[];
const crosswalk = payByParkZoneCrosswalk as Record<string, string>;

function normalizeZone(zone: string | undefined): string | null {
  const value = zone?.trim();
  return value ? value : null;
}

function isPointOnSegment(
  lng: number,
  lat: number,
  [lng1, lat1]: Position,
  [lng2, lat2]: Position,
): boolean {
  const epsilon = 1e-10;
  const cross = (lat - lat1) * (lng2 - lng1) - (lng - lng1) * (lat2 - lat1);
  if (Math.abs(cross) > epsilon) {
    return false;
  }

  const dot = (lng - lng1) * (lng - lng2) + (lat - lat1) * (lat - lat2);
  return dot <= epsilon;
}

function pointInRing(lng: number, lat: number, ring: LinearRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i];
    const [lngJ, latJ] = ring[j];

    if (isPointOnSegment(lng, lat, ring[j], ring[i])) {
      return true;
    }

    const intersects =
      (latI > lat) !== (latJ > lat) &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygon(lng: number, lat: number, polygon: PolygonCoordinates): boolean {
  const [outerRing, ...holes] = polygon;
  if (!outerRing || !pointInRing(lng, lat, outerRing)) {
    return false;
  }

  return !holes.some((hole) => pointInRing(lng, lat, hole));
}

function pointInGeometry(lng: number, lat: number, geometry: SupportedGeometry): boolean {
  if (geometry.type === "Polygon") {
    return pointInPolygon(lng, lat, geometry.coordinates);
  }
  return geometry.coordinates.some((polygon) => pointInPolygon(lng, lat, polygon));
}

function planarDistanceSquared(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const scaleLng = Math.cos(toRadians((lat1 + lat2) / 2));
  const dLat = lat2 - lat1;
  const dLng = (lng2 - lng1) * scaleLng;
  return dLat * dLat + dLng * dLng;
}

function nearestPointOnSegment(
  lng: number,
  lat: number,
  [lng1, lat1]: Position,
  [lng2, lat2]: Position,
): Position {
  const scaleLng = Math.cos(toRadians(lat));
  const px = lng * scaleLng;
  const py = lat;
  const x1 = lng1 * scaleLng;
  const y1 = lat1;
  const x2 = lng2 * scaleLng;
  const y2 = lat2;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-16) {
    return [lng1, lat1];
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  return [nearestX / scaleLng, nearestY];
}

function nearestPointOnRing(lng: number, lat: number, ring: LinearRing): Position {
  if (ring.length === 0) {
    return [lng, lat];
  }
  if (ring.length === 1) {
    return ring[0];
  }

  let bestPoint: Position = ring[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const candidate = nearestPointOnSegment(lng, lat, ring[j], ring[i]);
    const distance = planarDistanceSquared(lat, lng, candidate[1], candidate[0]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPoint = candidate;
    }
  }

  return bestPoint;
}

function nearestPointOnPolygon(lng: number, lat: number, polygon: PolygonCoordinates): Position {
  if (pointInPolygon(lng, lat, polygon)) {
    return [lng, lat];
  }

  let bestPoint: Position = [lng, lat];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const ring of polygon) {
    const candidate = nearestPointOnRing(lng, lat, ring);
    const distance = planarDistanceSquared(lat, lng, candidate[1], candidate[0]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPoint = candidate;
    }
  }

  return bestPoint;
}

function nearestPointOnGeometry(lng: number, lat: number, geometry: SupportedGeometry): Position {
  if (geometry.type === "Polygon") {
    return nearestPointOnPolygon(lng, lat, geometry.coordinates);
  }

  let bestPoint: Position = [lng, lat];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const polygon of geometry.coordinates) {
    const candidate = nearestPointOnPolygon(lng, lat, polygon);
    const distance = planarDistanceSquared(lat, lng, candidate[1], candidate[0]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPoint = candidate;
    }
  }

  return bestPoint;
}

function addPointToBounds(
  [lng, lat]: Position,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
) {
  bounds.minLat = Math.min(bounds.minLat, lat);
  bounds.maxLat = Math.max(bounds.maxLat, lat);
  bounds.minLng = Math.min(bounds.minLng, lng);
  bounds.maxLng = Math.max(bounds.maxLng, lng);
}

function getGeometryCenter(geometry: SupportedGeometry): { centerLat: number; centerLng: number } {
  const bounds = {
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  };

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => ring.forEach((position) => addPointToBounds(position, bounds)));
  } else {
    geometry.coordinates.forEach((polygon) =>
      polygon.forEach((ring) => ring.forEach((position) => addPointToBounds(position, bounds))),
    );
  }

  return {
    centerLat: (bounds.minLat + bounds.maxLat) / 2,
    centerLng: (bounds.minLng + bounds.maxLng) / 2,
  };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function buildParkingZoneRecords(): ParkingZoneRecord[] {
  return rawFeatures
    .filter((feature): feature is ZoneFeature & { geometry: SupportedGeometry } => Boolean(feature.geometry))
    .map((feature) => {
      const zoneId = feature.properties.zoneID ?? feature.properties.code ?? "UNKNOWN";
      const payByParkZone = normalizeZone(crosswalk[zoneId]);
      const { centerLat, centerLng } = getGeometryCenter(feature.geometry);

      return {
        zoneId,
        code: feature.properties.code ?? zoneId,
        description: feature.properties.description ?? zoneId,
        district: feature.properties.DISTRICT ?? "",
        hours: feature.properties.HOURS ?? "",
        label: feature.properties.label ?? "",
        geometry: feature.geometry,
        centerLat,
        centerLng,
        payByParkZone,
      };
    });
}

const parkingZones = buildParkingZoneRecords();

function clampRecommendationLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 2;
  }
  return Math.max(1, Math.min(5, Math.floor(limit ?? 2)));
}

function zoneResponse(
  zone: ParkingZoneRecord,
  matchType: "inside" | "nearest",
  distanceMeters: number | null,
): ParkingZoneLookup {
  return {
    matchType,
    distanceMeters,
    zone: {
      zoneId: zone.zoneId,
      code: zone.code,
      description: zone.description,
      district: zone.district,
      hours: zone.hours,
      label: zone.label,
      payByParkZone: zone.payByParkZone,
    },
  };
}

export function listParkingZones() {
  return parkingZones.map((zone) => ({
    zoneId: zone.zoneId,
    code: zone.code,
    description: zone.description,
    district: zone.district,
    hours: zone.hours,
    payByParkZone: zone.payByParkZone,
  }));
}

export function lookupParkingZoneByCoordinate(
  lat: number,
  lng: number,
  options: ParkingLookupOptions = {},
): ParkingZoneLookup {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      matchType: "none",
      distanceMeters: null,
      zone: null,
    };
  }

  const containingZone = parkingZones.find((zone) => pointInGeometry(lng, lat, zone.geometry));
  if (containingZone) {
    return zoneResponse(containingZone, "inside", 0);
  }

  const nearestFallbackMeters = options.nearestFallbackMeters ?? 120;
  if (nearestFallbackMeters === null || nearestFallbackMeters < 0) {
    return {
      matchType: "none",
      distanceMeters: null,
      zone: null,
    };
  }

  let nearest: ParkingZoneRecord | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const zone of parkingZones) {
    const distance = haversineMeters(lat, lng, zone.centerLat, zone.centerLng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = zone;
    }
  }

  if (nearest && nearestDistance <= nearestFallbackMeters) {
    return zoneResponse(nearest, "nearest", nearestDistance);
  }

  return {
    matchType: "none",
    distanceMeters: nearestDistance,
    zone: null,
  };
}

export function recommendResidentialZonesByCoordinate(
  lat: number,
  lng: number,
  options: ResidentialRecommendOptions = {},
): ResidentialZoneRecommendation[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return [];
  }

  const limit = clampRecommendationLimit(options.limit);
  const maxDistanceMeters = options.maxDistanceMeters ?? null;

  const candidates = parkingZones
    .map((zone) => ({
      zone,
      nearestPoint: nearestPointOnGeometry(lng, lat, zone.geometry),
    }))
    .map((candidate) => ({
      zone: candidate.zone,
      nearestPoint: candidate.nearestPoint,
      distanceMeters: haversineMeters(lat, lng, candidate.nearestPoint[1], candidate.nearestPoint[0]),
    }))
    .filter((candidate) =>
      maxDistanceMeters === null ? true : candidate.distanceMeters <= Math.max(0, maxDistanceMeters),
    )
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const seen = new Set<string>();
  const results: ResidentialZoneRecommendation[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.zone.zoneId)) {
      continue;
    }
    seen.add(candidate.zone.zoneId);

    results.push({
      zoneId: candidate.zone.zoneId,
      description: candidate.zone.description,
      district: candidate.zone.district,
      hours: candidate.zone.hours,
      distanceMeters: candidate.distanceMeters,
      zoneLat: candidate.nearestPoint[1],
      zoneLng: candidate.nearestPoint[0],
    });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}
