import { ZoneLookupForm } from "@/app/components/zone-lookup-form";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-8">
        <section className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-black">ParkOS Zone Matching</h1>
          <p className="max-w-3xl text-sm text-black/70">
            Search destinations with Google Maps Places data, then get recommended downtown parking
            zones based on your current provisional zone map.
          </p>
        </section>
        <ZoneLookupForm />
      </main>
    </div>
  );
}
