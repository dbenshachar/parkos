import type {
  PaidParkingRecommendation,
  ResidentialParkingRecommendation,
} from "@/lib/parking-recommendation-engine";
import type { ParsedTripIntent } from "@/lib/trip-parser";

export type TripAgentReasoningStep = {
  name:
    | "parse_intent"
    | "resolve_destination_candidates"
    | "score_and_select_destination"
    | "recommend_zones"
    | "decide_response";
  outcome: "ok" | "fallback" | "clarify";
  detail: string;
};

export type TripAgentCandidateDiagnostic = {
  destination: string;
  formattedAddress: string;
  placeId: string | null;
  score: number;
  reasons: string[];
};

export type TripAgentParkingPointRationale = {
  category: "paid" | "residential";
  zoneNumber: string;
  distanceMeters: number;
  rationale: string;
};

export type TripAgentReasoning = {
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  warnings: string[];
  factors: string[];
  steps: TripAgentReasoningStep[];
  candidateDiagnostics: {
    query: string;
    topTwoScoreGap: number | null;
    selectedPlaceId: string | null;
    rankedCandidates: TripAgentCandidateDiagnostic[];
  };
  parkingPointRationale: TripAgentParkingPointRationale[];
};

export type TripAgentTrip = Pick<ParsedTripIntent, "destination" | "arrivalTimeIso" | "arrivalTimeLabel" | "timezone">;

export type TripAgentDestination = {
  name: string;
  street: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  placeId: string | null;
};

export type TripAgentClarificationTarget = "destination" | "arrival_time" | "destination_refinement";

export type TripAgentClarificationOption = {
  label: string;
  value: string;
};

export type TripAgentClarification = {
  target: TripAgentClarificationTarget;
  question: string;
  options: TripAgentClarificationOption[];
};

export type TripAgentReadyResponse = {
  status: "ready";
  runId: string;
  trip: TripAgentTrip;
  destination: TripAgentDestination;
  recommendations: {
    nearestParkingDistanceMeters: number;
    paid: PaidParkingRecommendation[];
    residential: ResidentialParkingRecommendation[];
  };
  reasoning: TripAgentReasoning;
};

export type TripAgentNeedsClarificationResponse = {
  status: "needs_clarification";
  runId: string;
  clarification: TripAgentClarification;
  partialTrip: TripAgentTrip;
  reasoning: TripAgentReasoning;
};

export type TripAgentResponse = TripAgentReadyResponse | TripAgentNeedsClarificationResponse;
