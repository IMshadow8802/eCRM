// src/api/centralQueries.js
// Company code → API base URL, via the Central licensing API. Plain axios on
// purpose: Central is another host, needs no token, and must never go through
// the CRM interceptors (which would stamp a stale token and redirect on 401).
import axios from "axios";
import { CENTRAL_API_URL, APP_TYPE } from "../config/central";

/** kind: "invalid" | "not_found" | "inactive" | "timeout" | "network" */
export class ClientLookupError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = "ClientLookupError";
    this.kind = kind;
  }
}

export async function fetchClientConfig(compCode) {
  const code = String(compCode ?? "").trim().toUpperCase();
  if (!code) throw new ClientLookupError("Enter your company code", "invalid");

  let res;
  try {
    res = await axios.get(`${CENTRAL_API_URL}/api/clients/${encodeURIComponent(code)}`, {
      params: { appType: APP_TYPE },
      timeout: 10000,
    });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) throw new ClientLookupError("Company not found. Check the code.", "not_found");
    if (status === 403) {
      throw new ClientLookupError(err.response?.data?.message || "License not active, contact admin", "inactive");
    }
    if (err?.code === "ECONNABORTED") throw new ClientLookupError("Connection timed out. Try again.", "timeout");
    throw new ClientLookupError("Could not reach the licensing server.", "network");
  }

  const row = res?.data?.data;
  if (!res?.data?.success || !row?.BaseURL) throw new ClientLookupError("Invalid company code", "invalid");
  return {
    baseURL: row.BaseURL,
    compCode: row.CompCode ?? code,
    companyName: row.Company ?? null,
    logoURL: row.LogoURL || null,
    // Central also returns PrimaryColor. It is another product's field and this
    // app does not read it (2026-09-17) — do not add it back.
  };
}
