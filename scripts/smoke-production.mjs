const baseUrlRaw = process.env.APP_BASE_URL?.trim() || "";
const username = process.env.SMOKE_USERNAME?.trim() || "";
const password = process.env.SMOKE_PASSWORD?.trim() || "";
const cronSecret = process.env.CRON_SECRET?.trim() || "";

const lat = Number(process.env.SMOKE_LAT || "35.2813");
const lng = Number(process.env.SMOKE_LNG || "-120.6612");

if (!baseUrlRaw) {
  console.error("Missing APP_BASE_URL.");
  process.exit(1);
}

if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
  console.error("SMOKE_LAT and SMOKE_LNG must be finite numbers.");
  process.exit(1);
}

const baseUrl = baseUrlRaw.endsWith("/") ? baseUrlRaw : `${baseUrlRaw}/`;
const cookieJar = new Map();

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const setCookie = response.headers.get("set-cookie");
  return setCookie ? [setCookie] : [];
}

function upsertCookies(response) {
  for (const header of getSetCookies(response)) {
    const firstSegment = header.split(";")[0] || "";
    const separatorIndex = firstSegment.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = firstSegment.slice(0, separatorIndex);
    const value = firstSegment.slice(separatorIndex + 1);
    cookieJar.set(name, value);
  }
}

function cookieHeader() {
  if (!cookieJar.size) {
    return "";
  }
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function request(path, input = {}) {
  const url = new URL(path, baseUrl);
  const headers = new Headers(input.headers || {});

  if (input.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const cookie = cookieHeader();
  if (cookie) {
    headers.set("Cookie", cookie);
  }

  const response = await fetch(url, {
    method: input.method || "GET",
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    cache: "no-store",
    redirect: "manual",
  });

  upsertCookies(response);

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    json,
  };
}

const checks = [];
function addCheck(name, ok, details = "") {
  checks.push({ name, ok, details });
  const marker = ok ? "PASS" : "FAIL";
  console.log(`${marker} ${name}${details ? `: ${details}` : ""}`);
}

const meBeforeAuth = await request("api/account/me");
addCheck("GET /api/account/me before login", meBeforeAuth.status === 401);

const zoneLookup = await request("api/parking/current-zone", {
  method: "POST",
  body: { lat, lng, accuracyMeters: 30 },
});
addCheck("POST /api/parking/current-zone", zoneLookup.ok, `status=${zoneLookup.status}`);

if (username && password) {
  const login = await request("api/account/login", {
    method: "POST",
    body: { username, password },
  });
  addCheck("POST /api/account/login", login.ok, `status=${login.status}`);

  const meAfterLogin = await request("api/account/me");
  addCheck("GET /api/account/me after login", meAfterLogin.ok, `status=${meAfterLogin.status}`);

  const capture = await request("api/parking/session/capture", {
    method: "POST",
    body: { lat, lng, accuracyMeters: 20 },
  });
  addCheck("POST /api/parking/session/capture", capture.ok, `status=${capture.status}`);

  const resumeToken = typeof capture.json?.resumeToken === "string" ? capture.json.resumeToken : "";
  if (resumeToken) {
    const resume = await request(`api/parking/session/resume?token=${encodeURIComponent(resumeToken)}`);
    addCheck("GET /api/parking/session/resume", resume.ok, `status=${resume.status}`);
  } else {
    addCheck("GET /api/parking/session/resume", false, "missing resumeToken from capture response");
  }

  const userTick = await request("api/jobs/parking-agent-tick", {
    method: "POST",
    headers: {
      "x-parkos-user-trigger": "1",
    },
  });
  addCheck("POST /api/jobs/parking-agent-tick (user trigger)", userTick.ok, `status=${userTick.status}`);

  const logout = await request("api/account/logout", { method: "POST" });
  addCheck("POST /api/account/logout", logout.ok, `status=${logout.status}`);

  const meAfterLogout = await request("api/account/me");
  addCheck("GET /api/account/me after logout", meAfterLogout.status === 401);
} else {
  console.log("SKIP auth/session checks (set SMOKE_USERNAME and SMOKE_PASSWORD to enable).");
}

if (cronSecret) {
  const cronTick = await request("api/jobs/parking-agent-tick", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
    },
  });
  addCheck("POST /api/jobs/parking-agent-tick (cron auth)", cronTick.ok, `status=${cronTick.status}`);
} else {
  console.log("SKIP cron-auth tick (set CRON_SECRET to enable).");
}

const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  console.error(`Smoke checks failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}

console.log(`Smoke checks passed: ${checks.length}/${checks.length}`);
