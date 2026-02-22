"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let mapsInitializationPromise: Promise<void> | null = null;
let mapsOptionsSet = false;

async function getClientUsableMapsApiKey(): Promise<string> {
  // Keep backwards compatibility if a public key exists.
  const publicKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (publicKey) {
    return publicKey;
  }

  const response = await fetch("/api/google-maps/client-key", { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!response.ok || !payload.key) {
    const message =
      payload.error ??
      "Unable to retrieve Google Maps API key from server. Set GOOGLE_MAPS_API_KEY in .env.";
    throw new Error(message);
  }
  return payload.key.trim();
}

async function ensureMapsOptions() {
  if (mapsOptionsSet) {
    return;
  }

  const key = await getClientUsableMapsApiKey();
  setOptions({
    key,
    v: "weekly",
  });
  mapsOptionsSet = true;
}

export async function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined") {
    throw new Error("Google Maps can only be loaded in the browser.");
  }

  await ensureMapsOptions();

  if (!mapsInitializationPromise) {
    mapsInitializationPromise = (async () => {
      await importLibrary("maps");
      await importLibrary("marker");
    })();
  }

  await mapsInitializationPromise;
  return google.maps;
}
