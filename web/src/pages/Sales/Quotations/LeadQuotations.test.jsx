import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Routes, Route } from "react-router-dom";
import LeadQuotations from "./LeadQuotations";
import useAuthStore from "../../../stores/useAuthStore";
import { server } from "../../../test/mocks/server";
import renderWithProviders from "../../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const LEAD = { Id: 9, Name: "Ramesh Patel", Company: "", MobileNo: "9825012345", City: "Ahmedabad", State: "Gujarat", ProductId: 7, StatusCode: "qualified" };
const ROWS = [
  { Id: 4, QuoteNo: "QT-2627-0042", Revision: 1, Status: "final", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", GrandTotal: 302400, IsExpired: false },
  { Id: 5, QuoteNo: null, Revision: 2, Status: "draft", QuoteDate: "2026-09-19", ValidTill: null, GrandTotal: 296800, IsExpired: false },
];
const mocks = (rows = ROWS, cap = {}) => {
  server.use(
    http.post("*/api/quotations/fetchQuotations", () => json({ quotations: rows, pagination: {} })),
    http.post("*/api/quotations/ensureQuoteProfile", () => json({ profile: { Id: 3, CompanyName: "Solar Care", DefaultTemplate: "modern", IsSet: true } })),
    http.post("*/api/products/fetchProducts", () => json({ products: [{ Id: 7, Name: "5 kW Rooftop", UnitPrice: 280000, TaxPct: 12 }], pagination: {} })),
    http.post("*/api/quotations/saveQuotation", async ({ request }) => { cap.save = await request.json(); return json({ Id: 12, ResponseCode: 200 }); }),
  );
  return cap;
};
const draw = (lead = LEAD, onCount = vi.fn()) => {
  renderWithProviders(
    <Routes>
      <Route path="/sales/leads/9" element={<LeadQuotations lead={lead} onCount={onCount} />} />
      <Route path="/sales/quotations/:id" element={<div data-testid="builder" />} />
    </Routes>, { route: "/sales/leads/9" },
  );
  return onCount;
};

beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, companyName: "Solar Care", API_BASE_URL: "https://shadowcodes.in/CRM" }));

describe("LeadQuotations", () => {
  it("lists the lead's quotations and reports how many", async () => {
    mocks();
    const onCount = draw();
    expect(await screen.findByText("QT-2627-0042")).toBeInTheDocument();
    expect(screen.getByText(/draft · revision 2/i)).toBeInTheDocument();
    expect(screen.getByText("₹3,02,400.00")).toBeInTheDocument();
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(2));
  });

  it("opens a quotation in the builder", async () => {
    mocks();
    draw();
    fireEvent.click(await screen.findByText("QT-2627-0042"));
    expect(await screen.findByTestId("builder")).toBeInTheDocument();
  });

  // The builder must open already filled in — that is the whole pitch.
  it("creates a draft from the lead, the branch's letterhead and the lead's product, then opens it", async () => {
    const cap = mocks([]);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /create quotation/i }));
    fireEvent.click(await screen.findByTestId("template-minimal"));
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({ Id: 0, LeadId: 9, TemplateCode: "minimal", ToName: "Ramesh Patel", ToMobile: "9825012345", ToStateCode: "24" });
    expect(cap.save.Company.name).toBe("Solar Care");
    expect(cap.save.Lines[0]).toMatchObject({ productId: 7, description: "5 kW Rooftop", rate: 280000, taxPct: 12 });
    expect(await screen.findByTestId("builder")).toBeInTheDocument();
  });

  it("pre-selects the branch's usual template", async () => {
    mocks([]);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /create quotation/i }));
    // The picker renders its cards immediately; which one shows "checked"
    // depends on ensureQuoteProfile, a separate in-flight fetch — poll for it
    // rather than racing the first paint.
    await waitFor(() => expect(screen.getByTestId("template-modern")).toHaveAttribute("aria-checked", "true"));
  });

  it("Cancel closes the picker without creating anything", async () => {
    const cap = mocks([]);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /create quotation/i }));
    await screen.findByTestId("template-picker");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByTestId("template-picker-root")).not.toBeInTheDocument());
    expect(cap.save).toBeUndefined();
  });

  // A closed lead's quotations are history: readable, never extendable.
  it("offers no Create on a lead that is won, lost or junk", async () => {
    mocks();
    draw({ ...LEAD, StatusCode: "converted" });
    await screen.findByText("QT-2627-0042");
    expect(screen.queryByRole("button", { name: /create quotation/i })).toBeNull();
  });

  it("says so when there are none", async () => {
    mocks([]);
    draw();
    expect(await screen.findByText(/no quotations yet/i)).toBeInTheDocument();
  });
});
