"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type LoginResponse = {
  ok?: boolean;
  hasSavedDetails?: boolean;
  username?: string;
  error?: string;
};

export function HomeLoginCard() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUsername = username.trim().toLowerCase();
    if (!trimmedUsername || !password.trim()) {
      setError("Enter both username and password.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/account/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: trimmedUsername,
          password,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as LoginResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to log in.");
      }

      if (!payload.hasSavedDetails) {
        router.push(`/account?username=${encodeURIComponent(trimmedUsername)}`);
        return;
      }

      router.push("/parking");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to log in.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-black">Login With Username</h2>
      <p className="mt-2 text-sm text-black/70">
        Sign in with your username and password to load your saved vehicle profile.
      </p>

      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <label className="block text-sm text-black/80">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
            placeholder="your_username"
          />
        </label>

        <label className="block text-sm text-black/80">
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            type="password"
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
            placeholder="Your password"
          />
        </label>

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isLoading ? "Logging in..." : "Login & Continue"}
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <p className="mt-4 text-sm text-black/70">
        No saved details yet?{" "}
        <Link href="/account" className="font-medium text-black underline underline-offset-2">
          Create your account profile
        </Link>
        .
      </p>
    </article>
  );
}
