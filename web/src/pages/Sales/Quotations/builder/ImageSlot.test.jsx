import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import ImageSlot from "./ImageSlot";
import renderWithProviders from "../../../../test/renderWithProviders";
import { buildTheme } from "../../../../theme";

// renderWithProviders' `rerender` swaps the whole tree, providers included —
// ImageSlot reads theme.tokens, so a rerender needs its own ThemeProvider.
const themed = (ui) => <ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>;

const base = { label: "Logo", src: "data:logo", onUpload: vi.fn(), onRemove: vi.fn(), onRestore: vi.fn(), "data-testid": "logo" };

describe("ImageSlot", () => {
  it("shows the image and hands a chosen file to onUpload", () => {
    const onUpload = vi.fn();
    renderWithProviders(<ImageSlot {...base} onUpload={onUpload} />);
    expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute("src", "data:logo");
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("logo-file"), { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it("opens the file picker from the Replace button", () => {
    renderWithProviders(<ImageSlot {...base} />);
    const input = screen.getByTestId("logo-file");
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: /replace/i }));
    expect(click).toHaveBeenCalled();
  });

  // The whole point of shipping sample art: it must be obvious that it is ours,
  // not theirs — Finalise is blocked until it is replaced or removed.
  it("says so when what is showing is our sample", () => {
    renderWithProviders(<ImageSlot {...base} isSample />);
    expect(screen.getByText(/sample/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /replace/i })).toBeInTheDocument();
  });

  it("can be removed outright, and brought back", () => {
    const onRemove = vi.fn(); const onRestore = vi.fn();
    const { rerender } = renderWithProviders(<ImageSlot {...base} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
    rerender(themed(<ImageSlot {...base} hidden onRestore={onRestore} />));
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(onRestore).toHaveBeenCalled();
  });

  it("offers nothing to press when disabled (an issued quotation)", () => {
    renderWithProviders(<ImageSlot {...base} disabled />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lays out wide for the banner slot", () => {
    renderWithProviders(<ImageSlot {...base} wide />);
    const img = screen.getByRole("img", { name: "Logo" });
    // wide: full-width frame, image cropped to fill — not the square 88px
    // "contain" frame every other slot (logo) uses.
    expect(img.parentElement).toHaveStyle({ width: "100%" });
    expect(img).toHaveStyle({ objectFit: "cover" });
  });

  it("shows Replace as busy while an upload is in flight", () => {
    renderWithProviders(<ImageSlot {...base} busy />);
    expect(screen.getAllByRole("button")[0]).toHaveAttribute("aria-busy", "true");
  });

  it("draws no image when there is no src yet", () => {
    renderWithProviders(<ImageSlot {...base} src={null} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
