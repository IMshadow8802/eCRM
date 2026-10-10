import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Partners from "./Partners";
import { formatCommission } from "../../../api/partnerQueries";
import useAuthStore from "../../../stores/useAuthStore";
import renderWithProviders from "../../../test/renderWithProviders";
import { mockPartnerEndpoints, partnerRow } from "../../../test/partnerMocks";

const ADMIN = { isAdmin: true, modules: {} };

describe("formatCommission", () => {
  it("writes terms in plain words", () => {
    expect(formatCommission("pct", 10)).toBe("10%");
    expect(formatCommission("fixed", 5000)).toBe("₹5,000");
    expect(formatCommission(null, null)).toBe("—");
    expect(formatCommission("pct", null)).toBe("—");
    expect(formatCommission("weird", 5)).toBe("—");
  });
});

describe("Partners page", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 17 }, access: ADMIN });
  });

  it("lists partners with terms, counts and the amount due", async () => {
    mockPartnerEndpoints({ partners: [partnerRow(), partnerRow({ Id: 2, Name: "Patel Traders", Mobile: "9000000002", CommType: "fixed", CommValue: 5000, DueAmount: 2500 }), partnerRow({ Id: 3, Name: "Walk-in Agent", DueAmount: 0, Mobile: "9000000003", CommType: null, CommValue: null })] });
    renderWithProviders(<Partners />);
    expect(await screen.findByText("Sharma Associates")).toBeInTheDocument();
    expect(screen.getByText("9825012345")).toBeInTheDocument();
    expect(screen.getAllByText("Surat").length).toBeGreaterThan(0);
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("₹5,000")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("₹4,000.00")).toBeInTheDocument();
    expect(screen.getByText("Usual commission")).toBeInTheDocument();
  });

  it("adds a partner with percent commission and refetches", async () => {
    const cap = mockPartnerEndpoints();
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    await user.click(screen.getByTestId("add-partner-btn"));
    await user.type(screen.getByTestId("partner-Name"), "New Firm");
    await user.type(screen.getByTestId("partner-Mobile"), "9000011111");
    await user.type(screen.getByTestId("partner-City"), "Pune");
    await user.click(screen.getByTestId("partner-CommType-input"));
    await user.click(await screen.findByRole("option", { name: "Percent of deal" }));
    await user.type(screen.getByTestId("partner-CommValue"), "10");
    await user.click(screen.getByTestId("partner-form-submit"));
    await waitFor(() => expect(cap.savePartner).toBeTruthy());
    expect(cap.savePartner).toMatchObject({ Id: 0, Name: "New Firm", Mobile: "9000011111", City: "Pune", CommType: "pct", CommValue: 10 });
    await waitFor(() => expect(cap.calls.fetchPartners.length).toBeGreaterThan(1));
  });

  it("with no commission type sends nulls and hides the value field", async () => {
    const cap = mockPartnerEndpoints();
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    await user.click(screen.getByTestId("add-partner-btn"));
    expect(screen.queryByTestId("partner-CommValue")).not.toBeInTheDocument();
    await user.type(screen.getByTestId("partner-Name"), "Plain Firm");
    await user.click(screen.getByTestId("partner-form-submit"));
    await waitFor(() => expect(cap.savePartner).toBeTruthy());
    expect(cap.savePartner).toMatchObject({ Id: 0, Name: "Plain Firm", CommType: null, CommValue: null });
  });

  it("refuses an empty name and a fixed commission with no amount", async () => {
    const cap = mockPartnerEndpoints();
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    await user.click(screen.getByTestId("add-partner-btn"));
    await user.click(screen.getByTestId("partner-form-submit"));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    await user.type(screen.getByTestId("partner-Name"), "X Firm");
    await user.click(screen.getByTestId("partner-CommType-input"));
    await user.click(await screen.findByRole("option", { name: "Fixed amount" }));
    await user.click(screen.getByTestId("partner-form-submit"));
    expect(await screen.findByText("Enter the commission amount")).toBeInTheDocument();
    expect(cap.savePartner).toBeUndefined();
  });

  it("shows the server's message inside the modal on a 409", async () => {
    mockPartnerEndpoints({ fail: { savePartner: "Another partner already has this mobile number" } });
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    await user.click(screen.getByTestId("add-partner-btn"));
    await user.type(screen.getByTestId("partner-Name"), "Dup");
    await user.click(screen.getByTestId("partner-form-submit"));
    const modal = await screen.findByTestId("partner-form-modal");
    expect(await within(modal).findByText("Another partner already has this mobile number")).toBeInTheDocument();
  });

  it("edits a partner: prefilled, posts its Id", async () => {
    const cap = mockPartnerEndpoints();
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    await user.click(screen.getByTestId("edit-partner-1"));
    expect(screen.getByTestId("partner-Name")).toHaveValue("Sharma Associates");
    expect(screen.getByTestId("partner-CommValue")).toHaveValue(10);
    await user.clear(screen.getByTestId("partner-City"));
    await user.type(screen.getByTestId("partner-City"), "Vapi");
    await user.click(screen.getByTestId("partner-form-submit"));
    await waitFor(() => expect(cap.savePartner).toBeTruthy());
    expect(cap.savePartner).toMatchObject({ Id: 1, Name: "Sharma Associates", City: "Vapi", CommType: "pct", CommValue: 10, IsActive: true });
  });

  it("editing an inactive partner keeps it inactive", async () => {
    const cap = mockPartnerEndpoints({ partners: [partnerRow({ IsActive: false })] });
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    await user.click(screen.getByTestId("edit-partner-1"));
    await user.click(screen.getByTestId("partner-form-submit"));
    await waitFor(() => expect(cap.savePartner).toBeTruthy());
    expect(cap.savePartner.IsActive).toBe(false);
  });

  it("allows a commission of 0", async () => {
    const cap = mockPartnerEndpoints();
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    await user.click(screen.getByTestId("add-partner-btn"));
    await user.type(screen.getByTestId("partner-Name"), "Zero Firm");
    await user.click(screen.getByTestId("partner-CommType-input"));
    await user.click(await screen.findByRole("option", { name: "Fixed amount" }));
    await user.type(screen.getByTestId("partner-CommValue"), "0");
    await user.click(screen.getByTestId("partner-form-submit"));
    await waitFor(() => expect(cap.savePartner).toBeTruthy());
    expect(cap.savePartner).toMatchObject({ CommType: "fixed", CommValue: 0 });
  });

  it("clears the server's message as soon as any field is edited", async () => {
    mockPartnerEndpoints({ fail: { savePartner: "Another partner already has this mobile number" } });
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    await user.click(screen.getByTestId("add-partner-btn"));
    await user.type(screen.getByTestId("partner-Name"), "Dup");
    await user.click(screen.getByTestId("partner-form-submit"));
    expect(await screen.findByTestId("partner-server-error")).toBeInTheDocument();
    await user.type(screen.getByTestId("partner-City"), "V");
    expect(screen.queryByTestId("partner-server-error")).not.toBeInTheDocument();
  });

  it("reactivates an inactive partner with its fields and IsActive true", async () => {
    const cap = mockPartnerEndpoints({ partners: [partnerRow({ IsActive: false })] });
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    expect(screen.queryByTestId("deactivate-partner-1")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("reactivate-partner-1"));
    await waitFor(() => expect(cap.savePartner).toBeTruthy());
    expect(cap.savePartner).toEqual({
      Id: 1, Name: "Sharma Associates", ContactPerson: "Raj", Mobile: "9825012345", Email: null, City: "Surat", Notes: null,
      CommType: "pct", CommValue: 10, IsActive: true,
    });
  });

  it("deactivates after confirming, and 'Show inactive' refetches with IncludeInactive", async () => {
    const cap = mockPartnerEndpoints();
    renderWithProviders(<Partners />);
    const user = userEvent.setup();
    await screen.findByText("Sharma Associates");
    await user.click(screen.getByTestId("deactivate-partner-1"));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(cap.savePartner).toBeTruthy());
    expect(cap.savePartner).toEqual({
      Id: 1, Name: "Sharma Associates", ContactPerson: "Raj", Mobile: "9825012345", Email: null, City: "Surat", Notes: null,
      CommType: "pct", CommValue: 10, IsActive: false,
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument());
    await user.click(screen.getByText("Show inactive"));
    await waitFor(() => expect(cap.fetchPartners).toEqual({ IncludeInactive: true }));
  });

  it("hides Add / Edit / Deactivate without the right", async () => {
    useAuthStore.setState({ access: { modules: { partners: { view: true } } } });
    mockPartnerEndpoints();
    renderWithProviders(<Partners />);
    await screen.findByText("Sharma Associates");
    expect(screen.queryByTestId("add-partner-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-partner-1")).not.toBeInTheDocument();
  });

  it("switches to the Commissions tab through the URL", async () => {
    mockPartnerEndpoints();
    renderWithProviders(<Partners />, { route: "/sales/partners?tab=commissions" });
    expect(await screen.findByText("Mehta Jewels")).toBeInTheDocument();
  });
});
