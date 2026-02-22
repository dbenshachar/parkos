import "server-only";

import type {
  ParkingContext,
  ParkingNotificationRow,
  ParkingNotificationType,
  ParkingRuleCacheRow,
  ParkingRulesRundown,
  ParkingSessionRow,
  ParkingSessionStatus,
} from "@/lib/parking-agent/types";
import type { SupabaseConfig } from "@/lib/account-store";

const PARKING_SESSION_SELECT =
  "id,profile_id,status,parked_lat,parked_lng,parked_accuracy_meters,captured_zone_number,captured_rate,captured_category,confirmed_zone_number,duration_minutes,starts_at,expires_at,resume_token,rules_context_json,rules_rundown_json,renew_parent_session_id,created_at,updated_at";

const PARKING_NOTIFICATION_SELECT =
  "id,parking_session_id,profile_id,notification_type,scheduled_at,sent_at,status,attempt_count,last_error,twilio_message_sid,message_text,created_at,updated_at";

const PARKING_RULE_CACHE_SELECT = "id,cache_key,source_url,facts_json,fetched_at,expires_at,created_at,updated_at";

export type SmsDeliveryProfile = {
  id: string;
  username: string;
  phone_e164: string | null;
  sms_opt_in: boolean;
};

type SupabaseErrorPayload = {
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
};

type DbResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

type CreateParkingSessionInput = {
  profileId: string;
  status: ParkingSessionStatus;
  parkedLat: number;
  parkedLng: number;
  parkedAccuracyMeters: number | null;
  capturedZoneNumber: string | null;
  capturedRate: string | null;
  capturedCategory: "paid" | "residential" | "none";
  resumeToken: string;
  rulesContext: ParkingContext | null;
  rulesRundown: ParkingRulesRundown | null;
  renewParentSessionId?: string | null;
};

type UpdateParkingSessionInput = {
  status?: ParkingSessionStatus;
  confirmedZoneNumber?: string | null;
  durationMinutes?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  rulesContext?: ParkingContext | null;
  rulesRundown?: ParkingRulesRundown | null;
  renewParentSessionId?: string | null;
};

type CreateParkingNotificationInput = {
  parkingSessionId: string;
  profileId: string;
  notificationType: ParkingNotificationType;
  scheduledAt: string;
};

function buildHeaders(config: SupabaseConfig, includeJsonBody = false): HeadersInit {
  return {
    ...(includeJsonBody ? { "Content-Type": "application/json" } : {}),
    Accept: "application/json",
    apikey: config.apiKey,
    Authorization: `Bearer ${config.apiKey}`,
  };
}

function parseSupabaseError(payload: SupabaseErrorPayload, fallback: string): string {
  return payload.error_description || payload.msg || payload.message || payload.error || fallback;
}

async function parseErrorResponse(response: Response, fallback: string): Promise<string> {
  const rawText = await response.text();
  if (!rawText) {
    return fallback;
  }

  try {
    const payload = JSON.parse(rawText) as SupabaseErrorPayload;
    return parseSupabaseError(payload, fallback);
  } catch {
    return rawText;
  }
}

async function getSingleRow<T>(
  response: Response,
  fallbackError: string,
): Promise<DbResult<T | null>> {
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `${fallbackError} (${response.status}): ${await parseErrorResponse(response, fallbackError)}`,
    };
  }

  const rows = (await response.json().catch(() => [])) as T[];
  return { ok: true, value: rows[0] || null };
}

async function getRows<T>(response: Response, fallbackError: string): Promise<DbResult<T[]>> {
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `${fallbackError} (${response.status}): ${await parseErrorResponse(response, fallbackError)}`,
    };
  }

  const rows = (await response.json().catch(() => [])) as T[];
  return { ok: true, value: rows };
}

export async function createParkingSession(
  config: SupabaseConfig,
  input: CreateParkingSessionInput,
): Promise<DbResult<ParkingSessionRow>> {
  const response = await fetch(`${config.url}/rest/v1/parking_sessions`, {
    method: "POST",
    headers: {
      ...buildHeaders(config, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      profile_id: input.profileId,
      status: input.status,
      parked_lat: input.parkedLat,
      parked_lng: input.parkedLng,
      parked_accuracy_meters: input.parkedAccuracyMeters,
      captured_zone_number: input.capturedZoneNumber,
      captured_rate: input.capturedRate,
      captured_category: input.capturedCategory,
      resume_token: input.resumeToken,
      rules_context_json: input.rulesContext,
      rules_rundown_json: input.rulesRundown,
      renew_parent_session_id: input.renewParentSessionId ?? null,
    }),
  });

  const parsed = await getRows<ParkingSessionRow>(response, "Failed to create parking session");
  if (!parsed.ok) {
    return parsed;
  }

  if (!parsed.value[0]) {
    return {
      ok: false,
      status: 502,
      error: "Parking session created but no data was returned.",
    };
  }

  return { ok: true, value: parsed.value[0] };
}

export async function fetchParkingSessionById(
  config: SupabaseConfig,
  sessionId: string,
): Promise<DbResult<ParkingSessionRow | null>> {
  const url = new URL(`${config.url}/rest/v1/parking_sessions`);
  url.searchParams.set("select", PARKING_SESSION_SELECT);
  url.searchParams.set("id", `eq.${sessionId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(config),
    cache: "no-store",
  });

  return getSingleRow<ParkingSessionRow>(response, "Failed to fetch parking session");
}

export async function fetchParkingSessionByResumeToken(
  config: SupabaseConfig,
  resumeToken: string,
): Promise<DbResult<ParkingSessionRow | null>> {
  const url = new URL(`${config.url}/rest/v1/parking_sessions`);
  url.searchParams.set("select", PARKING_SESSION_SELECT);
  url.searchParams.set("resume_token", `eq.${resumeToken}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(config),
    cache: "no-store",
  });

  return getSingleRow<ParkingSessionRow>(response, "Failed to fetch parking session by token");
}

export async function fetchLatestParkingSessionForProfile(
  config: SupabaseConfig,
  profileId: string,
): Promise<DbResult<ParkingSessionRow | null>> {
  const url = new URL(`${config.url}/rest/v1/parking_sessions`);
  url.searchParams.set("select", PARKING_SESSION_SELECT);
  url.searchParams.set("profile_id", `eq.${profileId}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(config),
    cache: "no-store",
  });

  return getSingleRow<ParkingSessionRow>(response, "Failed to fetch latest parking session");
}

export async function updateParkingSession(
  config: SupabaseConfig,
  sessionId: string,
  input: UpdateParkingSessionInput,
): Promise<DbResult<ParkingSessionRow>> {
  const payload: Record<string, unknown> = {};
  if (input.status !== undefined) {
    payload.status = input.status;
  }
  if (input.confirmedZoneNumber !== undefined) {
    payload.confirmed_zone_number = input.confirmedZoneNumber;
  }
  if (input.durationMinutes !== undefined) {
    payload.duration_minutes = input.durationMinutes;
  }
  if (input.startsAt !== undefined) {
    payload.starts_at = input.startsAt;
  }
  if (input.expiresAt !== undefined) {
    payload.expires_at = input.expiresAt;
  }
  if (input.rulesContext !== undefined) {
    payload.rules_context_json = input.rulesContext;
  }
  if (input.rulesRundown !== undefined) {
    payload.rules_rundown_json = input.rulesRundown;
  }
  if (input.renewParentSessionId !== undefined) {
    payload.renew_parent_session_id = input.renewParentSessionId;
  }

  const url = new URL(`${config.url}/rest/v1/parking_sessions`);
  url.searchParams.set("id", `eq.${sessionId}`);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      ...buildHeaders(config, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  const parsed = await getRows<ParkingSessionRow>(response, "Failed to update parking session");
  if (!parsed.ok) {
    return parsed;
  }

  if (!parsed.value[0]) {
    return {
      ok: false,
      status: 502,
      error: "Parking session updated but no data was returned.",
    };
  }

  return { ok: true, value: parsed.value[0] };
}

export async function createParkingNotifications(
  config: SupabaseConfig,
  notifications: CreateParkingNotificationInput[],
): Promise<DbResult<ParkingNotificationRow[]>> {
  if (notifications.length === 0) {
    return { ok: true, value: [] };
  }

  const response = await fetch(`${config.url}/rest/v1/parking_notifications`, {
    method: "POST",
    headers: {
      ...buildHeaders(config, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify(
      notifications.map((item) => ({
        parking_session_id: item.parkingSessionId,
        profile_id: item.profileId,
        notification_type: item.notificationType,
        scheduled_at: item.scheduledAt,
        status: "queued",
      })),
    ),
  });

  return getRows<ParkingNotificationRow>(response, "Failed to create parking notifications");
}

export async function fetchDueParkingNotifications(
  config: SupabaseConfig,
  nowIso: string,
  limit = 50,
  profileId?: string,
): Promise<DbResult<ParkingNotificationRow[]>> {
  const url = new URL(`${config.url}/rest/v1/parking_notifications`);
  url.searchParams.set("select", PARKING_NOTIFICATION_SELECT);
  url.searchParams.set("status", "eq.queued");
  url.searchParams.set("scheduled_at", `lte.${nowIso}`);
  if (profileId) {
    url.searchParams.set("profile_id", `eq.${profileId}`);
  }
  url.searchParams.set("order", "scheduled_at.asc");
  url.searchParams.set("limit", String(Math.max(1, Math.min(200, Math.floor(limit)))));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(config),
    cache: "no-store",
  });

  return getRows<ParkingNotificationRow>(response, "Failed to fetch due parking notifications");
}

export async function fetchParkingNotificationsBySessionId(
  config: SupabaseConfig,
  parkingSessionId: string,
): Promise<DbResult<ParkingNotificationRow[]>> {
  const url = new URL(`${config.url}/rest/v1/parking_notifications`);
  url.searchParams.set("select", PARKING_NOTIFICATION_SELECT);
  url.searchParams.set("parking_session_id", `eq.${parkingSessionId}`);
  url.searchParams.set("order", "scheduled_at.asc");
  url.searchParams.set("limit", "50");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(config),
    cache: "no-store",
  });

  return getRows<ParkingNotificationRow>(response, "Failed to fetch parking session notifications");
}

export async function claimParkingNotification(
  config: SupabaseConfig,
  notification: ParkingNotificationRow,
): Promise<DbResult<ParkingNotificationRow | null>> {
  const url = new URL(`${config.url}/rest/v1/parking_notifications`);
  url.searchParams.set("id", `eq.${notification.id}`);
  url.searchParams.set("status", "eq.queued");

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      ...buildHeaders(config, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      status: "sending",
      attempt_count: Math.max(0, notification.attempt_count) + 1,
    }),
  });

  const parsed = await getRows<ParkingNotificationRow>(response, "Failed to claim notification");
  if (!parsed.ok) {
    return parsed;
  }

  return { ok: true, value: parsed.value[0] || null };
}

async function patchNotification(
  config: SupabaseConfig,
  notificationId: string,
  payload: Record<string, unknown>,
): Promise<DbResult<ParkingNotificationRow>> {
  const url = new URL(`${config.url}/rest/v1/parking_notifications`);
  url.searchParams.set("id", `eq.${notificationId}`);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      ...buildHeaders(config, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  const parsed = await getRows<ParkingNotificationRow>(response, "Failed to update notification");
  if (!parsed.ok) {
    return parsed;
  }

  if (!parsed.value[0]) {
    return {
      ok: false,
      status: 502,
      error: "Notification update returned no data.",
    };
  }

  return { ok: true, value: parsed.value[0] };
}

export async function markParkingNotificationSent(
  config: SupabaseConfig,
  notificationId: string,
  messageText: string,
  twilioSid: string,
): Promise<DbResult<ParkingNotificationRow>> {
  return patchNotification(config, notificationId, {
    status: "sent",
    sent_at: new Date().toISOString(),
    message_text: messageText,
    twilio_message_sid: twilioSid,
    last_error: null,
  });
}

export async function markParkingNotificationFailed(
  config: SupabaseConfig,
  notificationId: string,
  errorMessage: string,
): Promise<DbResult<ParkingNotificationRow>> {
  return patchNotification(config, notificationId, {
    status: "failed",
    last_error: errorMessage,
  });
}

export async function markParkingNotificationSkipped(
  config: SupabaseConfig,
  notificationId: string,
  reason: string,
): Promise<DbResult<ParkingNotificationRow>> {
  return patchNotification(config, notificationId, {
    status: "skipped",
    sent_at: new Date().toISOString(),
    last_error: reason,
  });
}

export async function cancelPendingNotificationsForSession(
  config: SupabaseConfig,
  sessionId: string,
  types: ParkingNotificationType[],
): Promise<DbResult<ParkingNotificationRow[]>> {
  if (types.length === 0) {
    return { ok: true, value: [] };
  }

  const inValue = `(${types.map((type) => `"${type}"`).join(",")})`;
  const url = new URL(`${config.url}/rest/v1/parking_notifications`);
  url.searchParams.set("parking_session_id", `eq.${sessionId}`);
  url.searchParams.set("status", "eq.queued");
  url.searchParams.set("notification_type", `in.${inValue}`);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      ...buildHeaders(config, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      status: "skipped",
      last_error: "Superseded by renewed session.",
    }),
  });

  return getRows<ParkingNotificationRow>(response, "Failed to cancel pending notifications");
}

export async function fetchSmsDeliveryProfileById(
  config: SupabaseConfig,
  profileId: string,
): Promise<DbResult<SmsDeliveryProfile | null>> {
  const url = new URL(`${config.url}/rest/v1/user_payment_profiles`);
  url.searchParams.set("select", "id,username,phone_e164,sms_opt_in");
  url.searchParams.set("id", `eq.${profileId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(config),
    cache: "no-store",
  });

  return getSingleRow<SmsDeliveryProfile>(response, "Failed to fetch sms delivery profile");
}

export async function fetchSmsDeliveryProfileByPhone(
  config: SupabaseConfig,
  phoneE164: string,
): Promise<DbResult<SmsDeliveryProfile | null>> {
  const url = new URL(`${config.url}/rest/v1/user_payment_profiles`);
  url.searchParams.set("select", "id,username,phone_e164,sms_opt_in");
  url.searchParams.set("phone_e164", `eq.${phoneE164}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(config),
    cache: "no-store",
  });

  return getSingleRow<SmsDeliveryProfile>(response, "Failed to fetch sms delivery profile by phone");
}

export async function updateSmsOptInByProfileId(
  config: SupabaseConfig,
  profileId: string,
  optIn: boolean,
): Promise<DbResult<SmsDeliveryProfile>> {
  const url = new URL(`${config.url}/rest/v1/user_payment_profiles`);
  url.searchParams.set("id", `eq.${profileId}`);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      ...buildHeaders(config, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      sms_opt_in: optIn,
      sms_opt_in_at: optIn ? new Date().toISOString() : null,
    }),
  });

  const parsed = await getRows<SmsDeliveryProfile>(response, "Failed to update SMS opt-in");
  if (!parsed.ok) {
    return parsed;
  }

  if (!parsed.value[0]) {
    return {
      ok: false,
      status: 502,
      error: "SMS opt-in update returned no data.",
    };
  }

  return { ok: true, value: parsed.value[0] };
}

export async function fetchRuleCache(
  config: SupabaseConfig,
  cacheKey: string,
  sourceUrl: string,
): Promise<DbResult<ParkingRuleCacheRow | null>> {
  const nowIso = new Date().toISOString();
  const url = new URL(`${config.url}/rest/v1/parking_rule_cache`);
  url.searchParams.set("select", PARKING_RULE_CACHE_SELECT);
  url.searchParams.set("cache_key", `eq.${cacheKey}`);
  url.searchParams.set("source_url", `eq.${sourceUrl}`);
  url.searchParams.set("expires_at", `gte.${nowIso}`);
  url.searchParams.set("order", "expires_at.desc");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(config),
    cache: "no-store",
  });

  return getSingleRow<ParkingRuleCacheRow>(response, "Failed to fetch rule cache");
}

export async function upsertRuleCache(
  config: SupabaseConfig,
  input: {
    cacheKey: string;
    sourceUrl: string;
    excerpt: string;
    fetchedAtIso: string;
    expiresAtIso: string;
  },
): Promise<DbResult<ParkingRuleCacheRow>> {
  const url = new URL(`${config.url}/rest/v1/parking_rule_cache`);
  url.searchParams.set("on_conflict", "cache_key,source_url");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...buildHeaders(config, true),
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      cache_key: input.cacheKey,
      source_url: input.sourceUrl,
      facts_json: {
        excerpt: input.excerpt,
      },
      fetched_at: input.fetchedAtIso,
      expires_at: input.expiresAtIso,
    }),
  });

  const parsed = await getRows<ParkingRuleCacheRow>(response, "Failed to upsert rule cache");
  if (!parsed.ok) {
    return parsed;
  }

  if (!parsed.value[0]) {
    return {
      ok: false,
      status: 502,
      error: "Rule cache upsert returned no data.",
    };
  }

  return { ok: true, value: parsed.value[0] };
}
