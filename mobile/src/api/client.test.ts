import { AxiosError } from "axios";

import { adapter, fail, lastRequest, respond } from "../test/transport";
import {
  getApiBaseUrl,
  getAuthToken,
  post,
  postData,
  setApiBaseUrl,
  setAuthToken,
  setReauthHandler,
  setUnauthorizedHandler,
  shouldSkipAuthRedirect,
} from "./client";

const onUnauthorized = jest.fn();

beforeEach(() => {
  setAuthToken(null);
  setApiBaseUrl(null);
  setUnauthorizedHandler(onUnauthorized);
  setReauthHandler(null);
  respond({ success: true, data: {} });
});

describe("request interceptor", () => {
  it("stamps the token pushed by setAuthToken", async () => {
    setAuthToken("tok-1");
    await post("/api/x");
    expect(lastRequest().config.headers.Authorization).toBe("Bearer tok-1");
    expect(getAuthToken()).toBe("tok-1");
  });

  it("sends no Authorization header without a token (empty string counts as none)", async () => {
    setAuthToken("");
    await post("/api/x");
    expect(getAuthToken()).toBeNull();
    expect(lastRequest().config.headers.Authorization).toBeUndefined();
  });

  it("uses the base URL pushed by setApiBaseUrl, read per request", async () => {
    setApiBaseUrl("https://shadowcodes.in/TestCRM");
    await post("/api/x");
    expect(lastRequest().config.baseURL).toBe("https://shadowcodes.in/TestCRM");
    setApiBaseUrl("https://shadowcodes.in/CRM");
    await post("/api/x");
    expect(lastRequest().config.baseURL).toBe("https://shadowcodes.in/CRM");
    expect(getApiBaseUrl()).toBe("https://shadowcodes.in/CRM");
  });

  it("leaves baseURL unset before a company is chosen", async () => {
    await post("/api/x");
    expect(getApiBaseUrl()).toBeNull();
    expect(lastRequest().config.baseURL).toBeUndefined();
  });
});

describe("401 handling", () => {
  it("calls the unauthorized handler with the server's code and message", async () => {
    fail(401, { code: "SESSION_EXPIRED", message: "Your session ended" });
    await expect(post("/api/tasks/fetchTasks")).rejects.toMatchObject({ response: { status: 401 } });
    expect(onUnauthorized).toHaveBeenCalledWith("SESSION_EXPIRED", "Your session ended");
  });

  it.each(["/api/auth/loginUser", "/api/auth/logoutUser"])("does not fire for %s", async (url) => {
    fail(401, { message: "Invalid credentials" });
    await expect(post(url)).rejects.toBeTruthy();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("does not fire for other statuses", async () => {
    fail(403);
    await expect(post("/api/x")).rejects.toBeTruthy();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("a 401 with no handler registered still rejects", async () => {
    setUnauthorizedHandler(null);
    fail(401);
    await expect(post("/api/x")).rejects.toMatchObject({ response: { status: 401 } });
  });

  it("shouldSkipAuthRedirect tolerates a missing url", () => {
    expect(shouldSkipAuthRedirect()).toBe(false);
    expect(shouldSkipAuthRedirect("https://h/CRM/api/auth/loginUser")).toBe(true);
  });
});

describe("post / postData", () => {
  it("post resolves the whole envelope and sends {} by default", async () => {
    respond({ success: true, message: "hi", data: { a: 1 } });
    await expect(post("/api/x")).resolves.toEqual({ success: true, message: "hi", data: { a: 1 } });
    expect(lastRequest()).toMatchObject({ url: "/api/x", body: {} });
  });

  it("postData unwraps data[key]", async () => {
    respond({ success: true, data: { rows: [1, 2] } });
    await expect(postData("/api/x", { a: 1 }, "rows")).resolves.toEqual([1, 2]);
    expect(lastRequest().body).toEqual({ a: 1 });
  });

  it.each([
    ["key absent", { success: true, data: {} }],
    ["data null", { success: false, data: null }],
    ["empty body", ""],
  ])("postData maps %s to []", async (_label, body) => {
    respond(body);
    await expect(postData("/api/x", {}, "rows")).resolves.toEqual([]);
  });
});

describe("re-sign-in on a closed session", () => {
  const SESSION_401 = { code: "SESSION_EXPIRED", message: "Your shift ended" };
  const authOf = (call: number) => adapter.mock.calls[call]![0].headers.Authorization;

  /** A request carrying `new-token` answers 200; anything else 401s with a session code. */
  const sessionEndsOnce = () => {
    adapter.mockImplementation(async (config) => {
      const response = { data: { success: true, data: { ok: config.url } }, status: 200, statusText: "OK", headers: {}, config };
      if (config.headers.Authorization === "Bearer new-token") return response;
      throw new AxiosError("401", "ERR_BAD_REQUEST", config, null, { ...response, status: 401, data: SESSION_401 });
    });
  };

  it("waits for the handler, then retries once with the new token and resolves", async () => {
    setAuthToken("old-token");
    sessionEndsOnce();
    const reauth = jest.fn(async () => {
      setAuthToken("new-token");
      return "new-token";
    });
    setReauthHandler(reauth);
    await expect(post("/api/tickets/saveTicket", { Title: "half typed" })).resolves.toMatchObject({ data: { ok: "/api/tickets/saveTicket" } });
    expect(reauth).toHaveBeenCalledWith("SESSION_EXPIRED", "Your shift ended");
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(authOf(1)).toBe("Bearer new-token");
    expect(lastRequest().body).toEqual({ Title: "half typed" });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("concurrent 401s share one handler call", async () => {
    setAuthToken("old-token");
    let release!: (t: string) => void;
    const reauth = jest.fn(() => new Promise<string>((res) => (release = res)));
    setReauthHandler(reauth);
    sessionEndsOnce();
    const a = post("/api/a");
    const b = post("/api/b");
    await new Promise((r) => setTimeout(r, 0));
    setAuthToken("new-token");
    release("new-token");
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);
    expect(reauth).toHaveBeenCalledTimes(1);
  });

  it("a request sent with an older token than the current one retries without asking", async () => {
    setAuthToken("old-token");
    const reauth = jest.fn();
    setReauthHandler(reauth);
    sessionEndsOnce();
    const answer = adapter.getMockImplementation()!;
    adapter.mockImplementationOnce(async (config) => {
      setAuthToken("new-token"); // someone re-signed in while this one was in flight
      return answer(config);
    });
    await expect(post("/api/slow")).resolves.toBeTruthy();
    expect(reauth).not.toHaveBeenCalled();
  });

  it("a late 401 from the previous user's session is never replayed as the next user", async () => {
    setAuthToken("tok-A");
    const reauth = jest.fn();
    setReauthHandler(reauth);
    let land!: () => void;
    adapter.mockImplementation(
      (config) =>
        new Promise((_res, rej) => {
          land = () => rej(new AxiosError("401", "ERR_BAD_REQUEST", config, null, { data: SESSION_401, status: 401, statusText: "401", headers: {}, config }));
        }),
    );
    const upload = post("/api/tickets/saveTicket", { Title: "A's complaint" });
    await new Promise((r) => setTimeout(r, 0));
    setAuthToken(null); // A signs out ...
    setAuthToken("tok-B"); // ... and B signs in while A's save is still on the wire
    land();
    await expect(upload).rejects.toMatchObject({ response: { status: 401 } });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(reauth).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled(); // nor does it sign B out
  });

  it.each([[{}], [SESSION_401]])("a token-less request sent between sign-out and sign-in never touches the next session (%j)", async (body) => {
    setAuthToken("tok-A");
    setAuthToken(null); // signed out
    const reauth = jest.fn();
    setReauthHandler(reauth);
    let land!: () => void;
    adapter.mockImplementation(
      (config) =>
        new Promise((_res, rej) => {
          land = () => rej(new AxiosError("401", "ERR_BAD_REQUEST", config, null, { data: body, status: 401, statusText: "401", headers: {}, config }));
        }),
    );
    const orphan = post("/api/presence/heartbeat");
    await new Promise((r) => setTimeout(r, 0));
    setAuthToken("tok-B"); // B signs in while it is on the wire
    land();
    await expect(orphan).rejects.toMatchObject({ response: { status: 401 } });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(reauth).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("a cancelled re-sign-in rejects the original error", async () => {
    fail(401, SESSION_401);
    setReauthHandler(() => Promise.reject(new Error("cancelled")));
    await expect(post("/api/x")).rejects.toMatchObject({ response: { status: 401 } });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("a retry that 401s again is not saved: the unauthorized handler runs", async () => {
    fail(401, SESSION_401);
    const reauth = jest.fn(async () => "new-token");
    setReauthHandler(reauth);
    await expect(post("/api/x")).rejects.toMatchObject({ response: { status: 401 } });
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledWith("SESSION_EXPIRED", "Your shift ended");
  });

  it.each(["TOKEN_EXPIRED", "INVALID_TOKEN", undefined])("%s is not a session to save", async (code) => {
    fail(401, { code });
    const reauth = jest.fn();
    setReauthHandler(reauth);
    await expect(post("/api/x")).rejects.toBeTruthy();
    expect(reauth).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("a login 401 never asks", async () => {
    fail(401, SESSION_401);
    const reauth = jest.fn();
    setReauthHandler(reauth);
    await expect(post("/api/auth/loginUser")).rejects.toBeTruthy();
    expect(reauth).not.toHaveBeenCalled();
  });
});
