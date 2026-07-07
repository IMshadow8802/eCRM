import { describe, it, expect, afterEach, vi } from "vitest";
import { getLoginUrl, redirectToLogin } from "./redirectToLogin";

const originalBase = import.meta.env.BASE_URL;

afterEach(() => {
  import.meta.env.BASE_URL = originalBase;
  vi.restoreAllMocks();
});

describe("getLoginUrl", () => {
  it("prefixes BASE_URL when configured", () => {
    import.meta.env.BASE_URL = "/CRM/";
    expect(getLoginUrl()).toBe("/CRM/login");
  });

  it("collapses trailing slashes so no double slash leaks", () => {
    import.meta.env.BASE_URL = "/CRM///";
    expect(getLoginUrl()).toBe("/CRM/login");
  });

  it("falls back to root base when BASE_URL is empty", () => {
    import.meta.env.BASE_URL = "";
    expect(getLoginUrl()).toBe("/login");
  });

  it("returns /login when BASE_URL is root '/'", () => {
    import.meta.env.BASE_URL = "/";
    expect(getLoginUrl()).toBe("/login");
  });
});

describe("redirectToLogin", () => {
  it("sets window.location.href to the resolved login URL", () => {
    import.meta.env.BASE_URL = "/CRM/";
    const setter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get href() {
          return "";
        },
        set href(v) {
          setter(v);
        },
      },
    });
    redirectToLogin();
    expect(setter).toHaveBeenCalledWith("/CRM/login");
  });
});
