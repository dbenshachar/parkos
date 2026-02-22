import { randomUUID } from "node:crypto";

import {
  GooglePlacesLookupError,
  searchDestinationsWithGooglePlaces,
  type ResolvedDestination,
} from "@/lib/google-places";
import {
  ParkingRecommendationError,
  recommendParkingForResolvedDestination,
  type ParkingRecommendationEngineResult,
} from "@/lib/parking-recommendation-engine";
import { computeTripAgentScore } from "@/lib/trip-agent/scoring";
import type {
  TripAgentClarification,
  TripAgentClarificationOption,
  TripAgentNeedsClarificationResponse,
  TripAgentReasoningStep,
  TripAgentResponse,
  TripAgentTrip,
} from "@/lib/trip-agent/types";
import {
  fallbackTripIntentFromPrompt,
  parseTripPromptWithLlm,
  TripParserConfigError,
  TripParserExtractionError,
  type ParsedTripIntent,
} from "@/lib/trip-parser";

const DESTINATION_AMBIGUITY_GAP_THRESHOLD = 0.12;
const READY_CONFIDENCE_THRESHOLD = 0.55;

type RankedDestinationCandidate = {
  candidate: ResolvedDestination;
  score: number;
  nameScore: number;
  addressScore: number;
  localityBoost: number;
  reasons: string[];
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .map((item) => item.trim())
      .filter((item) => item.length > 1),
  );
}

function countIntersection(a: Set<string>, b: Set<string>): number {
  let matches = 0;
  for (const token of a) {
    if (b.has(token)) {
      matches += 1;
    }
  }
  return matches;
}

function rankDestinationCandidates(query: string, candidates: ResolvedDestination[]): RankedDestinationCandidate[] {
  const queryTokens = tokenize(query);

  return candidates
    .map((candidate, index) => {
      const nameTokens = tokenize(candidate.destination);
      const addressTokens = tokenize(candidate.formattedAddress);
      const nameMatches = countIntersection(queryTokens, nameTokens);
      const addressMatches = countIntersection(queryTokens, addressTokens);
      const nameScore = queryTokens.size > 0 ? nameMatches / queryTokens.size : 0;
      const addressScore = queryTokens.size > 0 ? addressMatches / queryTokens.size : 0;
      const localityBoost = candidate.formattedAddress.toLowerCase().includes("san luis obispo") ? 0.2 : 0;
      const reasons: string[] = [];

      if (nameScore > 0) {
        reasons.push(`name match ${(nameScore * 100).toFixed(0)}%`);
      }
      if (addressScore > 0) {
        reasons.push(`address match ${(addressScore * 100).toFixed(0)}%`);
      }
      if (localityBoost > 0) {
        reasons.push("downtown SLO locality boost");
      }
      if (reasons.length === 0) {
        reasons.push("low lexical match, kept as fallback candidate");
      }

      return {
        candidate,
        score: nameScore + addressScore * 0.35 + localityBoost - index * 0.001,
        nameScore,
        addressScore,
        localityBoost,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function isArrivalTimeAmbiguityError(error: unknown): boolean {
  if (!(error instanceof TripParserExtractionError)) {
    return false;
  }
  return /arrival time|resolve arrival time|time is unclear/i.test(error.message);
}

function sanitizeDestinationQuery(raw: string): string {
  const cleaned = raw
    .replace(/\b(going to|headed to|driving to|trip to|dinner at|lunch at|meeting at)\b/gi, " ")
    .replace(/\b(today|tonight|tomorrow|tmrw|this evening|this afternoon|this morning)\b/gi, " ")
    .replace(/@\s*\d{1,2}(:\d{2})?\s*(am|pm)?/gi, " ")
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || raw.trim();
}

function dedupeWarnings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function toTrip(parsedIntent: ParsedTripIntent): TripAgentTrip {
  return {
    destination: parsedIntent.destination,
    arrivalTimeIso: parsedIntent.arrivalTimeIso,
    arrivalTimeLabel: parsedIntent.arrivalTimeLabel,
    timezone: parsedIntent.timezone,
  };
}

function toClarificationOptions(candidates: ResolvedDestination[], limit = 3): TripAgentClarificationOption[] {
  return candidates.slice(0, limit).map((candidate) => ({
    label: `${candidate.destination} — ${candidate.formattedAddress}`,
    value: `${candidate.destination} ${candidate.formattedAddress}`,
  }));
}

function toCandidateDiagnostics(
  rankedCandidates: RankedDestinationCandidate[],
  query: string,
  topTwoScoreGap: number | null,
  selectedPlaceId: string | null,
) {
  return {
    query,
    topTwoScoreGap: topTwoScoreGap === null ? null : Number(topTwoScoreGap.toFixed(3)),
    selectedPlaceId,
    rankedCandidates: rankedCandidates.slice(0, 5).map((item) => ({
      destination: item.candidate.destination,
      formattedAddress: item.candidate.formattedAddress,
      placeId: item.candidate.placeId,
      score: Number(item.score.toFixed(3)),
      reasons: item.reasons,
    })),
  };
}

function toParkingPointRationale(parkingRecommendation: ParkingRecommendationEngineResult) {
  const allPoints = [
    ...parkingRecommendation.recommendations.map((item) => ({
      category: "paid" as const,
      zoneNumber: item.zoneNumber,
      distanceMeters: item.distanceMeters,
      rationale: `Paid zone ${item.zoneNumber} at ${item.price}, ${Math.round(item.distanceMeters)}m from destination.`,
    })),
    ...parkingRecommendation.residentialRecommendations.map((item) => ({
      category: "residential" as const,
      zoneNumber: item.zoneNumber,
      distanceMeters: item.distanceMeters,
      rationale: `Residential zone ${item.zoneNumber}, permit rules may apply, ${Math.round(item.distanceMeters)}m from destination.`,
    })),
  ].sort((a, b) => a.distanceMeters - b.distanceMeters);

  return allPoints.slice(0, 5);
}

function buildClarificationResponse(input: {
  runId: string;
  clarification: TripAgentClarification;
  partialTrip: TripAgentTrip;
  warnings: string[];
  steps: TripAgentReasoningStep[];
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
  score: {
    confidence: "high" | "medium" | "low";
    confidenceScore: number;
    factors: string[];
  };
}): TripAgentNeedsClarificationResponse {
  return {
    status: "needs_clarification",
    runId: input.runId,
    clarification: input.clarification,
    partialTrip: input.partialTrip,
    reasoning: {
      confidence: input.score.confidence,
      confidenceScore: input.score.confidenceScore,
      warnings: input.warnings,
      factors: input.score.factors,
      steps: input.steps,
      candidateDiagnostics: input.candidateDiagnostics,
      parkingPointRationale: input.parkingPointRationale,
    },
  };
}

function defaultScoreForClarification(parsedIntent: ParsedTripIntent) {
  const result = computeTripAgentScore({
    parserConfidence: parsedIntent.confidence,
    destinationInSanLuisObispo: false,
    topTwoScoreGap: null,
    nearestPaidDistanceMeters: null,
  });
  return {
    confidence: result.confidence,
    confidenceScore: result.confidenceScore,
    factors: result.factors,
  };
}

export async function orchestrateTripAgent(input: { prompt: string; limit: number }): Promise<TripAgentResponse> {
  const runId = randomUUID();
  const steps: TripAgentReasoningStep[] = [];

  let parsedIntent: ParsedTripIntent;
  let hasArrivalTimeAmbiguity = false;

  try {
    parsedIntent = await parseTripPromptWithLlm(input.prompt);
    steps.push({
      name: "parse_intent",
      outcome: "ok",
      detail: `Extracted destination "${parsedIntent.destination}".`,
    });
  } catch (error) {
    if (error instanceof TripParserConfigError || error instanceof TripParserExtractionError) {
      parsedIntent = fallbackTripIntentFromPrompt(input.prompt, error.message);
      hasArrivalTimeAmbiguity = isArrivalTimeAmbiguityError(error);
      steps.push({
        name: "parse_intent",
        outcome: "fallback",
        detail: `Parser fallback applied: ${error.message}`,
      });
    } else {
      throw error;
    }
  }

  const destinationQuery = sanitizeDestinationQuery(parsedIntent.destination);
  const defaultCandidateDiagnostics = {
    query: destinationQuery,
    topTwoScoreGap: null,
    selectedPlaceId: null,
    rankedCandidates: [] as Array<{
      destination: string;
      formattedAddress: string;
      placeId: string | null;
      score: number;
      reasons: string[];
    }>,
  };
  const defaultParkingPointRationale: Array<{
    category: "paid" | "residential";
    zoneNumber: string;
    distanceMeters: number;
    rationale: string;
  }> = [];

  let destinationCandidates: ResolvedDestination[];
  try {
    destinationCandidates = await searchDestinationsWithGooglePlaces(destinationQuery, 5);
    steps.push({
      name: "resolve_destination_candidates",
      outcome: "ok",
      detail: `Resolved ${destinationCandidates.length} destination candidate(s).`,
    });
  } catch (error) {
    if (error instanceof GooglePlacesLookupError && /No destination results/i.test(error.message)) {
      steps.push({
        name: "resolve_destination_candidates",
        outcome: "clarify",
        detail: "No valid destination candidates were returned.",
      });

      return buildClarificationResponse({
        runId,
        clarification: {
          target: "destination_refinement",
          question: "I couldn't find that destination in downtown San Luis Obispo. Can you share the exact place name?",
          options: [],
        },
        partialTrip: toTrip(parsedIntent),
        warnings: dedupeWarnings(parsedIntent.warnings),
        steps,
        candidateDiagnostics: defaultCandidateDiagnostics,
        parkingPointRationale: defaultParkingPointRationale,
        score: defaultScoreForClarification(parsedIntent),
      });
    }

    throw error;
  }

  const rankedCandidates = rankDestinationCandidates(destinationQuery, destinationCandidates);
  const selectedCandidate = rankedCandidates[0]?.candidate;
  if (!selectedCandidate) {
    steps.push({
      name: "score_and_select_destination",
      outcome: "clarify",
      detail: "No ranked destination candidate was available.",
    });

    return buildClarificationResponse({
      runId,
      clarification: {
        target: "destination_refinement",
        question: "I need a more specific downtown destination to continue.",
        options: [],
      },
      partialTrip: toTrip(parsedIntent),
      warnings: dedupeWarnings(parsedIntent.warnings),
      steps,
      candidateDiagnostics: defaultCandidateDiagnostics,
      parkingPointRationale: defaultParkingPointRationale,
      score: defaultScoreForClarification(parsedIntent),
    });
  }

  const secondCandidate = rankedCandidates[1] ?? null;
  const topTwoScoreGap = secondCandidate ? rankedCandidates[0].score - secondCandidate.score : null;
  const destinationAmbiguous = secondCandidate !== null && topTwoScoreGap !== null && topTwoScoreGap < DESTINATION_AMBIGUITY_GAP_THRESHOLD;
  const candidateDiagnostics = toCandidateDiagnostics(
    rankedCandidates,
    destinationQuery,
    topTwoScoreGap,
    selectedCandidate.placeId,
  );

  steps.push({
    name: "score_and_select_destination",
    outcome: destinationAmbiguous ? "clarify" : "ok",
    detail: destinationAmbiguous
      ? "Top destination candidates were too close in score."
      : `Selected "${selectedCandidate.destination}" as best destination match.`,
  });

  let parkingRecommendation: ParkingRecommendationEngineResult;
  let parkingPointRationale: Array<{
    category: "paid" | "residential";
    zoneNumber: string;
    distanceMeters: number;
    rationale: string;
  }> = [];
  try {
    parkingRecommendation = recommendParkingForResolvedDestination({
      resolvedDestination: selectedCandidate,
      limit: input.limit,
      enforceDowntownDistance: false,
    });
    steps.push({
      name: "recommend_zones",
      outcome: parkingRecommendation.withinDowntownDistance ? "ok" : "clarify",
      detail: `Nearest paid parking is ${Math.round(parkingRecommendation.nearestParkingDistanceMeters)}m away.`,
    });
    parkingPointRationale = toParkingPointRationale(parkingRecommendation);
  } catch (error) {
    if (error instanceof ParkingRecommendationError && error.code === "NO_PAID_ZONES") {
      steps.push({
        name: "recommend_zones",
        outcome: "clarify",
        detail: "No paid parking zones were available for this destination.",
      });

      return buildClarificationResponse({
        runId,
        clarification: {
          target: "destination_refinement",
          question: "I couldn't find paid downtown parking near that destination. Can you refine it to a downtown SLO landmark?",
          options: toClarificationOptions(destinationCandidates),
        },
        partialTrip: toTrip(parsedIntent),
        warnings: dedupeWarnings(parsedIntent.warnings),
        steps,
        candidateDiagnostics,
        parkingPointRationale: defaultParkingPointRationale,
        score: defaultScoreForClarification(parsedIntent),
      });
    }

    throw error;
  }

  const destinationInSanLuisObispo = selectedCandidate.formattedAddress.toLowerCase().includes("san luis obispo");
  const score = computeTripAgentScore({
    parserConfidence: parsedIntent.confidence,
    destinationInSanLuisObispo,
    topTwoScoreGap,
    nearestPaidDistanceMeters: parkingRecommendation.nearestParkingDistanceMeters,
  });

  const warnings = dedupeWarnings([
    ...parsedIntent.warnings,
    ...parkingRecommendation.warnings,
    ...(!parkingRecommendation.withinDowntownDistance
      ? [
          `Nearest paid parking is ${Math.round(parkingRecommendation.nearestParkingDistanceMeters)}m away; destination appears outside core downtown.`,
        ]
      : []),
  ]);

  if (hasArrivalTimeAmbiguity) {
    steps.push({
      name: "decide_response",
      outcome: "clarify",
      detail: "Arrival time was ambiguous in the original prompt.",
    });

    return buildClarificationResponse({
      runId,
      clarification: {
        target: "arrival_time",
        question: "What time are you planning to arrive?",
        options: [],
      },
      partialTrip: toTrip(parsedIntent),
      warnings,
      steps,
      candidateDiagnostics,
      parkingPointRationale,
      score,
    });
  }

  if (destinationAmbiguous) {
    steps.push({
      name: "decide_response",
      outcome: "clarify",
      detail: "Requesting destination clarification due close candidate scores.",
    });

    return buildClarificationResponse({
      runId,
      clarification: {
        target: "destination",
        question: "I found multiple likely destinations. Which one do you mean?",
        options: toClarificationOptions(rankedCandidates.map((item) => item.candidate)),
      },
      partialTrip: toTrip(parsedIntent),
      warnings,
      steps,
      candidateDiagnostics,
      parkingPointRationale,
      score,
    });
  }

  if (!parkingRecommendation.withinDowntownDistance) {
    steps.push({
      name: "decide_response",
      outcome: "clarify",
      detail: "Destination was outside downtown parking threshold.",
    });

    return buildClarificationResponse({
      runId,
      clarification: {
        target: "destination_refinement",
        question: `That destination is ${Math.round(parkingRecommendation.nearestParkingDistanceMeters)}m from downtown paid zones. Can you provide a closer downtown SLO destination?`,
        options: toClarificationOptions(rankedCandidates.map((item) => item.candidate)),
      },
      partialTrip: toTrip(parsedIntent),
      warnings,
      steps,
      candidateDiagnostics,
      parkingPointRationale,
      score,
    });
  }

  if (score.confidenceScore < READY_CONFIDENCE_THRESHOLD) {
    steps.push({
      name: "decide_response",
      outcome: "clarify",
      detail: `Confidence ${score.confidenceScore.toFixed(2)} below ready threshold.`,
    });

    return buildClarificationResponse({
      runId,
      clarification: {
        target: "destination",
        question: "I want to confirm your destination before recommending parking. Which one is correct?",
        options: toClarificationOptions(rankedCandidates.map((item) => item.candidate)),
      },
      partialTrip: toTrip(parsedIntent),
      warnings,
      steps,
      candidateDiagnostics,
      parkingPointRationale,
      score,
    });
  }

  steps.push({
    name: "decide_response",
    outcome: "ok",
    detail: "Returned ready response with destination and recommendations.",
  });

  return {
    status: "ready",
    runId,
    trip: toTrip(parsedIntent),
    destination: {
      name: selectedCandidate.destination,
      street: selectedCandidate.street,
      formattedAddress: selectedCandidate.formattedAddress,
      lat: selectedCandidate.latitude,
      lng: selectedCandidate.longitude,
      placeId: selectedCandidate.placeId,
    },
    recommendations: {
      nearestParkingDistanceMeters: parkingRecommendation.nearestParkingDistanceMeters,
      paid: parkingRecommendation.recommendations,
      residential: parkingRecommendation.residentialRecommendations,
    },
    reasoning: {
      confidence: score.confidence,
      confidenceScore: score.confidenceScore,
      warnings,
      factors: score.factors,
      steps,
      candidateDiagnostics,
      parkingPointRationale,
    },
  };
}
