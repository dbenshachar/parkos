import Link from "next/link";
import { ProfileEditorCard } from "@/app/components/profile-editor-card";

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-8">
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-black">ParkOS Profile</h1>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/"
                className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
              >
                Home
              </Link>
              <Link
                href="/parking"
                className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
              >
                Parking
              </Link>
            </div>
          </div>
          <p className="max-w-3xl text-sm text-black/70">
            This page shows your saved account and vehicle details. Update anything here before you
            continue to zone lookup and payment.
          </p>
        </section>
        <ProfileEditorCard />
      </main>
    </div>
  );
}
