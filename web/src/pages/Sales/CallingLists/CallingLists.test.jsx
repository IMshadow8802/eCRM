import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CallingLists from "./CallingLists";
import useAuthStore from "../../../stores/useAuthStore";
import renderWithProviders from "../../../test/renderWithProviders";
import { listRow, mockCallingEndpoints } from "../../../test/callingMocks";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));
vi.mock("./ListFormModal", () => ({ default: ({ open }) => (open ? <div data-testid="list-form-modal" /> : null) }));

const ADMIN = { isAdmin: true, modules: {} };
const MANAGER = { isAdmin: false, modules: { calling: { view: true, add: false, edit: true, delete: false } } };
const SALES = { isAdmin: false, modules: { leads: { view: true, add: true, edit: true, delete: false, reach: "Own" } } };
const as = (access) => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, access });

describe("Calling Lists page", () => {
  beforeEach(() => { mockNavigate.mockReset(); as(ADMIN); });

  it("lists a purchase with its numbers, lead % and cost per lead", async () => {
    mockCallingEndpoints({ lists: [listRow(), listRow({ Id: 6, Name: "Surat traders", Leads: 0, Cost: null, Contacts: 0 })] });
    renderWithProviders(<CallingLists />);
    const row = (await screen.findByText("MLSS Delhi — Lucky draw, Nov")).closest("tr");
    for (const t of ["Kapoor Data House", "4,186", "3,402", "40", "11", "655", "78", "1.9%", "₹42,000", "₹538", "Active"]) {
      expect(within(row).getByText(t)).toBeInTheDocument();
    }
    expect(within(row).getByText(/Delhi office · Auto · holds 10/)).toBeInTheDocument();
    const surat = screen.getByText("Surat traders").closest("tr");
    expect(within(surat).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    // No totals strip: the server sends no company-wide totals, and a page's sum would mislead.
    expect(screen.queryByTestId("stat-pool")).toBeNull();
    expect(screen.queryByText("Spent")).toBeNull();
    expect(screen.getByText("Turned lead")).toBeInTheDocument();
  });

  it("shows a used-up list as a state", async () => {
    mockCallingEndpoints({ lists: [listRow({ Eligible: 0, InPool: 0 })] });
    renderWithProviders(<CallingLists />);
    expect(await screen.findByText("Contacts used up")).toBeInTheDocument();
  });

  it("hides the cost columns when the rows carry no cost (not an admin)", async () => {
    as(MANAGER);
    mockCallingEndpoints({ lists: [listRow({ Cost: null })] });
    renderWithProviders(<CallingLists />);
    await screen.findByText("MLSS Delhi — Lucky draw, Nov");
    expect(screen.queryByText("Cost")).toBeNull();
    expect(screen.queryByText("Cost / lead")).toBeNull();
    expect(screen.queryByTestId("new-list-btn")).toBeNull();
  });

  it("tells a salesperson the lists are their manager's and asks the server nothing", async () => {
    as(SALES);
    const cap = mockCallingEndpoints();
    renderWithProviders(<CallingLists />);
    expect(await screen.findByText("Calling lists are managed by your manager")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(cap.calls.fetchLists).toBeUndefined();
  });

  it("pauses a list sending the whole list, and resumes it", async () => {
    const cap = mockCallingEndpoints({ lists: [listRow(), listRow({ Id: 6, Name: "Paused one", Status: "paused" })] });
    renderWithProviders(<CallingLists />);
    const user = userEvent.setup();
    await screen.findByText("MLSS Delhi — Lucky draw, Nov");
    await user.click(screen.getByTestId("pause-list-5"));
    await waitFor(() => expect(cap.saveList).toBeDefined());
    expect(cap.saveList).toEqual({ Id: 5, BranchId: 1, Name: "MLSS Delhi — Lucky draw, Nov", Vendor: "Kapoor Data House", PurchasedOn: "2026-11-18",
      Cost: 42000, ProductId: 3, Script: "Namaste…", AutoTopUp: true, HoldSize: 10, MaxAttempts: 3, RetryGapHours: 4, Status: "paused" });
    await user.click(screen.getByTestId("pause-list-6"));
    await waitFor(() => expect(cap.saveList.Id).toBe(6));
    expect(cap.saveList.Status).toBe("active");
  });

  it("archives a list after a confirmation", async () => {
    const cap = mockCallingEndpoints();
    renderWithProviders(<CallingLists />);
    const user = userEvent.setup();
    await screen.findByText("MLSS Delhi — Lucky draw, Nov");
    await user.click(screen.getByTestId("archive-list-5"));
    expect(await screen.findByText(/Contacts with callers go back to the pool/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(cap.saveList?.Status).toBe("archived"));
  });

  it("filters by status and opens a list on row click", async () => {
    const cap = mockCallingEndpoints();
    renderWithProviders(<CallingLists />);
    const user = userEvent.setup();
    await user.click(await screen.findByText("MLSS Delhi — Lucky draw, Nov"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/calling-lists/5");
    await user.click(screen.getByTestId("list-status-filter-input"));
    await user.click(await screen.findByRole("option", { name: "Paused" }));
    await waitFor(() => expect(cap.fetchLists.Status).toBe("paused"));
  });

  it("opens the New list modal for someone who can add", async () => {
    mockCallingEndpoints({ lists: [] });
    renderWithProviders(<CallingLists />);
    const user = userEvent.setup();
    expect(await screen.findByText("No calling lists yet")).toBeInTheDocument();
    await user.click(screen.getByTestId("new-list-btn"));
    expect(await screen.findByTestId("list-form-modal")).toBeInTheDocument();
  });
});
