import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BreachReasonDialog from "./BreachReasonDialog";
import { server } from "../../../../test/mocks/server";
import { tatHandlers } from "../../../../test/tatMocks";
import renderWithProviders from "../../../../test/renderWithProviders";

const pick = async (user, testId, name) => {
  const box = screen.getByTestId(testId);
  await user.click(box.querySelector("[role='combobox']") ?? box);
  await user.click(await screen.findByRole("option", { name }));
};

function setup() {
  const calls = [];
  server.use(...tatHandlers({ calls }));
  const onClose = vi.fn();
  renderWithProviders(<BreachReasonDialog open tatId={88} taskId={501} onClose={onClose} />, { router: false });
  return { calls, onClose, user: userEvent.setup() };
}

describe("BreachReasonDialog", () => {
  it("Save waits for a reason, then sends it", async () => {
    const { calls, onClose, user } = setup();
    expect(screen.getByTestId("breach-reason-save")).toBeDisabled();
    await pick(user, "breach-reason-select", "Waiting on someone");
    await user.click(screen.getByTestId("breach-reason-save"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual(["saveReason", { TaskId: 501, TatId: 88, ReasonId: 71, Remarks: null }]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Other needs remarks before it can be saved", async () => {
    const { calls, user } = setup();
    await pick(user, "breach-reason-select", "Other");
    expect(screen.getByTestId("breach-reason-save")).toBeDisabled();
    expect(screen.getByText("Required for Other")).toBeInTheDocument();
    const remarks = screen.getByTestId("breach-reason-remarks");
    await user.type(remarks, "Client vanished");
    await user.click(screen.getByTestId("breach-reason-save"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0][1]).toMatchObject({ ReasonId: 74, Remarks: "Client vanished" });
  });

  it("Later just closes - nothing is sent", async () => {
    const { calls, onClose, user } = setup();
    await user.click(screen.getByTestId("breach-reason-later"));
    expect(onClose).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("a refused save keeps the dialog open", async () => {
    const { onClose, user } = setup();
    const { http, HttpResponse } = await import("msw");
    server.use(http.post("*/api/tat/saveReason", () =>
      HttpResponse.json({ success: false, message: "Only your own clock", responseCode: 403 }, { status: 403 })));
    await pick(user, "breach-reason-select", "Waiting on someone");
    await user.click(screen.getByTestId("breach-reason-save"));
    expect(await screen.findByText("Only your own clock")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
