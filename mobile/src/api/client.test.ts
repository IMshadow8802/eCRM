import { fail, lastRequest, respond } from "../test/transport";
import {
  getApiBaseUrl,
  getAuthToken,
  post,
  postData,
  setApiBaseUrl,
  setAuthToken,
  setUnauthorizedHandler,
  shouldSkipAuthRedirect,
} from "./client";

const onUnauthorized = jest.fn();

beforeEach(() => {
  setAuthToken(null);
  setApiBaseUrl(null);
  setUnauthorizedHandler(onUnauthorized);
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
