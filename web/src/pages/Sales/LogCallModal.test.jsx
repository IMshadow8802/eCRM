import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import LogCallModal from "./LogCallModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const OUTCOMES = [
  { Id: 1, Value: "Interested" },
  { Id: 2, Value: "No answer" },
];

const mockLookups = () =>
  server.use(
    http.post("*/api/config/fetchLookups", async () =>
      HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { lookups: OUTCOMES },
      }),
    ),
  );

const mockLogCall = (capture) =>
  server.use(
    http.post("*/api/calls/logCall", async ({ request }) => {
      const body = await request.json();
      capture?.(body);
      return HttpResponse.json({
        success: true,
        message: "Call logged",
        responseCode: 200,
        data: { Id: 9, ResponseCode: 200, ResponseMess: "Call logged" },
      });
    }),
  );

describe("LogCallModal", () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    mockLookups();
  });

  it("loads outcome options from the call_outcome lookup", async () => {
    mockLogCall();
    renderWithProviders(<LogCallModal open leadId={9} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("log-call-outcome-input"));
    expect(await screen.findByText("Interested")).toBeInTheDocument();
    expect(screen.getByText("No answer")).toBeInTheDocument();
  });

  it("submits logCall with the picked outcome, notes and next follow-up date", async () => {
    let captured;
    // Typing into the masked MUI date field is slow under coverage
    // instrumentation — give this one more headroom than the 5s default.
    mockLogCall((body) => {
      captured = body;
    });
    const onClose = vi.fn();
    const onLogged = vi.fn();
    renderWithProviders(
      <LogCallModal open leadId={9} onClose={onClose} onLogged={onLogged} />,
      { router: false },
    );
    const user = userEvent.setup();

    await user.click(screen.getByTestId("log-call-outcome-input"));
    await user.click(await screen.findByText("Interested"));

    await user.type(screen.getByLabelText("Notes"), "Customer wants a demo");

    const dateInput = screen.getByLabelText("Next follow-up (optional)");
    await user.click(dateInput);
    await user.keyboard("07102026");

    await user.click(screen.getByTestId("log-call-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toMatchObject({
      LeadId: 9,
      OutcomeId: 1,
      Notes: "Customer wants a demo",
      Direction: "out",
      NextFollowupDate: "2026-10-07",
      FollowupRemarks: "Customer wants a demo",
    });
    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  }, 15000);

  it("submits with a null outcome and no follow-up date when both are left blank", async () => {
    let captured;
    mockLogCall((body) => {
      captured = body;
    });
    renderWithProviders(<LogCallModal open leadId={9} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("log-call-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toMatchObject({
      LeadId: 9,
      OutcomeId: null,
      Notes: null,
      Direction: "out",
      NextFollowupDate: null,
      FollowupRemarks: null,
    });
  });

  it("logs a ticket call with TicketId set and LeadId null", async () => {
    let captured;
    mockLogCall((body) => {
      captured = body;
    });
    renderWithProviders(<LogCallModal open ticketId={4} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("log-call-submit"));
    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toMatchObject({ LeadId: null, TicketId: 4, Direction: "out" });
  });

  it("Cancel closes the modal without calling logCall", async () => {
    const captureSpy = vi.fn();
    mockLogCall(captureSpy);
    const onClose = vi.fn();
    renderWithProviders(<LogCallModal open leadId={9} onClose={onClose} />, { router: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(captureSpy).not.toHaveBeenCalled();
  });
});
