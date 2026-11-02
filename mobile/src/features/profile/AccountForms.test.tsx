import { createRef, useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { changeMyPassword } from "../../api/userQueries";
import useAuthStore from "../../stores/useAuthStore";
import { envelope, serverError } from "../../test/fixtures";
import { fail, lastRequest } from "../../test/transport";
import { renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { spySheets } from "../../test/sheets";
import type { SheetRef } from "../../ui";
import { AvatarPicker, ChangePasswordSheet, parsePreset, presetValue, type AvatarPreset } from "./AccountForms";

const userQueries = jest.requireActual<typeof import("../../api/userQueries")>("../../api/userQueries");
jest.mock("../../api/userQueries", () => ({
  ...jest.requireActual("../../api/userQueries"),
  changeMyPassword: jest.fn(),
}));

const fill = async (current: string, next: string, confirm: string) => {
  await fireEvent.changeText(screen.getByLabelText("Current password"), current);
  await fireEvent.changeText(screen.getByLabelText("New password"), next);
  await fireEvent.changeText(screen.getByLabelText("Confirm new password"), confirm);
  await fireEvent.press(screen.getByRole("button", { name: "Save password" }));
};

beforeEach(() => seedAuth({ user: { Id: 7, FullName: "Asha" } }));

// parity: ME-01 — change own password: at least 6 characters (userController.js:434), typed twice.
// Spec §4 19: the password ComposeSheet (masked fields).
describe("ChangePasswordSheet", () => {
  it("checks length and the confirm before asking the server, then changes it and closes", async () => {
    jest.mocked(changeMyPassword).mockResolvedValue(envelope({}));
    const { dismiss } = spySheets();
    await renderWithProviders(<ChangePasswordSheet ref={createRef<SheetRef>()} />);
    expect(screen.getByText("Change password")).toBeOnTheScreen();
    expect(screen.getByLabelText("New password").props.secureTextEntry).toBe(true);

    await fill("old-fixture", "short", "short");
    expect(await screen.findByText("The new password needs at least 6 characters.")).toBeOnTheScreen();
    await fill("old-fixture", "new-fixture", "new-fixturX");
    expect(await screen.findByText("The two new passwords do not match.")).toBeOnTheScreen();
    expect(changeMyPassword).not.toHaveBeenCalled();

    await fill("old-fixture", "new-fixture", "new-fixture");
    await waitFor(() =>
      expect(changeMyPassword).toHaveBeenCalledWith({ CurrentPassword: "old-fixture", NewPassword: "new-fixture" }),
    );
    expect(await screen.findByText("Password changed")).toBeOnTheScreen();
    expect(dismiss).toHaveBeenCalled();
  });

  it("needs the current password: Save stays off until all three are typed", async () => {
    await renderWithProviders(<ChangePasswordSheet ref={createRef<SheetRef>()} />);
    await fill("", "new-fixture", "new-fixture");
    expect(screen.getByRole("button", { name: "Save password" })).toBeDisabled();
    expect(changeMyPassword).not.toHaveBeenCalled();
  });

  it("shows the server's reason and stays open", async () => {
    jest.mocked(changeMyPassword).mockRejectedValue(serverError(401, "Current password is incorrect"));
    const { dismiss } = spySheets();
    await renderWithProviders(<ChangePasswordSheet ref={createRef<SheetRef>()} />);
    await fill("wrong-fixture", "new-fixture", "new-fixture");
    expect(await screen.findByText("Current password is incorrect")).toBeOnTheScreen();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("closing clears what was typed and the error", async () => {
    jest.mocked(changeMyPassword).mockRejectedValue(serverError(401, "Current password is incorrect"));
    // The real sheet calls onDismiss when it closes; the mock's dismiss is a no-op.
    spySheets().dismiss.mockImplementation(function (this: unknown) {
      (this as { props: { onDismiss?: () => void } }).props.onDismiss?.();
    });
    const ref = createRef<SheetRef>();
    await renderWithProviders(<ChangePasswordSheet ref={ref} />);
    await fill("wrong-fixture", "new-fixture", "new-fixture");
    expect(await screen.findByText("Current password is incorrect")).toBeOnTheScreen();
    await act(() => ref.current!.dismiss());
    expect(screen.queryByText("Current password is incorrect")).toBeNull();
    expect(screen.getByLabelText("Current password").props.value).toBe("");
  });

  // The real request path (fetcher → api client → its 401 handling → the store),
  // only the wire faked: a 401 here must not end the session.
  it("a wrong current password over the wire keeps the user signed in", async () => {
    jest.mocked(changeMyPassword).mockImplementation(userQueries.changeMyPassword);
    fail(401, { success: false, code: "WRONG_PASSWORD", message: "Current password is incorrect" });
    await renderWithProviders(<ChangePasswordSheet ref={createRef<SheetRef>()} />);
    await fill("wrong-fixture", "new-fixture", "new-fixture");
    expect(await screen.findByText("Current password is incorrect")).toBeOnTheScreen();
    expect(lastRequest()).toMatchObject({ url: "/api/users/me/changePassword" });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().reauth).toBeFalsy();
  });
});

describe("avatar presets", () => {
  it.each([
    ["icon:rocket|blue", { icon: "rocket", color: "blue" }],
    ["icon:rocket", { icon: "rocket", color: null }],
    ["color:green", { icon: null, color: "green" }],
    ["emoji:x", { icon: null, color: null }],
    [null, { icon: null, color: null }],
  ])("%s parses to %o", (value, preset) => {
    expect(parsePreset(value)).toEqual(preset);
  });

  it("a pick becomes the stored string; no pick keeps what was there", () => {
    expect(presetValue({ icon: "cat", color: null }, null)).toBe("icon:cat|violet");
    expect(presetValue({ icon: null, color: "red" }, null)).toBe("color:red");
    expect(presetValue({ icon: null, color: null }, "emoji:x")).toBe("emoji:x");
  });

  it("the picker marks the chosen colour and icon", async () => {
    function Harness() {
      const [p, setP] = useState<AvatarPreset>({ icon: null, color: null });
      return <AvatarPicker value={p} onChange={setP} />;
    }
    await renderWithProviders(<Harness />);
    await fireEvent.press(screen.getByLabelText("Icon cat"));
    expect(screen.getByLabelText("Icon cat")).toBeSelected();
    expect(screen.getByLabelText("Colour violet")).toBeSelected();
    await fireEvent.press(screen.getByLabelText("Colour blue"));
    expect(screen.getByLabelText("Colour blue")).toBeSelected();
    expect(screen.getByLabelText("Colour violet")).not.toBeSelected();
  });
});
