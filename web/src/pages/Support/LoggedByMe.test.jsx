import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import LoggedByMe from "./LoggedByMe";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import { json } from "../../test/supportMocks";

const ROWS = [
  { Id: 7, TicketNo: "TKT-0007", CreatedAt: "2026-11-01T10:00:00", CustomerName: "Acme Corp", Subject: "Screen flickers",
    StatusName: "In Progress", StatusCode: "open", AssignedToName: "Vivek Rao", DueAt: "2026-11-02T10:00:00", IsOverdue: 1, ClosedOn: null, CanOpen: 1 },
  { Id: null, TicketNo: "TKT-0008", CreatedAt: "2026-11-01T11:00:00", CustomerName: "Beta Ltd", Subject: "No power",
    StatusName: "Closed", StatusCode: "closed", AssignedToName: null, DueAt: "2026-11-03T10:00:00", IsOverdue: 0, ClosedOn: "2026-11-02T09:00:00", CanOpen: 0 },
];
const HEADERS = ["Number", "Logged on", "Customer", "Subject", "Status", "Assigned to", "Due", "Resolved / closed"];

describe("LoggedByMe", () => {
  let body;
  beforeEach(() => {
    mockNavigate.mockClear();
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, UserId: 17, API_BASE_URL: "https://shadowcodes.in/CRM" });
    server.use(http.post("*/api/tickets/fetchLoggedByMe", async ({ request }) => {
      body = await request.json();
      return json({ rows: ROWS, pagination: { currentPage: 1, pageSize: 25, totalRecords: 2, totalPages: 1 } });
    }));
  });

  it("renders exactly the eight columns, in order", async () => {
    renderWithProviders(<LoggedByMe />);
    await screen.findByText("TKT-0007");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent.trim()).filter(Boolean);
    expect(headers).toEqual(HEADERS);
    expect(body).toMatchObject({ PageNumber: 1, PageSize: 25 });
  });

  it("links an openable row, leaves the other as plain text", async () => {
    renderWithProviders(<LoggedByMe />);
    const link = await screen.findByRole("link", { name: "TKT-0007" });
    expect(link).toHaveAttribute("href", "/support/tickets/7");
    expect(screen.queryByRole("link", { name: "TKT-0008" })).toBeNull();
    expect(screen.getByText("TKT-0008")).toBeInTheDocument();
  });

  it("says Unassigned, flags Overdue, and shows the search placeholder", async () => {
    renderWithProviders(<LoggedByMe />);
    await screen.findByText("TKT-0007");
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search number, subject or customer")).toBeInTheDocument();
  });

  it("clicking an openable row opens it; the other row does nothing", async () => {
    renderWithProviders(<LoggedByMe />);
    const user = userEvent.setup();
    await user.click(await screen.findByText("Screen flickers"));
    expect(mockNavigate).toHaveBeenCalledWith("/support/tickets/7");
    mockNavigate.mockClear();
    const plainRow = screen.getByText("No power").closest("tr");
    await user.click(within(plainRow).getByText("No power"));
    expect(mockNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(getComputedStyle(plainRow).cursor).not.toBe("pointer"));
  });
});
