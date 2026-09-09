import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../components/ui/DateField", () => import("../../test/DateFieldStub"));

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import LogFollowUpModal from "./LogFollowUpModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const FU = { Id: 21, LeadId: 9, Type: "call", DueAt: "2026-09-10T00:00:00.000Z", Status: "open" };

const mocks = (cap = {}) =>
  server.use(
    http.post("*/api/config/fetchLookups", async () =>
      json({ lookups: [{ Id: 1, Value: "Connected" }, { Id: 2, Value: "No Answer" }] }),
    ),
    http.post("*/api/followups/completeFollowUp", async ({ request }) => {
      cap.body = await request.json();
      return json({ Id: 21, NextId: 22 });
    }),
  );

describe("LogFollowUpModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" });
  });

  it("posts outcome, remarks and the next follow-up", async () => {
    const cap = {};
    mocks(cap);
    const onLogged = vi.fn();
    renderWithProviders(<LogFollowUpModal open followUp={FU} onClose={() => {}} onLogged={onLogged} />, { router: false });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("followup-outcome-input"));
    await user.click(await screen.findByRole("option", { name: "Connected" }));
    await user.type(screen.getByTestId("followup-remarks"), "Wants a quote for 2 units");
    await user.click(screen.getByTestId("followup-next-type-input"));
    await user.click(await screen.findByRole("option", { name: "Visit" }));
    await user.type(screen.getByTestId("followup-next-date"), "2026-09-14");
    await user.click(screen.getByTestId("followup-submit"));

    await waitFor(() => expect(cap.body).toBeTruthy());
    expect(cap.body).toEqual({
      Id: 21, OutcomeId: 1, Remarks: "Wants a quote for 2 units",
      Direction: "out", Duration: null, NextType: "visit", NextDueAt: "2026-09-14",
    });
    expect(onLogged).toHaveBeenCalled();
  });

  it("will not submit without remarks", async () => {
    const cap = {};
    mocks(cap);
    renderWithProviders(<LogFollowUpModal open followUp={FU} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();
    expect(screen.getByTestId("followup-submit")).toBeDisabled();
    await user.click(screen.getByTestId("followup-submit"));
    expect(cap.body).toBeUndefined();
  });

  it("hides call-only fields for a visit", () => {
    mocks();
    renderWithProviders(<LogFollowUpModal open followUp={{ ...FU, Type: "visit" }} onClose={() => {}} />, { router: false });
    expect(screen.queryByTestId("followup-direction-input")).toBeNull();
  });

  it("records call duration when no outcome or next follow-up is picked", async () => {
    const cap = {};
    mocks(cap);
    renderWithProviders(<LogFollowUpModal open followUp={FU} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("followup-remarks"), "Left a voicemail");
    await user.type(screen.getByTestId("followup-duration"), "15");
    await user.click(screen.getByTestId("followup-submit"));

    await waitFor(() => expect(cap.body).toBeTruthy());
    expect(cap.body).toEqual({
      Id: 21, OutcomeId: null, Remarks: "Left a voicemail",
      Direction: "out", Duration: 15, NextType: null, NextDueAt: null,
    });
  });

  it("logs a non-call follow-up with no due date in the header", async () => {
    const cap = {};
    mocks(cap);
    const visitFU = { ...FU, Type: "visit", DueAt: null };
    renderWithProviders(<LogFollowUpModal open followUp={visitFU} onClose={() => {}} />, { router: false });
    const user = userEvent.setup();

    expect(screen.queryByText(/due/)).toBeNull();
    await user.type(screen.getByTestId("followup-remarks"), "Site was closed");
    await user.click(screen.getByTestId("followup-submit"));

    await waitFor(() => expect(cap.body).toBeTruthy());
    expect(cap.body).toEqual({
      Id: 21, OutcomeId: null, Remarks: "Site was closed",
      Direction: null, Duration: null, NextType: null, NextDueAt: null,
    });
  });

  it("does not call onLogged when the server rejects the follow-up", async () => {
    server.use(
      http.post("*/api/config/fetchLookups", async () => json({ lookups: [] })),
      http.post("*/api/followups/completeFollowUp", async () =>
        HttpResponse.json({ success: false, message: "Remarks required", responseCode: 400 }),
      ),
    );
    const onLogged = vi.fn();
    renderWithProviders(<LogFollowUpModal open followUp={FU} onClose={() => {}} onLogged={onLogged} />, { router: false });
    const user = userEvent.setup();

    await user.type(screen.getByTestId("followup-remarks"), "Wants a quote");
    await user.click(screen.getByTestId("followup-submit"));

    await screen.findByText("Remarks required");
    expect(onLogged).not.toHaveBeenCalled();
  });
});
