import { act, fireEvent, screen } from "@testing-library/react-native";

import { ackNotice } from "../../api/presenceQueries";
import { envelope } from "../../test/fixtures";
import { renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import useAuthStore from "../../stores/useAuthStore";
import PresenceNoticeDialog from "./PresenceNoticeDialog";

jest.mock("../../api/presenceQueries");

const TITLE = "What this workplace records";

beforeEach(() => jest.mocked(ackNotice).mockResolvedValue(envelope({})));

it("shows after a login that flagged the notice; OK acknowledges it once", async () => {
  seedAuth();
  useAuthStore.setState({ presenceNotice: true });
  await renderWithProviders(<PresenceNoticeDialog />);
  expect(await screen.findByText(TITLE)).toBeOnTheScreen();
  expect(screen.getByText(/Not recorded: screenshots/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("OK"));
  expect(ackNotice).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().presenceNotice).toBe(false);
  expect(screen.queryByText(TITLE)).toBeNull();
});

it("a failed ack still dismisses the notice", async () => {
  jest.mocked(ackNotice).mockRejectedValue(new Error("Network Error"));
  seedAuth();
  useAuthStore.setState({ presenceNotice: true });
  await renderWithProviders(<PresenceNoticeDialog />);
  await fireEvent.press(await screen.findByText("OK"));
  expect(useAuthStore.getState().presenceNotice).toBe(false);
});

it("stays hidden when the notice was already acknowledged or nobody is signed in", async () => {
  seedAuth();
  await renderWithProviders(<PresenceNoticeDialog />);
  expect(screen.queryByText(TITLE)).toBeNull();
  await act(async () => useAuthStore.setState({ isAuthenticated: false, presenceNotice: true }));
  expect(screen.queryByText(TITLE)).toBeNull();
  expect(ackNotice).not.toHaveBeenCalled();
});
