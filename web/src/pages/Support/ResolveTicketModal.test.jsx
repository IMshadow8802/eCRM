import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import ResolveTicketModal from "./ResolveTicketModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { mockSupportRefData, mockTicketEndpoints, ticketRow, refuse } from "../../test/supportMocks";

const RESOLVED = { value: 64, label: "Resolved", code: "resolved" };

const renderModal = (props = {}) =>
  renderWithProviders(
    <ResolveTicketModal open onClose={vi.fn()} ticket={ticketRow()} status={RESOLVED} onDone={vi.fn()} {...props} />,
    { router: false },
  );

describe("ResolveTicketModal", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
  });

  // Spec §2: 'resolved' requires a ResolutionId AND remarks. The SP refuses
  // without them; refusing here says why before the round-trip.
  it("refuses without a resolution and without remarks, then posts the picked status", async () => {
    const cap = mockTicketEndpoints();
    const onDone = vi.fn();
    const onClose = vi.fn();
    renderModal({ onDone, onClose });
    const user = userEvent.setup();

    expect(screen.getByTestId("resolve-submit")).toBeDisabled();
    await user.click(screen.getByTestId("resolution-combobox-input"));
    await user.click(await screen.findByRole("option", { name: "Fixed" }));
    expect(screen.getByTestId("resolve-submit")).toBeDisabled();   // remarks still missing

    await user.type(screen.getByTestId("resolve-remarks"), "Replaced the panel connector");
    await user.click(screen.getByTestId("resolve-submit"));

    await waitFor(() => expect(cap.status).toBeTruthy());
    // The status the user picked — not "the first resolved one", which is what
    // sp_ResolveTicket would have chosen for a company with two of them.
    expect(cap.status).toEqual({ TicketId: 7, StatusId: 64, ResolutionId: 8, Remarks: "Replaced the panel connector" });
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // renderWithProviders wraps the tree inline (not via RTL's `wrapper:`
  // option), so RTL's own `rerender` would drop the ThemeProvider and crash
  // on `theme.tokens` — two fresh renders instead (see ReportShell.test.jsx).
  it("titles itself Resolve for a resolved status", async () => {
    mockTicketEndpoints();
    renderModal();
    expect(await screen.findByText("Resolve complaint")).toBeInTheDocument();
  });

  it("titles itself Close for a closed status", async () => {
    mockTicketEndpoints();
    renderModal({ status: { value: 65, label: "Closed", code: "closed" } });
    expect(await screen.findByText("Close complaint")).toBeInTheDocument();
  });

  it("keeps the modal open and shows the server's refusal", async () => {
    mockTicketEndpoints();
    server.use(http.post("*/api/tickets/setTicketStatus", () => refuse("A resolution is required", 400)));
    const onClose = vi.fn();
    renderModal({ onClose });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("resolution-combobox-input"));
    await user.click(await screen.findByRole("option", { name: "Fixed" }));
    await user.type(screen.getByTestId("resolve-remarks"), "Done");
    await user.click(screen.getByTestId("resolve-submit"));

    expect(await screen.findByText("A resolution is required")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
