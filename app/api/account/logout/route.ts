import { NextRequest, NextResponse } from "next/server";
import { clearAuthSessionCookie } from "@/lib/account-session";
import { ensureTrustedOrigin } from "@/lib/security/origin";

export async function POST(request: NextRequest) {
  const originViolation = ensureTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  const response = NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
  clearAuthSessionCookie(response);
  return response;
}
