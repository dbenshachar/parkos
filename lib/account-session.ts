import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const PARKOS_AUTH_COOKIE_NAME = "parkos_session";
const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SerializedSessionPayload = {
  profileId: string;
  username: string;
  expiresAtEpochSeconds: number;
};

export type AuthSessionPayload = {
  profileId: string;
  username: string;
};

function getSessionSecret(): string {
  return (
    process.env.PARKOS_SESSION_SECRET?.trim() ||
    process.env.SUPABASE_API_KEY?.trim() ||
    ""
  );
}

function signToken(payloadSegment: string): string {
  const secret = getSessionSecret();
  return createHmac("sha256", secret).update(payloadSegment).digest("base64url");
}

function encodeSessionPayload(payload: SerializedSessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeSessionPayload(payloadSegment: string): SerializedSessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as SerializedSessionPayload;
    if (
      typeof parsed.profileId !== "string" ||
      typeof parsed.username !== "string" ||
      typeof parsed.expiresAtEpochSeconds !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function createSessionToken(payload: SerializedSessionPayload): string {
  const encodedPayload = encodeSessionPayload(payload);
  const signature = signToken(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseSessionToken(token: string): SerializedSessionPayload | null {
  const [payloadSegment, signatureSegment] = token.split(".");
  if (!payloadSegment || !signatureSegment) {
    return null;
  }

  const expectedSignature = signToken(payloadSegment);
  const providedBuffer = Buffer.from(signatureSegment, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  return decodeSessionPayload(payloadSegment);
}

export function setAuthSessionCookie(
  response: NextResponse,
  session: AuthSessionPayload,
  expiresInSeconds?: number,
): void {
  const parsedMaxAge = Number.isFinite(expiresInSeconds)
    ? Math.max(60, Math.trunc(expiresInSeconds as number))
    : DEFAULT_SESSION_MAX_AGE_SECONDS;
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + parsedMaxAge;

  const token = createSessionToken({
    profileId: session.profileId,
    username: session.username,
    expiresAtEpochSeconds,
  });

  response.cookies.set({
    name: PARKOS_AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: parsedMaxAge,
  });
}

export function clearAuthSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: PARKOS_AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function getAuthSession(request: NextRequest): AuthSessionPayload | null {
  const token = request.cookies.get(PARKOS_AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const parsed = parseSessionToken(token);
  if (!parsed) {
    return null;
  }

  if (!parsed.profileId.trim() || !parsed.username.trim()) {
    return null;
  }

  if (parsed.expiresAtEpochSeconds <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    profileId: parsed.profileId,
    username: parsed.username,
  };
}
