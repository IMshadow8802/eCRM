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

export const isTrustedApiUrl = (url) => {
  try {
    return TRUSTED_API_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
};
