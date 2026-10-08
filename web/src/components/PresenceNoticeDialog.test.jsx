import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "../test/mocks/server";
import renderWithProviders from "../test/renderWithProviders";
import useAuthStore from "../stores/useAuthStore";
import PresenceNoticeDialog from "./PresenceNoticeDialog";

let acks;
beforeEach(() => {
  acks = 0;
  server.use(
    http.post("*/api/presence/ackNotice", () => {
      acks += 1;
      return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: null });
    }),
  );
});

describe("PresenceNoticeDialog", () => {
  it("stays hidden unless the login said to show it", () => {
    useAuthStore.setState({ presenceNotice: false });
    renderWithProviders(<PresenceNoticeDialog />);
    expect(screen.queryByTestId("presence-notice")).not.toBeInTheDocument();
  });

  it("shows exactly what is recorded and acks on OK", async () => {
    useAuthStore.setState({ presenceNotice: true });
    const user = userEvent.setup();
    renderWithProviders(<PresenceNoticeDialog />);

    expect(screen.getByText("What this workplace records")).toBeInTheDocument();
    for (const line of [
      "Your sign-in and sign-out times, and when the app was last open (every 2 minutes while it is).",
      "Leave and on-duty days your manager marks.",
      "How long assigned tasks take, counted in working hours.",
      "Who sees it: you, your manager and their managers, and admins.",
      "Kept for 13 months.",
      "Not recorded: screenshots, keystrokes, camera, microphone or location.",
    ]) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(useAuthStore.getState().presenceNotice).toBe(false));
    expect(acks).toBe(1);
  });

  it("closes even when the ack fails (the server shows it again next time)", async () => {
    server.use(http.post("*/api/presence/ackNotice", () => HttpResponse.json({}, { status: 500 })));
    useAuthStore.setState({ presenceNotice: true });
    const user = userEvent.setup();
    renderWithProviders(<PresenceNoticeDialog />);
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(useAuthStore.getState().presenceNotice).toBe(false));
  });
});
