// src/pages/Support/TicketDetail.rejectedClose.test.jsx
//
// Regression for the rejected -> closed dead end (fix wave 2026-09-17).
// sp_SetTicketStatus (backend/sql/086_support_rebuild.sql) requires a
// resolution + remarks for @ToCode='closed' whenever @FromCode<>'resolved'.
// TicketDetail used to gate the resolve prompt on "from is NOT terminal",
// and rejected is terminal, so a rejected -> closed move skipped the prompt
// and posted with neither field, which the SP refuses. This drives the REAL
// ResolveTicketModal (the sibling suite stubs it) so the fix is proven end
// to end: the prompt opens, and the post carries both fields.
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TicketDetail from "./TicketDetail";
import useAuthStore from "../../stores/useAuthStore";
import renderWithProviders from "../../test/renderWithProviders";
import { mockSupportRefData, mockTicketEndpoints, ticketRow, ticketDetail } from "../../test/supportMocks";

describe("TicketDetail — rejected to closed (spec 2 §2)", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    mockSupportRefData();
  });

  it("opens the resolution prompt and posts ResolutionId + Remarks, matching sp_SetTicketStatus's FromCode<>'resolved' rule", async () => {
    const cap = mockTicketEndpoints({}, {
      detail: ticketDetail({ ticket: ticketRow({ StatusId: 66, StatusName: "Rejected", StatusCode: "rejected", ClosedAt: "2026-09-10T09:00:00Z" }) }),
    });
    renderWithProviders(<TicketDetail ticketId={7} />);
    await screen.findByTestId("ticket-detail");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("ticket-status-select-input"));
    await user.click(await screen.findByRole("option", { name: "Closed" }));

    expect(await screen.findByText("Close complaint")).toBeInTheDocument();
    expect(cap.status).toBeUndefined();

    await user.click(screen.getByTestId("resolution-combobox-input"));
    await user.click(await screen.findByRole("option", { name: "Fixed" }));
    await user.type(screen.getByTestId("resolve-remarks"), "Customer called back, fixed on revisit");
    await user.click(screen.getByTestId("resolve-submit"));

    await waitFor(() => expect(cap.status).toEqual({
      TicketId: 7, StatusId: 65, ResolutionId: 8, Remarks: "Customer called back, fixed on revisit",
    }));
  });
});
