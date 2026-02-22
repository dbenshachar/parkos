/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === "production";
const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https://api.openai.com https://maps.googleapis.com https://maps.gstatic.com https://places.googleapis.com https://api.twilio.com https://*.supabase.co",
  "frame-src 'self'",
].join("; ");

const nextConfig = {
  env: {
    NEXT_PUBLIC_PAYMENT_PROFILE_ENCRYPTION_ENFORCED:
      process.env.PAYMENT_PROFILE_ENCRYPTION_ENFORCED ||
      process.env.NEXT_PUBLIC_PAYMENT_PROFILE_ENCRYPTION_ENFORCED ||
      "false",
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    if (!isProduction) {
      return [];
    }

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspDirectives,
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
