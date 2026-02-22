"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { loadStoredPaymentProfile, saveStoredPaymentProfile } from "@/lib/payment-profile-storage";

type PendingPaymentRequest = {
  sessionId: string;
  zoneNumber: string;
  durationMinutes: number;
  renewFromSessionId: string | null;
};

type PaymentExecuteError = {
  error?: string;
};

type ExecutePaymentResponse = {
  ok: boolean;
  paymentStatus: string;
  expiresAt: string;
};

type PaymentDetailsState = {
  cardNumber: string;
  cardCCV: string;
  cardExpiration: string;
  zipCode: string;
  license: string;
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const parsed = parsePendingPaymentRequestFromLocation();
    setRequest(parsed);
    setLoadingRequest(false);

    void (async () => {
      try {
        const stored = await loadStoredPaymentProfile();
        if (stored) {
          setHasStoredProfile(true);
          setDetails((current) => ({
            ...current,
            cardNumber: stored.cardNumber,
            cardExpiration: stored.cardExpiration,
            zipCode: stored.zipCode,
            license: stored.license,
            cardCCV: "",
          }));
        }
      } catch {
        setHasStoredProfile(false);
      } finally {
        setLoadingStoredProfile(false);
      }
    })();
  }, []);

  const onInputChange = (field: keyof PaymentDetailsState) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setDetails((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const onSubmitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!request) {
      setErrorMessage("Missing payment context. Start from the parking page.");
      return;
    }

    const cardNumber = details.cardNumber.trim();
    const cardCCV = details.cardCCV.trim();
    const cardExpiration = details.cardExpiration.trim();
    const zipCode = details.zipCode.trim();
    const license = details.license.trim();

    if (!cardNumber || !cardExpiration || !zipCode || !license) {
      setErrorMessage("Card number, expiration, ZIP code, and plate are required.");
      return;
    }
    if (!cardCCV) {
      setErrorMessage("CCV is required for every payment and is never saved.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await saveStoredPaymentProfile({
        cardNumber,
        cardExpiration,
        zipCode,
        license,
      });

      const response = await fetch("/api/parking/payment/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-card-number": cardNumber,
          "x-card-ccv": cardCCV,
          "x-card-expiration": cardExpiration,
          "x-zip-code": zipCode,
          "x-license": license,
        },
        body: JSON.stringify({
          sessionId: request.sessionId,
          zoneNumber: request.zoneNumber,
          durationMinutes: request.durationMinutes,
          renewFromSessionId: request.renewFromSessionId,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as PaymentExecuteError;
        throw new Error(payload.error || "Failed to execute payment.");
      }

      const payload = (await response.json()) as ExecutePaymentResponse;
      setSuccessMessage(`Payment ${payload.paymentStatus}. Expires at ${formatTimestamp(payload.expiresAt)}.`);
      setDetails((current) => ({
        ...current,
        cardCCV: "",
      }));
      setHasStoredProfile(true);
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
            <p className="mt-2 text-black/70">Saved card details found on this device. Enter CCV to continue.</p>
          ) : (
            <p className="mt-2 text-black/70">No saved card details found. Enter details below to continue.</p>
          )
        ) : (
          <p className="mt-2 text-black/70">Checking for saved card details...</p>
        )}
      </div>

      <form onSubmit={onSubmitPayment} className="rounded-md border border-black/10 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-black/80">
            Card Number
            <input
              value={details.cardNumber}
              onChange={onInputChange("cardNumber")}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="4111111111111111"
              autoComplete="cc-number"
            />
          </label>
          <label className="text-sm text-black/80">
            Expiration (MM/YY)
            <input
              value={details.cardExpiration}
              onChange={onInputChange("cardExpiration")}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="08/28"
              autoComplete="cc-exp"
            />
          </label>
          <label className="text-sm text-black/80">
            CCV (required every payment)
            <input
              value={details.cardCCV}
              onChange={onInputChange("cardCCV")}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="123"
              autoComplete="cc-csc"
            />
          </label>
          <label className="text-sm text-black/80">
            ZIP Code
            <input
              value={details.zipCode}
              onChange={onInputChange("zipCode")}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="93401"
              autoComplete="postal-code"
            />
          </label>
          <label className="text-sm text-black/80 md:col-span-2">
            License Plate
            <input
              value={details.license}
              onChange={onInputChange("license")}
              className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="8ABC123"
            />
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
      <p className="text-xs text-black/60">Card number, expiration, ZIP code, and plate are saved locally on-device. CCV is never saved.</p>
    </div>
  );
}
