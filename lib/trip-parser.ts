import "server-only";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const TRIP_PARSER_MODEL = process.env.OPENAI_TRIP_PARSER_MODEL?.trim() || "gpt-4o-mini";

export const TRIP_TIMEZONE = "America/Los_Angeles" as const;

export type TripParseConfidence = "high" | "medium" | "low";

export type ParsedTripIntent = {
  destination: string;
  arrivalTimeIso: string | null;
  arrivalTimeLabel: string | null;
  timezone: typeof TRIP_TIMEZONE;
  confidence: TripParseConfidence;
  warnings: string[];
};

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

type RawTripParserPayload = {
  destination?: unknown;
  arrivalTimeStatus?: unknown;
  arrivalTimeIso?: unknown;
  confidence?: unknown;
  warnings?: unknown;
};

type ArrivalTimeStatus = "present" | "missing" | "ambiguous";

export class TripParserConfigError extends Error {}
export class TripParserExtractionError extends Error {}

function getOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new TripParserConfigError("Missing OPENAI_API_KEY environment variable.");
  }
  return key;
}

function normalizeConfidence(value: unknown): TripParseConfidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function normalizeArrivalStatus(value: unknown): ArrivalTimeStatus {
  if (value === "present" || value === "missing" || value === "ambiguous") {
    return value;
  }
  return "missing";
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function isLosAngelesOffsetIso(value: string): boolean {
  return /-(07|08):00$/i.test(value);
}

function formatArrivalTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new TripParserExtractionError("Parsed arrival time is not a valid ISO timestamp.");
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: TRIP_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

function normalizeDestination(value: unknown): string {
  if (typeof value !== "string") {
    throw new TripParserExtractionError("Parsed destination is missing.");
  }
  const destination = value.trim();
  if (!destination) {
    throw new TripParserExtractionError("Parsed destination is empty.");
  }
  return destination;
}

function parseJsonContent(content: string): RawTripParserPayload {
  try {
    return JSON.parse(content) as RawTripParserPayload;
  } catch {
    throw new TripParserExtractionError("Trip parser returned invalid JSON.");
  }
}

function getLosAngelesNowIso(): string {
  const now = new Date();
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TRIP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(now)
    .replace(" ", "T");
}

function buildSystemPrompt(): string {
  return [
    "You extract parking trip intent for downtown San Luis Obispo.",
    `Interpret relative dates/times using timezone ${TRIP_TIMEZONE}.`,
    `Current local datetime reference in ${TRIP_TIMEZONE}: ${getLosAngelesNowIso()}.`,
    "Return only JSON with this schema:",
    "{",
    '  "destination": string,',
    '  "arrivalTimeStatus": "present" | "missing" | "ambiguous",',
    '  "arrivalTimeIso": string | null,',
    '  "confidence": "high" | "medium" | "low",',
    '  "warnings": string[]',
    "}",
    "Rules:",
    "- destination must be the intended place/business/location.",
    "- If arrival time is clearly given, set arrivalTimeStatus=present and provide an ISO8601 timestamp with Los Angeles offset (-07:00 or -08:00).",
    "- If no arrival time is mentioned, set arrivalTimeStatus=missing and arrivalTimeIso=null.",
    "- If time is unclear/contradictory, set arrivalTimeStatus=ambiguous and arrivalTimeIso=null.",
    "- warnings should be empty unless there is ambiguity or assumptions.",
  ].join("\n");
}

export function fallbackTripIntentFromPrompt(prompt: string, warning: string): ParsedTripIntent {
  return {
    destination: prompt.trim(),
    arrivalTimeIso: null,
    arrivalTimeLabel: null,
    timezone: TRIP_TIMEZONE,
    confidence: "low",
    warnings: [warning],
  };
}

export async function parseTripPromptWithLlm(prompt: string): Promise<ParsedTripIntent> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new TripParserExtractionError("Trip prompt cannot be empty.");
  }

  const apiKey = getOpenAiApiKey();
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TRIP_PARSER_MODEL,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "trip_intent_extract",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["destination", "arrivalTimeStatus", "arrivalTimeIso", "confidence", "warnings"],
            properties: {
              destination: { type: "string" },
              arrivalTimeStatus: {
                type: "string",
                enum: ["present", "missing", "ambiguous"],
              },
              arrivalTimeIso: {
                anyOf: [{ type: "string" }, { type: "null" }],
              },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
              warnings: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: trimmedPrompt },
      ],
    }),
  });

  const payload = (await response.json()) as OpenAiChatCompletionResponse;
  if (!response.ok) {
    throw new TripParserExtractionError(
      payload.error?.message || `Trip parser request failed with status ${response.status}.`,
    );
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new TripParserExtractionError("Trip parser returned an empty response.");
  }

  const parsed = parseJsonContent(content);
  const destination = normalizeDestination(parsed.destination);
  const arrivalStatus = normalizeArrivalStatus(parsed.arrivalTimeStatus);
  const confidence = normalizeConfidence(parsed.confidence);
  const warnings = normalizeWarnings(parsed.warnings);

  if (arrivalStatus === "ambiguous") {
    throw new TripParserExtractionError("Could not confidently resolve arrival time from the trip prompt.");
  }

  if (arrivalStatus === "missing") {
    return {
      destination,
      arrivalTimeIso: null,
      arrivalTimeLabel: null,
      timezone: TRIP_TIMEZONE,
      confidence,
      warnings,
    };
  }

  if (typeof parsed.arrivalTimeIso !== "string" || !parsed.arrivalTimeIso.trim()) {
    throw new TripParserExtractionError("Trip parser marked arrival time as present but did not return a timestamp.");
  }

  const arrivalTimeIso = parsed.arrivalTimeIso.trim();
  if (!isLosAngelesOffsetIso(arrivalTimeIso)) {
    throw new TripParserExtractionError("Trip parser did not return a Los Angeles ISO offset timestamp.");
  }

  const arrivalTimeLabel = formatArrivalTimeLabel(arrivalTimeIso);

  return {
    destination,
    arrivalTimeIso,
    arrivalTimeLabel,
    timezone: TRIP_TIMEZONE,
    confidence,
    warnings,
  };
}
