import { NextRequest, NextResponse } from "next/server";
import { setAuthSessionCookie } from "@/lib/account-session";
import {
  fetchProfileByUsername,
  getSupabaseConfig,
  normalizeUsername,
  verifyPassword,
} from "@/lib/account-store";
import { ensureTrustedOrigin, clientIp } from "@/lib/security/origin";
import { checkAndConsumeRateLimit } from "@/lib/security/rate-limit";

type LoginRequest = {
  username?: string;
  password?: string;
};

type LoginFailureEntry = {
  failures: number;
  firstFailureAtMs: number;
  blockedUntilMs: number;
};

const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_BLOCK_MS = 15 * 60_000;
const loginFailures = new Map<string, LoginFailureEntry>();

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function loginFailureKey(username: string, ip: string): string {
  return `${username}:${ip}`;
}

function loginBlocked(username: string, ip: string): { blocked: boolean; retryAfterSeconds: number } {
  const key = loginFailureKey(username, ip);
  const entry = loginFailures.get(key);
  const now = Date.now();
  if (!entry) {
    return { blocked: false, retryAfterSeconds: 0 };
  }
  if (entry.blockedUntilMs > now) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntilMs - now) / 1000)),
    };
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

function recordLoginFailure(username: string, ip: string): void {
  const key = loginFailureKey(username, ip);
  const now = Date.now();
  const existing = loginFailures.get(key);
  const next: LoginFailureEntry = existing
    ? { ...existing }
    : {
        failures: 0,
        firstFailureAtMs: now,
        blockedUntilMs: 0,
      };

  if (now - next.firstFailureAtMs > LOGIN_FAILURE_WINDOW_MS) {
    next.failures = 0;
    next.firstFailureAtMs = now;
    next.blockedUntilMs = 0;
  }

  next.failures += 1;
  if (next.failures >= LOGIN_FAILURE_LIMIT) {
    next.blockedUntilMs = now + LOGIN_FAILURE_BLOCK_MS;
  }
  loginFailures.set(key, next);
}

function clearLoginFailures(username: string, ip: string): void {
  loginFailures.delete(loginFailureKey(username, ip));
}

export async function POST(request: NextRequest) {
  const originViolation = ensureTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  const ip = clientIp(request);
  const endpointRate = checkAndConsumeRateLimit(`account-login:${ip}`, {
    maxRequests: 20,
    windowMs: 10 * 60_000,
    blockMs: 10 * 60_000,
  });
  if (!endpointRate.allowed) {
    return jsonNoStore({ error: "Too many login attempts. Try again later." }, 429);
  }

  let body: LoginRequest;
  try {
    body = (await request.json()) as LoginRequest;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const username = normalizeUsername(body.username || "");
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return jsonNoStore({ error: "Both `username` and `password` are required." }, 400);
  }

  const blocked = loginBlocked(username, ip);
  if (blocked.blocked) {
    return jsonNoStore(
      { error: `Too many failed login attempts. Try again in ${blocked.retryAfterSeconds} seconds.` },
      429,
    );
  }

  const config = getSupabaseConfig();
  if (!config) {
    return jsonNoStore(
      { error: "Missing SUPABASE_URL or SUPABASE_API_KEY environment variables." },
      500,
    );
  }

  const profileResult = await fetchProfileByUsername(config, username);
  if (!profileResult.ok) {
    return jsonNoStore({ error: profileResult.error }, 502);
  }

  const profile = profileResult.value;
  if (!profile?.id || !profile.username || !profile.password_hash || !verifyPassword(password, profile.password_hash)) {
    recordLoginFailure(username, ip);
    return jsonNoStore({ error: "Invalid username or password." }, 401);
  }
  clearLoginFailures(username, ip);

  const response = jsonNoStore(
    {
      ok: true,
      hasSavedDetails: true,
      username: profile.username,
    },
    200,
  );

  setAuthSessionCookie(response, {
    profileId: profile.id,
    username: profile.username,
  });
  return response;
}
