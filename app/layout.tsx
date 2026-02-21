import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ParkOS",
  description: "Parking zone lookup for San Luis Obispo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
