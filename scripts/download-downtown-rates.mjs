#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SOURCE_URL =
  "https://services.arcgis.com/yygmGNIVQrHqSELP/arcgis/rest/services/SLODowntownPrakingRates/FeatureServer/2/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson";

const OUTPUT_PATH = "data/slo-downtown-parking-rates.json";

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to download downtown rates layer (${response.status})`);
  }

  const payload = await response.json();
  if (payload?.type !== "FeatureCollection") {
    throw new Error("Unexpected response shape. Expected GeoJSON FeatureCollection.");
  }

  const destination = path.resolve(process.cwd(), OUTPUT_PATH);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Saved ${payload.features?.length ?? 0} features to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
