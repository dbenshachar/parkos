import Link from "next/link";
import { Suspense } from "react";
import { AccountProfileForm } from "@/app/components/account-profile-form";

export default function AccountPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-8">
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-black">ParkOS Account Setup</h1>
            <Link
              href="/"
              className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
            >
              Back to Home
            </Link>
          </div>
          <p className="max-w-3xl text-sm text-black/70">
            Create a username/password account and save your vehicle details for faster guest parking payments.
          </p>
        </section>
        <Suspense
          fallback={
            <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
              <p className="text-sm text-black/70">Loading account form...</p>
            </section>
          }
        >
          <AccountProfileForm />
        </Suspense>
      </main>
    </div>
  );
}
