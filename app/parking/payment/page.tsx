import Link from "next/link";

import { PaymentConfirmForm } from "@/app/components/payment-confirm-form";

export default function ParkingPaymentPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-8">
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-black">Confirm Parking Payment</h1>
            <Link
              href="/parking"
              className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
            >
              Back to Parking
            </Link>
          </div>
          <p className="text-sm text-black/70">
            Confirm payment details and complete your PayByPhone checkout.
          </p>
        </section>

        <PaymentConfirmForm />
      </main>
    </div>
  );
}
