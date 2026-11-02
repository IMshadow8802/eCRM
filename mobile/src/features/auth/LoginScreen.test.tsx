import { AxiosError, type AxiosResponse } from "axios";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { login } from "../../api/authQueries";
import { fetchClientConfig } from "../../api/centralQueries";
import { getApiBaseUrl } from "../../api/client";
import { envelope } from "../../test/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";
import useAuthStore from "../../stores/useAuthStore";
import type { AuthUser, ClientConfig, LoginData } from "../../types/api";
import LoginScreen from "./LoginScreen";

jest.mock("../../api/authQueries");
jest.mock("../../api/centralQueries");

const CONFIG: ClientConfig = {
  baseURL: "https://shadowcodes.in/TestCRM",
  compCode: "TESTCRM",
  companyName: "Test CRM",
  logoURL: "https://shadowcodes.in/logo.png",
};

const LOGIN: LoginData = {
  token: "tok-1",
  user: { Id: 9, CompId: 3, BranchId: 4, FullName: "Asha", IsAdmin: false } as AuthUser,
  company: {} as LoginData["company"],
  permissions: { menuItems: [], rawPermissions: [], totalMenuItems: 0, hasAdminAccess: false },
  presenceNotice: true,
};

// What apiClient rejects with when the backend answers 401 INVALID_CREDENTIALS.
const invalidCredentials = () => {
  const data = { success: false, message: "Incorrect username or password", code: "INVALID_CREDENTIALS" };
  return new AxiosError("Request failed with status code 401", "ERR_BAD_REQUEST", undefined, null, {
    status: 401,
    data,
  } as AxiosResponse);
};

const state = () => useAuthStore.getState();
const configured = (cfg: ClientConfig = CONFIG) => useAuthStore.getState().setClientConfig(cfg);

const signIn = async (identifier = "asha") => {
  await fireEvent.changeText(screen.getByPlaceholderText("Enter username, email or mobile"), identifier);
  await fireEvent.changeText(screen.getByPlaceholderText("Enter password"), "fixture");
  await fireEvent.press(screen.getByText("Sign in"));
};

beforeEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true);
});

describe("step 1 — company code", () => {
  it("looks the code up at Central and moves to sign-in, showing the company", async () => {
    jest.mocked(fetchClientConfig).mockResolvedValue(CONFIG);
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByText("Which company?")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByPlaceholderText("e.g. PRD"), "testcrm");
    await fireEvent.press(screen.getByText("Continue"));
    expect(fetchClientConfig).toHaveBeenCalledWith("TESTCRM");
    expect(await screen.findByText("Sign in")).toBeOnTheScreen();
    expect(screen.getByText("Test CRM")).toBeOnTheScreen();
    expect(screen.getByLabelText("Test CRM")).toBeOnTheScreen(); // the tenant's logo
    expect(state()).toMatchObject({ API_BASE_URL: CONFIG.baseURL, isClientConfigured: true });
    expect(getApiBaseUrl()).toBe(CONFIG.baseURL);
  });

  it("an unknown code shows Central's message in the form and stays on step 1", async () => {
    jest.mocked(fetchClientConfig).mockRejectedValue(new Error("Company not found. Check the code."));
    await renderWithProviders(<LoginScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText("e.g. PRD"), "NOPE");
    await fireEvent.press(screen.getByText("Continue"));
    expect(await screen.findByText("Company not found. Check the code.")).toBeOnTheScreen();
    expect(state().isClientConfigured).toBe(false);
    // Typing again clears the error.
    await fireEvent.changeText(screen.getByPlaceholderText("e.g. PRD"), "PRD");
    expect(screen.queryByText("Company not found. Check the code.")).toBeNull();
  });

  it("a lookup failure without a message shows the connection fallback", async () => {
    jest.mocked(fetchClientConfig).mockRejectedValue({});
    await renderWithProviders(<LoginScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText("e.g. PRD"), "PRD");
    await fireEvent.press(screen.getByText("Continue"));
    expect(await screen.findByText(/Could not reach the server/)).toBeOnTheScreen();
  });

  it("an empty code asks for one without calling Central", async () => {
    await renderWithProviders(<LoginScreen />);
    await fireEvent.press(screen.getByText("Continue"));
    expect(screen.getByText("Enter your company code.")).toBeOnTheScreen();
    expect(fetchClientConfig).not.toHaveBeenCalled();
  });
});

describe("step 2 — credentials", () => {
  it("posts the identifier and password and opens the session", async () => {
    configured();
    jest.mocked(login).mockResolvedValue(envelope(LOGIN));
    await renderWithProviders(<LoginScreen />);
    await signIn("  asha  ");
    expect(login).toHaveBeenCalledWith({ identifier: "asha", password: "fixture" });
    expect(state()).toMatchObject({ isAuthenticated: true, token: "tok-1", UserId: 9, presenceNotice: true });
  });

  it("a wrong username or password shows the server's message in the form", async () => {
    configured();
    jest.mocked(login).mockRejectedValue(invalidCredentials());
    await renderWithProviders(<LoginScreen />);
    await signIn();
    expect(await screen.findByText("Incorrect username or password")).toBeOnTheScreen();
    expect(screen.getByText("Sign in")).toBeOnTheScreen();
    expect(state().isAuthenticated).toBe(false);
  });

  it("a network failure shows the connection fallback", async () => {
    configured();
    jest.mocked(login).mockRejectedValue(new Error("Network Error"));
    await renderWithProviders(<LoginScreen />);
    await signIn();
    expect(await screen.findByText(/Could not reach the server/)).toBeOnTheScreen();
  });

  it("an unsuccessful envelope shows its message, or a default", async () => {
    configured();
    jest.mocked(login).mockResolvedValueOnce(envelope(LOGIN, { success: false, message: "Account disabled" }));
    jest.mocked(login).mockResolvedValueOnce(envelope(LOGIN, { success: false, message: "" }));
    await renderWithProviders(<LoginScreen />);
    await signIn();
    expect(await screen.findByText("Account disabled")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Sign in"));
    expect(await screen.findByText("Login failed")).toBeOnTheScreen();
    expect(state().isAuthenticated).toBe(false);
  });

  it("asks for each missing field before calling the server, and typing clears the prompt", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    await fireEvent.press(screen.getByText("Sign in"));
    expect(screen.getByText("Enter your username, email or mobile.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByPlaceholderText("Enter username, email or mobile"), "asha");
    expect(screen.queryByText("Enter your username, email or mobile.")).toBeNull();
    await fireEvent.press(screen.getByText("Sign in"));
    expect(screen.getByText("Enter your password.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByPlaceholderText("Enter password"), "fixture");
    expect(screen.queryByText("Enter your password.")).toBeNull();
    expect(login).not.toHaveBeenCalled();
  });

  it("Switch company clears the company and goes back to step 1", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByText(/Not Test CRM\? Switch company/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Switch company"));
    expect(screen.getByText("Which company?")).toBeOnTheScreen();
    expect(state()).toMatchObject({ API_BASE_URL: null, compCode: null, isClientConfigured: false, isAuthenticated: false });
  });

  it("falls back to the code, then a generic title, when Central gave no name", async () => {
    configured({ ...CONFIG, companyName: null, logoURL: null });
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByText("TESTCRM")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Company logo")).toBeNull();
    await act(async () => useAuthStore.setState({ compCode: null }));
    expect(screen.getByText("Welcome back")).toBeOnTheScreen();
    expect(screen.getByText(/Not this company\? Switch company/)).toBeOnTheScreen();
  });

  it("a dead logo URL falls back to the generic mark", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    await fireEvent(screen.getByLabelText("Test CRM"), "error");
    expect(screen.queryByLabelText("Test CRM")).toBeNull();
    expect(screen.getByText("Test CRM")).toBeOnTheScreen();
  });
});

describe("why the last session ended", () => {
  it.each([
    ["SESSION_EXPIRED", "Your session ended at the end of your shift. Sign in again."],
    ["SESSION_FORCED", "An admin ended your session."],
    ["SESSION_ENDED", "Please sign in again."],
    ["SESSION_REQUIRED", "Please sign in again."],
  ])("%s reads: %s", async (code, wording) => {
    configured();
    useAuthStore.setState({ sessionEndedReason: code });
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByText(wording)).toBeOnTheScreen();
  });

  it("says nothing on a normal sign-in", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    expect(screen.queryByText(/sign in again/i)).toBeNull();
  });
});
