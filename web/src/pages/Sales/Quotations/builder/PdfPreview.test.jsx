import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

// The PDF engine cannot run in jsdom. The hook has its own tests (Task 14);
// here it is a dial, so each state this component draws can be rendered.
vi.mock("../usePdfPreview", () => ({ usePdfPreview: vi.fn() }));

import { usePdfPreview } from "../usePdfPreview";
import PdfPreview from "./PdfPreview";
import renderWithProviders from "../../../../test/renderWithProviders";

const Template = () => null;
const show = (instance) => {
  usePdfPreview.mockReturnValue({ url: null, blob: null, loading: false, error: null, ...instance });
  const onReady = vi.fn();
  renderWithProviders(<PdfPreview Component={Template} doc={{ quoteNo: "QT-2627-0042" }} onReady={onReady} />);
  return onReady;
};

beforeEach(() => vi.clearAllMocks());

describe("PdfPreview", () => {
  it("frames the drawn PDF and hands the blob up, so Download saves what is on screen", () => {
    const blob = new Blob(["pdf"], { type: "application/pdf" });
    const onReady = show({ url: "blob:preview", blob });
    expect(screen.getByTitle("Quotation preview")).toHaveAttribute("src", "blob:preview#toolbar=0&navpanes=0");
    expect(onReady).toHaveBeenCalledWith(blob);
  });

  it("says it is drawing while there is nothing to show yet", () => {
    const onReady = show({});
    expect(screen.queryByTitle("Quotation preview")).toBeNull();
    expect(screen.getByText(/drawing the preview/i)).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
  });

  // A failed preview must never read as "your work is gone".
  it("reassures instead of blaming when the draw fails, and shows no stale frame", () => {
    show({ error: new Error("boom"), url: "blob:stale" });
    expect(screen.getByRole("alert")).toHaveTextContent(/changes are safe/i);
    expect(screen.queryByTitle("Quotation preview")).toBeNull();
  });
});

// Regression, 2026-09-19: the preview is an <iframe> holding an A4 page with
// `#toolbar=0`, which strips the viewer's zoom. At 336px that puts 9pt body
// text at about 6.7 CSS pixels — and a phone may not render a PDF in an
// iframe at all (Chrome on Android shows an empty box). There was no other
// route to the document, so a draft could not be read on a phone.
describe("the escape hatch out of the iframe", () => {
  it("offers the same file in the browser's own viewer", () => {
    usePdfPreview.mockReturnValue({ url: "blob:abc", blob: new Blob(), error: null });
    renderWithProviders(<PdfPreview Component={() => null} doc={{}} />, { router: false });
    const open = screen.getByTestId("pdf-preview-open");
    expect(open).toHaveAttribute("href", "blob:abc");
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("offers nothing to open while the file is still being drawn", () => {
    usePdfPreview.mockReturnValue({ url: null, blob: null, error: null });
    renderWithProviders(<PdfPreview Component={() => null} doc={{}} />, { router: false });
    expect(screen.queryByTestId("pdf-preview-open")).toBeNull();
  });
});
