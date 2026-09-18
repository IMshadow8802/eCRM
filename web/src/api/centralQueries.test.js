import { describe, it, expect, vi, beforeEach } from "vitest";

const get = vi.fn();
vi.mock("axios", () => ({ default: { get: (...a) => get(...a) } }));

import { fetchClientConfig, ClientLookupError } from "./centralQueries";
import { CENTRAL_API_URL, APP_TYPE, isTrustedApiUrl } from "../config/central";

const ok = (data) => ({ data: { success: true, data } });
const httpErr = (status, message) => Object.assign(new Error("http"), { response: { status, data: { message } } });

beforeEach(() => {
  get.mockReset();
});

describe("fetchClientConfig", () => {
  it("asks Central for the upper-cased code with the CRM admin appType and maps the row", async () => {
    // PrimaryColor is deliberately populated here and deliberately absent from
    // the mapped result: it belongs to another product and this app does not
    // read it (2026-09-17). toEqual is exact, so re-adding it fails this test.
    get.mockResolvedValue(ok({ Company: "PRD Infotech", CompCode: "PRD", BaseURL: "https://shadowcodes.in/CRM", LogoURL: "", PrimaryColor: "#ff8a00" }));
    const cfg = await fetchClientConfig(" prd ");
    expect(get).toHaveBeenCalledWith(`${CENTRAL_API_URL}/api/clients/PRD`, { params: { appType: APP_TYPE }, timeout: 10000 });
    expect(cfg).toEqual({ baseURL: "https://shadowcodes.in/CRM", compCode: "PRD", companyName: "PRD Infotech", logoURL: null });
  });

  it("refuses an empty code without a request", async () => {
    await expect(fetchClientConfig("  ")).rejects.toMatchObject({ kind: "invalid" });
    expect(get).not.toHaveBeenCalled();
  });

  it("404 → not_found", async () => {
    get.mockRejectedValue(httpErr(404, "Company not found"));
    await expect(fetchClientConfig("NOPE")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("403 → inactive, carrying the server's message", async () => {
    get.mockRejectedValue(httpErr(403, "License not active, contact admin"));
    await expect(fetchClientConfig("OLD")).rejects.toMatchObject({ kind: "inactive", message: "License not active, contact admin" });
  });

  it("timeout → timeout", async () => {
    get.mockRejectedValue(Object.assign(new Error("t"), { code: "ECONNABORTED" }));
    await expect(fetchClientConfig("PRD")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("anything else → network", async () => {
    get.mockRejectedValue(new Error("boom"));
    const err = await fetchClientConfig("PRD").catch((e) => e);
    expect(err).toBeInstanceOf(ClientLookupError);
    expect(err.kind).toBe("network");
  });

  it("a 200 without a BaseURL is invalid", async () => {
    get.mockResolvedValue(ok({ Company: "X" }));
    await expect(fetchClientConfig("PRD")).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("isTrustedApiUrl", () => {
  it("accepts only the hosted origin", () => {
    expect(isTrustedApiUrl("https://shadowcodes.in/CRM")).toBe(true);
    expect(isTrustedApiUrl("https://shadowcodes.in/Client2/")).toBe(true);
    expect(isTrustedApiUrl("http://shadowcodes.in/CRM")).toBe(false);
    expect(isTrustedApiUrl("https://evil.tld/CRM")).toBe(false);
    expect(isTrustedApiUrl(null)).toBe(false);
    expect(isTrustedApiUrl("not a url")).toBe(false);
  });
});
