// web/src/pages/Support/CustomerDetailModal.test.jsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import CustomerDetailModal from "./CustomerDetailModal";
import useAuthStore from "../../stores/useAuthStore";
import renderWithProviders from "../../test/renderWithProviders";
import { mockCustomerEndpoints, customerRow } from "../../test/supportMocks";

// fetchCustomerDetail RS2 shape (plan Contracts), not the fetchTickets row.
const TICKETS = [
  { Id: 7, TicketNo: "TKT-0007", Subject: "Screen flickers on boot", StatusId: 62, StatusName: "In Progress", StatusCode: "open",
    Priority: 3, PriorityName: "High", AssignedTo: 17, AssigneeName: "Amit Singh", DueAt: "2020-01-01T10:00:00Z", IsOverdue: 1,
    CreatedAt: "2026-09-15T10:00:00Z", ResolvedAt: null, ClosedAt: null },
  { Id: 5, TicketNo: "TKT-0005", Subject: "Invoice mismatch", StatusId: 65, StatusName: "Closed", StatusCode: "closed",
    Priority: 1, PriorityName: "Low", AssignedTo: null, AssigneeName: null, DueAt: "2026-08-08T10:00:00Z", IsOverdue: 0,
    CreatedAt: "2026-08-01T10:00:00Z", ResolvedAt: "2026-08-03T10:00:00Z", ClosedAt: "2026-08-04T10:00:00Z" },
];

const renderModal = (props = {}) =>
  renderWithProviders(<CustomerDetailModal customerId={3} open onClose={vi.fn()} onEdit={vi.fn()} {...props} />);

describe("CustomerDetailModal", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
  });

  it("shows the profile and every complaint with its status, due and assignee", async () => {
    const cap = mockCustomerEndpoints({}, { detail: { customer: customerRow(), tickets: TICKETS } });
    renderModal();
    expect(screen.getByTestId("customer-detail-loading")).toBeInTheDocument();

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(cap.detail).toEqual({ CustomerId: 3 });
    expect(screen.getByText("acme@example.com")).toBeInTheDocument();
    expect(screen.getByText(/12 MG Road/)).toBeInTheDocument();

    const open = screen.getByTestId("customer-ticket-7");
    expect(open).toHaveTextContent("TKT-0007");
    expect(open).toHaveTextContent("Screen flickers on boot");
    expect(open).toHaveTextContent("In Progress");
    expect(open).toHaveTextContent("overdue");
    expect(open).toHaveTextContent("Amit Singh");
    const closed = screen.getByTestId("customer-ticket-5");
    expect(closed).toHaveTextContent("Closed");
    expect(closed).toHaveTextContent("Unassigned");
    // A past due date on a closed complaint is a date, never "overdue".
    expect(closed).toHaveTextContent("08-08-2026");
  });

  it("clicking a complaint opens it", async () => {
    mockCustomerEndpoints({}, { detail: { customer: customerRow(), tickets: TICKETS } });
    renderModal();
    await userEvent.setup().click(await screen.findByTestId("customer-ticket-7"));
    expect(mockNavigate).toHaveBeenCalledWith("/support/tickets/7");
  });

  it("says so when the customer has no complaints in the caller's scope", async () => {
    mockCustomerEndpoints({}, { detail: { customer: customerRow({ TotalTickets: 0, OpenTickets: 0 }), tickets: [] } });
    renderModal();
    expect(await screen.findByTestId("customer-tickets-empty")).toBeInTheDocument();
  });

  it("Edit hands the customer row to the caller", async () => {
    mockCustomerEndpoints({}, { detail: { customer: customerRow(), tickets: [] } });
    const onEdit = vi.fn();
    renderModal({ onEdit });
    await userEvent.setup().click(await screen.findByTestId("customer-detail-edit"));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ Id: 3, Name: "Acme Corp" }));
  });

  it("renders nothing and fetches nothing while closed", () => {
    const cap = mockCustomerEndpoints();
    renderModal({ open: false });
    expect(screen.queryByTestId("customer-detail-modal")).toBeNull();
    expect(cap.detail).toBeUndefined();
  });
});
