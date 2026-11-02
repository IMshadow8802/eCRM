import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

import { ClientLookupError, fetchClientConfig } from "./centralQueries";

const get = jest.spyOn(axios, "get");
const config = { headers: {} } as InternalAxiosRequestConfig;
const reply = (data: unknown): AxiosResponse => ({ data, status: 200, statusText: "OK", headers: {}, config });
const httpError = (status: number, data: unknown = {}, code = "ERR_BAD_REQUEST") =>
  new AxiosError("x", code, config, null, { ...reply(data), status });

const row = { Company: "PRD", CompCode: "TESTCRM", BaseURL: "https://shadowcodes.in/TestCRM", LogoURL: "" };

it("asks Central for the trimmed, upper-cased code as ECRM_EMP and maps the row", async () => {
  get.mockResolvedValue(reply({ success: true, data: { ...row, PrimaryColor: "#f00" } }));
  await expect(fetchClientConfig("  testcrm ")).resolves.toEqual({
    baseURL: "https://shadowcodes.in/TestCRM",
    compCode: "TESTCRM",
    companyName: "PRD",
    logoURL: null,
  });
  expect(get).toHaveBeenCalledWith("https://shadowcodes.in/Central/api/clients/TESTCRM", {
    params: { appType: "ECRM_EMP" },
    timeout: 10_000,
  });
});

it("falls back to the typed code and null name when Central omits them", async () => {
  get.mockResolvedValue(reply({ success: true, data: { BaseURL: "https://b", LogoURL: "https://l.png" } }));
  await expect(fetchClientConfig("abc")).resolves.toEqual({
    baseURL: "https://b",
    compCode: "ABC",
    companyName: null,
    logoURL: "https://l.png",
  });
});

it("refuses a blank code without a request", async () => {
  await expect(fetchClientConfig("  ")).rejects.toMatchObject({ kind: "invalid" });
  expect(get).not.toHaveBeenCalled();
});

it.each([
  ["success false", { success: false, data: row }],
  ["no BaseURL", { success: true, data: { ...row, BaseURL: null } }],
  ["no data", { success: true }],
])("an answer with %s is an invalid code", async (_l, body) => {
  get.mockResolvedValue(reply(body));
  const err = await fetchClientConfig("x").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ClientLookupError);
  expect(err).toMatchObject({ kind: "invalid", name: "ClientLookupError" });
});

it.each([
  ["404", httpError(404), "not_found", "Company not found. Check the code."],
  ["403 with message", httpError(403, { message: "License expired" }), "inactive", "License expired"],
  ["403 without message", httpError(403), "inactive", "License not active, contact admin"],
  ["timeout", new AxiosError("t", "ECONNABORTED", config), "timeout", "Connection timed out. Try again."],
  ["no network", new AxiosError("Network Error", "ERR_NETWORK", config), "network", "Could not reach the licensing server."],
])("maps %s", async (_l, error, kind, message) => {
  get.mockRejectedValue(error);
  await expect(fetchClientConfig("x")).rejects.toMatchObject({ kind, message });
});
