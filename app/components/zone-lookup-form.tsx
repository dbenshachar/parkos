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

type TripAgentClarificationOption = {
  label: string;
  value: string;
};

type TripAgentClarification = {
  target: "destination" | "arrival_time" | "destination_refinement";
  question: string;
  options: TripAgentClarificationOption[];
};

type TripAgentReasoning = {
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  warnings: string[];
  factors: string[];
  steps: Array<{
    name: string;
    outcome: "ok" | "fallback" | "clarify";
    detail: string;
  }>;
  candidateDiagnostics: {
    query: string;
    topTwoScoreGap: number | null;
    selectedPlaceId: string | null;
    rankedCandidates: Array<{
      destination: string;
      formattedAddress: string;
      placeId: string | null;
      score: number;
      reasons: string[];
    }>;
  };
  parkingPointRationale: Array<{
    category: "paid" | "residential";
    zoneNumber: string;
    distanceMeters: number;
    rationale: string;
  }>;
};

type TripAgentReadyResponse = {
  status: "ready";
  runId: string;
  trip: {
    destination: string;
    arrivalTimeIso: string | null;
    arrivalTimeLabel: string | null;
    timezone: "America/Los_Angeles";
  };
  destination: {
    name: string;
    street: string;
    formattedAddress: string;
    lat: number;
    lng: number;
    placeId: string | null;
  };
  recommendations: {
    nearestParkingDistanceMeters: number;
    paid: ParkingRecommendation[];
    residential: ResidentialRecommendation[];
  };
  reasoning: TripAgentReasoning;
};

type TripAgentNeedsClarificationResponse = {
  status: "needs_clarification";
  runId: string;
  clarification: TripAgentClarification;
  partialTrip: {
    destination: string;
    arrivalTimeIso: string | null;
    arrivalTimeLabel: string | null;
    timezone: "America/Los_Angeles";
  };
  reasoning: TripAgentReasoning;
};

type TripAgentResponse = TripAgentReadyResponse | TripAgentNeedsClarificationResponse;

type TripAgentError = {
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

type RulesRundown = {
  headline: string;
  bullets: string[];
  timeLimitSummary: string;
  confidence: "high" | "medium" | "low";
  citations: string[];
};

type CaptureParkingSessionResponse = {
  ok: boolean;
  sessionId: string;
  resumeToken: string;
  captured: {
    zoneNumber: string | null;
    rate: string | null;
    category: "paid" | "residential" | "none";
  };
  rulesRundown: RulesRundown;
};

type ResumeParkingSessionResponse = {
  ok: boolean;
  session: {
    id: string;
    status: "captured" | "active" | "renewed" | "expired" | "cancelled";
    lat: number;
    lng: number;
    accuracyMeters: number | null;
    zoneNumber: string | null;
    capturedRate: string | null;
    durationMinutes: number | null;
    startsAt: string | null;
    expiresAt: string | null;
    isExpired: boolean;
    rulesRundown: RulesRundown | null;
  };
};

type ParkingSessionError = {
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

function formatStepName(name: string): string {
  return name.replace(/_/g, " ");
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
  const [tripReasoning, setTripReasoning] = useState<TripAgentReasoning | null>(null);
  const [tripClarification, setTripClarification] = useState<TripAgentClarification | null>(null);
  const [tripClarificationAnswer, setTripClarificationAnswer] = useState("");
  const [tripRunId, setTripRunId] = useState<string | null>(null);
  const [tripConfidence, setTripConfidence] = useState<{
    label: "high" | "medium" | "low";
    score: number;
  } | null>(null);

  const [destination, setDestination] = useState("");
  const [destinationResult, setDestinationResult] = useState<DestinationLookupResponse | null>(null);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const [isTrackingLiveLocation, setIsTrackingLiveLocation] = useState(false);
  const [testLatitude, setTestLatitude] = useState("");
  const [testLongitude, setTestLongitude] = useState("");
  const [liveLocation, setLiveLocation] = useState<LiveCoordinates | null>(null);
  const [liveZoneResult, setLiveZoneResult] = useState<CurrentZoneResponse | null>(null);
  const [liveZoneLoading, setLiveZoneLoading] = useState(false);
  const [liveLocationError, setLiveLocationError] = useState<string | null>(null);

  const [parkedSnapshot, setParkedSnapshot] = useState<CurrentZoneResponse | null>(null);
  const [parkedSnapshotLoading, setParkedSnapshotLoading] = useState(false);
  const [paymentZoneValue, setPaymentZoneValue] = useState("");
  const [paymentDurationMinutes, setPaymentDurationMinutes] = useState("60");
  const [parkingSessionId, setParkingSessionId] = useState<string | null>(null);
  const [parkingSessionResumeToken, setParkingSessionResumeToken] = useState<string | null>(null);
  const [renewFromSessionId, setRenewFromSessionId] = useState<string | null>(null);
  const [rulesRundown, setRulesRundown] = useState<RulesRundown | null>(null);
  const [sessionRestoreMessage, setSessionRestoreMessage] = useState<string | null>(null);
  const [paymentExecuting, setPaymentExecuting] = useState(false);
  const [paymentEntryMessage, setPaymentEntryMessage] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const lastSentLocationRef = useRef<LiveCoordinates | null>(null);
  const latestLocationRef = useRef<LiveCoordinates | null>(null);
  const loadedResumeTokenRef = useRef<string | null>(null);

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

  const captureParkingSession = async (coords: LiveCoordinates): Promise<CaptureParkingSessionResponse> => {
    const response = await fetch("/api/parking/session/capture", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lat: coords.lat,
        lng: coords.lng,
        accuracyMeters: coords.accuracyMeters,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as ParkingSessionError;
      throw new Error(payload.error ?? "Failed to capture parking session.");
    }

    return (await response.json()) as CaptureParkingSessionResponse;
  };

  const loadParkingSessionFromToken = async (resumeToken: string): Promise<ResumeParkingSessionResponse> => {
    const response = await fetch(`/api/parking/session/resume?token=${encodeURIComponent(resumeToken)}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as ParkingSessionError;
      throw new Error(payload.error ?? "Failed to load parked session.");
    }

    return (await response.json()) as ResumeParkingSessionResponse;
  };

  const resolveCurrentZoneForCoords = async (coords: LiveCoordinates) => {
    setLiveZoneLoading(true);
    try {
      const result = await requestCurrentZone(coords.lat, coords.lng, coords.accuracyMeters);
      setLiveZoneResult(result);
      setLiveLocationError(null);
      return result;
    } finally {
      setLiveZoneLoading(false);
    }
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const resumeToken = new URLSearchParams(window.location.search).get("resume")?.trim() || "";
    if (!resumeToken || loadedResumeTokenRef.current === resumeToken) {
      return;
    }

    loadedResumeTokenRef.current = resumeToken;
    setSessionRestoreMessage("Loading saved parking session...");
    setLiveLocationError(null);

    void (async () => {
      try {
        const payload = await loadParkingSessionFromToken(resumeToken);
        const session = payload.session;

        const restoredCoords: LiveCoordinates = {
          lat: session.lat,
          lng: session.lng,
          accuracyMeters: session.accuracyMeters,
        };

        setRenewFromSessionId(session.id);
        setPaymentZoneValue(session.zoneNumber || "");
        setPaymentDurationMinutes(String(session.durationMinutes || 60));
        setTestLatitude(session.lat.toString());
        setTestLongitude(session.lng.toString());
        setLiveLocation(restoredCoords);
        latestLocationRef.current = restoredCoords;
        lastSentLocationRef.current = restoredCoords;

        const currentZone = await resolveCurrentZoneForCoords(restoredCoords);
        setParkedSnapshot(currentZone);

        try {
          const captured = await captureParkingSession(restoredCoords);
          setParkingSessionId(captured.sessionId);
          setParkingSessionResumeToken(captured.resumeToken);
          setRulesRundown(captured.rulesRundown);
          setPaymentZoneValue(captured.captured.zoneNumber || currentZone.zone.zoneNumber || session.zoneNumber || "");
        } catch {
          setParkingSessionId(session.id);
          setParkingSessionResumeToken(resumeToken);
          setRulesRundown(session.rulesRundown);
        }

        if (session.isExpired) {
          setSessionRestoreMessage("Loaded session from SMS link. This session has expired; renew to continue parking.");
        } else if (session.expiresAt) {
          setSessionRestoreMessage(`Loaded session from SMS link. Current expiry: ${formatTimestamp(session.expiresAt)}.`);
        } else {
          setSessionRestoreMessage("Loaded session from SMS link.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load saved parking session.";
        setLiveLocationError(message);
        setSessionRestoreMessage(null);
      }
    })();
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

  const runTripAgent = async (promptInput: string) => {
    const trimmedPrompt = promptInput.trim();
    if (!trimmedPrompt) {
      setTripParseError("Enter a trip prompt with your destination and optional arrival time.");
      return;
    }

    setTripParseLoading(true);
    setTripParseError(null);
    setTripWarnings([]);
    setTripClarification(null);
    setTripClarificationAnswer("");
    setTripRunId(null);
    setTripConfidence(null);
    setTripReasoning(null);
    setDestinationResult(null);

    try {
      const response = await fetch("/api/parking/agent-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          limit: 5,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as TripAgentError;
        throw new Error(payload.error ?? "Failed to run trip agent.");
      }

      const payload = (await response.json()) as TripAgentResponse;
      const normalizedReasoning: TripAgentReasoning = {
        confidence: payload.reasoning.confidence,
        confidenceScore: payload.reasoning.confidenceScore,
        warnings: payload.reasoning.warnings ?? [],
        factors: payload.reasoning.factors ?? [],
        steps: payload.reasoning.steps ?? [],
        candidateDiagnostics: payload.reasoning.candidateDiagnostics ?? {
          query: "",
          topTwoScoreGap: null,
          selectedPlaceId: null,
          rankedCandidates: [],
        },
        parkingPointRationale: payload.reasoning.parkingPointRationale ?? [],
      };
      setTripRunId(payload.runId);
      setTripConfidence({
        label: normalizedReasoning.confidence,
        score: normalizedReasoning.confidenceScore,
      });
      setTripWarnings(normalizedReasoning.warnings);
      setTripReasoning(normalizedReasoning);

      if (payload.status === "ready") {
        const resolvedDestination = payload.trip.destination.trim();
        if (!resolvedDestination) {
          throw new Error("Trip agent returned an empty destination.");
        }

        setDestination(resolvedDestination);
        setArrivalTimeIso(payload.trip.arrivalTimeIso);
        setArrivalTimeLabel(payload.trip.arrivalTimeLabel ?? "");
        setDestinationResult({
          destination: payload.destination.name,
          street: payload.destination.street,
          destinationLat: payload.destination.lat,
          destinationLng: payload.destination.lng,
          nearestParkingDistanceMeters: payload.recommendations.nearestParkingDistanceMeters,
          recommendations: payload.recommendations.paid,
          residentialRecommendations: payload.recommendations.residential,
          warnings: normalizedReasoning.warnings,
        });
        setIsMapOpen(false);
        return;
      }

      setDestination(payload.partialTrip.destination);
      setArrivalTimeIso(payload.partialTrip.arrivalTimeIso);
      setArrivalTimeLabel(payload.partialTrip.arrivalTimeLabel ?? "");
      setTripClarification(payload.clarification);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run trip agent.";
      setTripParseError(message);
    } finally {
      setTripParseLoading(false);
    }
  };

  const onAnalyzeTripPrompt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runTripAgent(tripPrompt);
  };

  const onSubmitClarification = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tripClarification) {
      return;
    }

    const answer = tripClarificationAnswer.trim();
    if (!answer) {
      setTripParseError("Enter a clarification response to continue.");
      return;
    }

    const nextPrompt =
      tripClarification.target === "arrival_time" && destination
        ? `${destination} ${answer}`
        : answer;

    setTripPrompt(nextPrompt);
    await runTripAgent(nextPrompt);
  };

  const onChooseClarificationOption = async (value: string) => {
    const optionValue = value.trim();
    const nextPrompt =
      tripClarification?.target === "destination" && arrivalTimeLabel
        ? `${optionValue} arriving ${arrivalTimeLabel}`
        : optionValue;
    if (!nextPrompt) {
      return;
    }
    setTripPrompt(nextPrompt);
    setTripClarificationAnswer("");
    await runTripAgent(nextPrompt);
  };

  const onTestLocation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const lat = Number.parseFloat(testLatitude);
    const lng = Number.parseFloat(testLongitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setLiveLocationError("Enter valid latitude and longitude values.");
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setLiveLocationError("Latitude must be between -90 and 90, and longitude between -180 and 180.");
      return;
    }

    const coords: LiveCoordinates = {
      lat,
      lng,
      accuracyMeters: null,
    };

    setLiveLocationError(null);
    setPaymentEntryMessage(null);
    setParkedSnapshot(null);
    setSessionRestoreMessage(null);
    setRulesRundown(null);
    setParkingSessionId(null);
    setParkingSessionResumeToken(null);
    setRenewFromSessionId(null);
    setLiveLocation(coords);
    latestLocationRef.current = coords;
    lastSentLocationRef.current = coords;

    try {
      await resolveCurrentZoneForCoords(coords);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resolve current parking zone.";
      setLiveLocationError(message);
    }
  };

  const onHaveParked = async () => {
    setParkedSnapshotLoading(true);
    setPaymentEntryMessage(null);
    setLiveLocationError(null);
    setSessionRestoreMessage(null);

    try {
      let coords = latestLocationRef.current ?? liveLocation;
      if (!coords) {
        if (geolocationSupported !== true) {
          setLiveLocationError("Geolocation is unavailable. Enter coordinates and tap Test My Location first.");
          return;
        }

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

      const result = await resolveCurrentZoneForCoords(coords);
      setLiveZoneResult(result);
      setParkedSnapshot(result);
      const capturedSession = await captureParkingSession(coords);
      setParkingSessionId(capturedSession.sessionId);
      setParkingSessionResumeToken(capturedSession.resumeToken);
      setRenewFromSessionId(null);
      setRulesRundown(capturedSession.rulesRundown);
      setPaymentZoneValue(capturedSession.captured.zoneNumber ?? result.zone.zoneNumber ?? "");
      setPaymentDurationMinutes("60");
      setSessionRestoreMessage("Saved parked location. This session can be reopened from reminder links.");
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

  const onProceedToPayment = async () => {
    if (!parkedSnapshot) {
      return;
    }

    const normalizedZone = paymentZoneValue.trim();
    const duration = Number.parseInt(paymentDurationMinutes, 10);

    if (!normalizedZone) {
      setPaymentEntryMessage("Enter a parking zone before confirming.");
      return;
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      setPaymentEntryMessage("Enter a valid parking duration in minutes.");
      return;
    }

    if (!parkingSessionId) {
      setPaymentEntryMessage("Tap I have parked! to create a parking session before confirming.");
      return;
    }

    setPaymentExecuting(true);
    setPaymentEntryMessage(null);
    try {
      const params = new URLSearchParams({
        sessionId: parkingSessionId,
        zoneNumber: normalizedZone,
        durationMinutes: String(duration),
      });
      if (renewFromSessionId) {
        params.set("renewFromSessionId", renewFromSessionId);
      }

      window.location.assign(`/parking/payment?${params.toString()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open payment page.";
      setPaymentEntryMessage(message);
      setPaymentExecuting(false);
    }
  };

  return (
    <section className="w-full max-w-4xl space-y-5">
      <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-black">Trip Agent</h2>
        <p className="mt-2 text-sm text-black/70">
          Describe your trip in plain language. ParkOS will parse destination and arrival time, resolve Google Places
          candidates, cross-reference downtown zone geojson, and either return recommendations or ask one clarification.
        </p>

        <form onSubmit={onAnalyzeTripPrompt} className="mt-5 space-y-3">
          <label className="block text-sm text-black/80">
            Trip Prompt
            <textarea
              value={tripPrompt}
              onChange={(event) => setTripPrompt(event.target.value)}
              className="mt-1 min-h-24 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="e.g. Going to Luna Red today @ 8pm"
            />
          </label>
          <button
            type="submit"
            disabled={tripParseLoading}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {tripParseLoading ? "Planning..." : "Plan Parking"}
          </button>
          <p className="text-xs text-black/60">
            Arrival time is captured now for context and does not affect ranking yet. Ranking stays distance-first.
          </p>
        </form>

        {tripParseError ? <p className="mt-3 text-sm text-red-700">{tripParseError}</p> : null}

        {(destination || arrivalTimeLabel || tripWarnings.length > 0 || tripConfidence || tripRunId) ? (
          <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.02] p-4 text-sm text-black">
            <p>
              Parsed destination: <strong>{destination || "Not found"}</strong>
            </p>
            <p>Parsed arrival time: {arrivalTimeLabel || "Not specified"}</p>
            {arrivalTimeIso ? <p className="text-xs text-black/70">Normalized ISO: {arrivalTimeIso}</p> : null}
            {tripConfidence ? (
              <p className="text-xs text-black/70">
                Confidence: {tripConfidence.label} ({tripConfidence.score.toFixed(2)})
              </p>
            ) : null}
            {tripRunId ? <p className="text-xs text-black/60">Run ID: {tripRunId}</p> : null}
            {tripWarnings.length > 0 ? (
              <p className="mt-2 text-xs text-amber-700">{tripWarnings.join(" ")}</p>
            ) : null}
          </div>
        ) : null}

        {tripReasoning ? (
          <div className="mt-4 rounded-lg border border-black/10 bg-white p-4 text-sm text-black">
            <p className="font-semibold">Why this recommendation?</p>
            <p className="mt-1 text-xs text-black/70">
              Strategy: distance-first ranking with destination confidence checks and downtown proximity validation.
            </p>
            {tripReasoning.factors.length > 0 ? (
              <p className="mt-2 text-xs text-black/70">Score factors: {tripReasoning.factors.join(" | ")}</p>
            ) : null}

            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-black/70">Decision Steps</p>
              <ol className="mt-1 space-y-2">
                {tripReasoning.steps.map((step, index) => (
                  <li key={`${step.name}-${index}`} className="rounded border border-black/10 bg-black/[0.02] p-2">
                    <p className="text-xs font-semibold text-black">
                      {index + 1}. {formatStepName(step.name)} ({step.outcome})
                    </p>
                    <p className="text-xs text-black/80">{step.detail}</p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-black/70">Candidate Scores</p>
              <p className="mt-1 text-xs text-black/70">
                Query: <span className="font-mono">{tripReasoning.candidateDiagnostics.query || "n/a"}</span>
                {tripReasoning.candidateDiagnostics.topTwoScoreGap !== null
                  ? ` | top gap: ${tripReasoning.candidateDiagnostics.topTwoScoreGap.toFixed(3)}`
                  : ""}
              </p>
              {tripReasoning.candidateDiagnostics.rankedCandidates.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {tripReasoning.candidateDiagnostics.rankedCandidates.map((candidate) => (
                    <div
                      key={`${candidate.placeId ?? candidate.formattedAddress}-${candidate.score}`}
                      className="rounded border border-black/10 bg-black/[0.02] p-2"
                    >
                      <p className="text-xs font-semibold text-black">
                        {candidate.destination} ({candidate.score.toFixed(3)})
                      </p>
                      <p className="text-xs text-black/70">{candidate.formattedAddress}</p>
                      <p className="text-xs text-black/70">Reasoning: {candidate.reasons.join(", ")}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-black/60">No candidates available for this run.</p>
              )}
            </div>

            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-black/70">Point Selection Rationale</p>
              {tripReasoning.parkingPointRationale.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {tripReasoning.parkingPointRationale.map((point) => (
                    <div
                      key={`${point.category}-${point.zoneNumber}-${point.distanceMeters}`}
                      className="rounded border border-black/10 bg-black/[0.02] p-2"
                    >
                      <p className="text-xs font-semibold text-black">
                        {point.category === "paid" ? "Paid" : "Residential"} zone {point.zoneNumber}
                      </p>
                      <p className="text-xs text-black/70">
                        {Math.round(point.distanceMeters)}m away. {point.rationale}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-black/60">No parking point rationale available yet for this run.</p>
              )}
            </div>
          </div>
        ) : null}

        {tripClarification ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Need Clarification</p>
            <p className="mt-1">{tripClarification.question}</p>
            {tripClarification.options.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {tripClarification.options.map((option) => (
                  <button
                    key={`${option.label}-${option.value}`}
                    type="button"
                    onClick={() => void onChooseClarificationOption(option.value)}
                    disabled={tripParseLoading}
                    className="rounded-md border border-amber-400 bg-white px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            <form onSubmit={onSubmitClarification} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={tripClarificationAnswer}
                onChange={(event) => setTripClarificationAnswer(event.target.value)}
                className="w-full rounded-md border border-amber-300 px-3 py-2 text-sm text-black"
                placeholder={
                  tripClarification.target === "arrival_time"
                    ? "e.g. tonight at 8pm"
                    : "Enter destination clarification"
                }
              />
              <button
                type="submit"
                disabled={tripParseLoading}
                className="rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {tripParseLoading ? "Retrying..." : "Submit Clarification"}
              </button>
            </form>
          </div>
        ) : null}

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
          capture your payment entry details. You can also enter manual coordinates below for testing.
        </p>

        {geolocationSupported === false ? (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Geolocation is not supported in this browser. Use manual test coordinates instead.
          </p>
        ) : geolocationSupported === null ? (
          <p className="mt-4 rounded-md border border-black/15 bg-black/[0.02] px-3 py-2 text-sm text-black/70">
            Checking browser location support...
          </p>
        ) : (
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
        )}

        <form onSubmit={onTestLocation} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-sm text-black/80">
            Test Latitude
            <input
              value={testLatitude}
              onChange={(event) => setTestLatitude(event.target.value)}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="e.g. 35.282753"
            />
          </label>
          <label className="text-sm text-black/80">
            Test Longitude
            <input
              value={testLongitude}
              onChange={(event) => setTestLongitude(event.target.value)}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="e.g. -120.659616"
            />
          </label>
          <button
            type="submit"
            disabled={liveZoneLoading}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {liveZoneLoading ? "Testing..." : "Test My Location"}
          </button>
        </form>

        {geolocationSupported === false ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={onHaveParked}
              disabled={parkedSnapshotLoading}
              className="rounded-md border border-black/20 bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {parkedSnapshotLoading ? "Capturing..." : "I have parked!"}
            </button>
          </div>
        ) : null}

        {liveLocationError ? <p className="mt-3 text-sm text-red-700">{liveLocationError}</p> : null}
        {sessionRestoreMessage ? (
          <p className="mt-2 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 text-sm text-black/80">
            {sessionRestoreMessage}
          </p>
        ) : null}
        {parkingSessionId ? (
          <p className="mt-2 text-xs text-black/60">
            Session ready: <code>{parkingSessionId}</code>
            {parkingSessionResumeToken ? (
              <>
                {" "}
                | Resume token: <code>{parkingSessionResumeToken}</code>
              </>
            ) : null}
          </p>
        ) : null}

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
                {liveLocation.accuracyMeters === null
                  ? "Manual test coordinates"
                  : `${Math.round(liveLocation.accuracyMeters)}m`}
              </p>
            </>
          ) : (
            <p className="mt-1 text-black/70">Waiting for location fix or manual test coordinate.</p>
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
                {liveZoneResult.zone.distanceMeters !== null ? ` (${Math.round(liveZoneResult.zone.distanceMeters)}m)` : ""}
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

            {rulesRundown ? (
              <div className="mt-3 rounded-md border border-black/10 bg-black/[0.02] p-3">
                <p className="font-semibold">{rulesRundown.headline}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-black/85">
                  {rulesRundown.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-black/70">
                  {rulesRundown.timeLimitSummary} Confidence: {rulesRundown.confidence}.
                </p>
                {rulesRundown.citations.length > 0 ? (
                  <p className="mt-1 text-xs text-black/60">
                    Sources:{" "}
                    {rulesRundown.citations.map((citation, index) => (
                      <span key={citation}>
                        {index > 0 ? ", " : ""}
                        <a href={citation} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          {citation}
                        </a>
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 rounded-md border border-black/10 bg-black/[0.02] p-3">
              <p className="text-black/80">
                Look around you. Is this the correct zone that you parked at? If not, edit it before confirming.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm text-black/80">
                  Zone
                  <input
                    value={paymentZoneValue}
                    onChange={(event) => setPaymentZoneValue(event.target.value)}
                    className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                    placeholder="e.g. 72510"
                  />
                </label>
                <label className="text-sm text-black/80">
                  Duration (minutes)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={paymentDurationMinutes}
                    onChange={(event) => setPaymentDurationMinutes(event.target.value)}
                    className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                    placeholder="e.g. 60"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={onProceedToPayment}
                disabled={paymentExecuting}
                className="mt-3 rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {paymentExecuting ? "Opening..." : "Confirm and Pay"}
              </button>
            </div>

            {!parkedSnapshot.zone.paymentEligible ? (
              <p className="mt-2 text-black/70">
                This location was detected as non-payable, so double-check the zone before confirming.
              </p>
            ) : null}

            {paymentEntryMessage ? <p className="mt-2 text-sm text-black/80">{paymentEntryMessage}</p> : null}
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
