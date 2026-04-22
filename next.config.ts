import type { NextConfig } from "next";

// BLOCKER 1 FIX: Hard crash at startup if CMS_SESSION_SECRET is missing in production.
// This prevents silent auth bypass when an env var is forgotten at deploy time.
if (!process.env.CMS_SESSION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "CMS_SESSION_SECRET environment variable must be set in production. " +
    "Without it, authentication is silently disabled for all 122 salon sites. " +
    "Set a strong random secret and restart."
  );
}

// BLOCKER 3 FIX: Hard crash at startup if CMS_AUTH_DISABLED is set in production.
// This prevents accidental auth bypass via misconfigured .env.production.
if (process.env.CMS_AUTH_DISABLED && process.env.NODE_ENV === "production") {
  throw new Error(
    "CMS_AUTH_DISABLED is set in production environment. " +
    "This would bypass authentication for ALL 122+ salon sites. " +
    "Remove CMS_AUTH_DISABLED from .env.production immediately and restart."
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  rewrites: async () => [
    { source: "/guide", destination: "/guide.html" },
  ],
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-XSS-Protection", value: "1; mode=block" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ],
};

export default nextConfig;
