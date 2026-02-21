import downtownParkingRatesGeoJson from "@/data/slo-downtown-parking-rates.json";
import provisionalRulesJson from "@/data/paybyphone-provisional-rules.json";

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

type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

type DowntownFeature = {
  geometry: SupportedGeometry | null;
  properties: {
    MeterZone?: string;
    Type?: string;
    Name?: string | null;
    Label?: string;
    OBJECTID?: number;
  };
};

type DowntownZoneRecord = {
  objectId: number;
  type: string;
  meterZone: string;
  label: string;
  geometry: SupportedGeometry;
  centerLat: number;
  centerLng: number;
  payByPhoneZone: string | null;
  provisionalReason: string | null;
};

type ProvisionalRule = {
  id: string;
  type?: string;
  meterZone: string;
  payByPhoneZone: string;
  description: string;
};

export type PayByPhoneLookup = {
  matchType: "inside" | "nearest" | "none";
  distanceMeters: number | null;
  zone: {
    objectId: number;
    type: string;
    meterZone: string;
    payByPhoneZone: string | null;
    provisionalReason: string | null;
  } | null;
};

export type PayByPhoneLookupOptions = {
  nearestFallbackMeters?: number | null;
};

export type PayByPhoneRecommendOptions = {
  limit?: number;
  paidOnly?: boolean;
};

export type PayByPhoneZoneRecommendation = {
  zoneNumber: string;
  price: string;
  distanceMeters: number;
  zoneLat: number;
  zoneLng: number;
  sourceType: string;
  sourceObjectId: number;
  provisionalReason: string | null;
};

const rawFeatures = (downtownParkingRatesGeoJson.features ?? []) as unknown as DowntownFeature[];
const provisionalRules = provisionalRulesJson as ProvisionalRule[];

function createEmptyBounds(): Bounds {
  return {
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  };
}

function isFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minLat) &&
    Number.isFinite(bounds.maxLat) &&
    Number.isFinite(bounds.minLng) &&
    Number.isFinite(bounds.maxLng)
  );
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

  const allRings = polygon;
  let bestPoint: Position = [lng, lat];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const ring of allRings) {
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

function addGeometryToBounds(geometry: SupportedGeometry, bounds: Bounds) {
  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => ring.forEach((position) => addPointToBounds(position, bounds)));
    return;
  }

  geometry.coordinates.forEach((polygon) =>
    polygon.forEach((ring) => ring.forEach((position) => addPointToBounds(position, bounds))),
  );
}

function getGeometryCenter(geometry: SupportedGeometry): { centerLat: number; centerLng: number } {
  const bounds = createEmptyBounds();
  addGeometryToBounds(geometry, bounds);

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

function provisionalPayByPhoneZone(type: string, meterZone: string): { zone: string | null; reason: string | null } {
  const rule = provisionalRules.find((candidate) => {
    const typeMatches = candidate.type ? candidate.type === type : true;
    return typeMatches && candidate.meterZone === meterZone;
  });

  if (!rule) {
    return { zone: null, reason: null };
  }

  return {
    zone: rule.payByPhoneZone,
    reason: rule.description,
  };
}

function buildZoneRecords(): DowntownZoneRecord[] {
  return rawFeatures
    .filter((feature): feature is DowntownFeature & { geometry: SupportedGeometry } => Boolean(feature.geometry))
    .map((feature) => {
      const type = feature.properties.Type ?? "Unknown";
      const meterZone = feature.properties.MeterZone ?? "Unknown";
      const { zone, reason } = provisionalPayByPhoneZone(type, meterZone);
      const { centerLat, centerLng } = getGeometryCenter(feature.geometry);

      return {
        objectId: feature.properties.OBJECTID ?? -1,
        type,
        meterZone,
        label: feature.properties.Label ?? "",
        geometry: feature.geometry,
        centerLat,
        centerLng,
        payByPhoneZone: zone,
        provisionalReason: reason,
      };
    });
}

const downtownZones = buildZoneRecords();

function computeDowntownSearchBias() {
  const bounds = createEmptyBounds();
  downtownZones.forEach((zone) => addGeometryToBounds(zone.geometry, bounds));

  if (!isFiniteBounds(bounds)) {
    return { latitude: 35.2809, longitude: -120.6626, radiusMeters: 1800 };
  }

  const latitude = (bounds.minLat + bounds.maxLat) / 2;
  const longitude = (bounds.minLng + bounds.maxLng) / 2;
  const corners: Position[] = [
    [bounds.minLng, bounds.minLat],
    [bounds.minLng, bounds.maxLat],
    [bounds.maxLng, bounds.minLat],
    [bounds.maxLng, bounds.maxLat],
  ];

  const maxDistance = corners.reduce((max, [cornerLng, cornerLat]) => {
    const distance = haversineMeters(latitude, longitude, cornerLat, cornerLng);
    return Math.max(max, distance);
  }, 0);

  return {
    latitude,
    longitude,
    radiusMeters: Math.max(800, Math.round(maxDistance + 300)),
  };
}

const downtownSearchBias = computeDowntownSearchBias();

function toLookupResponse(
  zone: DowntownZoneRecord,
  matchType: "inside" | "nearest",
  distanceMeters: number | null,
): PayByPhoneLookup {
  return {
    matchType,
    distanceMeters,
    zone: {
      objectId: zone.objectId,
      type: zone.type,
      meterZone: zone.meterZone,
      payByPhoneZone: zone.payByPhoneZone,
      provisionalReason: zone.provisionalReason,
    },
  };
}

function clampRecommendationLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 2;
  }
  return Math.max(1, Math.min(5, Math.floor(limit ?? 2)));
}

export function getDowntownSearchBias() {
  return downtownSearchBias;
}

export function listPayByPhoneMappingSummary() {
  return downtownZones.map((zone) => ({
    objectId: zone.objectId,
    type: zone.type,
    meterZone: zone.meterZone,
    payByPhoneZone: zone.payByPhoneZone,
    provisionalReason: zone.provisionalReason,
  }));
}

export function isCoordinateInDowntownParkingArea(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  return downtownZones.some((zone) => pointInGeometry(lng, lat, zone.geometry));
}

export function recommendPayByPhoneZonesByCoordinate(
  lat: number,
  lng: number,
  options: PayByPhoneRecommendOptions = {},
): PayByPhoneZoneRecommendation[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return [];
  }

  const limit = clampRecommendationLimit(options.limit);
  const paidOnly = options.paidOnly ?? true;

  const sortedCandidates = downtownZones
    .filter((zone) => (paidOnly ? Boolean(zone.payByPhoneZone) : true))
    .map((zone) => ({
      zone,
      nearestPoint: nearestPointOnGeometry(lng, lat, zone.geometry),
    }))
    .map((candidate) => ({
      zone: candidate.zone,
      nearestPoint: candidate.nearestPoint,
      distanceMeters: haversineMeters(lat, lng, candidate.nearestPoint[1], candidate.nearestPoint[0]),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const deduped: PayByPhoneZoneRecommendation[] = [];
  const seenZoneNumbers = new Set<string>();

  for (const candidate of sortedCandidates) {
    const zoneNumber = candidate.zone.payByPhoneZone ?? `OBJECTID-${candidate.zone.objectId}`;
    if (seenZoneNumbers.has(zoneNumber)) {
      continue;
    }
    seenZoneNumbers.add(zoneNumber);

    deduped.push({
      zoneNumber,
      price: candidate.zone.meterZone,
      distanceMeters: candidate.distanceMeters,
      zoneLat: candidate.nearestPoint[1],
      zoneLng: candidate.nearestPoint[0],
      sourceType: candidate.zone.type,
      sourceObjectId: candidate.zone.objectId,
      provisionalReason: candidate.zone.provisionalReason,
    });

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

export function lookupPayByPhoneZoneByCoordinate(
  lat: number,
  lng: number,
  options: PayByPhoneLookupOptions = {},
): PayByPhoneLookup {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      matchType: "none",
      distanceMeters: null,
      zone: null,
    };
  }

  const containing = downtownZones.find((zone) => pointInGeometry(lng, lat, zone.geometry));
  if (containing) {
    return toLookupResponse(containing, "inside", 0);
  }

  const nearestFallbackMeters = options.nearestFallbackMeters ?? 120;
  if (nearestFallbackMeters === null || nearestFallbackMeters < 0) {
    return {
      matchType: "none",
      distanceMeters: null,
      zone: null,
    };
  }

  let nearest: DowntownZoneRecord | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const zone of downtownZones) {
    const distance = haversineMeters(lat, lng, zone.centerLat, zone.centerLng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = zone;
    }
  }

  if (nearest && nearestDistance <= nearestFallbackMeters) {
    return toLookupResponse(nearest, "nearest", nearestDistance);
  }

  return {
    matchType: "none",
    distanceMeters: nearestDistance,
    zone: null,
  };
}
