import Link from "next/link";
import { Suspense } from "react";
import { HomeLoginCard } from "@/app/components/home-login-card";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-8">
        <section className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-black">ParkOS</h1>
          <p className="max-w-3xl text-sm text-black/70">
            Start by logging in with your username and password. If you are new, create your account
            profile first, then continue to parking zone lookup.
          </p>
        </section>
        <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <Suspense
            fallback={
              <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
                <p className="text-sm text-black/70">Loading login...</p>
              </article>
            }
          >
            <HomeLoginCard />
          </Suspense>
          <article className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-black">New User?</h2>
            <p className="mt-2 text-sm text-black/70">
              Create your account and save vehicle details once so future guest parking checkouts are faster.
            </p>
            <Link
              href="/account"
              className="mt-5 inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85"
            >
              Go to Create Account
            </Link>
            <p className="mt-4 text-xs text-black/60">
              Already know your details and want to skip login checks? You can still access the tool directly.
            </p>
            <Link
              href="/parking"
              className="mt-2 inline-block rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
            >
              Open Parking Tool
            </Link>
          </article>
        </div>
      </main>
    </div>
  );
}
