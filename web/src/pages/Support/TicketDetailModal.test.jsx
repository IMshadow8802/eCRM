import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Unit-level: TicketDetail itself (fetches, lifecycle dialogs, etc.) is
// covered by TicketDetail.test.jsx. This file only proves the wrapper wires
// open/ticketId/onClose the way Tickets.jsx (its only caller) relies on.
vi.mock("./TicketDetail", () => ({
  __esModule: true,
  default: ({ ticketId }) => <div data-testid="ticket-detail-stub">ticket:{ticketId}</div>,
}));

import TicketDetailModal from "./TicketDetailModal";
import renderWithProviders from "../../test/renderWithProviders";

describe("TicketDetailModal", () => {
  it("renders nothing when closed", () => {
    renderWithProviders(<TicketDetailModal open={false} ticketId={7} onClose={vi.fn()} />, { router: false });
    expect(screen.queryByTestId("ticket-detail-modal")).toBeNull();
  });

  it("renders the modal shell but no TicketDetail until a ticketId is set", () => {
    renderWithProviders(<TicketDetailModal open ticketId={null} onClose={vi.fn()} />, { router: false });
    expect(screen.getByTestId("ticket-detail-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-detail-stub")).toBeNull();
  });

  it("open with a ticketId renders TicketDetail for that ticket", () => {
    renderWithProviders(<TicketDetailModal open ticketId={7} onClose={vi.fn()} />, { router: false });
    expect(screen.getByTestId("ticket-detail-modal")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-detail-stub")).toHaveTextContent("ticket:7");
  });

  it("the header close calls onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TicketDetailModal open ticketId={7} onClose={onClose} />, { router: false });
    await userEvent.setup().click(screen.getByTestId("modal-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
