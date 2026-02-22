import { NextResponse } from "next/server";

export async function GET() {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      { error: "Missing GOOGLE_MAPS_API_KEY environment variable." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { key },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
