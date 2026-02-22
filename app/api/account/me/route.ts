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

function unauthorizedResponse(message: string): NextResponse {
  const response = NextResponse.json({ error: message }, { status: 401 });
  clearAuthSessionCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const session = getAuthSession(request);
  if (!session) {
    return NextResponse.json({ error: "Please log in to view your profile." }, { status: 401 });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL or SUPABASE_API_KEY environment variables." },
      { status: 500 },
    );
  }

  const profileResult = await fetchProfileById(config, session.profileId);
  if (!profileResult.ok) {
    return NextResponse.json({ error: profileResult.error }, { status: 502 });
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
    return NextResponse.json(
      { error: "Saved account data is incomplete. Please recreate your account details." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      username: clientProfile.username,
      profile: clientProfile,
    },
    { status: 200 },
  );
}

export async function PATCH(request: NextRequest) {
  const session = getAuthSession(request);
  if (!session) {
    return NextResponse.json({ error: "Please log in to update your profile." }, { status: 401 });
  }

  let body: UpdateProfileRequest;
  try {
    body = (await request.json()) as UpdateProfileRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL or SUPABASE_API_KEY environment variables." },
      { status: 500 },
    );
  }

  const existingProfileResult = await fetchProfileById(config, session.profileId);
  if (!existingProfileResult.ok) {
    return NextResponse.json({ error: existingProfileResult.error }, { status: 502 });
  }

  const existingProfile = existingProfileResult.value;
  if (!existingProfile?.id) {
    return unauthorizedResponse("Session expired. Please log in again.");
  }
  if (existingProfile.username && existingProfile.username !== session.username) {
    return unauthorizedResponse("Session is invalid. Please log in again.");
  }

  const email = normalizeEmail(parseRequiredText(body.email ?? existingProfile.email));
  const carMake = parseRequiredText(body.carMake ?? existingProfile.car_make);
  const carModel = parseRequiredText(body.carModel ?? existingProfile.car_model);
  const licensePlate = normalizePlate(parseRequiredText(body.licensePlate ?? existingProfile.license_plate));
  const carColor =
    body.carColor !== undefined ? parseOptionalText(body.carColor) : parseOptionalText(existingProfile.car_color);
  const licensePlateState =
    body.licensePlateState !== undefined
      ? parseOptionalText(body.licensePlateState)?.toUpperCase() || null
      : parseOptionalText(existingProfile.license_plate_state)?.toUpperCase() || null;
  const phoneE164 =
    body.phoneE164 !== undefined ? normalizePhoneE164(body.phoneE164) : normalizePhoneE164(existingProfile.phone_e164);
  const smsOptIn = body.smsOptIn !== undefined ? body.smsOptIn === true : Boolean(existingProfile.sms_opt_in);
  const smsOptInAt = smsOptIn
    ? existingProfile.sms_opt_in_at || new Date().toISOString()
    : null;

  if (!email || !carMake || !carModel || !licensePlate) {
    return NextResponse.json(
      {
        error: "Required fields missing: email, carMake, carModel, and licensePlate are required.",
      },
      { status: 400 },
    );
  }

  const nextPassword = body.password || "";
  if (nextPassword && nextPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (phoneE164 && !E164_PHONE_REGEX.test(phoneE164)) {
    return NextResponse.json({ error: "Phone number must be in E.164 format (e.g. +15551234567)." }, { status: 400 });
  }
  if (smsOptIn && !phoneE164) {
    return NextResponse.json({ error: "A phone number is required when SMS reminders are enabled." }, { status: 400 });
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
    return NextResponse.json({ error: saveResult.error }, { status: 502 });
  }

  const savedProfile = mapProfileForClient(saveResult.value);
  if (!savedProfile) {
    return NextResponse.json({ error: "Saved account data is incomplete." }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      username: savedProfile.username,
      profile: savedProfile,
    },
    { status: 200 },
  );
}
