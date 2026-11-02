import { AxiosError, type InternalAxiosRequestConfig } from "axios";

import { apiErrorMessage } from "./errors";

const config = { headers: {} } as InternalAxiosRequestConfig;
const axiosError = (response?: { data: unknown }) =>
  new AxiosError(
    "Request failed",
    "ERR_BAD_REQUEST",
    config,
    null,
    response && { ...response, status: 400, statusText: "Bad Request", headers: {}, config },
  );

it("prefers the server's message", () => {
  expect(apiErrorMessage(axiosError({ data: { message: "Remarks are required" } }), "fallback")).toBe(
    "Remarks are required",
  );
});

it.each([
  ["no message", { data: {} }],
  ["blank message", { data: { message: "   " } }],
  ["non-string message", { data: { message: 42 } }],
])("falls back on a server answer with %s", (_label, response) => {
  expect(apiErrorMessage(axiosError(response), "Could not save")).toBe("Could not save");
});

it("falls back on a network error (no response at all)", () => {
  expect(apiErrorMessage(axiosError(), "Check your connection")).toBe("Check your connection");
});

it("shows a fetcher's own Error message", () => {
  expect(apiErrorMessage(new Error("Bad payload"), "fallback")).toBe("Bad payload");
});

it.each([new Error("Network Error"), new Error(""), "boom", null])("falls back for %p", (err) => {
  expect(apiErrorMessage(err, "fallback")).toBe("fallback");
});
