// src/config/env.ts
//
// The app knows ONE host: Central. The API base URL comes from Central after
// the user types their company code on the login screen, and is persisted by
// the auth store so the code is typed once per install. See api/centralQueries.ts.
export const CENTRAL_API_URL = "https://shadowcodes.in/Central";
export const APP_TYPE = "ECRM_EMP";

// A persisted base URL is stamped on every request, so a tampered AsyncStorage
// value must not be able to point the token at another host. Only URLs on
// these origins survive rehydration.
export const TRUSTED_API_ORIGINS = ["https://shadowcodes.in"];

export const isTrustedApiUrl = (url: unknown): boolean => {
  try {
    return typeof url === "string" && TRUSTED_API_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
};

/**
 * Dev override. Expo inlines any EXPO_PUBLIC_* var into the bundle, so point a
 * dev build at a laptop by putting this in mobile/.env.local:
 *   EXPO_PUBLIC_API_BASE_URL=http://192.168.1.5:5001
 * Use the LAN IP, not localhost — localhost on a phone is the phone. When set,
 * the company-code step is skipped and Central is never asked.
 */
export const DEV_API_BASE_URL: string | null = process.env.EXPO_PUBLIC_API_BASE_URL ?? null;

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
