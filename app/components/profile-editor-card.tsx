"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearPaymentProfileSessionUnlock } from "@/lib/payment-profile-storage";

type SavedProfile = {
  id?: string;
  username?: string;
  email?: string;
  phoneE164?: string;
  smsOptIn?: boolean;
  carMake?: string;
  carModel?: string;
  carColor?: string;
  licensePlate?: string;
  licensePlateState?: string;
};

type MeResponse = {
  ok?: boolean;
  username?: string;
  profile?: SavedProfile | null;
  error?: string;
};

type EditableValues = {
  username: string;
  email: string;
  phoneE164: string;
  smsOptIn: boolean;
  carMake: string;
  carModel: string;
  carColor: string;
  licensePlate: string;
  licensePlateState: string;
};

const defaultValues: EditableValues = {
  username: "",
  email: "",
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

export function ProfileEditorCard() {
  const router = useRouter();
  const [values, setValues] = useState<EditableValues>(defaultValues);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const response = await fetch("/api/account/me", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as MeResponse;
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load profile.");
        }

        if (!mounted) {
          return;
        }

        const loadedProfile = payload.profile;
        setValues({
          username: loadedProfile?.username || payload.username || "",
          email: loadedProfile?.email || "",
          phoneE164: loadedProfile?.phoneE164 || "",
          smsOptIn: Boolean(loadedProfile?.smsOptIn),
          carMake: loadedProfile?.carMake || "",
          carModel: loadedProfile?.carModel || "",
          carColor: loadedProfile?.carColor || "",
          licensePlate: loadedProfile?.licensePlate || "",
          licensePlateState: loadedProfile?.licensePlateState || "",
        });
      } catch (requestError) {
        if (!mounted) {
          return;
        }
        const message = requestError instanceof Error ? requestError.message : "Failed to load profile.";
        setLoadError(message);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const onChange =
    <K extends Exclude<keyof EditableValues, "smsOptIn">>(field: K) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setValues((previous) => ({
        ...previous,
        [field]: event.target.value,
      }));
    };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setSaveSuccess(null);

    const email = values.email.trim().toLowerCase();
    const carMake = values.carMake.trim();
    const carModel = values.carModel.trim();
    const licensePlate = normalizePlate(values.licensePlate);
    if (!email || !carMake || !carModel || !licensePlate) {
      setSaveError("Email, car make, car model, and license plate are required.");
      return;
    }
    if (values.phoneE164.trim() && !E164_PHONE_REGEX.test(values.phoneE164.trim())) {
      setSaveError("Phone must be in E.164 format (e.g. +15551234567).");
      return;
    }
    if (values.smsOptIn && !values.phoneE164.trim()) {
      setSaveError("Phone number is required when SMS reminders are enabled.");
      return;
    }

    setIsSaving(true);
    void (async () => {
      try {
        const response = await fetch("/api/account/me", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            phoneE164: values.phoneE164.trim() || null,
            smsOptIn: values.smsOptIn,
            carMake,
            carModel,
            carColor: values.carColor.trim() || null,
            licensePlate,
            licensePlateState: values.licensePlateState.trim().toUpperCase() || null,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as MeResponse;
        if (!response.ok) {
          throw new Error(payload.error || "Failed to save profile.");
        }

        const savedProfile = payload.profile;
        setValues((previous) => ({
          ...previous,
          username: savedProfile?.username || previous.username,
          email: savedProfile?.email || "",
          phoneE164: savedProfile?.phoneE164 || "",
          smsOptIn: Boolean(savedProfile?.smsOptIn),
          carMake: savedProfile?.carMake || "",
          carModel: savedProfile?.carModel || "",
          carColor: savedProfile?.carColor || "",
          licensePlate: savedProfile?.licensePlate || "",
          licensePlateState: savedProfile?.licensePlateState || "",
        }));
        setSaveSuccess("Profile updated.");
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "Failed to save profile.";
        setSaveError(message);
      } finally {
        setIsSaving(false);
      }
    })();
  };

  const onLogout = () => {
    setIsLoggingOut(true);
    void (async () => {
      try {
        await fetch("/api/account/logout", { method: "POST" });
      } finally {
        clearPaymentProfileSessionUnlock();
        router.push("/");
      }
    })();
  };

  if (isLoading) {
    return (
      <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <p className="text-sm text-black/70">Loading your saved profile...</p>
      </article>
    );
  }

  if (loadError) {
    return (
      <article className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-red-900">Unable to load profile</h2>
        <p className="mt-2 text-sm text-red-800">{loadError}</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-4 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85"
        >
          Back to Login
        </button>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-black">Saved Account Profile</h2>
        <button
          type="button"
          onClick={onLogout}
          disabled={isLoggingOut}
          className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isLoggingOut ? "Logging out..." : "Log Out"}
        </button>
      </div>
      <p className="mt-2 text-sm text-black/70">
        Review and update your saved account and vehicle details.
      </p>

      <form onSubmit={onSubmit} className="mt-5 space-y-5">
        <section className="rounded-xl border border-black/10 bg-black/[0.02] p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-black/70">Account Info</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm text-black/80">
              Username
              <input
                value={values.username}
                disabled
                className="mt-1 w-full rounded-md border border-black/15 bg-black/[0.03] px-3 py-2 text-sm text-black/60"
              />
            </label>
            <label className="text-sm text-black/80">
              Email
              <input
                type="email"
                value={values.email}
                onChange={onChange("email")}
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="name@example.com"
              />
            </label>
            <label className="text-sm text-black/80">
              Phone (E.164)
              <input
                type="tel"
                value={values.phoneE164}
                onChange={onChange("phoneE164")}
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="+15551234567"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-black/80 md:mt-7">
              <input
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
          <h3 className="text-sm font-semibold uppercase tracking-wide text-black/70">Vehicle Info</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm text-black/80">
              Car Make
              <input
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
                type="text"
                value={values.licensePlate}
                onChange={(event) => {
                  setValues((previous) => ({
                    ...previous,
                    licensePlate: normalizePlate(event.target.value),
                  }));
                }}
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm uppercase"
                placeholder="8ABC123"
              />
            </label>
            <label className="text-sm text-black/80">
              License Plate State
              <input
                type="text"
                value={values.licensePlateState}
                onChange={onChange("licensePlateState")}
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm uppercase"
                placeholder="CA"
              />
            </label>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving ? "Saving..." : "Save Profile Changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/parking")}
            className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
          >
            Go to Parking Tool
          </button>
        </div>
      </form>

      {saveError ? <p className="mt-3 text-sm text-red-700">{saveError}</p> : null}
      {saveSuccess ? <p className="mt-3 text-sm text-emerald-700">{saveSuccess}</p> : null}
    </article>
  );
}
