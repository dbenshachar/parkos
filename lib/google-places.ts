import "server-only";

import { getDowntownSearchBias } from "@/lib/paybyphone-zones";

const GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_PLACES_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location";

type GooglePlacesLocation = {
  latitude: number;
  longitude: number;
};

type GooglePlacesPlace = {
  id?: string;
  displayName?: {
    text?: string;
    languageCode?: string;
  };
  formattedAddress?: string;
  location?: GooglePlacesLocation;
};

type GooglePlacesTextSearchResponse = {
  places?: GooglePlacesPlace[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

export type ResolvedDestination = {
  destination: string;
  street: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
};

export class GooglePlacesConfigError extends Error {}
export class GooglePlacesLookupError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function clampMaxResultCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.max(1, Math.min(5, Math.floor(numeric)));
}

function getGoogleMapsApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    throw new GooglePlacesConfigError("Missing GOOGLE_MAPS_API_KEY environment variable.");
  }
  return key;
}

function extractStreet(formattedAddress: string): string {
  const street = formattedAddress.split(",")[0]?.trim();
  return street || formattedAddress;
}

function normalizePlace(place: GooglePlacesPlace): ResolvedDestination | null {
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  const formattedAddress = place.formattedAddress?.trim();
  const destination = place.displayName?.text?.trim();

  if (!formattedAddress || !destination || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    destination,
    street: extractStreet(formattedAddress),
    formattedAddress,
    latitude: Number(latitude),
    longitude: Number(longitude),
    placeId: place.id ?? null,
  };
}

function prioritizeSloCandidates(candidates: ResolvedDestination[]): ResolvedDestination[] {
  const scored = candidates.map((candidate, index) => ({
    candidate,
    index,
    localBoost: candidate.formattedAddress.toLowerCase().includes("san luis obispo") ? 1 : 0,
  }));

  scored.sort((a, b) => {
    if (a.localBoost !== b.localBoost) {
      return b.localBoost - a.localBoost;
    }
    return a.index - b.index;
  });

  return scored.map((item) => item.candidate);
}

export async function searchDestinationsWithGooglePlaces(query: string, maxResults = 5): Promise<ResolvedDestination[]> {
  const destinationQuery = query.trim();
  if (!destinationQuery) {
    throw new GooglePlacesLookupError("Destination query cannot be empty.");
  }

  const apiKey = getGoogleMapsApiKey();
  const searchBias = getDowntownSearchBias();
  const resultCount = clampMaxResultCount(maxResults);

  const response = await fetch(GOOGLE_PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: `${destinationQuery} in downtown San Luis Obispo`,
      maxResultCount: resultCount,
      languageCode: "en",
      regionCode: "US",
      locationBias: {
        circle: {
          center: {
            latitude: searchBias.latitude,
            longitude: searchBias.longitude,
          },
          radius: searchBias.radiusMeters,
        },
      },
    }),
  });

  const payload = (await response.json()) as GooglePlacesTextSearchResponse;
  if (!response.ok) {
    const message = payload.error?.message || `Google Places request failed (${response.status}).`;
    const normalizedMessage =
      payload.error?.status === "INVALID_ARGUMENT"
        ? `${message} Verify GOOGLE_MAPS_API_KEY permissions and that Places API (New) is enabled.`
        : message;
    throw new GooglePlacesLookupError(normalizedMessage, response.status);
  }

  const normalizedPlaces = prioritizeSloCandidates(
    (payload.places ?? [])
      .map((place) => normalizePlace(place))
      .filter((value): value is ResolvedDestination => Boolean(value)),
  );

  if (normalizedPlaces.length === 0) {
    throw new GooglePlacesLookupError("No destination results were returned from Google Places.");
  }

  return normalizedPlaces.slice(0, resultCount);
}

export async function resolveDestinationWithGooglePlaces(query: string): Promise<ResolvedDestination> {
  const candidates = await searchDestinationsWithGooglePlaces(query, 5);
  const [bestCandidate] = candidates;
  if (!bestCandidate) {
    throw new GooglePlacesLookupError("No destination results were returned from Google Places.");
  }

  return bestCandidate;
}
