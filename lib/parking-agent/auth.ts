import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/account-session";
import { fetchProfileById, getSupabaseConfig } from "@/lib/account-store";
import type { SupabaseConfig, UserPaymentProfileRow } from "@/lib/account-store";

export type AuthenticatedProfileContext = {
  session: {
    profileId: string;
    username: string;
  };
  config: SupabaseConfig;
  profile: UserPaymentProfileRow & { id: string; username: string };
};

export async function requireAuthenticatedProfile(
  request: NextRequest,
): Promise<{ ok: true; value: AuthenticatedProfileContext } | { ok: false; response: NextResponse }> {
  const session = getAuthSession(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Please log in first." }, { status: 401 }),
    };
  }

  const config = getSupabaseConfig();
  if (!config) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing SUPABASE_URL or SUPABASE_API_KEY environment variables." },
        { status: 500 },
      ),
    };
  }

  const profileResult = await fetchProfileById(config, session.profileId);
  if (!profileResult.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: profileResult.error }, { status: 502 }),
    };
  }

  const profile = profileResult.value;
  if (!profile?.id || !profile.username) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Session expired. Please log in again." }, { status: 401 }),
    };
  }

  if (profile.username !== session.username) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Session is invalid. Please log in again." }, { status: 401 }),
    };
  }

  const verifiedProfile: UserPaymentProfileRow & { id: string; username: string } = {
    ...profile,
    id: profile.id,
    username: profile.username,
  };

  return {
    ok: true,
    value: {
      session,
      config,
      profile: verifiedProfile,
    },
  };
}
