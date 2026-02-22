type TripParseConfidence = "high" | "medium" | "low";

export type TripAgentScoreInput = {
  parserConfidence: TripParseConfidence;
  destinationInSanLuisObispo: boolean;
  topTwoScoreGap: number | null;
  nearestPaidDistanceMeters: number | null;
};

export type TripAgentScoreResult = {
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  factors: string[];
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeConfidence(score: number): "high" | "medium" | "low" {
  if (score >= 0.75) {
    return "high";
  }
  if (score >= 0.55) {
    return "medium";
  }
  return "low";
}

function parserContribution(confidence: TripParseConfidence): number {
  if (confidence === "high") {
    return 0.45;
  }
  if (confidence === "medium") {
    return 0.3;
  }
  return 0.15;
}

function gapContribution(topTwoScoreGap: number | null): number {
  if (topTwoScoreGap === null) {
    return 0.15;
  }
  if (topTwoScoreGap >= 0.15) {
    return 0.15;
  }
  if (topTwoScoreGap >= 0.08) {
    return 0.08;
  }
  return 0;
}

function parkingContribution(distanceMeters: number | null): number {
  if (distanceMeters === null) {
    return -0.1;
  }
  if (distanceMeters <= 400) {
    return 0.2;
  }
  if (distanceMeters <= 1000) {
    return 0.1;
  }
  return -0.25;
}

export function computeTripAgentScore(input: TripAgentScoreInput): TripAgentScoreResult {
  const factors: string[] = [];

  const parseScore = parserContribution(input.parserConfidence);
  factors.push(`parser:${parseScore.toFixed(2)}`);

  const localityScore = input.destinationInSanLuisObispo ? 0.2 : 0;
  factors.push(`locality:${localityScore.toFixed(2)}`);

  const gapScore = gapContribution(input.topTwoScoreGap);
  factors.push(`candidate_gap:${gapScore.toFixed(2)}`);

  const distanceScore = parkingContribution(input.nearestPaidDistanceMeters);
  factors.push(`distance:${distanceScore.toFixed(2)}`);

  const confidenceScore = clampScore(parseScore + localityScore + gapScore + distanceScore);

  return {
    confidence: normalizeConfidence(confidenceScore),
    confidenceScore: Number(confidenceScore.toFixed(2)),
    factors,
  };
}
