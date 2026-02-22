# ParkOS iOS (Hosted Web + Tauri Shell)

This repo is set up to ship iOS as a thin Tauri shell that points to a hosted ParkOS web app.

## 1) Deploy backend + web app first

ParkOS iOS depends on hosted server APIs (`app/api/*`) for:

- Playwright payment automation (`/api/parking/payment/execute`)
- Twilio SMS jobs (`/api/jobs/parking-agent-tick`)
- Supabase-backed auth/profile/session data

Deploy with Docker:

```bash
npm run docker:build
docker run --rm -p 3000:3000 --env-file .env parkos
```

Required env vars are listed in `.env.example`.

Run Supabase migrations:

```sql
supabase/20260221_create_user_payment_profiles.sql
supabase/20260222_add_parking_agent_tables.sql
supabase/20260222_enable_rls_for_pci.sql
```

Configure cron every minute:

- Endpoint: `POST /api/jobs/parking-agent-tick`
- Header: `Authorization: Bearer <CRON_SECRET>`

Manual tick command:

```bash
npm run cron:tick
```

Smoke test command:

```bash
APP_BASE_URL=https://parkos.example.com \
SMOKE_USERNAME=<username> \
SMOKE_PASSWORD=<password> \
CRON_SECRET=<cron_secret> \
npm run smoke:prod
```

## 2) iOS shell config in this repo

Configured files:

- `src-tauri/tauri.ios.conf.json`
- `src-tauri/Info.ios.plist`
- `src-tauri/capabilities/default.json`

Before building iOS, update placeholders:

1. Set production URL in `src-tauri/tauri.ios.conf.json` (`build.frontendDist`).
2. Set your Apple Team ID in `src-tauri/tauri.ios.conf.json` (`bundle.iOS.developmentTeam`).
3. Replace `parkos.example.com` in `src-tauri/Info.ios.plist` ATS exceptions.

## 3) Initialize iOS target

Prereqs:

- Full Xcode app installed
- Writable Homebrew install (for `xcodegen`)

Initialize:

```bash
npm run tauri -- ios init
```

Dev run:

```bash
npm run tauri -- ios dev
```

Release build:

```bash
npm run tauri -- ios build
```

## 4) Install on iPhone (free Apple ID)

1. Connect phone by USB and trust the computer.
2. Open generated iOS project in Xcode.
3. Select your Personal Team in Signing & Capabilities.
4. Use a unique bundle identifier if prompted.
5. Build/run to your physical iPhone target.
6. On iPhone, trust your developer cert in Settings > General > VPN & Device Management.

Free-provisioned builds expire and need periodic reinstall.
