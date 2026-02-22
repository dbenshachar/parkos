import { randomBytes } from "node:crypto";

const runtimeSecrets = new Map<string, string>();

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function makeSecret(): string {
  return randomBytes(48).toString("base64url");
}

export function getOrCreateRuntimeSecret(name: string): string {
  const configured = process.env[name]?.trim() || "";
  if (configured) {
    return configured;
  }

  if (isProduction()) {
    return "";
  }

  const existing = runtimeSecrets.get(name);
  if (existing) {
    process.env[name] = existing;
    return existing;
  }

  const created = makeSecret();
  runtimeSecrets.set(name, created);
  process.env[name] = created;
  console.warn(`[security] Missing ${name}; generated ephemeral secret for this dev session.`);
  return created;
}
