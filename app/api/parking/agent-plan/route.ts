import { NextResponse } from "next/server";

import { GooglePlacesConfigError, GooglePlacesLookupError } from "@/lib/google-places";
import { normalizeRecommendationLimit, ParkingRecommendationError } from "@/lib/parking-recommendation-engine";
import { orchestrateTripAgent } from "@/lib/trip-agent/orchestrator";

type AgentPlanRequest = {
  prompt?: string;
  limit?: number;
};

type AgentPlanErrorResponse = {
  error: string;
};

export async function POST(request: Request) {
  let body: AgentPlanRequest;
  try {
    body = (await request.json()) as AgentPlanRequest;
  } catch {
    return NextResponse.json<AgentPlanErrorResponse>({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json<AgentPlanErrorResponse>({ error: "The `prompt` field is required." }, { status: 400 });
  }

  const limit = normalizeRecommendationLimit(body.limit, 5);

  try {
    const result = await orchestrateTripAgent({
      prompt,
      limit,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ParkingRecommendationError) {
      return NextResponse.json<AgentPlanErrorResponse>({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof GooglePlacesConfigError) {
      console.error("Trip agent config error:", error.message);
      return NextResponse.json<AgentPlanErrorResponse>({ error: error.message }, { status: 500 });
    }
    if (error instanceof GooglePlacesLookupError) {
      console.error("Trip agent Google lookup error:", {
        message: error.message,
        statusCode: error.statusCode,
      });
      return NextResponse.json<AgentPlanErrorResponse>({ error: error.message }, { status: 502 });
    }

    console.error("Trip agent unexpected error:", error);
    return NextResponse.json<AgentPlanErrorResponse>(
      { error: "Unexpected server error while running trip agent." },
      { status: 500 },
    );
  }
}
