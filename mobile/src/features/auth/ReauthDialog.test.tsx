import { useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";

import { post } from "../../api/client";
import useAuthStore from "../../stores/useAuthStore";
import { loginData } from "../../test/fixtures";
import { renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { adapter } from "../../test/transport";
import { Button, Input, Text } from "../../ui";
import ReauthDialog from "./ReauthDialog";

// Dummy strings only — never a real password.
const GOOD = "pw";
const BAD = "nope";

const reply = (config: InternalAxiosRequestConfig, status: number, data: unknown) => {
  const response = { data, status, statusText: String(status), headers: {}, config };
  if (status === 200) return response;
  throw new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_REQUEST", config, null, response);
};

/** The server: saveTicket 401s until a re-sign-in mints tok-2; loginUser checks the dummy password. */
const server = (user = loginData().user) =>
  adapter.mockImplementation(async (config) => {
    if (config.url === "/api/auth/loginUser") {
      const { password } = JSON.parse(String(config.data));
      return password === GOOD
        ? reply(config, 200, { success: true, data: loginData({ token: "tok-2", user }) })
        : reply(config, 401, { success: false, message: "Invalid username or password" });
    }
    if (config.headers.Authorization === "Bearer tok-2") return reply(config, 200, { success: true, data: {} });
    return reply(config, 401, { code: "SESSION_EXPIRED", message: "Your shift session ended. Sign in again." });
  });

const calls = (url: string) => adapter.mock.calls.filter(([c]) => c.url === url);

/** A half-filled form whose save hits the API, the way a complaint form does. */
function Form() {
  const [title, setTitle] = useState("");
  const [result, setResult] = useState("");
  // Not returned: fireEvent awaits a handler's promise, and this one is parked on the dialog.
  const save = () => {
    void post("/api/tickets/saveTicket", { Title: title }).then(
      () => setResult("Saved"),
      () => setResult("Failed"),
    );
  };
  return (
    <>
      <Input label="Title" accessibilityLabel="Title" value={title} onChangeText={setTitle} />
      <Button title="Save" onPress={save} />
      <Text>{result}</Text>
    </>
  );
}

const mount = async () => {
  await renderWithProviders(
    <>
      <Form />
      <ReauthDialog />
    </>,
  );
  await fireEvent.changeText(screen.getByLabelText("Title"), "Printer jammed");
  await fireEvent.press(screen.getByText("Save"));
  await screen.findByText("Sign in again");
};

beforeEach(() => {
  seedAuth({ UserId: 9, user: { Username: "asha", FullName: "Asha" } });
  server();
});

afterEach(() => act(() => useAuthStore.getState().logout()));

it("a session 401 mid-form asks for the password over the screen and keeps what was typed", async () => {
  await mount();
  expect(screen.getByText("Your shift session ended. Sign in again.")).toBeOnTheScreen();
  expect(screen.getByText(/asha/)).toBeOnTheScreen();
  expect(screen.getByLabelText("Title").props.value).toBe("Printer jammed");
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
});

it("an empty password is refused locally; a wrong one shows the server's message and stays open", async () => {
  await mount();
  await fireEvent.press(screen.getByText("Sign in"));
  expect(screen.getByText("Enter your password.")).toBeOnTheScreen();
  expect(calls("/api/auth/loginUser")).toHaveLength(0);

  await fireEvent.changeText(screen.getByLabelText("Password"), BAD);
  await fireEvent.press(screen.getByText("Sign in"));
  expect(await screen.findByText("Invalid username or password")).toBeOnTheScreen();
  expect(screen.getByText("Sign in again")).toBeOnTheScreen();
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
});

it("the right password swaps the token and the parked save goes through once, form intact", async () => {
  await mount();
  await fireEvent.changeText(screen.getByLabelText("Password"), GOOD);
  await fireEvent.press(screen.getByText("Sign in"));
  expect(await screen.findByText("Saved")).toBeOnTheScreen();
  expect(screen.queryByText("Sign in again")).toBeNull();
  expect(screen.getByLabelText("Title").props.value).toBe("Printer jammed");
  expect(JSON.parse(String(calls("/api/auth/loginUser")[0]![0].data))).toMatchObject({ identifier: "asha", Device: "mobile" });
  const saves = calls("/api/tickets/saveTicket");
  expect(saves).toHaveLength(2);
  expect(JSON.parse(String(saves[1]![0].data))).toEqual({ Title: "Printer jammed" });
  expect(useAuthStore.getState().token).toBe("tok-2");
});

it("two requests in the same burst share one dialog and both retry after one sign-in", async () => {
  await mount();
  const second = post("/api/tasks/fetchTasks");
  await waitFor(() => expect(calls("/api/tasks/fetchTasks")).toHaveLength(1));
  expect(screen.getAllByText("Sign in again")).toHaveLength(1);
  await fireEvent.changeText(screen.getByLabelText("Password"), GOOD);
  await fireEvent.press(screen.getByText("Sign in"));
  await expect(second).resolves.toMatchObject({ success: true });
  expect(await screen.findByText("Saved")).toBeOnTheScreen();
  expect(calls("/api/auth/loginUser")).toHaveLength(1);
});

it("'Sign in as someone else' is a full logout and the save fails", async () => {
  await mount();
  await fireEvent.press(screen.getByText("Sign in as someone else"));
  expect(await screen.findByText("Failed")).toBeOnTheScreen();
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, token: null, reauth: null });
  expect(screen.queryByText("Sign in again")).toBeNull();
});

it("a different account's password does not inherit the screen: full logout", async () => {
  server({ ...loginData().user, Id: 42, Username: "ravi" });
  await mount();
  await fireEvent.changeText(screen.getByLabelText("Password"), GOOD);
  await fireEvent.press(screen.getByText("Sign in"));
  expect(await screen.findByText("Failed")).toBeOnTheScreen();
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
});

it("falls back to the login screen's wording when the server sends no message", async () => {
  adapter.mockImplementation(async (config) => reply(config, 401, { code: "SESSION_FORCED" }));
  await mount();
  expect(screen.getByText("An admin ended your session.")).toBeOnTheScreen();
});

it("a refused sign-in that answers 200 shows its message (or a fallback)", async () => {
  await mount();
  adapter.mockImplementation(async (config) => reply(config, 200, { success: false, message: "Your account is inactive" }));
  await fireEvent.changeText(screen.getByLabelText("Password"), GOOD);
  await fireEvent.press(screen.getByText("Sign in"));
  expect(await screen.findByText("Your account is inactive")).toBeOnTheScreen();
  adapter.mockImplementation(async (config) => reply(config, 200, { success: false }));
  await fireEvent.press(screen.getByText("Sign in"));
  expect(await screen.findByText("Login failed")).toBeOnTheScreen();
});

it("a network failure on sign-in says so and keeps the dialog", async () => {
  await mount();
  adapter.mockImplementation(async (config) => {
    throw new AxiosError("Network Error", "ERR_NETWORK", config);
  });
  await fireEvent.changeText(screen.getByLabelText("Password"), GOOD);
  await fireEvent.press(screen.getByText("Sign in"));
  expect(await screen.findByText(/Could not reach the server/)).toBeOnTheScreen();
  expect(screen.getByText("Sign in again")).toBeOnTheScreen();
});
