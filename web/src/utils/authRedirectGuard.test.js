import { describe, it, expect } from "vitest";
import { shouldSkipAuthRedirect } from "./authRedirectGuard";

describe("shouldSkipAuthRedirect", () => {
  it("returns true for the login endpoint (relative)", () => {
    expect(shouldSkipAuthRedirect("/api/auth/loginUser")).toBe(true);
  });

  it("returns true for the login endpoint with a base URL prefix", () => {
    expect(
      shouldSkipAuthRedirect("https://prdinfotech.in/CRM/api/auth/loginUser"),
    ).toBe(true);
  });

  it("returns true for the logout endpoint", () => {
    expect(shouldSkipAuthRedirect("/api/auth/logoutUser")).toBe(true);
  });

  it("returns true for the hashPassword endpoint", () => {
    expect(shouldSkipAuthRedirect("/api/auth/hashPassword")).toBe(true);
  });

  it("returns false for protected endpoints — a 401 there means session died", () => {
    expect(shouldSkipAuthRedirect("/api/reports/getDashboard")).toBe(false);
    expect(shouldSkipAuthRedirect("/api/tasks/fetchTasks")).toBe(false);
    expect(shouldSkipAuthRedirect("/api/users/fetchUsers")).toBe(false);
  });

  it("returns false for null/undefined/non-string input", () => {
    expect(shouldSkipAuthRedirect(null)).toBe(false);
    expect(shouldSkipAuthRedirect(undefined)).toBe(false);
    expect(shouldSkipAuthRedirect(123)).toBe(false);
    expect(shouldSkipAuthRedirect("")).toBe(false);
  });

  it("does not match a suffix-collision URL", () => {
    expect(shouldSkipAuthRedirect("/api/foo/loginUserSomething")).toBe(false);
  });
});
