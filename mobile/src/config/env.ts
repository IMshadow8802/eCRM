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

/**
 * How long a normal JSON request may hang before axios aborts it.
 *
 * Deliberately shorter than it looks like it should be. Every one of these is
 * a small POST answered by a stored procedure; if it has not come back in 15
 * seconds it is not coming back, and the user is staring at a spinner. Paired
 * with one retry, that bounds a dead request at roughly half a minute instead
 * of the minute-and-a-half the old 30s × 3 attempts allowed.
 *
 * Transfers override it per-request: uploads and downloads pass `timeout: 0`,
 * because a 200MB build legitimately takes minutes on a phone connection.
 */
export const REQUEST_TIMEOUT_MS = 15_000;
