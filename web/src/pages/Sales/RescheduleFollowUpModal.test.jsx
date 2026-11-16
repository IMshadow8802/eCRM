import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));
vi.mock("../../api/salesQueries", async () => ({
  ...(await vi.importActual("../../api/salesQueries")),
  scheduleFollowUp: vi.fn(),
  skipFollowUp: vi.fn(),
}));

import { pickTime, clearTime } from "../../test/pickTime";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import RescheduleFollowUpModal from "./RescheduleFollowUpModal";
import { scheduleFollowUp, skipFollowUp } from "../../api/salesQueries";
import { buildTheme } from "../../theme";

const FU = { Id: 21, LeadId: 9, Type: "visit", DueAt: "2026-11-16T10:00:00", AssignedTo: 4, Status: "open" };

const renderModal = (props = {}) => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <QueryClientProvider client={client}>
        <RescheduleFollowUpModal open followUp={FU} onClose={onClose} onDone={onDone} {...props} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { invalidate, onClose, onDone, user: userEvent.setup() };
};

const fill = async (user, { date = "2099-01-05", remarks = "Client asked" } = {}) => {
  await user.type(screen.getByTestId("reschedule-date"), date);
  await user.type(screen.getByTestId("reschedule-remarks"), remarks);
};

afterEach(() => vi.useRealTimers());

describe("RescheduleFollowUpModal", () => {
  beforeEach(() => {
    scheduleFollowUp.mockReset().mockResolvedValue({ Id: 22 });
    skipFollowUp.mockReset().mockResolvedValue({ Id: 21 });
  });

  it("titles itself and prefills the time from a timed due", () => {
    renderModal();
    expect(screen.getByText("Reschedule follow-up")).toBeInTheDocument();
    expect(screen.getByTestId("reschedule-time")).toHaveValue("10:00 am");
  });

  it("leaves the time empty for a day-only due", () => {
    renderModal({ followUp: { ...FU, DueAt: "2026-11-16T00:00:00" } });
    expect(screen.getByTestId("reschedule-time")).toHaveValue("");
  });

  it("needs a date and remarks, and refuses a time already past today", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date().setHours(14, 10, 0, 0) }); // 14:10 of the real day (DEFAULTS read today() at import)
    const { user } = renderModal();
    const submit = screen.getByTestId("reschedule-submit");
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId("reschedule-date"), "2099-01-05");
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId("reschedule-remarks"), "Client asked");
    expect(submit).toBeEnabled();
    await user.clear(screen.getByTestId("reschedule-date"));
    await user.type(screen.getByTestId("reschedule-date"), dayjs().format("YYYY-MM-DD"));
    await pickTime(user, "reschedule-time", "09:00");
    expect(screen.getByText("Pick a time from now on")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(scheduleFollowUp).not.toHaveBeenCalled();
  });

  it("books the new one, then skips the old one with the new due in the remark", async () => {
    const { user, onClose, onDone, invalidate } = renderModal();
    await fill(user);
    await user.click(screen.getByTestId("reschedule-submit"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(scheduleFollowUp).toHaveBeenCalledWith({ LeadId: 9, Type: "visit", DueAt: "2099-01-05T10:00", AssignedTo: 4 });
    expect(skipFollowUp).toHaveBeenCalledWith({ Id: 21, Remarks: "Rescheduled to 05-01-2099 10:00: Client asked" });
    expect(scheduleFollowUp.mock.invocationCallOrder[0]).toBeLessThan(skipFollowUp.mock.invocationCallOrder[0]);
    expect(onDone).toHaveBeenCalled();
    for (const key of ["followups", "lead-detail", "leads"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });

  it("books a day-only follow-up when the time is cleared, with defaults for a bare row", async () => {
    const { user } = renderModal({ followUp: { Id: 21, LeadId: 9, DueAt: "2026-11-16T10:00:00" } });
    await fill(user);
    await clearTime(user, "reschedule-time");
    await user.click(screen.getByTestId("reschedule-submit"));
    await waitFor(() => expect(skipFollowUp).toHaveBeenCalled());
    expect(scheduleFollowUp).toHaveBeenCalledWith({ LeadId: 9, Type: "call", DueAt: "2099-01-05", AssignedTo: null });
    expect(skipFollowUp).toHaveBeenCalledWith({ Id: 21, Remarks: "Rescheduled to 05-01-2099: Client asked" });
  });

  it("on a half failure stays open, and a retry skips again without booking twice", async () => {
    skipFollowUp.mockRejectedValueOnce(new Error("boom"));
    const { user, onClose, invalidate } = renderModal();
    await fill(user);
    await user.click(screen.getByTestId("reschedule-submit"));
    expect(await screen.findByText("Booked the new follow-up, but the old one is still open — skip it from the lead.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["followups"] });
    await user.click(screen.getByTestId("reschedule-submit"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(skipFollowUp).toHaveBeenCalledTimes(2);
    expect(scheduleFollowUp).toHaveBeenCalledTimes(1);
  });

  it("shows the server's message when booking fails and never skips", async () => {
    scheduleFollowUp.mockRejectedValueOnce({ response: { data: { message: "Lead is closed" } } });
    const { user, onClose } = renderModal();
    await fill(user);
    await user.click(screen.getByTestId("reschedule-submit"));
    expect(await screen.findByText("Lead is closed")).toBeInTheDocument();
    expect(skipFollowUp).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the error carries none", async () => {
    scheduleFollowUp.mockRejectedValueOnce({});
    const { user } = renderModal();
    await fill(user);
    await user.click(screen.getByTestId("reschedule-submit"));
    expect(await screen.findByText("Could not reschedule the follow-up.")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("reschedule-submit")).toBeNull();
  });
});
