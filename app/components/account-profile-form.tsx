"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { primePaymentProfileSessionUnlockFromCredentials } from "@/lib/payment-profile-storage";

type FormValues = {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  phoneE164: string;
  smsOptIn: boolean;
  carMake: string;
  carModel: string;
  carColor: string;
  licensePlate: string;
  licensePlateState: string;
};

const initialValues: FormValues = {
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  phoneE164: "",
  smsOptIn: false,
  carMake: "",
  carModel: "",
  carColor: "",
  licensePlate: "",
  licensePlateState: "",
};

const E164_PHONE_REGEX = /^\+[1-9][0-9]{7,14}$/;

function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

export function AccountProfileForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const usernameFromQuery = searchParams.get("username")?.trim().toLowerCase() || "";

  useEffect(() => {
    if (!usernameFromQuery) {
      return;
    }

    setValues((previous) => {
      if (previous.username.trim()) {
        return previous;
      }
      return {
        ...previous,
        username: usernameFromQuery,
      };
    });
  }, [usernameFromQuery]);

  const onChange =
    <K extends Exclude<keyof FormValues, "smsOptIn">>(field: K) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({
        ...previous,
        [field]: event.target.value,
      }));
    };

  const validate = (): string[] => {
    const nextErrors: string[] = [];

    if (!values.username.trim()) {
      nextErrors.push("Username is required.");
    }
    if (!values.email.trim()) {
      nextErrors.push("Email is required.");
    }
    if (!values.password) {
      nextErrors.push("Password is required.");
    } else if (values.password.length < 8) {
      nextErrors.push("Password must be at least 8 characters.");
    }
    if (values.password !== values.confirmPassword) {
      nextErrors.push("Password and confirmation do not match.");
    }
    if (!values.carMake.trim()) {
      nextErrors.push("Car make is required.");
    }
    if (!values.carModel.trim()) {
      nextErrors.push("Car model is required.");
    }
    if (!values.licensePlate.trim()) {
      nextErrors.push("License plate is required.");
    }
    if (values.phoneE164.trim() && !E164_PHONE_REGEX.test(values.phoneE164.trim())) {
      nextErrors.push("Phone must be in E.164 format (e.g. +15551234567).");
    }
    if (values.smsOptIn && !values.phoneE164.trim()) {
      nextErrors.push("Phone number is required when SMS reminders are enabled.");
    }

    return nextErrors;
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (nextErrors.length > 0) {
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    void (async () => {
      try {
        const response = await fetch("/api/account/profile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: values.username.trim().toLowerCase(),
            email: values.email.trim().toLowerCase(),
            password: values.password,
            phoneE164: values.phoneE164.trim() || null,
            smsOptIn: values.smsOptIn,
            carMake: values.carMake.trim(),
            carModel: values.carModel.trim(),
            carColor: values.carColor.trim() || null,
            licensePlate: normalizePlate(values.licensePlate),
            licensePlateState: values.licensePlateState.trim().toUpperCase() || null,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as { error?: string; redirectTo?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Failed to save account profile.");
        }

        await primePaymentProfileSessionUnlockFromCredentials(values.username.trim().toLowerCase(), values.password).catch(() => {
          // If unlock priming fails, payment page fallback unlock will handle it.
        });

        router.push(payload.redirectTo || "/parking");
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "Failed to save account profile.";
        setSubmitError(message);
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <section className="w-full space-y-5">
      <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-black">Create Account</h2>
        <p className="mt-2 text-sm text-black/70">
          Create a username/password account and save your default vehicle details.
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-5">
          <section className="rounded-xl border border-black/10 bg-black/[0.02] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-black/70">Account Info</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm text-black/80">
                Username
                <input
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={values.username}
                  onChange={onChange("username")}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="your_username"
                />
              </label>
              <label className="text-sm text-black/80">
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={onChange("email")}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="name@example.com"
                />
              </label>
              <label className="text-sm text-black/80">
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={values.password}
                  onChange={onChange("password")}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="At least 8 characters"
                />
              </label>
              <label className="text-sm text-black/80">
                Confirm Password
                <input
                  name="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  value={values.confirmPassword}
                  onChange={onChange("confirmPassword")}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="Re-enter password"
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-black/10 bg-black/[0.02] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-black/70">SMS Alerts</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm text-black/80">
                Phone (E.164)
                <input
                  name="phone_e164"
                  type="tel"
                  value={values.phoneE164}
                  onChange={onChange("phoneE164")}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="+15551234567"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-black/80 md:mt-7">
                <input
                  name="sms_opt_in"
                  type="checkbox"
                  checked={values.smsOptIn}
                  onChange={(event) => {
                    setValues((previous) => ({
                      ...previous,
                      smsOptIn: event.target.checked,
                    }));
                  }}
                  className="h-4 w-4 rounded border border-black/30"
                />
                Enable SMS reminders for renew/expiry
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-black/10 bg-black/[0.02] p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-black/70">Vehicle Profile</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm text-black/80">
                Car Make
                <input
                  name="car_make"
                  type="text"
                  value={values.carMake}
                  onChange={onChange("carMake")}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="Toyota"
                />
              </label>
              <label className="text-sm text-black/80">
                Car Model
                <input
                  name="car_model"
                  type="text"
                  value={values.carModel}
                  onChange={onChange("carModel")}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="Corolla"
                />
              </label>
              <label className="text-sm text-black/80">
                Car Color
                <input
                  name="car_color"
                  type="text"
                  value={values.carColor}
                  onChange={onChange("carColor")}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="Blue"
                />
              </label>
              <label className="text-sm text-black/80">
                License Plate
                <input
                  name="license_plate"
                  type="text"
                  value={values.licensePlate}
                  onChange={(event) => {
                    const nextPlate = normalizePlate(event.target.value);
                    setValues((previous) => ({
                      ...previous,
                      licensePlate: nextPlate,
                    }));
                  }}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm uppercase"
                  placeholder="8ABC123"
                />
              </label>
              <label className="text-sm text-black/80">
                License Plate State
                <input
                  name="license_plate_state"
                  type="text"
                  value={values.licensePlateState}
                  onChange={onChange("licensePlateState")}
                  className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm uppercase"
                  placeholder="CA"
                />
              </label>
            </div>
          </section>

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Saving profile..." : "Create Account & Save Vehicle"}
          </button>
        </form>

        {errors.length > 0 ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        ) : null}
        {submitError ? <p className="mt-4 text-sm text-red-700">{submitError}</p> : null}
      </article>
    </section>
  );
}
