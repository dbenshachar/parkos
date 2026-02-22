import Link from "next/link";
import { SimulatedTextMessagesPanel } from "@/app/components/simulated-text-messages-panel";

export default function SimulatedTextMessagesPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-8">
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-black">ParkOS SMS Simulator</h1>
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
              <Link
                href="/profile"
                className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
              >
                Profile
              </Link>
            </div>
          </div>
          <p className="max-w-3xl text-sm text-black/70">
            Use this screen to inspect the exact SMS notification rows written to DB for your current parking session.
          </p>
        </section>
        <SimulatedTextMessagesPanel />
      </main>
    </div>
  );
}
