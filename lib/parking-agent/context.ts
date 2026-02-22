import "server-only";

import { lookupParkingZoneByCoordinate } from "@/lib/parking-zones";
import { lookupPayByPhoneZoneByCoordinate } from "@/lib/paybyphone-zones";
import {
  fetchRuleCache,
  upsertRuleCache,
} from "@/lib/parking-agent/db";
import type { SupabaseConfig } from "@/lib/account-store";
import type {
  ParkingContext,
  ParkingLocalFacts,
  ParkingOfficialFact,
  ParkingOfficialFacts,
} from "@/lib/parking-agent/types";

const PARKING_AGENT_TIMEZONE = "America/Los_Angeles" as const;
const RULE_CACHE_TTL_HOURS = 8;
const OFFICIAL_FACT_TIMEOUT_MS = 7000;
const MAX_EXCERPT_LENGTH = 380;

const DEFAULT_RULE_SOURCE_URLS = [
  "https://www.slocity.org/government/department-directory/public-works/parking-services",
  "https://www.slocity.org/government/department-directory/public-works/parking-services/parking-rules-regulations",
];

function getRuleSourceUrls(): string[] {
  const raw = process.env.PARKING_RULE_SOURCE_URLS?.trim();
  if (!raw) {
    return DEFAULT_RULE_SOURCE_URLS;
  }

  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getLosAngelesNowIso(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: PARKING_AGENT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(" ", "T");
}

function clipText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function extractReadableExcerpt(rawHtml: string): string {
  const withoutScripts = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");
  return clipText(withoutTags, MAX_EXCERPT_LENGTH);
}

function buildRuleCacheKey(lat: number, lng: number, localFacts: ParkingLocalFacts): string {
  const latRounded = lat.toFixed(4);
  const lngRounded = lng.toFixed(4);
  return [
    localFacts.category,
    localFacts.zoneNumber || "none",
    localFacts.rate || "none",
    latRounded,
    lngRounded,
  ].join("|");
}

function plusHoursIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function fetchOfficialFactLive(sourceUrl: string): Promise<string> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), OFFICIAL_FACT_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      headers: {
        "User-Agent": "ParkOS-Agent/1.0",
      },
      signal: abortController.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const excerpt = extractReadableExcerpt(text);
    if (!excerpt) {
      throw new Error("No readable rule content found.");
    }

    return excerpt;
  } finally {
    clearTimeout(timeout);
  }
}

function buildLocalFacts(lat: number, lng: number): ParkingLocalFacts {
  const paidLookup = lookupPayByPhoneZoneByCoordinate(lat, lng, {
    nearestFallbackMeters: 100,
  });

  if (paidLookup.zone?.payByPhoneZone) {
    return {
      category: "paid",
      source: "paybyphone-zones",
      matchType: paidLookup.matchType,
      distanceMeters: paidLookup.distanceMeters,
      zoneNumber: paidLookup.zone.payByPhoneZone,
      rate: paidLookup.zone.meterZone,
      description: paidLookup.zone.provisionalReason,
      district: null,
      hours: null,
      message:
        paidLookup.matchType === "inside"
          ? `Paid zone ${paidLookup.zone.payByPhoneZone} detected at ${paidLookup.zone.meterZone}.`
          : `Nearest paid zone ${paidLookup.zone.payByPhoneZone} detected (~${Math.round(paidLookup.distanceMeters || 0)}m).`,
      warnings:
        paidLookup.zone.provisionalReason
          ? [
              "PayByPhone mapping uses provisional rule mapping for this meter zone.",
              paidLookup.zone.provisionalReason,
            ]
          : [],
    };
  }

  const residentialLookup = lookupParkingZoneByCoordinate(lat, lng, {
    nearestFallbackMeters: 100,
  });

  if (residentialLookup.zone) {
    return {
      category: "residential",
      source: "residential-zones",
      matchType: residentialLookup.matchType,
      distanceMeters: residentialLookup.distanceMeters,
      zoneNumber: residentialLookup.zone.zoneId,
      rate: "Permit required",
      description: residentialLookup.zone.description,
      district: residentialLookup.zone.district,
      hours: residentialLookup.zone.hours,
      message: `Residential zone ${residentialLookup.zone.zoneId} detected. Permit restrictions may apply.`,
      warnings: ["No paid downtown zone matched. Verify nearby signs before parking."],
    };
  }

  return {
    category: "none",
    source: "none",
    matchType: "none",
    distanceMeters: null,
    zoneNumber: null,
    rate: null,
    description: null,
    district: null,
    hours: null,
    message: "No nearby zone was resolved from local GeoJSON data.",
    warnings: ["Move closer to posted signage and retry zone detection."],
  };
}

async function buildOfficialFacts(
  config: SupabaseConfig | null,
  cacheKey: string,
): Promise<ParkingOfficialFacts> {
  const sourceUrls = getRuleSourceUrls();
  const notices: string[] = [];
  const facts: ParkingOfficialFact[] = [];

  for (const sourceUrl of sourceUrls) {
    try {
      if (config) {
        const cached = await fetchRuleCache(config, cacheKey, sourceUrl);
        if (!cached.ok) {
          notices.push(`Cache read failed for ${sourceUrl}: ${cached.error}`);
        } else if (cached.value?.facts_json?.excerpt) {
          facts.push({
            sourceUrl,
            excerpt: clipText(cached.value.facts_json.excerpt, MAX_EXCERPT_LENGTH),
            fetchedAtIso: cached.value.fetched_at,
            fromCache: true,
          });
          continue;
        }
      }

      const excerpt = await fetchOfficialFactLive(sourceUrl);
      const fetchedAtIso = new Date().toISOString();

      if (config) {
        const cacheWrite = await upsertRuleCache(config, {
          cacheKey,
          sourceUrl,
          excerpt,
          fetchedAtIso,
          expiresAtIso: plusHoursIso(RULE_CACHE_TTL_HOURS),
        });

        if (!cacheWrite.ok) {
          notices.push(`Cache write failed for ${sourceUrl}: ${cacheWrite.error}`);
        }
      }

      facts.push({
        sourceUrl,
        excerpt,
        fetchedAtIso,
        fromCache: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      notices.push(`Official lookup failed for ${sourceUrl}: ${message}`);
    }
  }

  if (facts.length === 0) {
    return {
      source: "none",
      notices,
      facts: [],
    };
  }

  const anyLive = facts.some((fact) => !fact.fromCache);
  return {
    source: anyLive ? "live_web" : "cache",
    notices,
    facts,
  };
}

export async function buildParkingContext(input: {
  config: SupabaseConfig | null;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
}): Promise<ParkingContext> {
  const localFacts = buildLocalFacts(input.lat, input.lng);
  const cacheKey = buildRuleCacheKey(input.lat, input.lng, localFacts);
  const officialFacts = await buildOfficialFacts(input.config, cacheKey);

  return {
    location: {
      lat: input.lat,
      lng: input.lng,
      accuracyMeters: input.accuracyMeters,
    },
    session: {
      zoneNumber: localFacts.zoneNumber,
      rate: localFacts.rate,
      category: localFacts.category,
    },
    localFacts,
    officialFacts,
    nowLocalIso: getLosAngelesNowIso(),
    timezone: PARKING_AGENT_TIMEZONE,
  };
}
