import { NextRequest, NextResponse } from "next/server";

const DEV_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "tauri://localhost",
];

function collectAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const configuredValues = [process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_APP_BASE_URL];
  if (process.env.NODE_ENV !== "production") {
    configuredValues.push(...DEV_ALLOWED_ORIGINS);
  }

  for (const rawValue of configuredValues) {
    const value = (rawValue || "").trim();
    if (!value) {
      continue;
    }
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore malformed URL values.
    }
  }
  return origins;
}

export function ensureTrustedOrigin(request: NextRequest): NextResponse | null {
  const originHeader = (request.headers.get("origin") || "").trim();
  if (!originHeader) {
    return null;
  }

  try {
    if (originHeader === request.nextUrl.origin) {
      return null;
    }
  } catch {
    // Ignore URL parsing errors and continue with configured allow-list.
  }

  const allowedOrigins = collectAllowedOrigins();
  if (allowedOrigins.has(originHeader)) {
    return null;
  }

  return NextResponse.json(
    { error: "Blocked by origin policy." },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) {
    return real;
  }
  return "unknown";
}
