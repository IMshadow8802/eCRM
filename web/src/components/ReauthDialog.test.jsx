import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

const redirectToLogin = vi.fn();
vi.mock("../utils/redirectToLogin", () => ({
  redirectToLogin: (...a) => redirectToLogin(...a),
  getLoginUrl: () => "/login",
}));

import { server } from "../test/mocks/server";
import renderWithProviders from "../test/renderWithProviders";
import useAuthStore from "../stores/useAuthStore";
import { requestReauth, resetReauthForTests } from "../utils/reauth";
import { resetEndSessionForTests } from "../utils/endSession";
import ReauthDialog from "./ReauthDialog";

const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "");
const jwt = (s) => `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + s })}.sig`;

let loginBody;
const loginReplies = (data, status = 200) =>
  server.use(
    http.post("*/api/auth/loginUser", async ({ request }) => {
      loginBody = await request.json();
      return status === 200
        ? HttpResponse.json({ success: true, message: "ok", responseCode: 200, data })
        : HttpResponse.json({ success: false, message: "Invalid credentials", responseCode: status }, { status });
    }),
  );

const ALICE = { Id: 7, Username: "alice", CompId: 1, BranchId: 1 };

// The page beneath: a half-filled form the dialog must not destroy.
const Page = () => (
  <>
    <input aria-label="Draft note" />
    <ReauthDialog />
  </>
);

beforeEach(() => {
  resetReauthForTests();
  resetEndSessionForTests();
  redirectToLogin.mockClear();
  loginBody = null;
  useAuthStore.setState({
    isAuthenticated: true, token: jwt(3600), user: ALICE, UserId: 7, reauth: null, presenceNotice: false,
  });
});

const open = (code) => {
  let p;
  act(() => {
    p = requestReauth(code);
  });
  return p;
};

describe("ReauthDialog", () => {
  it.each([
    ["SESSION_EXPIRED", "Your shift session ended"],
    ["SESSION_FORCED", "An admin ended your session"],
    ["SESSION_ENDED", "Please sign in again"],
    ["SESSION_REQUIRED", "Please sign in again"],
  ])("titles %s as %s", (code, title) => {
    renderWithProviders(<Page />);
    open(code);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("alice");
  });

  it("renders nothing while no re-sign-in is open", () => {
    renderWithProviders(<Page />);
    expect(screen.queryByTestId("reauth-dialog")).not.toBeInTheDocument();
  });

  it("signs back in over the page: the draft beneath survives and the waiters get the token", async () => {
    const fresh = jwt(7200);
    loginReplies({ token: fresh, user: ALICE, company: {}, permissions: {}, presenceNotice: false });
    const user = userEvent.setup();
    renderWithProviders(<Page />);
    await user.type(screen.getByLabelText("Draft note"), "half a thought");

    const waiting = open("SESSION_EXPIRED");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await expect(waiting).resolves.toBe(fresh);
    expect(loginBody).toEqual({ identifier: "alice", password: "pw", Device: "web" });
    expect(useAuthStore.getState().token).toBe(fresh);
    await waitFor(() => expect(screen.queryByTestId("reauth-dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Draft note")).toHaveValue("half a thought");
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it("keeps a wrong password inside the dialog", async () => {
    loginReplies(null, 401);
    const user = userEvent.setup();
    renderWithProviders(<Page />);
    open("SESSION_FORCED");
    await user.type(screen.getByLabelText("Password"), "nope");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(useAuthStore.getState().reauth).not.toBeNull();
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it("asks for a password before calling the server", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Page />);
    open("SESSION_EXPIRED");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(loginBody).toBeNull();
  });

  it("shows the server's message when sign-in does not succeed", async () => {
    server.use(
      http.post("*/api/auth/loginUser", () =>
        HttpResponse.json({ success: false, message: "Account locked", responseCode: 200 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<Page />);
    open("SESSION_EXPIRED");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Account locked")).toBeInTheDocument();
  });

  it("a different person signing in logs out fully instead of inheriting the page", async () => {
    loginReplies({ token: jwt(7200), user: { ...ALICE, Id: 99, Username: "bob" } });
    const user = userEvent.setup();
    renderWithProviders(<Page />);
    const waiting = open("SESSION_EXPIRED");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await expect(waiting).rejects.toThrow("Re-sign-in cancelled");
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(redirectToLogin).toHaveBeenCalledOnce();
  });

  it("'Sign in as someone else' cancels and goes to the login page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Page />);
    const waiting = open("SESSION_ENDED");
    await user.click(screen.getByRole("button", { name: "Sign in as someone else" }));
    await expect(waiting).rejects.toThrow();
    expect(redirectToLogin).toHaveBeenCalledOnce();
  });

  // Guards the behaviour, whatever the mechanism: neither Escape, the
  // backdrop, nor a header close button may settle the waiting requests.
  // Wiring `onClose={cancelReauth}` (or any onClose) with the dismiss flags
  // removed fails here — the promise would reject and the dialog would close.
  it("cannot be dismissed: Escape and backdrop leave it open and the waiters pending", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Page />);
    let settled = false;
    open("SESSION_EXPIRED").then(
      () => (settled = true),
      () => (settled = true),
    );
    expect(screen.queryByTestId("modal-close")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("reauth-dialog-backdrop"));
    await act(async () => {});

    expect(screen.getByTestId("reauth-dialog")).toBeInTheDocument();
    expect(useAuthStore.getState().reauth).not.toBeNull();
    expect(settled).toBe(false);
    expect(redirectToLogin).not.toHaveBeenCalled();
  });
});
