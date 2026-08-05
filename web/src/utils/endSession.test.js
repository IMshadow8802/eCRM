import { describe, it, expect, beforeEach, vi } from "vitest";

const enqueueSnackbar = vi.fn();
vi.mock("notistack", () => ({ enqueueSnackbar: (...a) => enqueueSnackbar(...a) }));

const redirectToLogin = vi.fn();
vi.mock("./redirectToLogin", () => ({
  redirectToLogin: (...a) => redirectToLogin(...a),
  getLoginUrl: () => "/login",
}));

import {
  endSession,
  isEndingSession,
  resetEndSessionForTests,
} from "./endSession";
import useAuthStore from "../stores/useAuthStore";

beforeEach(() => {
  resetEndSessionForTests();
  enqueueSnackbar.mockClear();
  redirectToLogin.mockClear();
  useAuthStore.setState({ isAuthenticated: true, token: "t", user: { Id: 1 } });
  localStorage.setItem("userData", JSON.stringify({ token: "t" }));
});

describe("endSession", () => {
  it("clears the store, warns the user, and redirects", () => {
    expect(endSession("test")).toBe(true);

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(localStorage.getItem("userData")).toBeNull();
    expect(redirectToLogin).toHaveBeenCalledOnce();
    expect(enqueueSnackbar).toHaveBeenCalledOnce();
  });

  /**
   * THE regression. Waking a laptop refetches every mounted query at once, and
   * each rejection used to run the full logout + redirect. Reassigning
   * location.href restarts the pending navigation, so the burst kept resetting
   * the navigation that was about to land — the page churned until it was
   * reloaded by hand. Twenty callers, one teardown.
   */
  it("runs once however many callers pile in", () => {
    const results = Array.from({ length: 20 }, (_, i) => endSession(`caller ${i}`));

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[0]).toBe(true);
    expect(redirectToLogin).toHaveBeenCalledOnce();
    // One snackbar too — twenty stacked toasts was part of the "glitching".
    expect(enqueueSnackbar).toHaveBeenCalledOnce();
  });

  it("reports that a teardown is under way", () => {
    expect(isEndingSession()).toBe(false);
    endSession("first");
    expect(isEndingSession()).toBe(true);
  });

  it("stays latched after the first call", () => {
    endSession("first");
    expect(endSession("second")).toBe(false);
    // Deliberately never self-resets: a hard redirect is replacing the
    // document, and everything still running should keep quiet until it does.
    expect(isEndingSession()).toBe(true);
  });
});
