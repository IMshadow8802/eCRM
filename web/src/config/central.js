// src/config/central.js
// The only host any build of this app knows. Everything else — the API base
// URL, company name, logo — comes from Central after the user types their
// company code, and is persisted so the code is typed once per browser.
export const CENTRAL_API_URL = "https://shadowcodes.in/Central";
export const APP_TYPE = "ECRM_ADMIN";

// A persisted base URL is rehydrated into every Authorization header, so a
// same-origin localStorage write must not be able to point the token at an
// arbitrary host. Only URLs on these origins survive rehydration.
export const TRUSTED_API_ORIGINS = ["https://shadowcodes.in"];

// Dev-only: under `pnpm dev`, VITE_API_BASE_URL (e.g. http://localhost:5001)
// replaces the BaseURL Central returns, so testing against a local backend
// keeps every sign-in on this machine. A production build has DEV=false and
// never reads it. Mobile's twin is EXPO_PUBLIC_API_BASE_URL.
export const devApiOverride = (env = import.meta.env) =>
  (env.DEV && env.VITE_API_BASE_URL) || null;

export const isTrustedApiUrl = (url) => {
  try {
    const origin = new URL(url).origin;
    const dev = devApiOverride();
    return TRUSTED_API_ORIGINS.includes(origin) || (dev !== null && new URL(dev).origin === origin);
  } catch {
    return false;
  }
};
