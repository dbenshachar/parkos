import { NextRequest, NextResponse } from "next/server";
import { setAuthSessionCookie } from "@/lib/account-session";
import {
  fetchProfileByUsername,
  getSupabaseConfig,
  hashPassword,
  insertProfile,
  normalizeEmail,
  normalizePlate,
  normalizeUsername,
  parseOptionalText,
  parseRequiredText,
  updateProfile,
  verifyPassword,
} from "@/lib/account-store";

type SaveProfileRequest = {
  username?: string;
  password?: string;
  email?: string;
  carMake?: string;
  carModel?: string;
  carColor?: string | null;
  licensePlate?: string;
  licensePlateState?: string | null;
};

function isUniqueConstraintError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes("duplicate key") ||
    normalized.includes("unique constraint") ||
    normalized.includes("already exists")
  );
}

export async function POST(request: NextRequest) {
  let body: SaveProfileRequest;
  try {
    body = (await request.json()) as SaveProfileRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const username = normalizeUsername(parseRequiredText(body.username));
  const email = normalizeEmail(parseRequiredText(body.email));
  const password = body.password || "";
  const carMake = parseRequiredText(body.carMake);
  const carModel = parseRequiredText(body.carModel);
  const licensePlate = normalizePlate(parseRequiredText(body.licensePlate));
  const carColor = parseOptionalText(body.carColor);
  const licensePlateState = parseOptionalText(body.licensePlateState)?.toUpperCase() || null;

  if (!username || !password || !email || !carMake || !carModel || !licensePlate) {
    return NextResponse.json(
      {
        error:
          "Required fields missing: username, password, email, carMake, carModel, and licensePlate are required.",
      },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL or SUPABASE_API_KEY environment variables." },
      { status: 500 },
    );
  }

  const existingProfile = await fetchProfileByUsername(config, username);
  if (!existingProfile.ok) {
    return NextResponse.json({ error: existingProfile.error }, { status: 502 });
  }

  const passwordHash = hashPassword(password);

  if (existingProfile.value?.id) {
    if (
      !existingProfile.value.password_hash ||
      !verifyPassword(password, existingProfile.value.password_hash)
    ) {
      return NextResponse.json(
        { error: "Username already exists. Use the correct password to log in." },
        { status: 401 },
      );
    }

    const updatedProfile = await updateProfile(config, existingProfile.value.id, {
      passwordHash,
      email,
      carMake,
      carModel,
      carColor,
      licensePlate,
      licensePlateState,
    });
    if (!updatedProfile.ok) {
      return NextResponse.json({ error: updatedProfile.error }, { status: 502 });
    }
    if (!updatedProfile.value.id || !updatedProfile.value.username) {
      return NextResponse.json({ error: "Account update returned invalid data." }, { status: 502 });
    }

    const response = NextResponse.json(
      {
        ok: true,
        created: false,
        profileId: updatedProfile.value.id,
        redirectTo: "/parking",
      },
      { status: 200 },
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
  });

  if (!createdProfile.ok) {
    if (createdProfile.status === 409 || isUniqueConstraintError(createdProfile.error)) {
      return NextResponse.json({ error: "Username already exists. Please choose a different username." }, { status: 409 });
    }
    return NextResponse.json({ error: createdProfile.error }, { status: 502 });
  }
  if (!createdProfile.value.id || !createdProfile.value.username) {
    return NextResponse.json({ error: "Account creation returned invalid data." }, { status: 502 });
  }

  const response = NextResponse.json(
    {
      ok: true,
      created: true,
      profileId: createdProfile.value.id,
      redirectTo: "/parking",
    },
    { status: 200 },
  );
  setAuthSessionCookie(response, {
    profileId: createdProfile.value.id,
    username: createdProfile.value.username,
  });
  return response;
}
