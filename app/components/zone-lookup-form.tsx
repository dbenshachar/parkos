"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DestinationMapModal } from "@/app/components/destination-map-modal";

type ParkingRecommendation = {
  zoneNumber: string;
  price: string;
  street: string;
  intendedDestination: string;
  distanceMeters: number;
  zoneLat: number;
  zoneLng: number;
};

type ResidentialRecommendation = {
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

type DestinationLookupResponse = {
  destination: string;
  street: string;
  destinationLat: number;
  destinationLng: number;
  nearestParkingDistanceMeters: number;
  recommendations: ParkingRecommendation[];
  residentialRecommendations: ResidentialRecommendation[];
  warnings: string[];
};

type DestinationLookupError = {
  error?: string;
};

type TripParseResponse = {
  destination: string;
  arrivalTimeIso: string | null;
  arrivalTimeLabel: string | null;
  timezone: "America/Los_Angeles";
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

type TripParseError = {
  error?: string;
};

type CurrentZoneResponse = {
  location: {
    lat: number;
    lng: number;
    accuracyMeters: number | null;
  };
  zone: {
    category: "paid" | "residential" | "none";
    matchType: "inside" | "nearest" | "none";
    distanceMeters: number | null;
    zoneNumber: string | null;
    rate: string | null;
    paymentEligible: boolean;
    paymentEntryLabel: string;
    message: string;
  };
  snapshotAt: string;
  warnings: string[];
};

type CurrentZoneError = {
  error?: string;
};

type LiveCoordinates = {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
};

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 10_000,
  timeout: 15_000,
};

const LIVE_LOOKUP_DEBOUNCE_MS = 1_000;
const LIVE_LOOKUP_MIN_MOVEMENT_METERS = 8;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return earthRadiusMeters * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function geolocationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location access was denied. Enable location permissions to use live tracking.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Location data is currently unavailable. Try moving to an open area and retry.";
  }
  if (error.code === error.TIMEOUT) {
    return "Timed out while fetching your location. Try again.";
  }
  return "Unable to fetch your location right now.";
}

function isGeolocationPositionError(error: unknown): error is GeolocationPositionError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "number"
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

function toLiveCoordinates(position: GeolocationPosition): LiveCoordinates {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
  };
}

export function ZoneLookupForm() {
  const [tripPrompt, setTripPrompt] = useState("");
  const [tripParseLoading, setTripParseLoading] = useState(false);
  const [tripParseError, setTripParseError] = useState<string | null>(null);
  const [arrivalTimeIso, setArrivalTimeIso] = useState<string | null>(null);
  const [arrivalTimeLabel, setArrivalTimeLabel] = useState("");
  const [tripWarnings, setTripWarnings] = useState<string[]>([]);

  const [destination, setDestination] = useState("");
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [destinationResult, setDestinationResult] = useState<DestinationLookupResponse | null>(null);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const [isTrackingLiveLocation, setIsTrackingLiveLocation] = useState(false);
  const [liveLocation, setLiveLocation] = useState<LiveCoordinates | null>(null);
  const [liveZoneResult, setLiveZoneResult] = useState<CurrentZoneResponse | null>(null);
  const [liveZoneLoading, setLiveZoneLoading] = useState(false);
  const [liveLocationError, setLiveLocationError] = useState<string | null>(null);

  const [parkedSnapshot, setParkedSnapshot] = useState<CurrentZoneResponse | null>(null);
  const [parkedSnapshotLoading, setParkedSnapshotLoading] = useState(false);
  const [paymentEntryMessage, setPaymentEntryMessage] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const lastSentLocationRef = useRef<LiveCoordinates | null>(null);
  const latestLocationRef = useRef<LiveCoordinates | null>(null);

  const [geolocationSupported, setGeolocationSupported] = useState<boolean | null>(null);

  const orderedRecommendations = useMemo(() => {
    if (!destinationResult) {
      return [];
    }

    return [
      ...destinationResult.recommendations.map((item) => ({
        ...item,
        category: "Paid",
      })),
      ...destinationResult.residentialRecommendations.map((item) => ({
        ...item,
        category: "Residential",
      })),
    ].sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [destinationResult]);

  const requestCurrentZone = async (
    lat: number,
    lng: number,
    accuracyMeters: number | null,
  ): Promise<CurrentZoneResponse> => {
    const response = await fetch("/api/parking/current-zone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lat,
        lng,
        accuracyMeters,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as CurrentZoneError;
      throw new Error(payload.error ?? "Failed to resolve current parking zone.");
    }

    return (await response.json()) as CurrentZoneResponse;
  };

  const stopLiveLocationTracking = () => {
    if (watchIdRef.current !== null && geolocationSupported) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    lastSentLocationRef.current = null;
    setIsTrackingLiveLocation(false);
    setLiveZoneLoading(false);
  };

  const queueLiveZoneLookup = (coords: LiveCoordinates) => {
    const lastSent = lastSentLocationRef.current;
    if (lastSent) {
      const movement = haversineMeters(lastSent.lat, lastSent.lng, coords.lat, coords.lng);
      if (movement < LIVE_LOOKUP_MIN_MOVEMENT_METERS) {
        return;
      }
    }

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(async () => {
      setLiveZoneLoading(true);
      try {
        const result = await requestCurrentZone(coords.lat, coords.lng, coords.accuracyMeters);
        setLiveZoneResult(result);
        setLiveLocationError(null);
        lastSentLocationRef.current = coords;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to resolve current parking zone.";
        setLiveLocationError(message);
      } finally {
        setLiveZoneLoading(false);
      }
    }, LIVE_LOOKUP_DEBOUNCE_MS);
  };

  useEffect(() => {
    setGeolocationSupported(typeof navigator !== "undefined" && "geolocation" in navigator);

    return () => {
      if (watchIdRef.current !== null && typeof navigator !== "undefined" && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const startLiveLocationTracking = () => {
    if (geolocationSupported !== true) {
      setLiveLocationError("Geolocation is not supported in this browser.");
      return;
    }

    if (watchIdRef.current !== null) {
      return;
    }

    setLiveLocationError(null);
    setPaymentEntryMessage(null);

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const next = toLiveCoordinates(position);

        setLiveLocation(next);
        latestLocationRef.current = next;
        queueLiveZoneLookup(next);
      },
      (error) => {
        setLiveLocationError(geolocationErrorMessage(error));
        stopLiveLocationTracking();
      },
      GEOLOCATION_OPTIONS,
    );

    watchIdRef.current = watchId;
    setIsTrackingLiveLocation(true);
  };

  const lookupDestination = async (destinationInput: string) => {
    const trimmed = destinationInput.trim();
    if (!trimmed) {
      setDestinationError("Enter a destination such as a restaurant or business in downtown SLO.");
      return;
    }

    setDestinationLoading(true);
    setDestinationError(null);
    setDestinationResult(null);

    try {
      const response = await fetch("/api/parking/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          destination: trimmed,
          limit: 5,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as DestinationLookupError;
        throw new Error(payload.error ?? "Failed to fetch parking recommendations.");
      }

      const payload = (await response.json()) as DestinationLookupResponse;
      setDestinationResult(payload);
      setIsMapOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch parking recommendations.";
      setDestinationError(message);
    } finally {
      setDestinationLoading(false);
    }
  };

  const onAnalyzeTripPrompt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedPrompt = tripPrompt.trim();
    if (!trimmedPrompt) {
      setTripParseError("Enter a trip prompt with your destination and optional arrival time.");
      return;
    }

    setTripParseLoading(true);
    setTripParseError(null);
    setTripWarnings([]);

    try {
      const response = await fetch("/api/parking/parse-trip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as TripParseError;
        throw new Error(payload.error ?? "Failed to parse trip prompt.");
      }

      const payload = (await response.json()) as TripParseResponse;
      const parsedDestination = payload.destination.trim();

      if (!parsedDestination) {
        throw new Error("Trip parser returned an empty destination.");
      }

      setDestination(parsedDestination);
      setArrivalTimeIso(payload.arrivalTimeIso);
      setArrivalTimeLabel(payload.arrivalTimeLabel ?? "");
      setTripWarnings(payload.warnings ?? []);

      await lookupDestination(parsedDestination);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse trip prompt.";
      setTripParseError(message);
    } finally {
      setTripParseLoading(false);
    }
  };

  const onDestinationLookup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await lookupDestination(destination);
  };

  const onHaveParked = async () => {
    if (geolocationSupported !== true) {
      setLiveLocationError("Geolocation is not supported in this browser.");
      return;
    }

    setParkedSnapshotLoading(true);
    setPaymentEntryMessage(null);
    setLiveLocationError(null);

    try {
      let coords = latestLocationRef.current;
      if (!coords) {
        coords = await new Promise<LiveCoordinates>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (position) => resolve(toLiveCoordinates(position)),
            reject,
            GEOLOCATION_OPTIONS,
          );
        });
      }

      setLiveLocation(coords);
      latestLocationRef.current = coords;
      lastSentLocationRef.current = coords;

      const result = await requestCurrentZone(coords.lat, coords.lng, coords.accuracyMeters);
      setLiveZoneResult(result);
      setParkedSnapshot(result);
    } catch (error) {
      if (isGeolocationPositionError(error)) {
        setLiveLocationError(geolocationErrorMessage(error));
        return;
      }

      const message = error instanceof Error ? error.message : "Failed to capture parked location.";
      setLiveLocationError(message);
    } finally {
      setParkedSnapshotLoading(false);
    }
  };

  const onProceedToPayment = () => {
    if (!parkedSnapshot?.zone.paymentEligible || !parkedSnapshot.zone.zoneNumber || !parkedSnapshot.zone.rate) {
      return;
    }

    setPaymentEntryMessage(
      `Payment launch coming soon. Use Zone ${parkedSnapshot.zone.zoneNumber} at ${parkedSnapshot.zone.rate} in your payment app.`,
    );
  };

  return (
    <section className="w-full max-w-4xl space-y-5">
      <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-black">Trip Assistant</h2>
        <p className="mt-2 text-sm text-black/70">
          Describe your trip in plain language. ParkOS will extract your destination and intended arrival time, then
          auto-run parking recommendations.
        </p>

        <form onSubmit={onAnalyzeTripPrompt} className="mt-5 space-y-3">
          <label className="block text-sm text-black/80">
            Trip Prompt
            <textarea
              value={tripPrompt}
              onChange={(event) => setTripPrompt(event.target.value)}
              className="mt-1 min-h-24 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="e.g. Dinner at Firestone Grill tomorrow at 7pm."
            />
          </label>
          <button
            type="submit"
            disabled={tripParseLoading}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {tripParseLoading ? "Analyzing..." : "Analyze Trip"}
          </button>
        </form>

        {tripParseError ? <p className="mt-3 text-sm text-red-700">{tripParseError}</p> : null}

        {(destination || arrivalTimeLabel || tripWarnings.length > 0) ? (
          <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.02] p-4 text-sm text-black">
            <p>
              Parsed destination: <strong>{destination || "Not found"}</strong>
            </p>
            <p>Parsed arrival time: {arrivalTimeLabel || "Not specified"}</p>
            {arrivalTimeIso ? <p className="text-xs text-black/70">Normalized ISO: {arrivalTimeIso}</p> : null}
            {tripWarnings.length > 0 ? (
              <p className="mt-2 text-xs text-amber-700">{tripWarnings.join(" ")}</p>
            ) : null}
          </div>
        ) : null}
      </article>

      <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-black">Destination Lookup (Google Maps)</h2>
        <p className="mt-2 text-sm text-black/70">
          Enter your intended destination. The app will resolve it with Google Places, enforce
          downtown-only matching, and print the top 5 closest parking suggestions.
        </p>

        <form onSubmit={onDestinationLookup} className="mt-5 space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-sm text-black/80">
              Destination
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="e.g. Firestone Grill San Luis Obispo"
              />
            </label>
            <label className="text-sm text-black/80">
              Intended Arrival Time (Optional)
              <input
                value={arrivalTimeLabel}
                onChange={(event) => {
                  setArrivalTimeLabel(event.target.value);
                  setArrivalTimeIso(null);
                }}
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="e.g. Wed, Feb 21, 7:00 PM PST"
              />
            </label>
            <button
              type="submit"
              disabled={destinationLoading}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {destinationLoading ? "Looking up..." : "Find Parking Zones"}
            </button>
          </div>
          <p className="text-xs text-black/60">
            Arrival time is captured for future traffic-density analysis and does not affect parking ranking yet.
          </p>
        </form>

        {destinationError ? <p className="mt-3 text-sm text-red-700">{destinationError}</p> : null}

        {destinationResult ? (
          <div className="mt-5 rounded-lg border border-black/10 bg-black/[0.02] p-4 text-sm text-black">
            <p>
              Destination: <strong>{destinationResult.destination}</strong>
            </p>
            <p>Street: {destinationResult.street}</p>
            <p>
              Nearest paid parking zone: {Math.round(destinationResult.nearestParkingDistanceMeters)} m away
            </p>
            <p className="mt-3 font-medium">Output</p>
            <div className="mt-1 rounded border border-black/10 bg-white p-3 font-mono text-xs text-black sm:text-sm">
              {orderedRecommendations.map((item) => (
                <p key={`${item.category}-${item.zoneNumber}-${item.distanceMeters}`}>
                  {item.category} Zone {item.zoneNumber} | {item.price} | {item.street} | {item.intendedDestination} |{" "}
                  {Math.round(item.distanceMeters)}m away
                </p>
              ))}
            </div>
            {destinationResult.residentialRecommendations.length > 0 ? (
              <p className="mt-2 text-xs text-black/70">
                Closest spots are ranked across paid and residential zones within 1000m.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setIsMapOpen(true)}
              className="mt-3 rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
            >
              View Map
            </button>
          </div>
        ) : null}
      </article>

      <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-black">Live Location + Parked Check-In</h2>
        <p className="mt-2 text-sm text-black/70">
          Track your current position, detect your active parking zone, and use <strong>I have parked!</strong> to
          capture your payment entry details.
        </p>

        {geolocationSupported === false ? (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Geolocation is not supported in this browser. Live tracking is unavailable.
          </p>
        ) : geolocationSupported === null ? (
          <p className="mt-4 rounded-md border border-black/15 bg-black/[0.02] px-3 py-2 text-sm text-black/70">
            Checking browser location support...
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startLiveLocationTracking}
                disabled={isTrackingLiveLocation}
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Start Live Location
              </button>
              <button
                type="button"
                onClick={stopLiveLocationTracking}
                disabled={!isTrackingLiveLocation}
                className="rounded-md border border-black/20 bg-white px-4 py-2 text-sm font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Stop Live Location
              </button>
              <button
                type="button"
                onClick={onHaveParked}
                disabled={parkedSnapshotLoading}
                className="rounded-md border border-black/20 bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {parkedSnapshotLoading ? "Capturing..." : "I have parked!"}
              </button>
            </div>

            {liveLocationError ? <p className="mt-3 text-sm text-red-700">{liveLocationError}</p> : null}

            <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.02] p-4 text-sm text-black">
              <p>
                Live tracking status: <strong>{isTrackingLiveLocation ? "Tracking" : "Stopped"}</strong>
              </p>
              {liveLocation ? (
                <>
                  <p className="mt-1">
                    Current location: {formatCoordinate(liveLocation.lat)}, {formatCoordinate(liveLocation.lng)}
                  </p>
                  <p>
                    Accuracy:{" "}
                    {liveLocation.accuracyMeters === null ? "Unknown" : `${Math.round(liveLocation.accuracyMeters)}m`}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-black/70">Waiting for location fix.</p>
              )}

              {liveZoneLoading ? <p className="mt-2 text-black/70">Resolving current zone...</p> : null}

              {liveZoneResult ? (
                <div className="mt-3 rounded border border-black/10 bg-white p-3">
                  <p>
                    Current zone: <strong>{liveZoneResult.zone.zoneNumber ?? "None"}</strong>
                  </p>
                  <p>Category: {liveZoneResult.zone.category}</p>
                  <p>Current rate: {liveZoneResult.zone.rate ?? "N/A"}</p>
                  <p>
                    Match: {liveZoneResult.zone.matchType}
                    {liveZoneResult.zone.distanceMeters !== null
                      ? ` (${Math.round(liveZoneResult.zone.distanceMeters)}m)`
                      : ""}
                  </p>
                  <p className="mt-1 text-black/80">{liveZoneResult.zone.message}</p>
                  {liveZoneResult.warnings.length > 0 ? (
                    <p className="mt-1 text-amber-700">{liveZoneResult.warnings.join(" ")}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {parkedSnapshot ? (
              <div className="mt-4 rounded-lg border border-black/15 bg-white p-4 text-sm text-black">
                <p className="font-semibold">Parked Snapshot</p>
                <p className="mt-1">Captured: {formatTimestamp(parkedSnapshot.snapshotAt)}</p>
                <p>Current zone: {parkedSnapshot.zone.zoneNumber ?? "None"}</p>
                <p>Current rate: {parkedSnapshot.zone.rate ?? "N/A"}</p>
                <p>{parkedSnapshot.zone.message}</p>

                {parkedSnapshot.zone.paymentEligible ? (
                  <button
                    type="button"
                    onClick={onProceedToPayment}
                    className="mt-3 rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/85"
                  >
                    {parkedSnapshot.zone.paymentEntryLabel}
                  </button>
                ) : (
                  <p className="mt-2 text-black/70">Payment is unavailable here. Residential permit is required.</p>
                )}

                {paymentEntryMessage ? <p className="mt-2 text-sm text-black/80">{paymentEntryMessage}</p> : null}
              </div>
            ) : null}
          </>
        )}
      </article>

      {destinationResult ? (
        <DestinationMapModal
          isOpen={isMapOpen}
          onClose={() => setIsMapOpen(false)}
          destination={{
            lat: destinationResult.destinationLat,
            lng: destinationResult.destinationLng,
            name: destinationResult.destination,
            street: destinationResult.street,
          }}
          paidRecommendations={destinationResult.recommendations}
          residentialRecommendations={destinationResult.residentialRecommendations}
        />
      ) : null}
    </section>
  );
}
