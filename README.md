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

## Production + iOS quickstart

This project now includes:

- Docker deploy support with Playwright runtime (`Dockerfile`, `.dockerignore`)
- Environment template (`.env.example`)
- Production verification scripts:
  - `npm run cron:tick`
  - `npm run smoke:prod`
- iOS hosted-shell config:
  - `src-tauri/tauri.ios.conf.json`
  - `src-tauri/Info.ios.plist`
  - `src-tauri/capabilities/default.json`

Full guide: `docs/ios-hosted-shell.md`

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

- `POST /api/parking/agent-plan` (primary unified trip agent endpoint)
- `POST /api/parking/recommend` (legacy direct destination endpoint, still supported)
- `POST /api/parking/parse-trip` (legacy parser endpoint, still supported)

Note: these endpoints require running Next.js with a server (`npm run dev` / `npm run start`).

## Unified trip agent (`POST /api/parking/agent-plan`)

Request JSON:

```json
{
  "prompt": "Going to Luna Red today @ 8pm",
  "limit": 5
}
```

The deterministic agent pipeline is:

1. Parse trip intent (destination + optional arrival time)
2. Resolve Google Places destination candidates
3. Score and select best destination
4. Cross-reference paid + residential zone geojson
5. Return either `ready` recommendations or `needs_clarification`

The `reasoning` block now includes:

- `steps`: deterministic step-by-step execution trace
- `factors`: confidence score components used in final decision
- `candidateDiagnostics`: ranked place candidates with per-candidate score and reasons
- `parkingPointRationale`: plain-language explanation for why each parking point was chosen

Ready response (example):

```json
{
  "status": "ready",
  "runId": "f6f8f529-27c9-4cf4-8f3f-c8a6a424318f",
  "trip": {
    "destination": "Luna Red",
    "arrivalTimeIso": "2026-02-22T20:00:00-08:00",
    "arrivalTimeLabel": "Sun, Feb 22, 2026, 8:00 PM PST",
    "timezone": "America/Los_Angeles"
  },
  "destination": {
    "name": "Luna Red",
    "street": "1023 Chorro St",
    "formattedAddress": "1023 Chorro St, San Luis Obispo, CA 93401, USA",
    "lat": 35.281,
    "lng": -120.661,
    "placeId": "..."
  },
  "recommendations": {
    "nearestParkingDistanceMeters": 120,
    "paid": [],
    "residential": []
  },
  "reasoning": {
    "confidence": "high",
    "confidenceScore": 0.78,
    "warnings": [],
    "steps": []
  }
}
```

Clarification response (example):

```json
{
  "status": "needs_clarification",
  "runId": "73f16452-d858-42cb-8668-dbe5b7db2f8d",
  "clarification": {
    "target": "destination",
    "question": "I found multiple likely destinations. Which one do you mean?",
    "options": [
      {
        "label": "Luna Red — 1023 Chorro St, San Luis Obispo, CA 93401, USA",
        "value": "Luna Red 1023 Chorro St, San Luis Obispo, CA 93401, USA"
      }
    ]
  },
  "partialTrip": {
    "destination": "Luna Red",
    "arrivalTimeIso": null,
    "arrivalTimeLabel": null,
    "timezone": "America/Los_Angeles"
  },
  "reasoning": {
    "confidence": "medium",
    "confidenceScore": 0.54,
    "warnings": [],
    "steps": []
  }
}
```

Clarification behavior:

- Destination ambiguity returns `target: "destination"` and candidate options
- Time ambiguity returns `target: "arrival_time"` and asks for explicit arrival time
- Out-of-downtown matches return `target: "destination_refinement"` instead of silently guessing

Distance behavior:

- Destination is accepted for `ready` responses only if nearest paid downtown zone is within `1000m`
- Output includes each recommendation's distance in meters
- Residential recommendations are returned only when within `500m` of the destination
- Paid and residential recommendation limits are applied independently (`limit` per list)
- Recommendations include both paid downtown zones and nearby residential zones
- UI map markers remain: black (destination), red (paid), blue (residential)

Arrival time is captured for context and is not yet used in ranking.

## Legacy endpoints

Legacy parse endpoint:

- `POST /api/parking/parse-trip`

Legacy destination endpoint:

- `POST /api/parking/recommend`

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

## Parking Agent (LLM + SMS reminders)

The app now supports an LLM-driven parking agent with deterministic scheduling:

- Captures parked sessions from `I have parked!`
- Generates concise in-app parking rules + citations
- Executes payment session state and schedules 4 SMS stages
- Supports SMS deep-link resume/renew from saved parked coordinates

New APIs:

- `POST /api/parking/session/capture`
- `POST /api/parking/payment/execute`
- `GET /api/parking/session/resume?token=...`
- `POST /api/jobs/parking-agent-tick` (cron)
- `POST /api/sms/twilio/webhook` (STOP/START handling)

Payment execute request shape:

```json
{
  "sessionId": "<id>",
  "zoneNumber": "80511",
  "durationMinutes": 60,
  "renewFromSessionId": null,
  "paymentDetails": {
    "cardNumber": "<card_number_digits_only>",
    "cardCCV": "<card_cvv>",
    "cardExpiration": "MM/YY",
    "zipCode": "<billing_zip_or_postal>",
    "license": "<plate_number>"
  }
}
```

## Required environment variables

Use `.env.example` as the source of truth. Core variables:

- OpenAI: `OPENAI_API_KEY`, optional `OPENAI_PARKING_AGENT_MODEL`
- Supabase: `SUPABASE_URL`, `SUPABASE_API_KEY`
- App links/scheduling: `APP_BASE_URL`, `CRON_SECRET`
- Session security: `PARKOS_SESSION_SECRET`
- Payment profile encryption rollout:
  - `PAYMENT_PROFILE_ENCRYPTION_ENFORCED` (`false` for transitional rollout, then `true`)
  - `NEXT_PUBLIC_PAYMENT_PROFILE_ENCRYPTION_ENFORCED` (client mirror of the same flag)
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`
- Optional live-rule sources: `PARKING_RULE_SOURCE_URLS` (comma-separated)

## Cron setup

Schedule `POST /api/jobs/parking-agent-tick` every minute with:

- Header: `Authorization: Bearer <CRON_SECRET>`
- Behavior: sends due SMS notifications (`payment_confirmed`, `post_payment_info`, `renew_reminder`, `parking_expired`)

Manual cron tick:

```bash
npm run cron:tick
```

## Production smoke checks

Use `scripts/smoke-production.mjs` through:

```bash
APP_BASE_URL=https://parkos.example.com \
SMOKE_USERNAME=<username> \
SMOKE_PASSWORD=<password> \
CRON_SECRET=<cron_secret> \
npm run smoke:prod
```

## iOS wrapper setup (Tauri)

1. Install full Xcode.
2. Update placeholders in `src-tauri/tauri.ios.conf.json` and `src-tauri/Info.ios.plist`.
3. Run `npm run tauri -- ios init`.
4. Run `npm run tauri -- ios dev` for device testing.
5. Run `npm run tauri -- ios build` for release builds.

If `ios init` fails on `xcodegen`, fix local Homebrew write permissions first.

## Database migration

Run the new migration before using parking-agent APIs:

- `supabase/20260222_add_parking_agent_tables.sql`
- `supabase/20260222_enable_rls_for_pci.sql`

## PCI documentation

- `docs/pci/cde-data-flow.md`
- `docs/pci/payment-profile-encryption-rollout.md`
- `docs/pci/saq-d-requirement-evidence-matrix.md`
- `docs/pci/key-management-sop.md`
- `docs/pci/vulnerability-management-plan.md`
- `docs/pci/chd-incident-response-runbook.md`
- `docs/pci/qsa-acquirer-evidence-pack.md`

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment note

Because ParkOS uses server-side Playwright for payment execution, deploy to infrastructure that supports
long-running Node.js processes and Chromium dependencies (container/VM deployment is recommended).
