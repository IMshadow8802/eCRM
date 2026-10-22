import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CardDetailModal from "./CardDetailModal";
import renderWithProviders from "../../../test/renderWithProviders";
import { mockCardEndpoints, cardRow } from "../../../test/cardMocks";
import { palettes } from "../../../styles/tokens";
import { faceIndex } from "./cardColor";

let n;
beforeEach(() => {
  n = 0;
  URL.createObjectURL = vi.fn(() => `blob:p${++n}`);
  URL.revokeObjectURL = vi.fn();
});

describe("CardDetailModal", () => {
  it("shows every field, tel/mailto links and both photos", async () => {
    mockCardEndpoints();
    renderWithProviders(<CardDetailModal open card={cardRow()} onClose={() => {}} />);
    expect(screen.getByText("Shree Traders")).toBeInTheDocument();
    expect(screen.getByText("24ABCDE1234F1Z5")).toBeInTheDocument();
    expect(screen.getByText("Met at expo")).toBeInTheDocument();
    expect(screen.getByText("12 Ring Road, Surat")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "9825012346" })).toHaveAttribute("href", "tel:9825012346");
    expect(screen.getByRole("link", { name: "0261-222333" })).toHaveAttribute("href", "tel:0261-222333");
    expect(screen.getByRole("link", { name: "sales@shree.in" })).toHaveAttribute("href", "mailto:sales@shree.in");
    const imgs = await screen.findAllByRole("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("src")).toMatch(/^blob:/);
  });

  it("no back photo means one image; empty optional fields are skipped", async () => {
    mockCardEndpoints();
    renderWithProviders(<CardDetailModal open card={cardRow({ backImage: "", website: "", mobiles: [] })} onClose={() => {}} />);
    expect(await screen.findAllByRole("img")).toHaveLength(1);
    expect(screen.queryByText("Website")).toBeNull();
  });

  it("the same number listed twice renders both without a duplicate-key warning", async () => {
    mockCardEndpoints();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(<CardDetailModal open card={cardRow({ mobiles: ["9825012346", "9825012346"] })} onClose={() => {}} />);
    expect(screen.getAllByRole("link", { name: "9825012346" })).toHaveLength(2);
    const keyWarn = err.mock.calls.some((c) => String(c[0]).includes("same key"));
    err.mockRestore();
    expect(keyWarn).toBe(false);
  });

  it("a failed photo says so and the rest still renders", async () => {
    mockCardEndpoints({ photoFails: true });
    renderWithProviders(<CardDetailModal open card={cardRow({ backImage: "" })} onClose={() => {}} />);
    expect(await screen.findByText("Photo unavailable")).toBeInTheDocument();
    expect(screen.getByText("Wholesale")).toBeInTheDocument();
  });

  it("click on a photo opens it full size", async () => {
    mockCardEndpoints();
    renderWithProviders(<CardDetailModal open card={cardRow({ backImage: "" })} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("img"));
    expect(await screen.findByTestId("card-photo-full")).toBeInTheDocument();
    const closers = screen.getAllByRole("button", { name: "Close modal" });
    await userEvent.click(closers.at(-1));
    await waitFor(() => expect(screen.queryByTestId("card-photo-full")).toBeNull());
  });

  it("revokes object URLs when closed", async () => {
    mockCardEndpoints();
    const { rerender } = renderWithProviders(<CardDetailModal open card={cardRow()} onClose={() => {}} />, { router: false });
    await screen.findAllByRole("img");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    rerender(<div />);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2));
  });

  it("the header band wears the card's pastel with name and person · designation", () => {
    mockCardEndpoints();
    renderWithProviders(<CardDetailModal open card={cardRow({ id: 9 })} onClose={() => {}} />, { mode: "dark" });
    const band = screen.getByTestId("card-band");
    expect(band.dataset.face).toBe(palettes.dark.cardFace.faces[faceIndex(9)]);
    expect(band).toHaveTextContent("Shree Traders");
    expect(band).toHaveTextContent("Ramesh Shah · Owner");
  });

  it("an unnamed card is titled 'Visiting card'", () => {
    mockCardEndpoints();
    renderWithProviders(<CardDetailModal open card={cardRow({ businessName: "", contactPerson: "", designation: "" })} onClose={() => {}} />);
    expect(screen.getByTestId("card-band")).toHaveTextContent("Visiting card");
  });

  it("renders nothing without a card", () => {
    mockCardEndpoints();
    renderWithProviders(<CardDetailModal open card={null} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
