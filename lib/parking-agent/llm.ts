import "server-only";

import type {
  ParkingContext,
  ParkingNotificationType,
  ParkingRulesRundown,
} from "@/lib/parking-agent/types";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const PARKING_AGENT_MODEL = process.env.OPENAI_PARKING_AGENT_MODEL?.trim() || "gpt-4o-mini";

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

type RawRulesRundownPayload = {
  headline?: unknown;
  bullets?: unknown;
  time_limit_summary?: unknown;
  confidence?: unknown;
  citations?: unknown;
};

type SmsInput =
  | {
      type: "payment_confirmed";
      zone: string;
      durationMinutes: number;
      expiresLocal: string;
    }
  | {
      type: "post_payment_info";
      zone: string;
      topRules: string[];
      timeLimitSummary: string;
      renewUrl: string;
    }
  | {
      type: "renew_reminder";
      zone: string;
      expiresLocal: string;
      minutesRemaining: number;
      renewUrl: string;
    }
  | {
      type: "parking_expired";
      zone: string;
      expiredLocal: string;
      renewUrl: string;
    };

const SMS_MAX_LENGTH: Record<ParkingNotificationType, number> = {
  payment_confirmed: 160,
  post_payment_info: 280,
  renew_reminder: 180,
  parking_expired: 170,
};

function getOpenAiApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || null;
}

function clipText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function normalizeBullets(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => clipText(item, 95))
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeCitations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 3);
}

function buildRulesFallback(context: ParkingContext): ParkingRulesRundown {
  const bullets: string[] = [];

  if (context.localFacts.zoneNumber && context.localFacts.rate) {
    bullets.push(`Zone ${context.localFacts.zoneNumber}, rate ${context.localFacts.rate}.`);
  } else if (context.localFacts.zoneNumber) {
    bullets.push(`Zone ${context.localFacts.zoneNumber} detected near your parked location.`);
  } else {
    bullets.push("No exact paid zone was confirmed from local map data.");
  }

  if (context.localFacts.hours) {
    bullets.push(`Hours noted in local data: ${clipText(context.localFacts.hours, 75)}.`);
  }

  bullets.push("Check posted signs on your block for exact limits and restrictions.");
  bullets.push("Renew before expiry to reduce citation risk.");

  const citations = context.officialFacts.facts.map((item) => item.sourceUrl).slice(0, 3);

  return {
    headline: clipText("Parking rules summary for this spot", 80),
    bullets: bullets.slice(0, 4),
    timeLimitSummary: clipText(
      context.officialFacts.facts.length > 0
        ? "Local + official sources reviewed."
        : "Local geojson source reviewed; official lookup unavailable.",
      110,
    ),
    confidence: context.officialFacts.facts.length > 0 ? "medium" : "low",
    citations,
  };
}

async function requestChatCompletion(input: {
  apiKey: string;
  systemPrompt: string;
  userContent: string;
  responseFormat?: unknown;
  maxTokens?: number;
}): Promise<string> {
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: PARKING_AGENT_MODEL,
      temperature: 0,
      max_tokens: input.maxTokens ?? 220,
      ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userContent },
      ],
    }),
  });

  const payload = (await response.json()) as OpenAiChatCompletionResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI request failed with status ${response.status}.`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty completion.");
  }

  return content;
}

function parseRulesRundown(raw: string): ParkingRulesRundown {
  let parsed: RawRulesRundownPayload;
  try {
    parsed = JSON.parse(raw) as RawRulesRundownPayload;
  } catch {
    throw new Error("Rules rundown was not valid JSON.");
  }

  const headline = clipText(typeof parsed.headline === "string" ? parsed.headline : "Parking rules summary", 80);
  const bullets = normalizeBullets(parsed.bullets);
  const timeLimitSummary = clipText(
    typeof parsed.time_limit_summary === "string"
      ? parsed.time_limit_summary
      : "Review posted signs for the exact limit at your stall.",
    110,
  );

  if (bullets.length < 2) {
    throw new Error("Rules rundown bullets were incomplete.");
  }

  return {
    headline,
    bullets,
    timeLimitSummary,
    confidence: normalizeConfidence(parsed.confidence),
    citations: normalizeCitations(parsed.citations),
  };
}

function buildRulesSystemPrompt(): string {
  return [
    "You are ParkOS Rules Agent for downtown San Luis Obispo.",
    "Use ONLY facts provided in INPUT_JSON. Do not invent rules.",
    "If facts conflict, prefer official_facts over local_geojson_facts and mention uncertainty briefly.",
    "Return JSON only with keys:",
    "headline (string <= 80 chars),",
    "bullets (array of 2-4 strings, each <= 95 chars),",
    "time_limit_summary (string <= 110 chars),",
    'confidence ("high"|"medium"|"low"),',
    "citations (array of up to 3 URLs).",
    "Keep wording concise and practical.",
    "Include one bullet telling user to check posted signs.",
  ].join("\n");
}

function buildRulesUserPayload(context: ParkingContext): string {
  return JSON.stringify(
    {
      task: "summarize parking rules for this parked spot",
      location: {
        lat: context.location.lat,
        lng: context.location.lng,
      },
      session: {
        zone_number: context.session.zoneNumber,
        rate: context.session.rate,
        category: context.session.category,
      },
      local_geojson_facts: context.localFacts,
      official_facts: context.officialFacts,
      now_local_time: context.nowLocalIso,
      timezone: context.timezone,
    },
    null,
    2,
  );
}

export async function generateRulesRundown(context: ParkingContext): Promise<ParkingRulesRundown> {
  const fallback = buildRulesFallback(context);
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return fallback;
  }

  try {
    const content = await requestChatCompletion({
      apiKey,
      systemPrompt: buildRulesSystemPrompt(),
      userContent: buildRulesUserPayload(context),
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "parkos_rules_rundown",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["headline", "bullets", "time_limit_summary", "confidence", "citations"],
            properties: {
              headline: { type: "string" },
              bullets: {
                type: "array",
                items: { type: "string" },
                minItems: 2,
                maxItems: 4,
              },
              time_limit_summary: { type: "string" },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
              citations: {
                type: "array",
                items: { type: "string" },
                maxItems: 3,
              },
            },
          },
        },
      },
      maxTokens: 320,
    });

    return parseRulesRundown(content);
  } catch {
    return fallback;
  }
}

function fallbackSms(input: SmsInput): string {
  switch (input.type) {
    case "payment_confirmed":
      return clipText(
        `ParkOS: Payment confirmed for zone ${input.zone}. Expires ${input.expiresLocal}.`,
        SMS_MAX_LENGTH.payment_confirmed,
      );
    case "post_payment_info":
      return clipText(
        `ParkOS info: ${input.topRules.slice(0, 2).join(" ")} Renew here: ${input.renewUrl}`,
        SMS_MAX_LENGTH.post_payment_info,
      );
    case "renew_reminder":
      return clipText(
        `ParkOS reminder: ${Math.max(0, Math.floor(input.minutesRemaining))} min left in zone ${input.zone}. Renew: ${input.renewUrl}`,
        SMS_MAX_LENGTH.renew_reminder,
      );
    case "parking_expired":
      return clipText(
        `ParkOS: Parking in zone ${input.zone} expired at ${input.expiredLocal}. Renew: ${input.renewUrl}`,
        SMS_MAX_LENGTH.parking_expired,
      );
  }
}

function smsPrompt(input: SmsInput): { systemPrompt: string; userContent: string; maxChars: number } {
  if (input.type === "payment_confirmed") {
    return {
      systemPrompt: [
        "Write one transactional SMS. Max 160 chars.",
        "Tone: clear, calm, concise.",
        "Must confirm payment and include expiry time.",
        "No emojis. No fluff.",
        "Output plain text only.",
      ].join("\n"),
      userContent: JSON.stringify(
        {
          type: "payment_confirmed",
          zone: input.zone,
          duration_minutes: input.durationMinutes,
          expires_local: input.expiresLocal,
          brand: "ParkOS",
        },
        null,
        2,
      ),
      maxChars: SMS_MAX_LENGTH.payment_confirmed,
    };
  }

  if (input.type === "post_payment_info") {
    return {
      systemPrompt: [
        "Write one informational SMS. Max 280 chars.",
        "Use only provided rule facts. Include 1-2 key rules and one short renewal hint.",
        "Do not overwhelm the user.",
        "Output plain text only.",
      ].join("\n"),
      userContent: JSON.stringify(
        {
          type: "post_payment_info",
          zone: input.zone,
          top_rules: input.topRules,
          time_limit_summary: input.timeLimitSummary,
          renew_url: input.renewUrl,
          brand: "ParkOS",
        },
        null,
        2,
      ),
      maxChars: SMS_MAX_LENGTH.post_payment_info,
    };
  }

  if (input.type === "renew_reminder") {
    return {
      systemPrompt: [
        "Write one reminder SMS. Max 180 chars.",
        "Must mention remaining time and include renew link.",
        "Direct and concise.",
        "Output plain text only.",
      ].join("\n"),
      userContent: JSON.stringify(
        {
          type: "renew_reminder",
          zone: input.zone,
          expires_local: input.expiresLocal,
          minutes_remaining: input.minutesRemaining,
          renew_url: input.renewUrl,
          brand: "ParkOS",
        },
        null,
        2,
      ),
      maxChars: SMS_MAX_LENGTH.renew_reminder,
    };
  }

  return {
    systemPrompt: [
      "Write one expiry SMS. Max 170 chars.",
      "Must state parking time has expired and include renew link.",
      "Keep it actionable and concise.",
      "Output plain text only.",
    ].join("\n"),
    userContent: JSON.stringify(
      {
        type: "parking_expired",
        zone: input.zone,
        expired_local: input.expiredLocal,
        renew_url: input.renewUrl,
        brand: "ParkOS",
      },
      null,
      2,
    ),
    maxChars: SMS_MAX_LENGTH.parking_expired,
  };
}

export async function generateSmsText(input: SmsInput): Promise<string> {
  const fallback = fallbackSms(input);
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return fallback;
  }

  try {
    const prompt = smsPrompt(input);
    const content = await requestChatCompletion({
      apiKey,
      systemPrompt: prompt.systemPrompt,
      userContent: prompt.userContent,
      maxTokens: 120,
    });

    const singleLine = content.replace(/\s+/g, " ").trim();
    if (!singleLine) {
      return fallback;
    }

    if (singleLine.length > prompt.maxChars) {
      return clipText(singleLine, prompt.maxChars);
    }

    return singleLine;
  } catch {
    return fallback;
  }
}

export function buildPostPaymentTopRules(rules: ParkingRulesRundown | null): string[] {
  if (!rules) {
    return ["Check posted signs for block-specific limits."];
  }

  const cleaned = rules.bullets
    .map((bullet) => clipText(bullet, 110))
    .filter(Boolean)
    .slice(0, 2);

  if (cleaned.length === 0) {
    return ["Check posted signs for block-specific limits."];
  }

  return cleaned;
}
