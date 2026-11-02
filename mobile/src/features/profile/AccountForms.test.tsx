// The real request path (fetcher → api client → its 401 handling → the store),
// only the wire faked. MeScreen.test mocks the fetchers and cannot see this.
import { fireEvent, screen } from "@testing-library/react-native";

import useAuthStore from "../../stores/useAuthStore";
import { fail, lastRequest } from "../../test/transport";
import { renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { ChangePasswordForm } from "./AccountForms";

it("a wrong current password shows the server's message and keeps the user signed in", async () => {
  seedAuth({ user: { Id: 7, FullName: "Asha" } });
  fail(401, { success: false, code: "WRONG_PASSWORD", message: "Current password is incorrect" });
  await renderWithProviders(<ChangePasswordForm onDone={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText("Current password"), "wrong-fixture");
  await fireEvent.changeText(screen.getByLabelText("New password"), "new-fixture");
  await fireEvent.changeText(screen.getByLabelText("Confirm new password"), "new-fixture");
  await fireEvent.press(screen.getByText("Save password"));

  expect(await screen.findByText("Current password is incorrect")).toBeOnTheScreen();
  expect(lastRequest()).toMatchObject({ url: "/api/users/me/changePassword" });
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(useAuthStore.getState().reauth).toBeFalsy();
});
