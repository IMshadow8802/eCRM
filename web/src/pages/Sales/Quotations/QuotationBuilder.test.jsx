import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Routes, Route } from "react-router-dom";

// The PDF engine cannot run in jsdom; the preview has its own tests. Here it
// reports what it was handed, which is exactly what this page is responsible for.
// `drawn` is the dial for "has the engine produced a file yet"; every test but
// one leaves it on.
const preview = vi.hoisted(() => ({ drawn: true }));
vi.mock("./builder/PdfPreview", () => ({
  __esModule: true,
  default: ({ doc, onReady }) => { if (preview.drawn) onReady?.(new Blob(["pdf"], { type: "application/pdf" })); return <div data-testid="pdf-preview">{doc.quoteNo}|{doc.grandTotalText}|{doc.company.name}</div>; },
}));
// MUI X 9's date field is contenteditable sections jsdom cannot type into.
vi.mock("../../../components/ui/DateField", () => import("../../../test/DateFieldStub"));
vi.mock("./pdf/fonts", () => ({ registerFonts: vi.fn(), FONT_FAMILIES: [] }));
vi.mock("./pdf/fontSources", () => ({ FONT_SOURCES: {} }));
vi.mock("../../../components/ui/RichTextEditor", () => ({
  __esModule: true,
  default: ({ label, value, onChange, disabled }) => <textarea aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("../../../api/attachmentQueries", () => ({ fetchAttachmentBlob: vi.fn(async () => ({ blob: new Blob(["x"], { type: "image/png" }), url: "blob:x" })), uploadAttachment: vi.fn() }));

import QuotationBuilder from "./QuotationBuilder";
import { uploadAttachment } from "../../../api/attachmentQueries";
import useAuthStore from "../../../stores/useAuthStore";
import { server } from "../../../test/mocks/server";
import renderWithProviders from "../../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });
const refuse = (code, message) => HttpResponse.json({ success: false, message, responseCode: code }, { status: code });

const COMPANY = { name: "Solar Care", gstin: "24ABCDE1234F1Z5", stateCode: "24", logoAttachmentId: 12, headerAttachmentId: null, showLogo: true, showHeader: false, accent: "#1e3a8a" };
const quotation = (over = {}) => ({
  Id: 4, LeadId: 9, LeadName: "Ramesh Patel", LeadStatusCode: "qualified", Status: "draft", QuoteNo: null, Revision: 1, RootId: 4, TemplateCode: "modern",
  QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "Rooftop", ToName: "Ramesh Patel", ToStateCode: "24", ToMobile: "9825012345",
  SellerGSTIN: "24ABCDE1234F1Z5", SellerStateCode: "24", Company: COMPANY, Content: { intro: "<p>Dear Ramesh ji</p>", terms: "", notes: "", sections: [] },
  SubTotal: 280000, DiscountTotal: 10000, TaxableTotal: 270000, CgstTotal: 16200, SgstTotal: 16200, IgstTotal: 0, RoundOff: 0, GrandTotal: 302400, ...over,
});
const LINES = [{ Id: 1, ProductId: 7, Description: "5 kW Rooftop", HSNCode: "8541", Qty: 1, Unit: "Set", Rate: 280000, DiscountType: "amt", DiscountValue: 10000, TaxPct: 12,
  GrossAmt: 280000, DiscountAmt: 10000, TaxableAmt: 270000, CgstAmt: 16200, SgstAmt: 16200, IgstAmt: 0, LineTotal: 302400 }];

function mocks({ q = quotation(), profile = { Id: 3, BranchId: 2, IsSet: true }, cap = {}, on = {} } = {}) {
  server.use(
    // `rewrite` stands in for a colleague writing the row between reads: React
    // Query hands back the identical object otherwise, and the reset effect
    // never even runs.
    http.post("*/api/quotations/fetchQuotationDetail", () => {
      cap.detailCalls = (cap.detailCalls ?? 0) + 1;
      const row = cap.detailCalls > 1 && on.rewrite ? { ...q, ...on.rewrite } : q;
      return json({ quotation: row, lines: LINES, revisions: [{ Id: 4, Revision: 1, QuoteNo: q.QuoteNo, Status: q.Status }] });
    }),
    http.post("*/api/quotations/ensureQuoteProfile", () => json({ profile })),
    http.post("*/api/products/fetchProducts", () => json({ products: [], pagination: {} })),
    http.post("*/api/quotations/saveQuotation", async ({ request }) => { cap.save = await request.json(); return on.save?.() ?? json({ Id: 4, ResponseCode: 200 }); }),
    http.post("*/api/quotations/saveQuoteProfile", async ({ request }) => { cap.profile = await request.json(); return json({ Id: 3 }); }),
    http.post("*/api/quotations/finaliseQuotation", async ({ request }) => { cap.finalise = await request.json(); return on.finalise?.() ?? json({ Id: 4, QuoteNo: "QT-2627-0042" }); }),
    http.post("*/api/quotations/reviseQuotation", async ({ request }) => { cap.revise = await request.json(); return json({ Id: 5 }); }),
    http.post("*/api/quotations/rejectQuotation", async ({ request }) => { cap.reject = await request.json(); return json({ Id: 4 }); }),
    http.post("*/api/quotations/deleteQuotation", async ({ request }) => { cap.remove = await request.json(); return json({ Id: 4 }); }),
    http.post("*/api/leads/convertLead", async ({ request }) => { cap.convert = await request.json(); return json({ Id: 9, CustomerId: 31, WonValue: 270000 }); }),
  );
  return cap;
}

const open = () => renderWithProviders(
  <Routes>
    <Route path="/sales/quotations/:quotationId" element={<QuotationBuilder />} />
    <Route path="/sales/leads/:leadId" element={<div data-testid="lead-page" />} />
  </Routes>,
  { route: "/sales/quotations/4" },
);

beforeEach(() => { preview.drawn = true; useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1, IsAdmin: false }, UserId: 1, companyName: "Solar Care", API_BASE_URL: "https://shadowcodes.in/CRM" }); });

describe("QuotationBuilder — a draft", () => {
  it("loads into the form and previews the live numbers", async () => {
    mocks();
    open();
    expect(await screen.findByDisplayValue("Ramesh Patel")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-preview")).toHaveTextContent("DRAFT|₹3,02,400.00|Solar Care");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled(); // nothing changed yet
  });

  it("recomputes the preview as a line changes, and saves the form — never a total", async () => {
    const cap = mocks();
    open();
    fireEvent.change(await screen.findByLabelText("Rate"), { target: { value: "300000" } });
    expect(screen.getByTestId("pdf-preview")).toHaveTextContent("₹3,24,800.00");
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({ Id: 4, LeadId: 9, TemplateCode: "modern", ToName: "Ramesh Patel" });
    expect(cap.save.Lines[0]).toEqual({ productId: 7, description: "5 kW Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: "300000", discountType: "amt", discountValue: 10000, taxPct: 12 });
    expect(JSON.stringify(cap.save)).not.toMatch(/GrandTotal|LineTotal|"key"/);
    expect(await screen.findByText("Quotation saved")).toBeInTheDocument();
  });

  // "The template remembers": the first person to fill a branch's letterhead
  // saves it for everyone after them, without being asked.
  it("remembers the company block the first time a branch fills it in", async () => {
    const cap = mocks({ profile: { Id: 3, BranchId: 2, IsSet: false } });
    open();
    fireEvent.change(await screen.findByLabelText("Phone"), { target: { value: "079 2658" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.profile).toBeTruthy());
    expect(cap.profile).toMatchObject({ LeadId: 9, CompanyName: "Solar Care", Phone: "079 2658", DefaultTemplate: "modern" });
  });

  it("does not touch a saved letterhead on an ordinary save, and hides the admin button from a non-admin", async () => {
    const cap = mocks();
    open();
    fireEvent.change(await screen.findByLabelText("Phone"), { target: { value: "079" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.profile).toBeUndefined();
    expect(screen.queryByRole("button", { name: /save as our default/i })).toBeNull();
  });

  it("lets an admin overwrite the saved letterhead, explicitly", async () => {
    useAuthStore.setState({ user: { UserId: 1, IsAdmin: true } });
    const cap = mocks();
    open();
    fireEvent.click(await screen.findByRole("button", { name: /save as our default/i }));
    await waitFor(() => expect(cap.profile).toMatchObject({ LeadId: 9, CompanyName: "Solar Care" }));
  });

  // Only the builder knows the art on the page is OUR placeholder.
  it("will not finalise while the sample logo is showing, and says why", async () => {
    mocks({ q: quotation({ Company: { ...COMPANY, logoAttachmentId: null } }) });
    open();
    const btn = await screen.findByRole("button", { name: /finalise/i });
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("finalise-blockers")).toHaveTextContent("Replace the sample logo, or remove it");
  });

  it("saves unsaved edits first, then finalises", async () => {
    const cap = mocks();
    open();
    fireEvent.change(await screen.findByLabelText("Rate"), { target: { value: "300000" } });
    fireEvent.click(screen.getByRole("button", { name: /finalise/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, finalise/i }));
    await waitFor(() => expect(cap.finalise).toEqual({ QuotationId: 4 }));
    expect(cap.save.Lines[0].rate).toBe("300000");
  });

  it("shows the server's refusal and stays a draft", async () => {
    mocks({ on: { finalise: () => refuse(400, "Choose the customer's state — GST depends on it") } });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /finalise/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, finalise/i }));
    expect(await screen.findByText(/GST depends on it/)).toBeInTheDocument();
  });

  // Everything on the left half has to reach the server, not just the fields
  // with their own test above.
  it("carries the whole form into the save — look, subject, prose and the pictures they hid", async () => {
    const cap = mocks();
    open();
    await screen.findByDisplayValue("Ramesh Patel");
    fireEvent.click(screen.getByTestId("template-classic"));
    fireEvent.change(screen.getByLabelText("Custom accent"), { target: { value: "#ff0000" } });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Rooftop 5 kW" } });
    fireEvent.change(screen.getByLabelText("Opening message"), { target: { value: "<p>Namaste</p>" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "<p>Payment in 30 days</p>" } });
    fireEvent.change(screen.getByLabelText("Terms & conditions"), { target: { value: "<p>50% advance</p>" } });
    fireEvent.click(within(screen.getByTestId("logo-slot")).getByRole("button", { name: /^remove$/i }));
    fireEvent.click(within(screen.getByTestId("header-slot")).getByRole("button", { name: /show banner/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({
      TemplateCode: "classic", Subject: "Rooftop 5 kW",
      Content: { intro: "<p>Namaste</p>", notes: "<p>Payment in 30 days</p>", terms: "<p>50% advance</p>" },
    });
    expect(cap.save.Company).toMatchObject({ accent: "#ff0000", showLogo: false, showHeader: true });
  });

  // A save takes half a second or two. What the user types in that window is
  // theirs; the server's copy is not newer than it.
  it("keeps the keystrokes that landed while the save was in flight", async () => {
    let release;
    // `rewrite` matters: without it the refetch returns the identical object,
    // structural sharing preserves the `data` reference, and the reset effect
    // this test is about never runs at all.
    const cap = mocks({ on: {
      save: () => new Promise((r) => { release = () => r(json({ Id: 4, ResponseCode: 200 })); }),
      rewrite: { Subject: "Sent to the server" },
    } });
    open();
    fireEvent.change(await screen.findByLabelText("Subject"), { target: { value: "Sent to the server" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Typed while it flew" } });
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled());
    expect(screen.getByLabelText("Subject")).toHaveValue("Typed while it flew"); // not reverted
    expect(cap.save.Subject).toBe("Sent to the server");                          // and not silently re-sent
    expect(await screen.findByText(/typed more since/i)).toBeInTheDocument();      // told, not contradicted
  });

  // staleTime 0 + refetch-on-focus: tabbing away and back re-reads the row.
  // A colleague's write must not delete this user's half-finished draft.
  it("does not let a background refetch discard unsaved edits", async () => {
    const cap = mocks({ on: { rewrite: { Subject: "Rewritten by someone else" } } });
    open();
    fireEvent.change(await screen.findByLabelText("Subject"), { target: { value: "Half written" } });
    const before = cap.detailCalls;
    fireEvent(window, new Event("visibilitychange"));
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(cap.detailCalls).toBeGreaterThan(before));
    expect(screen.getByLabelText("Subject")).toHaveValue("Half written");
  });

  // Minutes of typing behind one stray click.
  it("asks before walking away from unsaved work, and stays put until told", async () => {
    mocks();
    open();
    fireEvent.change(await screen.findByLabelText("Subject"), { target: { value: "Nearly done" } });
    fireEvent.click(screen.getByRole("button", { name: /back to lead/i }));
    expect(screen.queryByTestId("lead-page")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /leave anyway/i }));
    expect(await screen.findByTestId("lead-page")).toBeInTheDocument();
  });

  it("goes straight back when there is nothing to lose", async () => {
    mocks();
    open();
    fireEvent.click(await screen.findByRole("button", { name: /back to lead/i }));
    expect(await screen.findByTestId("lead-page")).toBeInTheDocument();
  });

  // The page's own wiring, not the components': a typo in one of these handlers
  // drops the field from the save with every component test still green.
  it("carries the place of supply — the field that decides CGST/SGST versus IGST", async () => {
    const cap = mocks();
    open();
    await screen.findByDisplayValue("Ramesh Patel");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("place-of-supply-input"));
    await user.click(await screen.findByText("Maharashtra (27)"));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save.ToStateCode).toBe("27");
  });

  it("carries both dates", async () => {
    const cap = mocks();
    open();
    fireEvent.change(await screen.findByLabelText("Quotation date"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("Valid till"), { target: { value: "2026-10-10" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(cap.save).toBeTruthy());
    expect(cap.save).toMatchObject({ QuoteDate: "2026-09-20", ValidTill: "2026-10-10" });
  });

  // The two upload destinations are NOT interchangeable. The letterhead belongs
  // to the branch and outlives every quotation drawn on it; a section picture
  // belongs to this quotation and is swept away with it.
  it("hangs the letterhead on the BRANCH's profile, so the next quotation reuses it", async () => {
    mocks();
    uploadAttachment.mockResolvedValue({ data: { data: { attachmentId: 77 } } });
    open();
    const file = new File(["png"], "logo.png", { type: "image/png" });
    fireEvent.change(await screen.findByTestId("logo-slot-file"), { target: { files: [file] } });
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith({ Entity: "quoteprofile", EntityId: 3, file }));
    // the new logo is an unsaved change on the form, not just a file on the server
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled());
  });

  it("hangs an extra section's picture on THIS quotation", async () => {
    mocks();
    uploadAttachment.mockResolvedValue({ data: { data: { attachmentId: 88 } } });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /add picture section/i }));
    const file = new File(["png"], "site.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("section-file"), { target: { files: [file] } });
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith({ Entity: "quotation", EntityId: 4, file }));
  });

  it("says what is wrong with a picture the PDF cannot draw", async () => {
    mocks();
    open();
    fireEvent.change(await screen.findByTestId("logo-slot-file"), { target: { files: [new File(["gif"], "logo.gif", { type: "image/gif" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/PNG or JPEG/i);
  });

  it("deletes the draft and goes back to the lead", async () => {
    const cap = mocks();
    open();
    fireEvent.click(await screen.findByRole("button", { name: /delete draft/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, delete/i }));
    await waitFor(() => expect(cap.remove).toEqual({ QuotationId: 4 }));
    expect(await screen.findByTestId("lead-page")).toBeInTheDocument();
  });
});

describe("QuotationBuilder — issued", () => {
  const final = quotation({ Status: "final", QuoteNo: "QT-2627-0042" });

  it("is read-only and prints the SERVER's numbers", async () => {
    mocks({ q: quotation({ Status: "final", QuoteNo: "QT-2627-0042", GrandTotal: 302401 }) }); // deliberately not what quoteMath would give
    open();
    expect(await screen.findByDisplayValue("Ramesh Patel")).toBeDisabled();
    expect(screen.getByTestId("pdf-preview")).toHaveTextContent("QT-2627-0042|₹3,02,401.00");
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add line/i })).toBeNull();
  });

  // Regression, 2026-09-19: Download lived only in the non-editable branch.
  // The preview beside it is an <iframe>, and a phone may render nothing in
  // one at all (Chrome on Android has no inline PDF viewer), so someone
  // editing a draft on a phone had no way whatsoever to see the document they
  // were building.
  it("offers the download on a draft too, not only on a finalised quotation", async () => {
    mocks({ q: quotation({ Status: "draft" }) });
    open();
    expect(await screen.findByRole("button", { name: /download pdf/i })).toBeInTheDocument();
    // Still a draft: the draft-only actions are the ones on screen.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("downloads the PDF that is on screen, named for the customer", async () => {
    mocks({ q: final });
    URL.createObjectURL = vi.fn(() => "blob:dl"); URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { click.file = this.download; });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /download pdf/i }));
    expect(click.file).toBe("QT-2627-0042 - Ramesh Patel.pdf");
    click.mockRestore();
  });

  it("accepts: converts the lead through this quotation", async () => {
    const cap = mocks({ q: final });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /accepted/i }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, they accepted/i }));
    await waitFor(() => expect(cap.convert).toEqual({ LeadId: 9, QuotationId: 4 }));
  });

  it("rejects with optional remarks", async () => {
    const cap = mocks({ q: final });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /rejected/i }));
    const modal = await screen.findByTestId("remarks-modal");
    fireEvent.change(within(modal).getByLabelText(/remarks/i), { target: { value: "too expensive" } });
    fireEvent.click(within(modal).getByRole("button", { name: /mark rejected/i }));
    await waitFor(() => expect(cap.reject).toEqual({ QuotationId: 4, Remarks: "too expensive" }));
  });

  it("revises into a new draft and opens it", async () => {
    const cap = mocks({ q: final });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /revise/i }));
    await waitFor(() => expect(cap.revise).toEqual({ QuotationId: 4 }));
    // REGRESSION: the new id empties the query while the old form is still in
    // state. Reading the row in that gap threw, and the page the revision was
    // supposed to open never drew.
    expect(await screen.findByTestId("quotation-builder")).toBeInTheDocument();
  });

  it("says the preview is still drawing rather than doing nothing", async () => {
    preview.drawn = false;
    mocks({ q: final });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /download pdf/i }));
    expect(await screen.findByText(/still drawing/i)).toBeInTheDocument();
  });

  // The only place a user reads why their quotation was turned down.
  it("shows the closing remarks on a rejected quotation", async () => {
    mocks({ q: quotation({ Status: "rejected", QuoteNo: "QT-2627-0042", CloseRemarks: "Too expensive — went with a local installer" }) });
    open();
    expect(await screen.findByText(/went with a local installer/)).toBeInTheDocument();
  });

  it("offers no Revise on a closed lead — its quotations are history", async () => {
    mocks({ q: quotation({ Status: "unused", QuoteNo: "QT-2627-0042", LeadStatusCode: "converted" }) });
    open();
    await screen.findByRole("button", { name: /download pdf/i });
    expect(screen.queryByRole("button", { name: /revise/i })).toBeNull();
  });
});

describe("QuotationBuilder — not there", () => {
  it("does not blame a deleted quotation for a server that fell over", async () => {
    server.use(http.post("*/api/quotations/fetchQuotationDetail", () => refuse(500, "boom")));
    open();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/may have been deleted/i)).toBeNull();
  });

  it("says so instead of spinning", async () => {
    server.use(http.post("*/api/quotations/fetchQuotationDetail", () => refuse(404, "Quotation not found")));
    open();
    expect(await screen.findByText(/quotation not found/i)).toBeInTheDocument();
  });
});
