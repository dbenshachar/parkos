This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Download SLO parking data (ArcGIS)

This repo includes a helper script to download the ArcGIS layer as GeoJSON:

```bash
npm run download:parking
```

It writes to `data/slo-street-parking.json`.

If you want a different app/layer/output:

```bash
node scripts/download-arcgis-layer.mjs \
  --appid <arcgis-app-id> \
  --hint parking \
  --output data/parking.json
```

## Provisional downtown PayByPhone mapping

Downtown paid parking polygons are stored in:

- `data/slo-downtown-parking-rates.json`
- Source layer:
  `https://services.arcgis.com/yygmGNIVQrHqSELP/arcgis/rest/services/SLODowntownPrakingRates/FeatureServer/2`

Current provisional mapping rules are in:

- `data/paybyphone-provisional-rules.json`

Current assumptions:

- light blue (`Downtown Core`, `$2.75/hr`) => `80511`
- dark blue (`Lot`, `$2.75/hr`) => `80512`
- yellow (`$2.25/hr`) => `80513`

## Google destination recommendations

Set your Google Places API key in `.env`:

```bash
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
OPENAI_API_KEY=your_openai_api_key
```

Google APIs required for this feature:

- Places API (New) for destination lookup
- Maps JavaScript API for embedded interactive map rendering

The same `GOOGLE_MAPS_API_KEY` is reused for embedded map rendering and fetched through a server
endpoint (`/api/google-maps/client-key`), so you do not need a separate public env var.

The app now exposes:

- `POST /api/parking/recommend`
- `POST /api/parking/parse-trip`

Note: this endpoint requires running Next.js with a server (`npm run dev` / `npm run start`).

Request JSON:

```json
{
  "destination": "Firestone Grill San Luis Obispo",
  "limit": 5
}
```

Response includes:

- `destination`
- `street`
- `destinationLat`
- `destinationLng`
- `recommendations` with:
  `zoneNumber`, `price`, `street`, `intendedDestination`, `distanceMeters`

UI output format:

```text
<Paid|Residential> Zone <zone number> | <price> | <street> | <intended destination> | <distance>m away
```

Distance behavior:

- Destination is accepted if it is within `1000m` of a paid downtown parking zone.
- Output includes each recommended zone's distance from the destination in meters.
- Destination output now includes:
  - paid downtown recommendations (PayByPhone zones)
  - nearby residential district recommendations (RPD zones) within 1000m
- UI includes an embedded interactive Google map (marker-only, no route lines):
  - black marker: destination
  - red markers: paid parking suggestions
  - blue markers: residential parking suggestions

## Trip Assistant parsing

Trip Assistant accepts free-text trip prompts, uses an LLM to extract destination + intended
arrival time, then auto-runs destination parking lookup.

Trip parsing endpoint:

- `POST /api/parking/parse-trip`

Request JSON:

```json
{
  "prompt": "Dinner at Firestone Grill tomorrow at 7pm"
}
```

Response JSON:

```json
{
  "destination": "Firestone Grill",
  "arrivalTimeIso": "2026-02-22T19:00:00-08:00",
  "arrivalTimeLabel": "Sun, Feb 22, 2026, 7:00 PM PST",
  "timezone": "America/Los_Angeles",
  "confidence": "high",
  "warnings": []
}
```

Fallback behavior:

- If parsing fails (missing key, malformed output, ambiguous time, or LLM error), ParkOS falls back
  to destination-only parsing:
  - `destination` is set to the original prompt text
  - `arrivalTimeIso` / `arrivalTimeLabel` are `null`
  - response still returns `200` with warnings
- Arrival time is captured for future traffic-density analysis and is not yet used in recommendation ranking.

## Live location zone detection

The app also exposes:

- `POST /api/parking/current-zone`

Request JSON:

```json
{
  "lat": 35.2813,
  "lng": -120.6612,
  "accuracyMeters": 22
}
```

Behavior:

- Paid zone lookup runs first with a `100m` nearest fallback.
- If no paid zone matches, residential lookup runs with the same `100m` fallback.
- Response includes category (`paid` / `residential` / `none`), current zone number, and current rate.
- Live UI supports:
  - `Start Live Location` for continuous tracking
  - `I have parked!` to capture a parked snapshot for payment entry

Note: `Proceed to Payment` is currently an entry-point placeholder and does not yet launch an external payment app.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
