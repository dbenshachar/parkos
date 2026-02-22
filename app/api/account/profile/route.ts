import { NextRequest, NextResponse } from "next/server";
import { setAuthSessionCookie } from "@/lib/account-session";
import {
  fetchProfileByUsername,
  getSupabaseConfig,
  hashPassword,
  insertProfile,
  normalizeEmail,
  normalizePhoneE164,
  normalizePlate,
  normalizeUsername,
  parseOptionalText,
  parseRequiredText,
  updateProfile,
  verifyPassword,
} from "@/lib/account-store";
import { ensureTrustedOrigin, clientIp } from "@/lib/security/origin";
import { checkAndConsumeRateLimit } from "@/lib/security/rate-limit";

type SaveProfileRequest = {
  username?: string;
  password?: string;
  email?: string;
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

function isUniqueConstraintError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes("duplicate key") ||
    normalized.includes("unique constraint") ||
    normalized.includes("already exists")
  );
}

export async function POST(request: NextRequest) {
  const originViolation = ensureTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  const endpointRate = checkAndConsumeRateLimit(`account-profile-create:${clientIp(request)}`, {
    maxRequests: 12,
    windowMs: 10 * 60_000,
    blockMs: 10 * 60_000,
  });
  if (!endpointRate.allowed) {
    return jsonNoStore({ error: "Too many account setup attempts. Try again later." }, 429);
  }

  let body: SaveProfileRequest;
  try {
    body = (await request.json()) as SaveProfileRequest;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const username = normalizeUsername(parseRequiredText(body.username));
  const email = normalizeEmail(parseRequiredText(body.email));
  const password = body.password || "";
  const carMake = parseRequiredText(body.carMake);
  const carModel = parseRequiredText(body.carModel);
  const licensePlate = normalizePlate(parseRequiredText(body.licensePlate));
  const carColor = parseOptionalText(body.carColor);
  const licensePlateState =
    parseOptionalText(body.licensePlateState)?.toUpperCase() || null;
  const phoneE164 = normalizePhoneE164(body.phoneE164);
  const smsOptIn = body.smsOptIn === true;
  const smsOptInAt = smsOptIn ? new Date().toISOString() : null;

  if (
    !username ||
    !password ||
    !email ||
    !carMake ||
    !carModel ||
    !licensePlate
  ) {
    return jsonNoStore(
      {
        error:
          "Required fields missing: username, password, email, carMake, carModel, and licensePlate are required.",
      },
      400,
    );
  }
  if (password.length < 8) {
    return jsonNoStore({ error: "Password must be at least 8 characters." }, 400);
  }
  if (phoneE164 && !E164_PHONE_REGEX.test(phoneE164)) {
    return jsonNoStore({ error: "Phone number must be in E.164 format (e.g. +15551234567)." }, 400);
  }
  if (smsOptIn && !phoneE164) {
    return jsonNoStore({ error: "A phone number is required when SMS reminders are enabled." }, 400);
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
  const existingProfile = await fetchProfileByUsername(config, username);
  if (!existingProfile.ok) {
    return jsonNoStore({ error: existingProfile.error }, 502);
  }

  const passwordHash = hashPassword(password);

  if (existingProfile.value?.id) {
    if (
      !existingProfile.value.password_hash ||
      !verifyPassword(password, existingProfile.value.password_hash)
    ) {
      return jsonNoStore(
        {
          error: "Username already exists. Use the correct password to log in.",
        },
        401,
      );
    }

    const updatedProfile = await updateProfile(
      config,
      existingProfile.value.id,
      {
        passwordHash,
        email,
        carMake,
        carModel,
        carColor,
        licensePlate,
        licensePlateState,
        phoneE164,
        smsOptIn,
        smsOptInAt,
      },
    );
    if (!updatedProfile.ok) {
      return jsonNoStore({ error: updatedProfile.error }, 502);
    }
    if (!updatedProfile.value.id || !updatedProfile.value.username) {
      return jsonNoStore({ error: "Account update returned invalid data." }, 502);
    }

    const response = jsonNoStore(
      {
        ok: true,
        created: false,
        profileId: updatedProfile.value.id,
        redirectTo: "/parking",
      },
      200,
    );
    setAuthSessionCookie(response, {
      profileId: updatedProfile.value.id,
      username: updatedProfile.value.username,
    });
    return response;
  }

  const createdProfile = await insertProfile(config, {
    username,
    passwordHash,
    email,
    carMake,
    carModel,
    carColor,
    licensePlate,
    licensePlateState,
    phoneE164,
    smsOptIn,
    smsOptInAt,
  });

  if (!createdProfile.ok) {
    if (
      createdProfile.status === 409 ||
      isUniqueConstraintError(createdProfile.error)
    ) {
      return jsonNoStore(
        {
          error: "Username already exists. Please choose a different username.",
        },
        409,
      );
    }
    return jsonNoStore({ error: createdProfile.error }, 502);
  }
  if (!createdProfile.value.id || !createdProfile.value.username) {
    return jsonNoStore({ error: "Account creation returned invalid data." }, 502);
  }

  const response = jsonNoStore(
    {
      ok: true,
      created: true,
      profileId: createdProfile.value.id,
      redirectTo: "/parking",
    },
    200,
  );
  setAuthSessionCookie(response, {
    profileId: createdProfile.value.id,
    username: createdProfile.value.username,
  });
  return response;
}
