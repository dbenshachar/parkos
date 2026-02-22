import { NextResponse } from "next/server";
import { clearAuthSessionCookie } from "@/lib/account-session";

export async function POST() {
  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearAuthSessionCookie(response);
  return response;
}
