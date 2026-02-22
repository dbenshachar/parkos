"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import {
  PaymentProfileUnlockRequiredError,
  loadStoredPaymentProfile,
  saveStoredPaymentProfile,
} from "@/lib/payment-profile-storage";
import {
  PAYMENT_DETAILS_VALIDATION_CODES,
  type PaymentDetailsField,
  type PaymentDetailsValidationCode,
  type StoredPaymentDetailsValidationResult,
  validatePaymentDetails,
  validateStoredPaymentDetails,
} from "@/lib/payment-details-validation";

type PendingPaymentRequest = {
  sessionId: string;
  zoneNumber: string;
  durationMinutes: number;
  renewFromSessionId: string | null;
};

type PaymentExecuteError = {
  code?: PaymentDetailsValidationCode;
  missingFields?: PaymentDetailsField[];
  invalidFields?: PaymentDetailsField[];
  error?: string;
};

type ExecutePaymentResponse = {
  ok: boolean;
  paymentStatus: string;
  expiresAt: string;
};

type MeResponse = {
  ok?: boolean;
  username?: string;
  profile?: {
    username?: string;
    licensePlate?: string;
  } | null;
  error?: string;
};

type PaymentDetailsState = {
  cardNumber: string;
  cardCCV: string;
  cardExpiration: string;
  zipCode: string;
  license: string;
};

type PaymentDetailsFieldErrors = Partial<Record<PaymentDetailsField, string>>;

const POST_PAYMENT_INFO_DELAY_MS = 30_000;
const SHORT_DURATION_REMINDER_DELAY_MS = 60_000;
const RENEW_REMINDER_LEAD_MS = 10 * 60_000;

type ScheduledTick = {
  label: "payment_confirmed" | "post_payment_info" | "renew_reminder" | "parking_expired";
  delayMs: number;
};

function parsePendingPaymentRequestFromLocation(): PendingPaymentRequest | null {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("sessionId")?.trim() || "";
  const zoneNumber = params.get("zoneNumber")?.trim() || "";
  const durationRaw = params.get("durationMinutes")?.trim() || "";
  const renewFromSessionId = params.get("renewFromSessionId")?.trim() || "";

  const parsedDuration = Number.parseInt(durationRaw, 10);
  if (!sessionId || !zoneNumber || !Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    return null;
  }

  return {
    sessionId,
    zoneNumber,
    durationMinutes: parsedDuration,
    renewFromSessionId: renewFromSessionId || null,
  };
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const FIELD_ORDER: PaymentDetailsField[] = ["cardNumber", "cardExpiration", "cardCCV", "zipCode", "license"];

const MISSING_FIELD_MESSAGES: Record<PaymentDetailsField, string> = {
  cardNumber: "Card number is required.",
  cardCCV: "CCV is required for every payment and is never saved.",
  cardExpiration: "Card expiration is required.",
  zipCode: "ZIP code is required.",
  license: "License plate is required.",
};

const INVALID_FIELD_MESSAGES: Record<PaymentDetailsField, string> = {
  cardNumber: "Enter a valid card number.",
  cardCCV: "CCV must be 3 or 4 digits.",
  cardExpiration: "Expiration must be MM/YY and cannot be in the past.",
  zipCode: "Enter a valid ZIP/postal code.",
  license: "Enter a valid license plate.",
};

function mergeFieldErrors(
  missingFields: readonly PaymentDetailsField[],
  invalidFields: readonly PaymentDetailsField[],
): PaymentDetailsFieldErrors {
  const next: PaymentDetailsFieldErrors = {};
  for (const field of missingFields) {
    next[field] = MISSING_FIELD_MESSAGES[field];
  }
  for (const field of invalidFields) {
    next[field] = INVALID_FIELD_MESSAGES[field];
  }
  return next;
}

function firstFieldErrorMessage(fieldErrors: PaymentDetailsFieldErrors): string | null {
  for (const field of FIELD_ORDER) {
    if (fieldErrors[field]) {
      return fieldErrors[field] || null;
    }
  }
  return null;
}

function isPaymentValidationCode(value: unknown): value is PaymentDetailsValidationCode {
  return typeof value === "string" && (PAYMENT_DETAILS_VALIDATION_CODES as readonly string[]).includes(value);
}

function staleStoredDetailsMessage(validation: StoredPaymentDetailsValidationResult): string | null {
  if (validation.invalidFields.includes("cardExpiration")) {
    return "Saved card expiration is invalid or expired. Update expiration and enter CCV to continue.";
  }
  if (validation.missingFields.length > 0 || validation.invalidFields.length > 0) {
    return "Saved payment details need review. Update highlighted fields before confirming payment.";
  }
  return null;
}

export function PaymentConfirmForm() {
  const [request, setRequest] = useState<PendingPaymentRequest | null>(null);
  const [loadingRequest, setLoadingRequest] = useState(true);
  const [loadingStoredProfile, setLoadingStoredProfile] = useState(true);
  const [hasStoredProfile, setHasStoredProfile] = useState(false);
  const [details, setDetails] = useState<PaymentDetailsState>({
    cardNumber: "",
    cardCCV: "",
    cardExpiration: "",
    zipCode: "",
    license: "",
  });
  const [fieldErrors, setFieldErrors] = useState<PaymentDetailsFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unlockRequired, setUnlockRequired] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [accountUsername, setAccountUsername] = useState("");
  const tickTimerIdsRef = useRef<number[]>([]);

  const applyStoredProfileValidation = (
    profile: Pick<PaymentDetailsState, "cardNumber" | "cardExpiration" | "zipCode" | "license">,
  ) => {
    const validation = validateStoredPaymentDetails(profile);
    const validationFieldErrors = mergeFieldErrors(validation.missingFields, validation.invalidFields);

    setFieldErrors((current) => {
      const next = { ...current };
      delete next.cardNumber;
      delete next.cardExpiration;
      delete next.zipCode;
      delete next.license;
      return {
        ...next,
        ...validationFieldErrors,
      };
    });

    if (!validation.isValid) {
      const message = staleStoredDetailsMessage(validation);
      if (message) {
        setErrorMessage((current) => current ?? message);
      }
    }
  };

  useEffect(() => {
    const parsed = parsePendingPaymentRequestFromLocation();
    setRequest(parsed);
    setLoadingRequest(false);

    void (async () => {
      let licenseFromProfile = "";
      let username = "";
      try {
        const response = await fetch("/api/account/me", {
          method: "GET",
          cache: "no-store",
        });
        if (response.ok) {
          const payload = (await response.json().catch(() => ({}))) as MeResponse;
          licenseFromProfile = payload.profile?.licensePlate?.trim() || "";
          username = (payload.profile?.username || payload.username || "").trim().toLowerCase();
        }
      } catch {
        licenseFromProfile = "";
        username = "";
      }

      setAccountUsername(username);

      let stored = null as Awaited<ReturnType<typeof loadStoredPaymentProfile>>;
      try {
        stored = await loadStoredPaymentProfile({
          username,
        });
        setHasStoredProfile(Boolean(stored));
        setUnlockRequired(false);
      } catch (error) {
        if (error instanceof PaymentProfileUnlockRequiredError) {
          setHasStoredProfile(true);
          setUnlockRequired(true);
          setUnlockError(null);
        } else {
          setHasStoredProfile(false);
          setUnlockRequired(false);
        }
      }

      if (stored || licenseFromProfile) {
        setDetails((current) => ({
          ...current,
          cardNumber: stored?.cardNumber || current.cardNumber,
          cardExpiration: stored?.cardExpiration || current.cardExpiration,
          zipCode: stored?.zipCode || current.zipCode,
          license: stored?.license || current.license || licenseFromProfile,
          cardCCV: "",
        }));
      }

      if (stored) {
        applyStoredProfileValidation({
          cardNumber: stored.cardNumber,
          cardExpiration: stored.cardExpiration,
          zipCode: stored.zipCode,
          license: stored.license || licenseFromProfile,
        });
      }

      setLoadingStoredProfile(false);
    })();
  }, []);

  const onUnlockStoredProfile = async () => {
    if (!accountUsername) {
      setUnlockError("Unable to determine your account username. Refresh and try again.");
      return;
    }
    if (!unlockPassword.trim()) {
      setUnlockError("Enter your account password to unlock saved details.");
      return;
    }

    setUnlocking(true);
    setUnlockError(null);
    try {
      const stored = await loadStoredPaymentProfile({
        username: accountUsername,
        password: unlockPassword,
      });

      setHasStoredProfile(Boolean(stored));
      setUnlockRequired(false);
      setUnlockPassword("");
      if (stored) {
        setDetails((current) => ({
          ...current,
          cardNumber: stored.cardNumber,
          cardExpiration: stored.cardExpiration,
          zipCode: stored.zipCode,
          license: stored.license || current.license,
          cardCCV: "",
        }));
        applyStoredProfileValidation({
          cardNumber: stored.cardNumber,
          cardExpiration: stored.cardExpiration,
          zipCode: stored.zipCode,
          license: stored.license,
        });
      }
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : "Unable to unlock saved payment details.");
    } finally {
      setUnlocking(false);
    }
  };

  const runParkingAgentTick = async () => {
    await fetch("/api/jobs/parking-agent-tick", {
      method: "POST",
      headers: {
        "x-parkos-user-trigger": "1",
      },
      credentials: "same-origin",
      cache: "no-store",
    });
  };

  const clearScheduledTicks = () => {
    for (const timerId of tickTimerIdsRef.current) {
      window.clearTimeout(timerId);
    }
    tickTimerIdsRef.current = [];
  };

  const computeScheduledTicks = (durationMinutes: number, expiresAtIso: string): ScheduledTick[] => {
    const nowMs = Date.now();
    const parsedExpiryMs = Date.parse(expiresAtIso);
    const fallbackExpiryMs = nowMs + durationMinutes * 60_000;
    const expiresAtMs = Number.isFinite(parsedExpiryMs) ? parsedExpiryMs : fallbackExpiryMs;
    const expiresDelayMs = Math.max(0, expiresAtMs - nowMs);

    const renewDelayMs =
      durationMinutes < 10
        ? SHORT_DURATION_REMINDER_DELAY_MS
        : Math.max(SHORT_DURATION_REMINDER_DELAY_MS, expiresDelayMs - RENEW_REMINDER_LEAD_MS);

    return [
      { label: "payment_confirmed", delayMs: 0 },
      { label: "post_payment_info", delayMs: POST_PAYMENT_INFO_DELAY_MS },
      { label: "renew_reminder", delayMs: renewDelayMs },
      { label: "parking_expired", delayMs: expiresDelayMs },
    ];
  };

  const scheduleNotificationTicks = (durationMinutes: number, expiresAtIso: string) => {
    clearScheduledTicks();
    const schedule = computeScheduledTicks(durationMinutes, expiresAtIso);

    for (const item of schedule) {
      const timerId = window.setTimeout(() => {
        void runParkingAgentTick().catch(() => {
          // User-triggered tick is best effort; cron delivery remains authoritative.
        });
      }, item.delayMs);
      tickTimerIdsRef.current.push(timerId);
    }
  };

  useEffect(() => {
    return () => {
      for (const timerId of tickTimerIdsRef.current) {
        window.clearTimeout(timerId);
      }
      tickTimerIdsRef.current = [];
    };
  }, []);

  const onInputChange = (field: keyof PaymentDetailsState) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setDetails((current) => ({
      ...current,
      [field]: value,
    }));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
    setErrorMessage(null);
  };

  const onSubmitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!request) {
      setErrorMessage("Missing payment context. Start from the parking page.");
      return;
    }

    const validation = validatePaymentDetails(details);
    if (!validation.isValid) {
      const nextFieldErrors = mergeFieldErrors(validation.missingFields, validation.invalidFields);
      setFieldErrors(nextFieldErrors);
      setErrorMessage(firstFieldErrorMessage(nextFieldErrors) || "Update the highlighted payment fields.");
      return;
    }

    const { cardNumber, cardCCV, cardExpiration, zipCode, license } = validation.normalized;

    setSubmitting(true);
    setFieldErrors({});
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      let localSaveWarning: string | null = null;
      try {
        await saveStoredPaymentProfile(
          {
            cardNumber,
            cardExpiration,
            zipCode,
            license,
          },
          {
            username: accountUsername,
          },
        );
      } catch (storageError) {
        if (storageError instanceof PaymentProfileUnlockRequiredError) {
          setUnlockRequired(true);
          localSaveWarning = "Payment details were not saved locally. Unlock saved details to restore autofill.";
        } else {
          localSaveWarning = "Payment details could not be saved locally on this device.";
        }
      }

      const response = await fetch("/api/parking/payment/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: request.sessionId,
          zoneNumber: request.zoneNumber,
          durationMinutes: request.durationMinutes,
          renewFromSessionId: request.renewFromSessionId,
          paymentDetails: {
            cardNumber,
            cardCCV,
            cardExpiration,
            zipCode,
            license,
          },
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as PaymentExecuteError;
        if (isPaymentValidationCode(payload.code) || payload.missingFields || payload.invalidFields) {
          setFieldErrors(mergeFieldErrors(payload.missingFields || [], payload.invalidFields || []));
        }
        throw new Error(payload.error || "Failed to execute payment.");
      }

      const payload = (await response.json()) as ExecutePaymentResponse;
      scheduleNotificationTicks(request.durationMinutes, payload.expiresAt);
      setSuccessMessage(`Payment ${payload.paymentStatus}. Expires at ${formatTimestamp(payload.expiresAt)}.`);
      setDetails((current) => ({
        ...current,
        cardCCV: "",
      }));
      setHasStoredProfile(true);
      if (localSaveWarning) {
        setErrorMessage(localSaveWarning);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Payment failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingRequest) {
    return <p className="mt-3 text-sm text-black/70">Loading payment request...</p>;
  }

  if (!request) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>Payment details are missing. Return to parking and start from Confirm and Pay.</p>
        <Link href="/parking" className="mt-3 inline-block underline underline-offset-2">
          Back to parking
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-black/10 bg-black/[0.02] p-4 text-sm text-black">
        <p>
          Zone <strong>{request.zoneNumber}</strong>
        </p>
        <p>Duration: {request.durationMinutes} minutes</p>
        {!loadingStoredProfile ? (
          hasStoredProfile ? (
            unlockRequired ? (
              <p className="mt-2 text-amber-800">Saved details are encrypted. Unlock with your password to autofill.</p>
            ) : (
              <p className="mt-2 text-black/70">Saved card details found on this device. Enter CCV to continue.</p>
            )
          ) : (
            <p className="mt-2 text-black/70">No saved card details found. Enter details below to continue.</p>
          )
        ) : (
          <p className="mt-2 text-black/70">Checking for saved card details...</p>
        )}
      </div>

      {unlockRequired ? (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Unlock saved payment details</p>
          <p className="mt-1 text-amber-800">Enter your account password once for this session to decrypt saved details.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
              className="w-full max-w-sm rounded-md border border-amber-400/70 px-3 py-2 text-sm text-black"
              placeholder="Account password"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => {
                void onUnlockStoredProfile();
              }}
              disabled={unlocking}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {unlocking ? "Unlocking..." : "Unlock"}
            </button>
          </div>
          {unlockError ? <p className="mt-2 text-red-700">{unlockError}</p> : null}
        </section>
      ) : null}

      <form onSubmit={onSubmitPayment} className="rounded-md border border-black/10 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-black/80">
            Card Number
            <input
              value={details.cardNumber}
              onChange={onInputChange("cardNumber")}
              className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${
                fieldErrors.cardNumber ? "border-red-400" : "border-black/15"
              }`}
              placeholder="4111111111111111"
              autoComplete="cc-number"
            />
            {fieldErrors.cardNumber ? <p className="mt-1 text-xs text-red-700">{fieldErrors.cardNumber}</p> : null}
          </label>
          <label className="text-sm text-black/80">
            Expiration (MM/YY)
            <input
              value={details.cardExpiration}
              onChange={onInputChange("cardExpiration")}
              className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${
                fieldErrors.cardExpiration ? "border-red-400" : "border-black/15"
              }`}
              placeholder="08/28"
              autoComplete="cc-exp"
            />
            {fieldErrors.cardExpiration ? (
              <p className="mt-1 text-xs text-red-700">{fieldErrors.cardExpiration}</p>
            ) : null}
          </label>
          <label className="text-sm text-black/80">
            CCV (required every payment)
            <input
              value={details.cardCCV}
              onChange={onInputChange("cardCCV")}
              className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${
                fieldErrors.cardCCV ? "border-red-400" : "border-black/15"
              }`}
              placeholder="123"
              autoComplete="cc-csc"
            />
            {fieldErrors.cardCCV ? <p className="mt-1 text-xs text-red-700">{fieldErrors.cardCCV}</p> : null}
          </label>
          <label className="text-sm text-black/80">
            ZIP Code
            <input
              value={details.zipCode}
              onChange={onInputChange("zipCode")}
              className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${
                fieldErrors.zipCode ? "border-red-400" : "border-black/15"
              }`}
              placeholder="93401"
              autoComplete="postal-code"
            />
            {fieldErrors.zipCode ? <p className="mt-1 text-xs text-red-700">{fieldErrors.zipCode}</p> : null}
          </label>
          <label className="text-sm text-black/80 md:col-span-2">
            License Plate
            <input
              value={details.license}
              onChange={onInputChange("license")}
              className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${
                fieldErrors.license ? "border-red-400" : "border-black/15"
              }`}
              placeholder="8ABC123"
            />
            {fieldErrors.license ? <p className="mt-1 text-xs text-red-700">{fieldErrors.license}</p> : null}
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Processing..." : "Confirm and Pay"}
          </button>
          <Link
            href="/parking"
            className="rounded-md border border-black/20 bg-white px-4 py-2 text-sm font-medium text-black hover:bg-black/5"
          >
            Back
          </Link>
        </div>
      </form>

      {errorMessage ? <p className="text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-700">{successMessage}</p> : null}
      <p className="text-xs text-black/60">
        Saved card details on this device are encrypted at rest. CCV is never saved.
      </p>
    </div>
  );
}
