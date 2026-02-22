export type StoredPaymentProfile = {
  cardNumber: string;
  cardExpiration: string;
  zipCode: string;
  license: string;
};

type PaymentProfileUnlockSession = {
  version: 1;
  username: string;
  unlockSecret: string;
  createdAt: string;
};

export type EncryptedStoredPaymentProfileV2 = {
  version: 2;
  algorithm: "AES-256-GCM";
  kdf: {
    algorithm: "PBKDF2-SHA256";
    iterations: number;
    saltBase64: string;
  };
  ivBase64: string;
  ciphertextBase64: string;
  createdAt: string;
};

type LoadOptions = {
  username?: string;
  password?: string;
};

const PAYMENT_PROFILE_STORAGE_KEY_V1 = "parkos.paymentProfile.v1";
const PAYMENT_PROFILE_STORAGE_KEY_V2 = "parkos.paymentProfile.v2";
const PAYMENT_PROFILE_UNLOCK_SESSION_KEY = "parkos.paymentProfile.unlock.v1";
const SESSION_KDF_ITERATIONS = 200_000;
const DATA_KDF_ITERATIONS = 310_000;

export class PaymentProfileUnlockRequiredError extends Error {
  constructor(message = "Unlock required to access encrypted saved payment details.") {
    super(message);
    this.name = "PaymentProfileUnlockRequiredError";
  }
}

function isEncryptionEnforced(): boolean {
  return (process.env.NEXT_PUBLIC_PAYMENT_PROFILE_ENCRYPTION_ENFORCED || "").trim().toLowerCase() === "true";
}

function normalizeStoredPaymentProfile(value: Partial<StoredPaymentProfile> | null | undefined): StoredPaymentProfile | null {
  if (!value) {
    return null;
  }

  const cardNumber = (value.cardNumber || "").trim();
  const cardExpiration = (value.cardExpiration || "").trim();
  const zipCode = (value.zipCode || "").trim();
  const license = (value.license || "").trim();

  if (!cardNumber || !cardExpiration || !zipCode || !license) {
    return null;
  }

  return {
    cardNumber,
    cardExpiration,
    zipCode,
    license,
  };
}

function cryptoSupported(): boolean {
  return typeof window !== "undefined" && Boolean(window.crypto?.subtle);
}

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveSecretFromPassword(username: string, password: string): Promise<string> {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername || !password) {
    throw new Error("Username and password are required to unlock saved payment details.");
  }
  if (!cryptoSupported()) {
    throw new Error("Secure crypto APIs are unavailable in this browser.");
  }

  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    textEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const sessionSalt = textEncoder().encode(`parkos.payment.unlock:${normalizedUsername}`);
  const bits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: SESSION_KDF_ITERATIONS,
      salt: sessionSalt,
    },
    baseKey,
    256,
  );

  return bytesToBase64(new Uint8Array(bits));
}

async function deriveDataKey(secret: string, saltBase64: string, iterations: number): Promise<CryptoKey> {
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    textEncoder().encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: toArrayBuffer(base64ToBytes(saltBase64)),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function parseUnlockSession(raw: string | null): PaymentProfileUnlockSession | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PaymentProfileUnlockSession>;
    if (
      parsed.version === 1 &&
      typeof parsed.username === "string" &&
      typeof parsed.unlockSecret === "string" &&
      typeof parsed.createdAt === "string"
    ) {
      return {
        version: 1,
        username: parsed.username.trim().toLowerCase(),
        unlockSecret: parsed.unlockSecret,
        createdAt: parsed.createdAt,
      };
    }
  } catch {
    // Ignore malformed session payloads.
  }

  return null;
}

function readUnlockSession(): PaymentProfileUnlockSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  return parseUnlockSession(window.sessionStorage.getItem(PAYMENT_PROFILE_UNLOCK_SESSION_KEY));
}

function writeUnlockSession(username: string, unlockSecret: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const payload: PaymentProfileUnlockSession = {
    version: 1,
    username: username.trim().toLowerCase(),
    unlockSecret,
    createdAt: new Date().toISOString(),
  };
  window.sessionStorage.setItem(PAYMENT_PROFILE_UNLOCK_SESSION_KEY, JSON.stringify(payload));
}

function readLegacyLocalProfile(): StoredPaymentProfile | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(PAYMENT_PROFILE_STORAGE_KEY_V1);
  if (!raw) {
    return null;
  }

  try {
    return normalizeStoredPaymentProfile(JSON.parse(raw) as Partial<StoredPaymentProfile>);
  } catch {
    return null;
  }
}

function removeLegacyLocalProfile(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(PAYMENT_PROFILE_STORAGE_KEY_V1);
}

function readEncryptedLocalPayload(): EncryptedStoredPaymentProfileV2 | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(PAYMENT_PROFILE_STORAGE_KEY_V2);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EncryptedStoredPaymentProfileV2>;
    if (
      parsed.version === 2 &&
      parsed.algorithm === "AES-256-GCM" &&
      parsed.kdf?.algorithm === "PBKDF2-SHA256" &&
      typeof parsed.kdf.iterations === "number" &&
      typeof parsed.kdf.saltBase64 === "string" &&
      typeof parsed.ivBase64 === "string" &&
      typeof parsed.ciphertextBase64 === "string" &&
      typeof parsed.createdAt === "string"
    ) {
      return parsed as EncryptedStoredPaymentProfileV2;
    }
  } catch {
    // Ignore malformed encrypted payloads.
  }
  return null;
}

function writeEncryptedLocalPayload(payload: EncryptedStoredPaymentProfileV2): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PAYMENT_PROFILE_STORAGE_KEY_V2, JSON.stringify(payload));
}

async function tryInvokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<{ ok: true; value: T } | { ok: false }> {
  if (typeof window === "undefined") {
    return { ok: false };
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const value = await invoke<T>(command, args);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

async function readStoredPayload(): Promise<{
  encrypted: EncryptedStoredPaymentProfileV2 | null;
  legacy: StoredPaymentProfile | null;
  source: "tauri" | "localStorage" | "none";
}> {
  const tauriBlob = await tryInvokeTauri<string | null>("load_payment_profile_blob");
  if (tauriBlob.ok && tauriBlob.value) {
    try {
      const parsed = JSON.parse(tauriBlob.value) as unknown;
      const encrypted = normalizeEncryptedPayload(parsed);
      if (encrypted) {
        return { encrypted, legacy: null, source: "tauri" };
      }
      const legacy = normalizeStoredPaymentProfile(parsed as Partial<StoredPaymentProfile>);
      if (legacy) {
        return { encrypted: null, legacy, source: "tauri" };
      }
    } catch {
      // Continue to localStorage fallbacks if parsing fails.
    }
  }

  const encryptedLocal = readEncryptedLocalPayload();
  if (encryptedLocal) {
    return { encrypted: encryptedLocal, legacy: null, source: "localStorage" };
  }

  const legacyLocal = readLegacyLocalProfile();
  if (legacyLocal) {
    return { encrypted: null, legacy: legacyLocal, source: "localStorage" };
  }

  return { encrypted: null, legacy: null, source: "none" };
}

function normalizeEncryptedPayload(value: unknown): EncryptedStoredPaymentProfileV2 | null {
  const parsed = value as Partial<EncryptedStoredPaymentProfileV2> | null;
  if (
    !parsed ||
    parsed.version !== 2 ||
    parsed.algorithm !== "AES-256-GCM" ||
    parsed.kdf?.algorithm !== "PBKDF2-SHA256" ||
    typeof parsed.kdf.iterations !== "number" ||
    typeof parsed.kdf.saltBase64 !== "string" ||
    typeof parsed.ivBase64 !== "string" ||
    typeof parsed.ciphertextBase64 !== "string" ||
    typeof parsed.createdAt !== "string"
  ) {
    return null;
  }
  return parsed as EncryptedStoredPaymentProfileV2;
}

async function persistEncryptedPayload(payload: EncryptedStoredPaymentProfileV2): Promise<void> {
  const serialized = JSON.stringify(payload);
  const tauriResult = await tryInvokeTauri<void>("save_payment_profile_blob", { blob: serialized });
  if (tauriResult.ok) {
    removeLegacyLocalProfile();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PAYMENT_PROFILE_STORAGE_KEY_V2);
    }
    return;
  }

  writeEncryptedLocalPayload(payload);
  removeLegacyLocalProfile();
}

function clearLegacyStorageArtifacts(): void {
  removeLegacyLocalProfile();
}

async function encryptProfile(profile: StoredPaymentProfile, unlockSecret: string): Promise<EncryptedStoredPaymentProfileV2> {
  if (!cryptoSupported()) {
    throw new Error("Secure crypto APIs are unavailable in this browser.");
  }

  const saltBase64 = bytesToBase64(randomBytes(16));
  const iv = randomBytes(12);
  const key = await deriveDataKey(unlockSecret, saltBase64, DATA_KDF_ITERATIONS);
  const serialized = JSON.stringify(profile);
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
    },
    key,
    textEncoder().encode(serialized),
  );

  return {
    version: 2,
    algorithm: "AES-256-GCM",
    kdf: {
      algorithm: "PBKDF2-SHA256",
      iterations: DATA_KDF_ITERATIONS,
      saltBase64,
    },
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString(),
  };
}

async function decryptProfile(payload: EncryptedStoredPaymentProfileV2, unlockSecret: string): Promise<StoredPaymentProfile> {
  const key = await deriveDataKey(unlockSecret, payload.kdf.saltBase64, payload.kdf.iterations);
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(payload.ivBase64)),
    },
    key,
    toArrayBuffer(base64ToBytes(payload.ciphertextBase64)),
  );
  const json = new TextDecoder().decode(decrypted);
  const parsed = JSON.parse(json) as Partial<StoredPaymentProfile>;
  const normalized = normalizeStoredPaymentProfile(parsed);
  if (!normalized) {
    throw new Error("Saved payment details are invalid.");
  }
  return normalized;
}

async function resolveUnlockSecret(options?: LoadOptions): Promise<{ secret: string; username: string } | null> {
  const session = readUnlockSession();
  const requestedUsername = options?.username?.trim().toLowerCase() || "";

  if (options?.password) {
    const username = requestedUsername || session?.username || "";
    if (!username) {
      throw new Error("Missing account username for decrypting saved payment details.");
    }
    const secret = await deriveSecretFromPassword(username, options.password);
    writeUnlockSession(username, secret);
    return { secret, username };
  }

  if (session) {
    if (requestedUsername && session.username !== requestedUsername) {
      return null;
    }
    return { secret: session.unlockSecret, username: session.username };
  }

  return null;
}

export async function primePaymentProfileSessionUnlockFromCredentials(username: string, password: string): Promise<void> {
  const secret = await deriveSecretFromPassword(username, password);
  writeUnlockSession(username, secret);
}

export function clearPaymentProfileSessionUnlock(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(PAYMENT_PROFILE_UNLOCK_SESSION_KEY);
}

export async function loadStoredPaymentProfile(options?: LoadOptions): Promise<StoredPaymentProfile | null> {
  const payload = await readStoredPayload();
  if (!payload.encrypted && !payload.legacy) {
    return null;
  }

  if (payload.encrypted) {
    const unlock = await resolveUnlockSecret(options);
    if (!unlock) {
      throw new PaymentProfileUnlockRequiredError();
    }
    try {
      return await decryptProfile(payload.encrypted, unlock.secret);
    } catch {
      clearPaymentProfileSessionUnlock();
      throw new PaymentProfileUnlockRequiredError("Unable to decrypt saved details. Re-enter your password.");
    }
  }

  const legacy = payload.legacy;
  if (!legacy) {
    return null;
  }

  const unlock = await resolveUnlockSecret(options);
  if (!unlock) {
    if (isEncryptionEnforced()) {
      throw new PaymentProfileUnlockRequiredError();
    }
    return legacy;
  }

  const encrypted = await encryptProfile(legacy, unlock.secret);
  await persistEncryptedPayload(encrypted);
  clearLegacyStorageArtifacts();
  return legacy;
}

export async function saveStoredPaymentProfile(profile: StoredPaymentProfile, options?: LoadOptions): Promise<void> {
  const normalized = normalizeStoredPaymentProfile(profile);
  if (!normalized) {
    throw new Error("Invalid payment profile payload.");
  }
  if (!cryptoSupported()) {
    throw new Error("Secure crypto APIs are unavailable in this browser.");
  }

  const unlock = await resolveUnlockSecret(options);
  if (!unlock) {
    throw new PaymentProfileUnlockRequiredError();
  }

  const encrypted = await encryptProfile(normalized, unlock.secret);
  await persistEncryptedPayload(encrypted);
  clearLegacyStorageArtifacts();
}
