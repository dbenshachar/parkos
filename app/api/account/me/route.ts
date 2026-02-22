import { NextRequest, NextResponse } from "next/server";
import { clearAuthSessionCookie, getAuthSession } from "@/lib/account-session";
import {
  fetchProfileById,
  getSupabaseConfig,
  hashPassword,
  mapProfileForClient,
  normalizeEmail,
  normalizePhoneE164,
  normalizePlate,
  parseOptionalText,
  parseRequiredText,
  updateProfile,
} from "@/lib/account-store";
import { ensureTrustedOrigin, clientIp } from "@/lib/security/origin";
import { checkAndConsumeRateLimit } from "@/lib/security/rate-limit";

type UpdateProfileRequest = {
  email?: string;
  password?: string;
  carMake?: string;
  carModel?: string;
  carColor?: string | null;
  licensePlate?: string;
  licensePlateState?: string | null;
  phoneE164?: string | null;
  smsOptIn?: boolean;
};

const E164_PHONE_REGEX = /^\+[1-9][0-9]{7,14}$/;

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function unauthorizedResponse(message: string): NextResponse {
  const response = jsonNoStore({ error: message }, 401);
  clearAuthSessionCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const endpointRate = checkAndConsumeRateLimit(`account-me-get:${clientIp(request)}`, {
    maxRequests: 120,
    windowMs: 10 * 60_000,
    blockMs: 5 * 60_000,
  });
  if (!endpointRate.allowed) {
    return jsonNoStore({ error: "Too many profile requests. Try again later." }, 429);
  }

  const session = getAuthSession(request);
  if (!session) {
    return jsonNoStore(
      { error: "Please log in to view your profile." },
      401,
    );
  }

  const config = getSupabaseConfig();
  if (!config) {
    return jsonNoStore(
      {
        error:
          "Missing SUPABASE_URL or SUPABASE_API_KEY environment variables.",
      },
      500,
    );
  }

  const profileResult = await fetchProfileById(config, session.profileId);
  if (!profileResult.ok) {
    return jsonNoStore({ error: profileResult.error }, 502);
  }

  const profile = profileResult.value;
  if (!profile) {
    return unauthorizedResponse("Session expired. Please log in again.");
  }
  if (profile.username && profile.username !== session.username) {
    return unauthorizedResponse("Session is invalid. Please log in again.");
  }

  const clientProfile = mapProfileForClient(profile);
  if (!clientProfile) {
    return jsonNoStore(
      {
        error:
          "Saved account data is incomplete. Please recreate your account details.",
      },
      500,
    );
  }

  return jsonNoStore(
    {
      ok: true,
      username: clientProfile.username,
      profile: clientProfile,
    },
    200,
  );
}

export async function PATCH(request: NextRequest) {
  const originViolation = ensureTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }
  const endpointRate = checkAndConsumeRateLimit(`account-me-patch:${clientIp(request)}`, {
    maxRequests: 30,
    windowMs: 10 * 60_000,
    blockMs: 10 * 60_000,
  });
  if (!endpointRate.allowed) {
    return jsonNoStore({ error: "Too many profile update attempts. Try again later." }, 429);
  }

  const session = getAuthSession(request);
  if (!session) {
    return jsonNoStore(
      { error: "Please log in to update your profile." },
      401,
    );
  }

  let body: UpdateProfileRequest;
  try {
    body = (await request.json()) as UpdateProfileRequest;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const config = getSupabaseConfig();
  if (!config) {
    return jsonNoStore(
      {
        error:
          "Missing SUPABASE_URL or SUPABASE_API_KEY environment variables.",
      },
      500,
    );
  }

  const existingProfileResult = await fetchProfileById(
    config,
    session.profileId,
  );
  if (!existingProfileResult.ok) {
    return jsonNoStore({ error: existingProfileResult.error }, 502);
  }

  const existingProfile = existingProfileResult.value;
  if (!existingProfile?.id) {
    return unauthorizedResponse("Session expired. Please log in again.");
  }
  if (
    existingProfile.username &&
    existingProfile.username !== session.username
  ) {
    return unauthorizedResponse("Session is invalid. Please log in again.");
  }

  const email = normalizeEmail(
    parseRequiredText(body.email ?? existingProfile.email),
  );
  const carMake = parseRequiredText(body.carMake ?? existingProfile.car_make);
  const carModel = parseRequiredText(
    body.carModel ?? existingProfile.car_model,
  );
  const licensePlate = normalizePlate(
    parseRequiredText(body.licensePlate ?? existingProfile.license_plate),
  );
  const carColor =
    body.carColor !== undefined
      ? parseOptionalText(body.carColor)
      : parseOptionalText(existingProfile.car_color);
  const licensePlateState =
    body.licensePlateState !== undefined
      ? parseOptionalText(body.licensePlateState)?.toUpperCase() || null
      : parseOptionalText(existingProfile.license_plate_state)?.toUpperCase() ||
        null;
  const phoneE164 =
    body.phoneE164 !== undefined
      ? normalizePhoneE164(body.phoneE164)
      : normalizePhoneE164(existingProfile.phone_e164);
  const smsOptIn =
    body.smsOptIn !== undefined
      ? body.smsOptIn === true
      : Boolean(existingProfile.sms_opt_in);
  const smsOptInAt = smsOptIn
    ? existingProfile.sms_opt_in_at || new Date().toISOString()
    : null;

  if (!email || !carMake || !carModel || !licensePlate) {
    return jsonNoStore(
      {
        error:
          "Required fields missing: email, carMake, carModel, and licensePlate are required.",
      },
      400,
    );
  }

  const nextPassword = body.password || "";
  if (nextPassword && nextPassword.length < 8) {
    return jsonNoStore({ error: "Password must be at least 8 characters." }, 400);
  }
  if (phoneE164 && !E164_PHONE_REGEX.test(phoneE164)) {
    return jsonNoStore({ error: "Phone number must be in E.164 format (e.g. +15551234567)." }, 400);
  }
  if (smsOptIn && !phoneE164) {
    return jsonNoStore({ error: "A phone number is required when SMS reminders are enabled." }, 400);
  }

  const saveResult = await updateProfile(config, existingProfile.id, {
    email,
    passwordHash: nextPassword ? hashPassword(nextPassword) : undefined,
    carMake,
    carModel,
    carColor,
    licensePlate,
    licensePlateState,
    phoneE164,
    smsOptIn,
    smsOptInAt,
  });

  if (!saveResult.ok) {
    return jsonNoStore({ error: saveResult.error }, 502);
  }

  const savedProfile = mapProfileForClient(saveResult.value);
  if (!savedProfile) {
    return jsonNoStore({ error: "Saved account data is incomplete." }, 500);
  }

  return jsonNoStore(
    {
      ok: true,
      username: savedProfile.username,
      profile: savedProfile,
    },
    200,
  );
}
