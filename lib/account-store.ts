import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type SupabaseConfig = {
  url: string;
  apiKey: string;
};

type SupabaseErrorPayload = {
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
};

export type UserPaymentProfileRow = {
  id?: string;
  username?: string;
  password_hash?: string;
  email?: string;
  car_make?: string;
  car_model?: string;
  car_color?: string | null;
  license_plate?: string;
  license_plate_state?: string | null;
};

export type UserPaymentProfileForClient = {
  id: string;
  username: string;
  email: string;
  carMake: string;
  carModel: string;
  carColor: string;
  licensePlate: string;
  licensePlateState: string;
};

type DbResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

type ProfileCreateInput = {
  username: string;
  passwordHash: string;
  email: string;
  carMake: string;
  carModel: string;
  carColor: string | null;
  licensePlate: string;
  licensePlateState: string | null;
};

type ProfileUpdateInput = {
  email?: string;
  passwordHash?: string;
  carMake?: string;
  carModel?: string;
  carColor?: string | null;
  licensePlate?: string;
  licensePlateState?: string | null;
};

const PROFILE_SELECT =
  "id,username,password_hash,email,car_make,car_model,car_color,license_plate,license_plate_state";
const PASSWORD_HASH_VERSION = "scrypt_v1";

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const apiKey = process.env.SUPABASE_API_KEY?.trim();
  if (!url || !apiKey) {
    return null;
  }

  return { url, apiKey };
}

export function parseRequiredText(value: string | undefined): string {
  return (value || "").trim();
}

export function parseOptionalText(value: string | null | undefined): string | null {
  const normalized = (value || "").trim();
  return normalized ? normalized : null;
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${PASSWORD_HASH_VERSION}$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [version, salt, derivedHex] = storedHash.split("$");
  if (version !== PASSWORD_HASH_VERSION || !salt || !derivedHex) {
    return false;
  }
  if (!/^[0-9a-f]+$/i.test(derivedHex) || derivedHex.length % 2 !== 0) {
    return false;
  }

  const expectedBuffer = Buffer.from(derivedHex, "hex");
  const actualBuffer = scryptSync(password, salt, expectedBuffer.length);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function mapProfileForClient(profile: UserPaymentProfileRow | null): UserPaymentProfileForClient | null {
  if (!profile?.id || !profile.username || !profile.email || !profile.car_make || !profile.car_model || !profile.license_plate) {
    return null;
  }

  return {
    id: profile.id,
    username: profile.username,
    email: profile.email,
    carMake: profile.car_make,
    carModel: profile.car_model,
    carColor: profile.car_color || "",
    licensePlate: profile.license_plate,
    licensePlateState: profile.license_plate_state || "",
  };
}

function buildRestHeaders(config: SupabaseConfig, includeJsonBody = false): HeadersInit {
  return {
    ...(includeJsonBody ? { "Content-Type": "application/json" } : {}),
    Accept: "application/json",
    apikey: config.apiKey,
    Authorization: `Bearer ${config.apiKey}`,
  };
}

function parseSupabaseError(payload: SupabaseErrorPayload, fallback: string): string {
  return payload.error_description || payload.msg || payload.message || payload.error || fallback;
}

async function parseErrorResponse(response: Response, fallback: string): Promise<string> {
  const rawText = await response.text();
  if (!rawText) {
    return fallback;
  }

  try {
    const payload = JSON.parse(rawText) as SupabaseErrorPayload;
    return parseSupabaseError(payload, fallback);
  } catch {
    return rawText;
  }
}

export async function fetchProfileByUsername(
  config: SupabaseConfig,
  username: string,
): Promise<DbResult<UserPaymentProfileRow | null>> {
  const url = new URL(`${config.url}/rest/v1/user_payment_profiles`);
  url.searchParams.set("select", PROFILE_SELECT);
  url.searchParams.set("username", `eq.${username}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildRestHeaders(config),
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `Failed to load account (${response.status}): ${await parseErrorResponse(response, "Lookup failed.")}`,
    };
  }

  const rows = (await response.json().catch(() => [])) as UserPaymentProfileRow[];
  return { ok: true, value: rows[0] || null };
}

export async function fetchProfileById(
  config: SupabaseConfig,
  profileId: string,
): Promise<DbResult<UserPaymentProfileRow | null>> {
  const url = new URL(`${config.url}/rest/v1/user_payment_profiles`);
  url.searchParams.set("select", PROFILE_SELECT);
  url.searchParams.set("id", `eq.${profileId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildRestHeaders(config),
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `Failed to load account (${response.status}): ${await parseErrorResponse(response, "Lookup failed.")}`,
    };
  }

  const rows = (await response.json().catch(() => [])) as UserPaymentProfileRow[];
  return { ok: true, value: rows[0] || null };
}

export async function insertProfile(
  config: SupabaseConfig,
  input: ProfileCreateInput,
): Promise<DbResult<UserPaymentProfileRow>> {
  const response = await fetch(`${config.url}/rest/v1/user_payment_profiles`, {
    method: "POST",
    headers: {
      ...buildRestHeaders(config, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      username: input.username,
      password_hash: input.passwordHash,
      email: input.email,
      car_make: input.carMake,
      car_model: input.carModel,
      car_color: input.carColor,
      license_plate: input.licensePlate,
      license_plate_state: input.licensePlateState,
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `Failed to create account (${response.status}): ${await parseErrorResponse(response, "Insert failed.")}`,
    };
  }

  const rows = (await response.json().catch(() => [])) as UserPaymentProfileRow[];
  if (!rows[0]) {
    return {
      ok: false,
      status: 502,
      error: "Account was created but no profile data was returned.",
    };
  }

  return { ok: true, value: rows[0] };
}

export async function updateProfile(
  config: SupabaseConfig,
  profileId: string,
  input: ProfileUpdateInput,
): Promise<DbResult<UserPaymentProfileRow>> {
  const updatePayload: Record<string, string | null> = {};
  if (input.email !== undefined) {
    updatePayload.email = input.email;
  }
  if (input.passwordHash !== undefined) {
    updatePayload.password_hash = input.passwordHash;
  }
  if (input.carMake !== undefined) {
    updatePayload.car_make = input.carMake;
  }
  if (input.carModel !== undefined) {
    updatePayload.car_model = input.carModel;
  }
  if (input.carColor !== undefined) {
    updatePayload.car_color = input.carColor;
  }
  if (input.licensePlate !== undefined) {
    updatePayload.license_plate = input.licensePlate;
  }
  if (input.licensePlateState !== undefined) {
    updatePayload.license_plate_state = input.licensePlateState;
  }

  const url = new URL(`${config.url}/rest/v1/user_payment_profiles`);
  url.searchParams.set("id", `eq.${profileId}`);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      ...buildRestHeaders(config, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify(updatePayload),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `Failed to update account (${response.status}): ${await parseErrorResponse(response, "Update failed.")}`,
    };
  }

  const rows = (await response.json().catch(() => [])) as UserPaymentProfileRow[];
  if (!rows[0]) {
    return {
      ok: false,
      status: 502,
      error: "Account was updated but no profile data was returned.",
    };
  }

  return { ok: true, value: rows[0] };
}
