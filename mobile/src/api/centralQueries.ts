// src/api/centralQueries.ts
// Company code → API base URL, via the Central licensing API. Plain axios on
// purpose: Central is another host, needs no token, and must never go through
// apiClient (which would stamp a stale token and treat a 401 as logout).
import axios from "axios";

import { APP_TYPE, CENTRAL_API_URL } from "../config/env";
import type { ClientConfig } from "../types/api";

export type ClientLookupKind = "invalid" | "not_found" | "inactive" | "timeout" | "network";

export class ClientLookupError extends Error {
  kind: ClientLookupKind;
  constructor(message: string, kind: ClientLookupKind) {
    super(message);
    this.name = "ClientLookupError";
    this.kind = kind;
  }
}

interface CentralRow {
  Company?: string | null;
  CompCode?: string | null;
  BaseURL?: string | null;
  LogoURL?: string | null;
}

interface CentralEnvelope {
  success: boolean;
  message?: string;
  data?: CentralRow;
}

export async function fetchClientConfig(compCode: string): Promise<ClientConfig> {
  const code = String(compCode ?? "").trim().toUpperCase();
  if (!code) throw new ClientLookupError("Enter your company code", "invalid");

  let body: CentralEnvelope;
  try {
    const res = await axios.get<CentralEnvelope>(
      `${CENTRAL_API_URL}/api/clients/${encodeURIComponent(code)}`,
      { params: { appType: APP_TYPE }, timeout: 10_000 },
    );
    body = res.data;
  } catch (err: any) {
    const status: number | undefined = err?.response?.status;
    if (status === 404) throw new ClientLookupError("Company not found. Check the code.", "not_found");
    if (status === 403) {
      throw new ClientLookupError(
        err?.response?.data?.message || "License not active, contact admin",
        "inactive",
      );
    }
    if (err?.code === "ECONNABORTED") throw new ClientLookupError("Connection timed out. Try again.", "timeout");
    throw new ClientLookupError("Could not reach the licensing server.", "network");
  }

  const row = body?.data;
  if (!body?.success || !row?.BaseURL) throw new ClientLookupError("Invalid company code", "invalid");
  return {
    baseURL: row.BaseURL,
    compCode: row.CompCode ?? code,
    companyName: row.Company ?? null,
    logoURL: row.LogoURL || null,
    // Central also returns PrimaryColor. It is another product's field and this
    // app does not read it (2026-09-17) — do not add it back.
  };
}
