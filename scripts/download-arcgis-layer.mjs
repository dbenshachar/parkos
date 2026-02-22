#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ARCGIS_BASE = "https://www.arcgis.com/sharing/rest/content/items";
const DEFAULT_APP_ID = "0e63a798f5d9435f9137ce38245d63ee";
const DEFAULT_OUTPUT = "data/slo-street-parking.json";
const DEFAULT_HINT = "parking";

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function collectPossibleIds(value, found = new Set()) {
  const itemIdPattern = /\b[a-f0-9]{32}\b/gi;

  if (typeof value === "string") {
    const matches = value.match(itemIdPattern);
    if (matches) {
      matches.forEach((match) => found.add(match.toLowerCase()));
    }
    return found;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectPossibleIds(entry, found));
    return found;
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectPossibleIds(entry, found));
  }

  return found;
}

async function resolveWebMapId(appId, appData) {
  const directCandidates = [
    appData?.values?.webmap,
    appData?.values?.webMap,
    appData?.webmap,
    appData?.webMap,
    appData?.map,
    appData?.values?.map,
  ]
    .filter(Boolean)
    .map((id) => String(id).toLowerCase());

  const discoveredCandidates = Array.from(collectPossibleIds(appData));
  const candidateIds = Array.from(new Set([...directCandidates, ...discoveredCandidates])).filter(
    (id) => id !== appId.toLowerCase(),
  );

  for (const candidateId of candidateIds) {
    const itemMeta = await fetchJson(`${ARCGIS_BASE}/${candidateId}?f=json`);
    if (String(itemMeta?.type).toLowerCase() === "web map") {
      return candidateId;
    }
  }

  throw new Error("Could not find a Web Map item ID in the ArcGIS app configuration.");
}

function collectQueryableLayers(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectQueryableLayers(entry, found));
    return found;
  }

  if (!value || typeof value !== "object") {
    return found;
  }

  if (typeof value.url === "string" && /\/(FeatureServer|MapServer)(\/\d+)?$/i.test(value.url)) {
    found.push(value);
  }

  Object.values(value).forEach((entry) => collectQueryableLayers(entry, found));
  return found;
}

function chooseLayer(layers, hint) {
  if (layers.length === 0) {
    throw new Error("No queryable layers were found in the Web Map.");
  }

  const normalizedHint = hint.trim().toLowerCase();
  if (!normalizedHint) {
    return layers[0];
  }

  return (
    layers.find((layer) => {
      const title = String(layer.title ?? layer.name ?? "").toLowerCase();
      return title.includes(normalizedHint);
    }) ?? layers[0]
  );
}

function buildQueryUrl(layerUrl) {
  const base = layerUrl.replace(/\/+$/, "");
  return `${base}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
}

async function main() {
  const appId = getArg("--appid") ?? process.env.ARCGIS_APP_ID ?? DEFAULT_APP_ID;
  const output = getArg("--output") ?? process.env.ARCGIS_OUTPUT ?? DEFAULT_OUTPUT;
  const hint = getArg("--hint") ?? process.env.ARCGIS_LAYER_HINT ?? DEFAULT_HINT;

  if (!/^[a-f0-9]{32}$/i.test(appId)) {
    throw new Error(`Invalid ArcGIS app id: ${appId}`);
  }

  const appData = await fetchJson(`${ARCGIS_BASE}/${appId}/data?f=json`);
  const webMapId = await resolveWebMapId(appId, appData);
  const webMapData = await fetchJson(`${ARCGIS_BASE}/${webMapId}/data?f=json`);
  const candidateLayers = collectQueryableLayers(webMapData?.operationalLayers ?? webMapData);
  const selectedLayer = chooseLayer(candidateLayers, hint);

  const queryUrl = buildQueryUrl(selectedLayer.url);
  const geojson = await fetchJson(queryUrl);
  if (geojson?.type !== "FeatureCollection") {
    throw new Error("Layer query succeeded but response was not GeoJSON FeatureCollection.");
  }

  const destination = path.resolve(process.cwd(), output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(geojson, null, 2)}\n`, "utf8");

  const layerTitle = selectedLayer.title ?? selectedLayer.name ?? selectedLayer.id ?? "Unknown";
  console.log(`Saved ${geojson.features.length} features to ${output}`);
  console.log(`App ID: ${appId}`);
  console.log(`Web Map ID: ${webMapId}`);
  console.log(`Layer: ${layerTitle}`);
  console.log(`Query URL: ${queryUrl}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
