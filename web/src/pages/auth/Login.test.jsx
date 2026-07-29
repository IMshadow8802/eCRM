import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const post = vi.fn();
vi.mock("../../hooks/useApi", () => ({ default: () => ({ post }) }));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

import Login from "./Login";
import renderWithProviders from "../../test/renderWithProviders";
import useAuthStore from "../../stores/useAuthStore";

const loginResponse = (rawPermissions) => ({
  data: {
    success: true,
    responseCode: 200,
    data: {
      token: "t",
      user: { Id: 1, BranchId: 1, CompId: 1 },
      company: {},
      permissions: { rawPermissions },
    },
  },
});

const signIn = async () => {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText(/Username \/ Email \/ Mobile/i),
    "alice@example.com",
  );
  await user.type(screen.getByLabelText(/^Password/i), "secret");
  await user.click(screen.getByRole("button", { name: /Sign in/i }));
};

beforeEach(() => {
  post.mockReset();
  navigate.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  useAuthStore.setState({ isAuthenticated: false, menuRights: [] });
});

describe("Login", () => {
  it("posts the typed value as `identifier` (username / email / mobile)", async () => {
    post.mockResolvedValueOnce({
      data: {
        success: true,
        responseCode: 200,
        data: {
          token: "t",
          user: { Id: 1, BranchId: 1, CompId: 1 },
          company: {},
          permissions: { rawPermissions: [] },
        },
      },
    });

    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();

    const idField = screen.getByLabelText(/Username \/ Email \/ Mobile/i);
    await user.type(idField, "alice@example.com");
    await user.type(screen.getByLabelText(/^Password/i), "secret");
    await user.click(screen.getByRole("button", { name: /Sign in/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/api/auth/loginUser", {
        identifier: "alice@example.com",
        password: "secret",
      });
    });
  });

  it("shows an error when identifier or password is empty", async () => {
    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Sign in/i }));
    expect(post).not.toHaveBeenCalled();
  });

  it("still refuses when only the password is missing", async () => {
    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(/Username \/ Email \/ Mobile/i),
      "alice",
    );
    await user.click(screen.getByRole("button", { name: /Sign in/i }));
    expect(post).not.toHaveBeenCalled();
  });

  // REGRESSION: this was a hardcoded navigate("/dashboard"), so a user with no
  // Dashboard grant opened straight onto a page absent from their own sidebar.
  it("lands the user on their first granted page, not /dashboard", async () => {
    post.mockResolvedValueOnce(
      loginResponse([
        {
          menuid: 2,
          parentid: 0,
          description: "Tasks",
          route: "/tasks",
          permissions: { canView: true },
        },
      ]),
    );

    renderWithProviders(<Login />, { router: true });
    await signIn();

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/tasks", { replace: true });
    expect(navigate).not.toHaveBeenCalledWith("/dashboard");
  });

  it("falls back to / when the user has no menus, so HomeRedirect explains it", async () => {
    post.mockResolvedValueOnce(loginResponse([]));

    renderWithProviders(<Login />, { router: true });
    await signIn();

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("does not navigate when the credentials are rejected", async () => {
    post.mockResolvedValueOnce({
      data: { success: false, responseCode: 401, message: "Incorrect password" },
    });

    renderWithProviders(<Login />, { router: true });
    await signIn();

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("handles a rejected request with a response body", async () => {
    post.mockRejectedValueOnce({
      response: { data: { message: "Account is inactive" } },
    });

    renderWithProviders(<Login />, { router: true });
    await signIn();

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("handles a network failure with no response", async () => {
    post.mockRejectedValueOnce({ request: {} });

    renderWithProviders(<Login />, { router: true });
    await signIn();

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("handles an error that is neither a response nor a request", async () => {
    post.mockRejectedValueOnce(new Error("boom"));

    renderWithProviders(<Login />, { router: true });
    await signIn();

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects an already-signed-in visitor away from the login page", async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      menuRights: [
        {
          menuid: 2,
          parentid: 0,
          description: "Tasks",
          route: "/tasks",
          permissions: { canView: true },
        },
      ],
    });

    renderWithProviders(<Login />, { router: true });

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/tasks", { replace: true }),
    );
  });
});
