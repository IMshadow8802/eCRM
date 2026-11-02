import { AxiosError, type AxiosResponse } from "axios";
import { act, fireEvent, screen } from "@testing-library/react-native";
import Constants from "expo-constants";

import { login } from "../../api/authQueries";
import { fetchClientConfig } from "../../api/centralQueries";
import { getApiBaseUrl } from "../../api/client";
import { envelope, loginData } from "../../test/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";
import useAuthStore from "../../stores/useAuthStore";
import type { ClientConfig } from "../../types/api";
import LoginScreen from "./LoginScreen";

jest.mock("../../api/authQueries");
jest.mock("../../api/centralQueries");
// The build's version: jest has no native manifest, so pin one (see appVersion.ts).
const mockExpo: { config: Partial<NonNullable<typeof Constants.expoConfig>> | null } = { config: null };
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  return {
    ...actual,
    __esModule: true,
    default: new Proxy(actual.default, {
      get: (target, key) => (key === "expoConfig" ? mockExpo.config : Reflect.get(target, key)),
    }),
  };
});

const CONFIG: ClientConfig = {
  baseURL: "https://shadowcodes.in/TestCRM",
  compCode: "TESTCRM",
  companyName: "Test CRM",
  logoURL: "https://shadowcodes.in/logo.png",
};

/** What apiClient rejects with when the backend answers a failed login (authController.loginUser). */
const loginFailure = (status: number, code: string, message: string) =>
  new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_REQUEST", undefined, null, {
    status,
    data: { success: false, message, code },
  } as AxiosResponse);

const state = () => useAuthStore.getState();
const configured = (cfg: ClientConfig = CONFIG) => useAuthStore.getState().setClientConfig(cfg);

const signIn = async (identifier = "asha") => {
  await fireEvent.changeText(screen.getByLabelText("Username"), identifier);
  await fireEvent.changeText(screen.getByLabelText("Password"), "fixture");
  await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
};

beforeEach(() => {
  mockExpo.config = { version: "1.0.1", android: { versionCode: 20261102 }, ios: { buildNumber: "20261102" } };
  useAuthStore.setState(useAuthStore.getInitialState(), true);
});

describe("01 — company code", () => {
  it("shows E's copy and the build's version", async () => {
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByText("Nexus CRM")).toBeOnTheScreen();
    expect(screen.getByText("Tasks, complaints and leads for your whole team, in one place.")).toBeOnTheScreen();
    expect(screen.getByText("Enter your company code")).toBeOnTheScreen();
    expect(screen.getByText("Your admin gives you this code. You only enter it once on this phone.")).toBeOnTheScreen();
    expect(screen.getByText("Company code")).toBeOnTheScreen();
    expect(screen.getByText("Not case-sensitive. Example: TestCRM")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Continue" })).toBeOnTheScreen();
    expect(screen.getByText("Nexus CRM · v1.0.1")).toBeOnTheScreen();
  });

  it("looks the code up at Central and moves to sign-in, showing the company", async () => {
    jest.mocked(fetchClientConfig).mockResolvedValue(CONFIG);
    await renderWithProviders(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText("Company code"), " TestCRM ");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    // Typed as the user typed it; Central's fetcher upper-cases.
    expect(fetchClientConfig).toHaveBeenCalledWith("TestCRM");
    expect(await screen.findByText("Use the username your admin set up for you.")).toBeOnTheScreen();
    expect(screen.getByText("Test CRM")).toBeOnTheScreen();
    expect(screen.getByText("Company code TESTCRM")).toBeOnTheScreen();
    expect(screen.getByLabelText("Test CRM")).toBeOnTheScreen(); // the tenant's logo
    expect(state()).toMatchObject({ API_BASE_URL: CONFIG.baseURL, isClientConfigured: true });
    expect(getApiBaseUrl()).toBe(CONFIG.baseURL);
  });

  it("an unknown code shows Central's message in the form and stays on step 1", async () => {
    jest.mocked(fetchClientConfig).mockRejectedValue(new Error("Company not found. Check the code."));
    await renderWithProviders(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText("Company code"), "NOPE");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Company not found. Check the code.")).toBeOnTheScreen();
    expect(screen.getByTestId("auth-error")).toBeOnTheScreen();
    expect(state().isClientConfigured).toBe(false);
    // Typing again clears the error.
    await fireEvent.changeText(screen.getByLabelText("Company code"), "PRD");
    expect(screen.queryByTestId("auth-error")).toBeNull();
  });

  it("a lookup failure without a message shows the connection fallback", async () => {
    jest.mocked(fetchClientConfig).mockRejectedValue({});
    await renderWithProviders(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText("Company code"), "PRD");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Could not reach the server")).toBeOnTheScreen();
    expect(screen.getByText("Check your connection and try again.")).toBeOnTheScreen();
  });

  it("an empty code asks for one on the field, without calling Central", async () => {
    await renderWithProviders(<LoginScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Enter your company code.")).toBeOnTheScreen();
    expect(fetchClientConfig).not.toHaveBeenCalled();
  });
});

describe("02 — sign in", () => {
  it("shows E's copy", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByText("Test CRM")).toBeOnTheScreen();
    expect(screen.getByText("Company code TESTCRM")).toBeOnTheScreen();
    expect(screen.getByText("Use the username your admin set up for you.")).toBeOnTheScreen();
    expect(screen.getByText("Username")).toBeOnTheScreen();
    expect(screen.getByText("Password")).toBeOnTheScreen();
    expect(screen.getByText("Switch company")).toBeOnTheScreen();
    expect(screen.getByText(/^Not Test CRM\?/)).toBeOnTheScreen();
    expect(screen.getByText("Nexus CRM · v1.0.1")).toBeOnTheScreen();
  });

  it("posts the identifier and password and opens the session", async () => {
    configured();
    jest.mocked(login).mockResolvedValue(envelope(loginData({ presenceNotice: true })));
    await renderWithProviders(<LoginScreen />);
    await signIn("  asha  ");
    expect(login).toHaveBeenCalledWith({ identifier: "asha", password: "fixture" });
    expect(state()).toMatchObject({ isAuthenticated: true, token: "tok-1", UserId: 9, presenceNotice: true });
  });

  it("the password is masked until the eye is tapped", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByLabelText("Password")).toHaveProp("secureTextEntry", true);
    await fireEvent.press(screen.getByLabelText("Show password"));
    expect(screen.getByLabelText("Password")).toHaveProp("secureTextEntry", false);
    await fireEvent.press(screen.getByLabelText("Hide password"));
    expect(screen.getByLabelText("Password")).toHaveProp("secureTextEntry", true);
  });

  it("asks for each missing field on that field before calling the server, and typing clears it", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your username, email or mobile.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Username"), "asha");
    expect(screen.queryByText("Enter your username, email or mobile.")).toBeNull();
    await fireEvent(screen.getByLabelText("Password"), "submitEditing");
    expect(screen.getByText("Enter your password.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Password"), "fixture");
    expect(screen.queryByText("Enter your password.")).toBeNull();
    expect(login).not.toHaveBeenCalled();
  });

  it("Switch company clears the company and goes back to step 1", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    await fireEvent.press(screen.getByLabelText("Switch company"));
    expect(screen.getByText("Enter your company code")).toBeOnTheScreen();
    expect(state()).toMatchObject({ API_BASE_URL: null, compCode: null, isClientConfigured: false, isAuthenticated: false });
  });

  it("falls back to the code, then a generic title, when Central gave no name", async () => {
    configured({ ...CONFIG, companyName: null, logoURL: null });
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByText("TESTCRM")).toBeOnTheScreen();
    expect(screen.getByTestId("tenant-placeholder")).toBeOnTheScreen();
    await act(async () => useAuthStore.setState({ compCode: null }));
    expect(screen.getByText("Welcome back")).toBeOnTheScreen();
    expect(screen.queryByText(/^Company code /)).toBeNull();
    expect(screen.getByText(/^Not this company\?/)).toBeOnTheScreen();
  });

  it("a dead logo URL falls back to the placeholder badge", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    await fireEvent(screen.getByLabelText("Test CRM"), "error");
    expect(screen.queryByLabelText("Test CRM")).toBeNull();
    expect(screen.getByTestId("tenant-placeholder")).toBeOnTheScreen();
  });
});

describe("03 — sign-in error, in the form", () => {
  it("INVALID_CREDENTIALS reads as E's title and body, with no session", async () => {
    configured();
    jest.mocked(login).mockRejectedValue(loginFailure(401, "INVALID_CREDENTIALS", "Incorrect username or password"));
    await renderWithProviders(<LoginScreen />);
    await signIn();
    expect(await screen.findByText("Wrong username or password")).toBeOnTheScreen();
    expect(screen.getByText("Check both and try again. Your admin can reset the password.")).toBeOnTheScreen();
    // The box replaces the sub line.
    expect(screen.queryByText("Use the username your admin set up for you.")).toBeNull();
    expect(state().isAuthenticated).toBe(false);
    // Typing again clears it.
    await fireEvent.changeText(screen.getByLabelText("Password"), "other");
    expect(screen.queryByText("Wrong username or password")).toBeNull();
  });

  it.each([
    ["USER_INACTIVE", 403, "Your account is inactive. Contact your admin."],
    ["LOGIN_ERROR", 500, "Login failed due to server error"],
    ["VALIDATION_ERROR", 400, "Username and password are required"],
  ])("%s keeps the server's own text in the same box", async (code, status, message) => {
    configured();
    jest.mocked(login).mockRejectedValue(loginFailure(status, code, message));
    await renderWithProviders(<LoginScreen />);
    await signIn();
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.getByTestId("auth-error")).toHaveTextContent(message);
  });

  it("a network failure shows the connection fallback", async () => {
    configured();
    jest.mocked(login).mockRejectedValue(new Error("Network Error"));
    await renderWithProviders(<LoginScreen />);
    await signIn();
    expect(await screen.findByText("Could not reach the server")).toBeOnTheScreen();
  });

  it("an unsuccessful envelope shows its message, or a default", async () => {
    configured();
    jest.mocked(login).mockResolvedValueOnce(envelope(loginData(), { success: false, message: "Account disabled" }));
    jest.mocked(login).mockResolvedValueOnce(envelope(loginData(), { success: false, message: "" }));
    await renderWithProviders(<LoginScreen />);
    await signIn();
    expect(await screen.findByText("Account disabled")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Login failed")).toBeOnTheScreen();
    expect(state().isAuthenticated).toBe(false);
  });
});

describe("why the last session ended", () => {
  it.each([
    ["SESSION_EXPIRED", "Your session ended at the end of your shift. Sign in again."],
    ["SESSION_FORCED", "An admin ended your session."],
    ["SESSION_ENDED", "Please sign in again."],
    ["SESSION_REQUIRED", "Please sign in again."],
  ])("%s without a server message falls back to: %s", async (code, wording) => {
    configured();
    useAuthStore.setState({ sessionEndedReason: code });
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByText(wording)).toBeOnTheScreen();
  });

  // The wording backend/src/utils/responseHelper.js sends with each 401 code.
  it.each([
    ["SESSION_REQUIRED", "Please sign in again"],
    ["SESSION_EXPIRED", "Your session ended at the end of your shift. Sign in again to continue."],
    ["SESSION_FORCED", "An admin ended your session. Sign in again to continue."],
    ["SESSION_ENDED", "You signed out. Sign in again to continue."],
    ["TOKEN_EXPIRED", "Token has expired - please login again"],
    ["INVALID_TOKEN", "Invalid token - please login again"],
  ])("%s shows the server's message", async (code, message) => {
    configured();
    useAuthStore.setState({ sessionEndedReason: code, sessionEndedMessage: message });
    await renderWithProviders(<LoginScreen />);
    expect(screen.getByText(message)).toBeOnTheScreen();
  });

  it("says nothing on a normal sign-in", async () => {
    configured();
    await renderWithProviders(<LoginScreen />);
    expect(screen.queryByText(/sign in again/i)).toBeNull();
  });
});
