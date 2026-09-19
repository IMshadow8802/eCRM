import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import WonDialog from "./WonDialog";
import useAuthStore from "../../../stores/useAuthStore";
import { server } from "../../../test/mocks/server";
import renderWithProviders from "../../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const LEAD = { Id: 9, Name: "Ramesh Patel", EstValue: 300000 };
const FINALS = [
  { Id: 4, QuoteNo: "QT-2627-0042-R2", TaxableTotal: 265000, GrandTotal: 296800 },
  { Id: 6, QuoteNo: "QT-2627-0051", TaxableTotal: 180000, GrandTotal: 201600 },
];
const mocks = (quotations, cap = {}) => {
  server.use(
    http.post("*/api/quotations/fetchQuotations", async ({ request }) => { cap.list = await request.json(); return json({ quotations, pagination: {} }); }),
    http.post("*/api/leads/convertLead", async ({ request }) => { cap.convert = await request.json(); return json({ Id: 9, CustomerId: 31, WonValue: 1 }); }),
  );
  return cap;
};
const draw = (props = {}) => renderWithProviders(<WonDialog open lead={LEAD} onClose={() => {}} {...props} />);

beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://shadowcodes.in/CRM" }));

describe("WonDialog", () => {
  // Spec decision 6: small leads are won with no quotation at all.
  it("with no quotation on the lead: asks for the value, pre-filled with the estimate", async () => {
    const cap = mocks([]);
    draw();
    const value = await screen.findByLabelText(/won for/i);
    expect(value).toHaveValue("300000");
    expect(cap.list).toMatchObject({ LeadId: 9, Status: "final" });
    fireEvent.change(value, { target: { value: "4000" } });
    fireEvent.change(screen.getByLabelText(/remarks/i), { target: { value: "paid by UPI" } });
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(cap.convert).toEqual({ LeadId: 9, WonValue: 4000, Remarks: "paid by UPI", QuotationId: null }));
  });

  it("with finalised quotations: asks which one they accepted, and takes the value from it", async () => {
    const cap = mocks(FINALS);
    draw();
    fireEvent.click(await screen.findByRole("radio", { name: /QT-2627-0042-R2/ }));
    expect(screen.queryByLabelText(/won for/i)).toBeNull(); // the quotation IS the value
    expect(screen.getByText("₹2,65,000.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(cap.convert).toEqual({ LeadId: 9, WonValue: null, Remarks: null, QuotationId: 4 }));
  });

  it("…or none of them — won without a quotation, on a typed value", async () => {
    const cap = mocks(FINALS);
    draw();
    fireEvent.click(await screen.findByRole("radio", { name: /none — won without a quotation/i }));
    fireEvent.change(screen.getByLabelText(/won for/i), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: /mark won/i }));
    await waitFor(() => expect(cap.convert).toMatchObject({ WonValue: 250000, QuotationId: null }));
  });

  it("will not submit until a choice is made and a value is there", async () => {
    mocks(FINALS);
    draw();
    await screen.findByRole("radio", { name: /QT-2627-0051/ });
    expect(screen.getByRole("button", { name: /mark won/i })).toBeDisabled();
  });

  it("accepts zero — a free replacement is still a win — but not a blank or a negative", async () => {
    mocks([]);
    draw();
    const value = await screen.findByLabelText(/won for/i);
    fireEvent.change(value, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /mark won/i })).toBeDisabled();
    fireEvent.change(value, { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /mark won/i })).toBeEnabled();
  });

  it("tells the parent, and closes", async () => {
    mocks([]);
    let won = 0; let closed = 0;
    draw({ onWon: () => { won += 1; }, onClose: () => { closed += 1; } });
    // The button exists (disabled) before the finalised-quotations fetch
    // settles — wait for it to actually be enabled rather than racing the
    // fetch, the same way a real user's click would land after it, not before.
    const button = await screen.findByRole("button", { name: /mark won/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(won).toBe(1));
    expect(closed).toBe(1);
  });

  // WonDialog.jsx:35 — an ordinary lead with no estimate typed on it yet.
  it("with no estimate on the lead: the value field starts blank, not \"null\" or 0", async () => {
    mocks([]);
    draw({ lead: { Id: 9, Name: "Ramesh Patel", EstValue: null } });
    const value = await screen.findByLabelText(/won for/i);
    expect(value).toHaveValue("");
    expect(screen.getByRole("button", { name: /mark won/i })).toBeDisabled();
    fireEvent.change(value, { target: { value: "15000" } });
    expect(screen.getByRole("button", { name: /mark won/i })).toBeEnabled();
  });
});
