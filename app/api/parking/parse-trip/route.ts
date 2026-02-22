import { NextResponse } from "next/server";

import {
  ParsedTripIntent,
  TripParserConfigError,
  TripParserExtractionError,
  fallbackTripIntentFromPrompt,
  parseTripPromptWithLlm,
} from "@/lib/trip-parser";

type ParseTripRequest = {
  prompt?: string;
};

type ParseTripErrorResponse = {
  error: string;
};

function fallbackWithWarning(prompt: string, warning: string): ParsedTripIntent {
  return fallbackTripIntentFromPrompt(prompt, warning);
}

export async function POST(request: Request) {
  let body: ParseTripRequest;
  try {
    body = (await request.json()) as ParseTripRequest;
  } catch {
    return NextResponse.json<ParseTripErrorResponse>({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json<ParseTripErrorResponse>({ error: "The `prompt` field is required." }, { status: 400 });
  }

  try {
    const parsedIntent = await parseTripPromptWithLlm(prompt);
    return NextResponse.json(parsedIntent, { status: 200 });
  } catch (error) {
    if (error instanceof TripParserConfigError || error instanceof TripParserExtractionError) {
      return NextResponse.json(fallbackWithWarning(prompt, error.message), { status: 200 });
    }

    console.error("Trip parser unexpected error:", error);
    return NextResponse.json<ParseTripErrorResponse>(
      {
        error: "Unexpected server error while parsing trip prompt.",
      },
      { status: 500 },
    );
  }
}
