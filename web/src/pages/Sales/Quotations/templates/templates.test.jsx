import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@react-pdf/renderer", () => import("../../../../test/reactPdfMock"));
vi.mock("react-pdf-html", async () => ({ default: (await import("../../../../test/reactPdfMock")).Html }));

import { TEMPLATES, templateByCode } from "./index";
import RichHtml from "../pdf/RichHtml";
import { buildQuoteDoc } from "../buildQuoteDoc";
import { computeQuote } from "../quoteMath";

afterEach(cleanup);

const items = [
  { description: "5 kW Rooftop", hsn: "8541", qty: 1, unit: "Set", rate: 280000, discountType: "amt", discountValue: 10000, taxPct: 12 },
  { description: "Installation", hsn: "9954", qty: 1, unit: "Job", rate: 20000, discountType: "pct", discountValue: 0, taxPct: 18 },
];
const company = { name: "Solar Care Pvt Ltd", address: "402 Titanium", city: "Ahmedabad", stateCode: "24", gstin: "24ABCDE1234F1Z5", bank: "HDFC 123", signatory: "Amit Shah", logoAttachmentId: 9 };
const header = { Status: "final", QuoteNo: "QT-2627-0042", QuoteDate: "2026-09-18", ValidTill: "2026-10-03", Subject: "Rooftop solar", ToName: "Ramesh Patel", ToStateCode: "24" };
const content = { intro: "<p>Dear Ramesh ji</p>", terms: "<p>50% advance</p>", sections: [{ type: "images", title: "Sites", items: [{ attachmentId: 21, caption: "Bopal" }] }] };

const docFor = (over = {}) => {
  const h = { ...header, ...(over.header ?? {}) };
  const c = { ...company, ...(over.company ?? {}) };
  const it = over.items ?? items;
  const ct = over.content ?? content;
  return buildQuoteDoc({ header: h, company: c, content: ct, items: it, images: { 9: "data:logo", 21: "data:site" }, samples: { logo: "sample:logo", header: "sample:header" },
    amounts: computeQuote(it, { sellerGstin: c.gstin, sellerState: c.stateCode, buyerState: h.ToStateCode }) });
};
const draw = (Component, over) => render(<Component doc={docFor(over)} />);
const texts = () => screen.getAllByText((_, el) => el.dataset.pdf === "text").map((el) => el.textContent);

describe.each(TEMPLATES.map((t) => [t.code, t.Component]))("template %s", (_code, Component) => {
  it("prints the parties, every line, the grand total and its words", () => {
    draw(Component);
    const all = texts().join(" | ");
    for (const s of ["Solar Care Pvt Ltd", "Ramesh Patel", "QT-2627-0042", "18-09-2026", "5 kW Rooftop", "Installation", "₹3,26,000.00", "Rupees Three Lakh Twenty Six Thousand Only", "Amit Shah", "HDFC 123"]) {
      expect(all).toContain(s);
    }
  });

  it("prints the buyer's GSTIN when the buyer is registered", () => {
    draw(Component, { header: { ToGSTIN: "24AAAAA0000A1Z5" } });
    expect(texts().some((t) => t.startsWith("GSTIN 24AAAAA0000A1Z5"))).toBe(true);
  });

  it("intra-state: CGST and SGST, no IGST", () => {
    draw(Component);
    const all = texts();
    expect(all).toContain("CGST"); expect(all).toContain("SGST"); expect(all).not.toContain("IGST");
  });

  it("inter-state: IGST, no CGST or SGST", () => {
    draw(Component, { header: { ToStateCode: "27" } });
    const all = texts();
    expect(all).toContain("IGST"); expect(all).not.toContain("CGST"); expect(all).not.toContain("SGST");
    expect(all.join(" ")).toContain("Maharashtra (27)");
  });

  // An unregistered seller charges no GST. A "GST" column of blanks, a tax
  // summary of zeros, or a "GSTIN" label with nothing after it would all be wrong.
  it("unregistered seller: no GST column, no tax summary, no GSTIN line", () => {
    draw(Component, { company: { gstin: "" } });
    const all = texts();
    expect(all).not.toContain("GST"); expect(all).not.toContain("Tax summary"); expect(all).not.toContain("CGST");
    expect(all.some((t) => t.startsWith("GSTIN"))).toBe(false);
  });

  it("hides the HSN and discount columns when no line uses them", () => {
    const plainItems = [{ description: "Basic item", hsn: "", qty: 1, unit: "Nos", rate: 1000, discountType: "amt", discountValue: 0, taxPct: 18 }];
    draw(Component, { items: plainItems });
    const all = texts();
    expect(all).not.toContain("HSN/SAC");
    expect(all).not.toContain("Disc.");
  });

  it("stamps DRAFT on a draft and only on a draft", () => {
    draw(Component, { header: { Status: "draft", QuoteNo: null } });
    expect(texts().filter((t) => t === "DRAFT").length).toBeGreaterThanOrEqual(1);
  });
  it("does not stamp a final quotation", () => {
    draw(Component);
    expect(texts()).not.toContain("DRAFT");
  });

  it("draws the company's logo, the sample banner until one is chosen, and the section pictures", () => {
    draw(Component);
    const srcs = [...document.querySelectorAll('img[data-pdf="image"]')].map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(expect.arrayContaining(["data:logo", "sample:header", "data:site"]));
  });

  it("draws no image at all once both are switched off", () => {
    draw(Component, { company: { showLogo: false, showHeader: false } });
    const srcs = [...document.querySelectorAll('img[data-pdf="image"]')].map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["data:site"]);
  });

  it("hands the rich text to the HTML renderer, already reduced to drawable tags", () => {
    draw(Component);
    const html = [...document.querySelectorAll('[data-pdf="html"]')].map((n) => n.textContent);
    expect(html).toEqual(expect.arrayContaining(["<p>Dear Ramesh ji</p>", "<p>50% advance</p>"]));
  });

  it("renders a written extra section — title and body both", () => {
    const withText = { ...content, sections: [...content.sections, { type: "text", title: "Delivery", body: "<p>Ex-works, freight extra</p>" }] };
    draw(Component, { content: withText });
    expect(texts()).toContain("Delivery");
    const html = [...document.querySelectorAll('[data-pdf="html"]')].map((n) => n.textContent);
    expect(html).toContain("<p>Ex-works, freight extra</p>");
  });

  it("hides the bank/signatory block entirely when both are blank", () => {
    draw(Component, { company: { bank: "", signatory: "" } });
    const all = texts();
    expect(all).not.toContain("Bank details");
    expect(all).not.toContain("Authorised signatory");
    expect(all.some((t) => t.startsWith("For "))).toBe(false);
  });

  it("falls back to 'Authorised signatory' when a bank is set but no signatory name is", () => {
    draw(Component, { company: { signatory: "" } });
    expect(texts()).toContain("Authorised signatory");
  });

  // A line item sliced across two pages is the classic PDF-table failure.
  it("never lets a line row break across pages, and repeats the footer on every page", () => {
    draw(Component);
    const row = screen.getByText("5 kW Rooftop").closest('[data-pdf="view"]');
    expect(row.dataset.wrap).toBe("false");
    const footer = screen.getByText("Page 1 of 1").closest('[data-pdf="view"]');
    expect(footer.dataset.fixed).toBe("");
  });

  it("titles the document for the PDF viewer's tab", () => {
    draw(Component);
    expect(document.querySelector('[data-pdf="document"]').dataset.title).toBe("Quotation QT-2627-0042");
  });
});

describe("template registry", () => {
  it("ships three, by stable code", () => expect(TEMPLATES.map((t) => t.code)).toEqual(["classic", "modern", "minimal"]));
  it("falls back to the first for a code it does not know", () => {
    expect(templateByCode("modern").name).toBe("Modern");
    expect(templateByCode("gone").code).toBe("classic");
    expect(templateByCode(undefined).code).toBe("classic");
  });
});

// RichHtml's own empty guard. Every caller in parts.jsx checks `!html` before
// rendering it, so this branch is unreachable from a template — but the
// component is exported on its own, and the next caller may not check.
describe("RichHtml", () => {
  it("draws nothing at all for empty html, rather than an empty block", () => {
    const { container } = render(<RichHtml html="" accent="#1e3a8a" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the html when there is some", () => {
    render(<RichHtml html="<p>Terms apply</p>" accent="#1e3a8a" />);
    expect(screen.getByText(/Terms apply/)).toBeInTheDocument();
  });
});

// Found in the live pass (2026-09-19): a 34-line quotation ran to three pages and
// page 2 opened straight into numbers — Rate, Disc. and Amount are all currency,
// so without the header a reader cannot tell which is which. `fixed` repeats it.
describe("the line table's header", () => {
  it("repeats on every page the table spans", () => {
    draw(TEMPLATES[0].Component);
    const header = screen.getAllByText("Description")[0].closest('[data-pdf="view"]');
    expect(header).toHaveAttribute("data-fixed");
  });
});

