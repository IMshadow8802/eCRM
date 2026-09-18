import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const post = vi.fn();
vi.mock("../../utils/axiosConfig", () => ({
  apiClient: { post: (...args) => post(...args) },
}));

const fetchClientConfig = vi.fn();
vi.mock("../../api/centralQueries", () => ({
  fetchClientConfig: (...a) => fetchClientConfig(...a),
}));

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

const BOUND = {
  isClientConfigured: true,
  API_BASE_URL: "https://shadowcodes.in/CRM",
  companyName: "PRD Infotech",
  compCode: "PRD",
  logoURL: null,
};
const UNBOUND = {
  isClientConfigured: false,
  API_BASE_URL: null,
  companyName: null,
  compCode: null,
  logoURL: null,
};

beforeEach(() => {
  post.mockReset();
  navigate.mockReset();
  fetchClientConfig.mockReset();
  useAuthStore.setState(BOUND);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  useAuthStore.setState({ isAuthenticated: false, menuRights: [], ...UNBOUND });
});

describe("Login — company code step", () => {
  beforeEach(() => useAuthStore.setState(UNBOUND));

  it("asks for the company code first; the credentials form is not there yet", () => {
    renderWithProviders(<Login />, { router: true });
    expect(screen.getByLabelText(/Company code/i)).toHaveFocus();
    expect(screen.queryByLabelText(/Username \/ Email \/ Mobile/i)).toBeNull();
  });

  it("an empty code is refused without asking Central", async () => {
    renderWithProviders(<Login />, { router: true });
    await userEvent.setup().click(screen.getByRole("button", { name: /Continue/i }));
    expect(fetchClientConfig).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Company code/i)).toBeInTheDocument();
  });

  it("a valid code binds the company and reveals the credentials form", async () => {
    fetchClientConfig.mockResolvedValueOnce({
      baseURL: "https://shadowcodes.in/Client2",
      compCode: "C2",
      companyName: "Client Two",
      logoURL: null,
    });
    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Company code/i), "c2");
    await user.click(screen.getByRole("button", { name: /Continue/i }));

    expect(fetchClientConfig).toHaveBeenCalledWith("C2");
    expect(await screen.findByLabelText(/Username \/ Email \/ Mobile/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("company-chip")).getByText("Client Two")).toBeInTheDocument();
    expect(useAuthStore.getState().API_BASE_URL).toBe("https://shadowcodes.in/Client2");
    expect(useAuthStore.getState().isClientConfigured).toBe(true);
  });

  it("shows the lookup error and stays on the code step", async () => {
    fetchClientConfig.mockRejectedValueOnce(
      Object.assign(new Error("Company not found. Check the code."), { kind: "not_found" }),
    );
    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Company code/i), "NOPE");
    await user.click(screen.getByRole("button", { name: /Continue/i }));

    expect(await screen.findByText(/Company not found/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Company code/i)).toBeInTheDocument();
    expect(useAuthStore.getState().isClientConfigured).toBe(false);
  });

  it("Switch company forgets the binding and returns to the code step", async () => {
    useAuthStore.setState(BOUND);
    renderWithProviders(<Login />, { router: true });
    expect(within(screen.getByTestId("company-chip")).getByText("PRD Infotech")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Switch company/i }));
    expect(screen.getByLabelText(/Company code/i)).toBeInTheDocument();
    expect(useAuthStore.getState().isClientConfigured).toBe(false);
    expect(useAuthStore.getState().API_BASE_URL).toBeNull();
  });
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

  /**
   * Keyboard path. These are regressions for a form that could only be driven
   * with the mouse or Tab.
   *
   * The Enter one is the important one. This is a plain <form> with two text
   * inputs and a submit button, so the browser's implicit submission fired on
   * Enter ANYWHERE in it — pressing Enter after typing a username submitted
   * with an empty password, and because the form is noValidate the browser
   * skipped `required` and handleSubmit answered with an error toast. Typing a
   * username and pressing Enter is the single most common way to fill a login
   * form, and it produced an error.
   */
  it("focuses the username field on arrival", () => {
    renderWithProviders(<Login />, { router: true });
    expect(screen.getByLabelText(/Username \/ Email \/ Mobile/i)).toHaveFocus();
  });

  it("moves Enter from the username to the password instead of submitting", async () => {
    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/Username \/ Email \/ Mobile/i),
      "alice@example.com{Enter}",
    );

    expect(screen.getByLabelText(/^Password/i)).toHaveFocus();
    // The whole point: no request, and no "enter your username and password".
    expect(post).not.toHaveBeenCalled();
  });

  it("submits on Enter from the password field", async () => {
    post.mockResolvedValue(loginResponse([]));
    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/Username \/ Email \/ Mobile/i),
      "alice@example.com{Enter}",
    );
    await user.type(screen.getByLabelText(/^Password/i), "secret{Enter}");

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
  });

  it("reveals and re-hides the password", async () => {
    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();
    const field = screen.getByLabelText(/^Password/i);
    expect(field).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /Show password/i }));
    expect(field).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: /Hide password/i }));
    expect(field).toHaveAttribute("type", "password");
  });

  // fireEvent, not userEvent: ui/Checkbox hides the native input behind its own
  // box, so a pointer interaction lands on an element with pointer-events: none.
  it("lets Remember me be turned off", () => {
    renderWithProviders(<Login />, { router: true });
    const box = screen.getByLabelText(/Remember me/i);
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
  });

  /**
   * Errors live in the form, not in a toast.
   *
   * notistack snackbars auto-dismiss. On a login page that is exactly wrong:
   * this is the one screen a user cannot navigate away from when they are
   * stuck, and the reason has to stay readable while they retype. These tests
   * assert the message is still in the document after the request settles,
   * which a snackbar would not guarantee.
   */
  describe("failure messages stay on the screen", () => {
    it("keeps a rejected credential message in the form", async () => {
      post.mockResolvedValueOnce({
        data: { success: false, responseCode: 401, message: "Incorrect password" },
      });

      renderWithProviders(<Login />, { router: true });
      await signIn();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Incorrect password");
    });

    it("explains an empty form rather than failing silently", async () => {
      renderWithProviders(<Login />, { router: true });
      await userEvent.setup().click(screen.getByRole("button", { name: /Sign in/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /username\/email\/mobile and password/i,
      );
      expect(post).not.toHaveBeenCalled();
    });

    it("clears the message as soon as the user starts fixing it", async () => {
      renderWithProviders(<Login />, { router: true });
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Sign in/i }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await user.type(screen.getByLabelText(/Username \/ Email \/ Mobile/i), "a");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("names a network failure as one, so nobody retypes a correct password", async () => {
      post.mockRejectedValueOnce({ request: {} });

      renderWithProviders(<Login />, { router: true });
      await signIn();

      expect(await screen.findByRole("alert")).toHaveTextContent(/Network error/i);
    });

    it("falls back to a plain message when the error is neither", async () => {
      post.mockRejectedValueOnce(new Error("boom"));

      renderWithProviders(<Login />, { router: true });
      await signIn();

      expect(await screen.findByRole("alert")).toHaveTextContent(/Error logging in/i);
    });
  });

  it("still refuses to submit when the password is empty", async () => {
    // Tab past the password rather than Enter — the guard must survive the
    // Enter change, since Enter no longer reaches submit from the username.
    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/Username \/ Email \/ Mobile/i),
      "alice@example.com",
    );
    await user.click(screen.getByRole("button", { name: /Sign in/i }));

    expect(post).not.toHaveBeenCalled();
  });
});
