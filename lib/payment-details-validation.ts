export const PAYMENT_DETAILS_FIELDS = [
  "cardNumber",
  "cardCCV",
  "cardExpiration",
  "zipCode",
  "license",
] as const;

export type PaymentDetailsField = (typeof PAYMENT_DETAILS_FIELDS)[number];
export type StoredPaymentDetailsField = Exclude<PaymentDetailsField, "cardCCV">;

export type PaymentDetailsInput = {
  cardNumber?: unknown;
  cardCCV?: unknown;
  cardExpiration?: unknown;
  zipCode?: unknown;
  license?: unknown;
};

export type NormalizedPaymentDetails = {
  cardNumber: string;
  cardCCV: string;
  cardExpiration: string;
  zipCode: string;
  license: string;
};

export type NormalizedStoredPaymentDetails = {
  cardNumber: string;
  cardExpiration: string;
  zipCode: string;
  license: string;
};

export type PaymentDetailsValidationResult = {
  normalized: NormalizedPaymentDetails;
  missingFields: PaymentDetailsField[];
  invalidFields: PaymentDetailsField[];
  isValid: boolean;
};

export type StoredPaymentDetailsValidationResult = {
  normalized: NormalizedStoredPaymentDetails;
  missingFields: StoredPaymentDetailsField[];
  invalidFields: StoredPaymentDetailsField[];
  isValid: boolean;
};

export const PAYMENT_DETAILS_VALIDATION_CODES = [
  "PAYMENT_DETAILS_MISSING",
  "PAYMENT_DETAILS_INVALID",
] as const;

export type PaymentDetailsValidationCode = (typeof PAYMENT_DETAILS_VALIDATION_CODES)[number];

export type PaymentDetailsValidationErrorPayload = {
  code: PaymentDetailsValidationCode;
  error: string;
  missingFields?: PaymentDetailsField[];
  invalidFields?: PaymentDetailsField[];
};

type ValidationState = {
  missingFields: Set<PaymentDetailsField>;
  invalidFields: Set<PaymentDetailsField>;
  normalized: NormalizedPaymentDetails;
};

type ValidateOptions = {
  licenseFallback?: string;
};

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

function isLuhnValid(cardNumberDigits: string): boolean {
  let sum = 0;
  let shouldDouble = false;

  for (let i = cardNumberDigits.length - 1; i >= 0; i -= 1) {
    let digit = Number(cardNumberDigits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function normalizeCardNumber(value: string): string {
  const normalized = normalizeDigits(value);
  if (normalized.length < 12 || normalized.length > 19 || !isLuhnValid(normalized)) {
    return "";
  }
  return normalized;
}

function normalizeExpiration(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{2})\s*\/\s*(\d{2})$/) || trimmed.match(/^(\d{2})(\d{2})$/);
  if (!match) {
    return "";
  }

  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) {
    return "";
  }

  const expiry = new Date(2000 + year, month, 0, 23, 59, 59, 999);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() < Date.now()) {
    return "";
  }

  return `${String(month).padStart(2, "0")}/${String(year).padStart(2, "0")}`;
}

function normalizeZipCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9 -]{3,10}$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function normalizeLicense(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9 -]{2,12}$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function addResult(
  state: ValidationState,
  field: PaymentDetailsField,
  rawValue: string,
  normalize: (value: string) => string,
): void {
  if (!rawValue) {
    state.missingFields.add(field);
    state.normalized[field] = "";
    return;
  }

  const normalized = normalize(rawValue);
  if (!normalized) {
    state.invalidFields.add(field);
    state.normalized[field] = "";
    return;
  }

  state.normalized[field] = normalized;
}

function validateCore(input: PaymentDetailsInput | null | undefined, options?: ValidateOptions): ValidationState {
  const state: ValidationState = {
    missingFields: new Set<PaymentDetailsField>(),
    invalidFields: new Set<PaymentDetailsField>(),
    normalized: {
      cardNumber: "",
      cardCCV: "",
      cardExpiration: "",
      zipCode: "",
      license: "",
    },
  };

  const cardNumber = toTrimmedString(input?.cardNumber);
  addResult(state, "cardNumber", cardNumber, normalizeCardNumber);

  const cardCCV = toTrimmedString(input?.cardCCV);
  addResult(state, "cardCCV", cardCCV, (value) => {
    const normalized = normalizeDigits(value);
    return /^\d{3,4}$/.test(normalized) ? normalized : "";
  });

  const cardExpiration = toTrimmedString(input?.cardExpiration);
  addResult(state, "cardExpiration", cardExpiration, normalizeExpiration);

  const zipCode = toTrimmedString(input?.zipCode);
  addResult(state, "zipCode", zipCode, normalizeZipCode);

  const licenseRaw = toTrimmedString(input?.license);
  const licenseFallback = toTrimmedString(options?.licenseFallback);
  const licenseCandidate = licenseRaw || licenseFallback;
  addResult(state, "license", licenseCandidate, normalizeLicense);

  if (licenseRaw) {
    state.missingFields.delete("license");
  }

  return state;
}

function orderedFields<T extends PaymentDetailsField>(
  values: ReadonlySet<PaymentDetailsField>,
  allowed: readonly T[],
): T[] {
  return allowed.filter((field) => values.has(field)) as T[];
}

const STORED_FIELDS: StoredPaymentDetailsField[] = [
  "cardNumber",
  "cardExpiration",
  "zipCode",
  "license",
];

export function validatePaymentDetails(
  input: PaymentDetailsInput | null | undefined,
  options?: ValidateOptions,
): PaymentDetailsValidationResult {
  const state = validateCore(input, options);
  const missingFields = orderedFields(state.missingFields, PAYMENT_DETAILS_FIELDS);
  const invalidFields = orderedFields(state.invalidFields, PAYMENT_DETAILS_FIELDS);

  return {
    normalized: state.normalized,
    missingFields,
    invalidFields,
    isValid: missingFields.length === 0 && invalidFields.length === 0,
  };
}

export function validateStoredPaymentDetails(
  input: PaymentDetailsInput | null | undefined,
  options?: ValidateOptions,
): StoredPaymentDetailsValidationResult {
  const state = validateCore(input, options);
  const missingFields = orderedFields(state.missingFields, STORED_FIELDS);
  const invalidFields = orderedFields(state.invalidFields, STORED_FIELDS);

  return {
    normalized: {
      cardNumber: state.normalized.cardNumber,
      cardExpiration: state.normalized.cardExpiration,
      zipCode: state.normalized.zipCode,
      license: state.normalized.license,
    },
    missingFields,
    invalidFields,
    isValid: missingFields.length === 0 && invalidFields.length === 0,
  };
}

function fieldPath(field: PaymentDetailsField): string {
  return `paymentDetails.${field}`;
}

export function buildPaymentDetailsValidationError(
  missingFields: readonly PaymentDetailsField[],
  invalidFields: readonly PaymentDetailsField[],
): PaymentDetailsValidationErrorPayload | null {
  if (missingFields.length === 0 && invalidFields.length === 0) {
    return null;
  }

  if (missingFields.length > 0) {
    return {
      code: "PAYMENT_DETAILS_MISSING",
      error: `Missing payment details. Required: ${missingFields.map(fieldPath).join(", ")}.`,
      missingFields: [...missingFields],
      ...(invalidFields.length > 0 ? { invalidFields: [...invalidFields] } : {}),
    };
  }

  return {
    code: "PAYMENT_DETAILS_INVALID",
    error: `Invalid payment details: ${invalidFields.map(fieldPath).join(", ")}.`,
    invalidFields: [...invalidFields],
  };
}
