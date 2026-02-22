import { NextResponse } from "next/server";

const GOOGLE_STATIC_MAPS_URL = "https://maps.googleapis.com/maps/api/staticmap";

function parseCoordinate(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Missing GOOGLE_MAPS_API_KEY environment variable." }, { status: 500 });
  }

  const url = new URL(request.url);
  const destinationLat = parseCoordinate(url.searchParams.get("destinationLat"));
  const destinationLng = parseCoordinate(url.searchParams.get("destinationLng"));
  if (destinationLat === null || destinationLng === null) {
    return NextResponse.json({ error: "Missing destination coordinates." }, { status: 400 });
  }

  const rawZones = url.searchParams.getAll("zone");
  const zones = rawZones
    .map((zone) => zone.split(","))
    .map(([latRaw, lngRaw]) => ({
      lat: parseCoordinate(latRaw ?? null),
      lng: parseCoordinate(lngRaw ?? null),
    }))
    .filter((zone): zone is { lat: number; lng: number } => zone.lat !== null && zone.lng !== null)
    .slice(0, 5);

  const googleUrl = new URL(GOOGLE_STATIC_MAPS_URL);
  googleUrl.searchParams.set("size", "700x420");
  googleUrl.searchParams.set("maptype", "roadmap");
  googleUrl.searchParams.set("zoom", "15");
  googleUrl.searchParams.set("key", apiKey);
  googleUrl.searchParams.append("markers", `color:red|label:D|${destinationLat},${destinationLng}`);
  zones.forEach((zone, index) => {
    googleUrl.searchParams.append("markers", `color:blue|label:${index + 1}|${zone.lat},${zone.lng}`);
  });

  const response = await fetch(googleUrl.toString());
  if (!response.ok) {
    const message = await response.text();
    return NextResponse.json(
      { error: `Google Static Maps request failed (${response.status}): ${message}` },
      { status: 502 },
    );
  }

  const imageBuffer = await response.arrayBuffer();
  return new NextResponse(imageBuffer, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/png",
      "Cache-Control": "public, max-age=300",
    },
  });
}
