// src/config/env.ts
//
// The old app hardcoded https://prdinfotech.in/CRM, which has been dead for
// months — every request failed and there was no way to point it elsewhere
// without editing source. The base URL is now overridable at build time.
//
// Expo inlines any EXPO_PUBLIC_* var into the bundle, so point a dev build at
// a laptop by putting this in mobile/.env.local:
//   EXPO_PUBLIC_API_BASE_URL=http://192.168.1.5:5001
// Use the LAN IP, not localhost — localhost on a phone is the phone.
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://shadowcodes.in/CRM";

/** Matches the backend default; uploads override this per-request. */
export const REQUEST_TIMEOUT_MS = 30_000;
