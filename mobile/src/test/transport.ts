// Replaces axios's network adapter on `apiClient`, for src/api tests only.
// The request still runs through the real interceptors and fetchers; only the
// wire is fake. Screen tests mock the api modules instead.
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

import { apiClient } from "../api/client";

const adapter = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>();
apiClient.defaults.adapter = adapter;

const ok = (config: InternalAxiosRequestConfig, data: unknown): AxiosResponse => ({
  data,
  status: 200,
  statusText: "OK",
  headers: {},
  config,
});

/** Every request answers 200 with `body`. */
export const respond = (body: unknown): void => {
  adapter.mockImplementation(async (config) => ok(config, body));
};

/** Every request is rejected with `status` and `body`, as axios's own adapter would. */
export const fail = (status: number, body: unknown = {}): void => {
  adapter.mockImplementation(async (config) => {
    const response = { ...ok(config, body), status, statusText: String(status) };
    throw new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_REQUEST", config, null, response);
  });
};

/** The last request: its config, URL and body (JSON parsed; FormData as-is). */
export const lastRequest = () => {
  const config = adapter.mock.calls.at(-1)?.[0];
  if (!config) throw new Error("no request was made");
  const body: unknown = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
  return { config, url: config.url, body };
};

export const requestCount = (): number => adapter.mock.calls.length;
