import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Partners from "./Partners";
import useAuthStore from "../../../stores/useAuthStore";
import renderWithProviders from "../../../test/renderWithProviders";
import { mockPartnerEndpoints, commissionRow, partnerRow } from "../../../test/partnerMocks";

vi.mock("../../../components/ui/DateField", () => import("../../../test/DateFieldStub"));

const ROUTE = "/sales/partners?tab=commissions";
const ADMIN = { isAdmin: true, modules: {} };
const rows = () => [
  commissionRow(),
  commissionRow({ Id: 12, LeadId: 502, LeadName: "Kapoor Gems", Amount: 5000, Status: "earned" }),
  commissionRow({ Id: 13, LeadId: 503, LeadName: "Due Lead", Status: "due" }),
  commissionRow({ Id: 14, LeadId: 504, LeadName: "Paid Lead", Status: "paid", Reverted: true, PaidAt: "2026-10-05T00:00:00Z" }),
  commissionRow({ Id: 15, LeadId: 505, LeadName: "Cancelled Lead", Status: "cancelled", CommType: "fixed", CommValue: 5000 }),
];
const rowOf = (name) => screen.getByText(name).closest("tr");
const tickRow = async (user, name) => user.click(within(rowOf(name)).getByRole("checkbox"));

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("Commissions tab", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, access: ADMIN });
  });

  it("shows partner, lead link, won value, terms, amount and a plain-word status", async () => {
    mockPartnerEndpoints({ commissions: rows() });
    renderWithProviders(<Partners />, { route: ROUTE });
    await screen.findByText("Mehta Jewels");
    expect(screen.getByText("Mehta Jewels").closest("a")).toHaveAttribute("href", "/sales/leads/501");
    const r = rowOf("Mehta Jewels");
    expect(within(r).getByText("Sharma Associates")).toBeInTheDocument();
    expect(within(r).getByText("₹1,00,000.00")).toBeInTheDocument();
    expect(within(r).getByText("10%")).toBeInTheDocument();
    expect(within(r).getByText("₹10,000.00")).toBeInTheDocument();
    expect(within(r).getByText("Earned")).toBeInTheDocument();
    expect(within(rowOf("Due Lead")).getByText("Ready to pay")).toBeInTheDocument();
    expect(within(rowOf("Paid Lead")).getByText("Paid")).toBeInTheDocument();
    expect(within(rowOf("Paid Lead")).getByText("Lead no longer converted")).toBeInTheDocument();
    expect(within(rowOf("Cancelled Lead")).getByText("Cancelled")).toBeInTheDocument();
    expect(within(rowOf("Mehta Jewels")).queryByText("Lead no longer converted")).not.toBeInTheDocument();
  });

  it("marks two earned rows ready to pay and totals the selection", async () => {
    const cap = mockPartnerEndpoints({ commissions: rows() });
    renderWithProviders(<Partners />, { route: ROUTE });
    const user = userEvent.setup();
    await screen.findByText("Mehta Jewels");
    expect(screen.getByTestId("bulk-due-btn")).toBeDisabled();
    await tickRow(user, "Mehta Jewels");
    await tickRow(user, "Kapoor Gems");
    expect(screen.getByTestId("selected-total")).toHaveTextContent("₹15,000.00");
    expect(screen.getByTestId("bulk-paid-btn")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Ready to pay (2)" }));
    await waitFor(() => expect(cap.setCommissionStatus).toBeTruthy());
    expect(cap.setCommissionStatus.ToStatus).toBe("due");
    expect(cap.setCommissionStatus.Ids.sort()).toEqual([11, 12]);
  });

  it("does not enable 'Ready to pay' when a non-earned row is mixed in", async () => {
    mockPartnerEndpoints({ commissions: rows() });
    renderWithProviders(<Partners />, { route: ROUTE });
    const user = userEvent.setup();
    await screen.findByText("Mehta Jewels");
    await tickRow(user, "Mehta Jewels");
    await tickRow(user, "Due Lead");
    expect(screen.getByTestId("bulk-due-btn")).toBeDisabled();
    expect(screen.getByTestId("bulk-paid-btn")).toBeDisabled();
  });

  it("marks ready-to-pay rows paid with today's date and an optional reference", async () => {
    const cap = mockPartnerEndpoints({ commissions: rows() });
    renderWithProviders(<Partners />, { route: ROUTE });
    const user = userEvent.setup();
    await screen.findByText("Due Lead");
    await tickRow(user, "Due Lead");
    await user.click(screen.getByTestId("bulk-paid-btn"));
    const paidOn = await screen.findByTestId("paid-on");
    expect(paidOn).toHaveValue(today());
    await user.type(screen.getByTestId("paid-ref"), "UTR123");
    await user.click(screen.getByTestId("mark-paid-submit"));
    await waitFor(() => expect(cap.setCommissionStatus).toBeTruthy());
    expect(cap.setCommissionStatus).toEqual({ Ids: [13], ToStatus: "paid", PaidAt: today(), PaidRef: "UTR123" });
  });

  it("sends a null reference when left blank", async () => {
    const cap = mockPartnerEndpoints({ commissions: rows() });
    renderWithProviders(<Partners />, { route: ROUTE });
    const user = userEvent.setup();
    await screen.findByText("Due Lead");
    await tickRow(user, "Due Lead");
    await user.click(screen.getByTestId("bulk-paid-btn"));
    await user.click(await screen.findByTestId("mark-paid-submit"));
    await waitFor(() => expect(cap.setCommissionStatus).toBeTruthy());
    expect(cap.setCommissionStatus.PaidRef).toBeNull();
  });

  it("shows the server message inside the mark-paid modal on a 409", async () => {
    mockPartnerEndpoints({ commissions: rows(), fail: { setCommissionStatus: "Nothing changed — already paid" } });
    renderWithProviders(<Partners />, { route: ROUTE });
    const user = userEvent.setup();
    await screen.findByText("Due Lead");
    await tickRow(user, "Due Lead");
    await user.click(screen.getByTestId("bulk-paid-btn"));
    await user.click(await screen.findByTestId("mark-paid-submit"));
    const modal = await screen.findByTestId("mark-paid-modal");
    expect(await within(modal).findByText("Nothing changed — already paid")).toBeInTheDocument();
  });

  it("shows the server message when ready-to-pay is refused", async () => {
    mockPartnerEndpoints({ commissions: rows(), fail: { setCommissionStatus: "Nothing changed" } });
    renderWithProviders(<Partners />, { route: ROUTE });
    const user = userEvent.setup();
    await screen.findByText("Mehta Jewels");
    await tickRow(user, "Mehta Jewels");
    await user.click(screen.getByTestId("bulk-due-btn"));
    expect(await screen.findByText("Nothing changed")).toBeInTheDocument();
  });

  it("hides the bulk actions without partners edit", async () => {
    useAuthStore.setState({ access: { modules: { partners: { view: true } } } });
    mockPartnerEndpoints({ commissions: rows() });
    renderWithProviders(<Partners />, { route: ROUTE });
    await screen.findByText("Mehta Jewels");
    expect(screen.queryByTestId("bulk-due-btn")).not.toBeInTheDocument();
  });

  it("refetches with Status for a status tab, and with partner and dates when filtered", async () => {
    const cap = mockPartnerEndpoints({ commissions: rows(), partners: [partnerRow(), partnerRow({ Id: 2, Name: "Patel Traders" })] });
    renderWithProviders(<Partners />, { route: ROUTE });
    const user = userEvent.setup();
    await screen.findByText("Mehta Jewels");
    expect(cap.fetchCommissions).toEqual({});
    await user.click(screen.getByRole("tab", { name: "Ready to pay" }));
    await waitFor(() => expect(cap.fetchCommissions).toEqual({ Status: "due" }));
    await user.click(screen.getByRole("tab", { name: "Paid" }));
    await waitFor(() => expect(cap.fetchCommissions).toEqual({ Status: "paid" }));
  });

  it("filters by partner and date range", async () => {
    const cap = mockPartnerEndpoints({ commissions: rows(), partners: [partnerRow(), partnerRow({ Id: 2, Name: "Patel Traders", Mobile: "9000000002" })] });
    renderWithProviders(<Partners />, { route: ROUTE });
    const user = userEvent.setup();
    await screen.findByText("Mehta Jewels");
    await user.click(screen.getByTestId("commission-partner-input"));
    await user.click(await screen.findByRole("option", { name: "Patel Traders" }));
    await waitFor(() => expect(cap.fetchCommissions).toEqual({ PartnerId: 2 }));
    await user.type(screen.getByLabelText("From"), "2026-10-01");
    await waitFor(() => expect(cap.fetchCommissions).toEqual({ PartnerId: 2, FromDate: "2026-10-01" }));
    await user.type(screen.getByLabelText("To"), "2026-10-09");
    await waitFor(() => expect(cap.fetchCommissions).toEqual({ PartnerId: 2, FromDate: "2026-10-01", ToDate: "2026-10-09" }));
  });
});
