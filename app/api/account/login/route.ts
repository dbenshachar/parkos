import { NextRequest, NextResponse } from "next/server";
import { setAuthSessionCookie } from "@/lib/account-session";
import {
  fetchProfileByUsername,
  getSupabaseConfig,
  normalizeUsername,
  verifyPassword,
} from "@/lib/account-store";

type LoginRequest = {
  username?: string;
  password?: string;
};

export async function POST(request: NextRequest) {
  let body: LoginRequest;
  try {
    body = (await request.json()) as LoginRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const username = normalizeUsername(body.username || "");
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "Both `username` and `password` are required." }, { status: 400 });
  }

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL or SUPABASE_API_KEY environment variables." },
      { status: 500 },
    );
  }

  const profileResult = await fetchProfileByUsername(config, username);
  if (!profileResult.ok) {
    return NextResponse.json({ error: profileResult.error }, { status: 502 });
  }

  const profile = profileResult.value;
  if (!profile?.id || !profile.username || !profile.password_hash || !verifyPassword(password, profile.password_hash)) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const response = NextResponse.json(
    {
      ok: true,
      hasSavedDetails: true,
      username: profile.username,
    },
    { status: 200 },
  );

  setAuthSessionCookie(response, {
    profileId: profile.id,
    username: profile.username,
  });
  return response;
}
