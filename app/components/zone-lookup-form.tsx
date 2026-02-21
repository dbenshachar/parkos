"use client";

import { useMemo, useState } from "react";
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

export function ZoneLookupForm() {
  const [destination, setDestination] = useState("");
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [destinationResult, setDestinationResult] = useState<DestinationLookupResponse | null>(null);
  const [isMapOpen, setIsMapOpen] = useState(false);
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

  const onDestinationLookup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = destination.trim();
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

  return (
    <section className="w-full max-w-4xl space-y-5">
      <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-black">Destination Lookup (Google Maps)</h2>
        <p className="mt-2 text-sm text-black/70">
          Enter your intended destination. The app will resolve it with Google Places, enforce
          downtown-only matching, and print the top 5 closest parking suggestions.
        </p>

        <form onSubmit={onDestinationLookup} className="mt-5 flex flex-col gap-3 md:flex-row">
          <label className="flex-1 text-sm text-black/80">
            Destination
            <input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="e.g. Firestone Grill San Luis Obispo"
            />
          </label>
          <button
            type="submit"
            disabled={destinationLoading}
            className="mt-6 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {destinationLoading ? "Looking up..." : "Find Parking Zones"}
          </button>
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
