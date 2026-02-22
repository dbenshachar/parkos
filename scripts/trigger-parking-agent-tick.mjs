const baseUrlRaw = process.env.APP_BASE_URL?.trim() || "";
const cronSecret = process.env.CRON_SECRET?.trim() || "";
const isProduction = (process.env.NODE_ENV || "").trim() === "production";

if (!baseUrlRaw) {
  console.error("Missing APP_BASE_URL.");
  process.exit(1);
}

if (!cronSecret && isProduction) {
  console.error("Missing CRON_SECRET.");
  process.exit(1);
}

const baseUrl = baseUrlRaw.endsWith("/") ? baseUrlRaw : `${baseUrlRaw}/`;
const endpoint = new URL("api/jobs/parking-agent-tick", baseUrl).toString();

const response = await fetch(endpoint, {
  method: "POST",
  headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
  cache: "no-store",
});

const text = await response.text();
let payload = null;
try {
  payload = text ? JSON.parse(text) : null;
} catch {
  payload = null;
}

if (!response.ok) {
  console.error(`Tick failed (${response.status}).`);
  console.error(payload || text || "<empty>");
  process.exit(1);
}

console.log(`Tick succeeded (${response.status}).`);
console.log(payload || text || "<empty>");
