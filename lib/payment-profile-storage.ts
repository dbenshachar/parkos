export type StoredPaymentProfile = {
  cardNumber: string;
  cardExpiration: string;
  zipCode: string;
  license: string;
};

const PAYMENT_PROFILE_STORAGE_KEY = "parkos.paymentProfile.v1";

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

export async function loadStoredPaymentProfile(): Promise<StoredPaymentProfile | null> {
  const tauriResult = await tryInvokeTauri<StoredPaymentProfile | null>("load_payment_profile");
  if (tauriResult.ok) {
    return normalizeStoredPaymentProfile(tauriResult.value);
  }

  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(PAYMENT_PROFILE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredPaymentProfile>;
    return normalizeStoredPaymentProfile(parsed);
  } catch {
    return null;
  }
}

export async function saveStoredPaymentProfile(profile: StoredPaymentProfile): Promise<void> {
  const normalized = normalizeStoredPaymentProfile(profile);
  if (!normalized) {
    throw new Error("Invalid payment profile payload.");
  }

  const tauriResult = await tryInvokeTauri<void>("save_payment_profile", { profile: normalized });
  if (tauriResult.ok) {
    return;
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(PAYMENT_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  }
}
