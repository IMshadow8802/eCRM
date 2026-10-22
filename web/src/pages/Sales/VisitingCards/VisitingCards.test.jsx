import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import VisitingCards from "./VisitingCards";
import renderWithProviders from "../../../test/renderWithProviders";
import { mockCardEndpoints, cardRow } from "../../../test/cardMocks";
import { palettes } from "../../../styles/tokens";
import { faceIndex } from "./cardColor";

const { faces } = palettes.light.cardFace;
let n;
beforeEach(() => {
  n = 0;
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => `blob:p${++n}`);
  URL.revokeObjectURL = vi.fn();
});

const toTable = () => userEvent.click(screen.getByRole("button", { name: "Table view" }));

describe("VisitingCards — cards view (default)", () => {
  it("defaults to cards: name, person · designation, first number +N, owner and date", async () => {
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    const tile = await screen.findByTestId("card-tile-1");
    expect(screen.getByRole("button", { name: "Card view" })).toHaveAttribute("aria-pressed", "true");
    expect(within(tile).getByText("Shree Traders")).toBeInTheDocument();
    expect(within(tile).getByText("Ramesh Shah · Owner")).toBeInTheDocument();
    expect(within(tile).getByText("9825012345")).toBeInTheDocument();
    expect(within(tile).getByText("+2")).toBeInTheDocument();
    expect(within(tile).getByText("Asha Patel")).toBeInTheDocument();
    expect(within(tile).getByText("21-10-2026")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("colours each tile by its id, the same on every render", async () => {
    mockCardEndpoints({ rows: [cardRow({ id: 7 }), cardRow({ id: 8, businessName: "Other" })] });
    const { unmount } = renderWithProviders(<VisitingCards />);
    const face7 = (await screen.findByTestId("card-tile-7")).dataset.face;
    expect(face7).toBe(faces[faceIndex(7)]);
    expect(screen.getByTestId("card-tile-8").dataset.face).toBe(faces[faceIndex(8)]);
    unmount();
    renderWithProviders(<VisitingCards />);
    expect((await screen.findByTestId("card-tile-7")).dataset.face).toBe(face7);
  });

  it("shows the front photo once loaded", async () => {
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    const img = await screen.findByRole("img", { name: "Front of Shree Traders" });
    expect(img.getAttribute("src")).toMatch(/^blob:/);
  });

  it("a photo that fails shows the initial on a pastel face", async () => {
    mockCardEndpoints({ photoFails: true });
    renderWithProviders(<VisitingCards />);
    const fb = await screen.findByTestId("card-fallback-1");
    expect(fb).toHaveTextContent("S");
    expect(screen.queryByRole("img", { name: /Front of/ })).toBeNull();
  });

  it("a card without a front photo falls back without fetching", async () => {
    mockCardEndpoints({ rows: [cardRow({ frontImage: "", businessName: "", contactPerson: "", designation: "" })] });
    renderWithProviders(<VisitingCards />);
    expect(await screen.findByText("Untitled card")).toBeInTheDocument();
    expect(screen.getByTestId("card-fallback-1")).toHaveTextContent("?");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to the contact person, then email, and hides +N when alone", async () => {
    mockCardEndpoints({ rows: [cardRow({ businessName: "", mobiles: [], landlines: [], emails: ["x@y.in"], ownerName: "", receivedAt: null })] });
    renderWithProviders(<VisitingCards />);
    const tile = await screen.findByTestId("card-tile-1");
    expect(within(tile).getByText("Ramesh Shah")).toBeInTheDocument();
    expect(within(tile).getByText("Owner")).toBeInTheDocument();
    expect(within(tile).getByText("x@y.in")).toBeInTheDocument();
    expect(within(tile).queryByText(/^\+/)).toBeNull();
  });

  it("click opens the detail modal", async () => {
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    await userEvent.click(await screen.findByTestId("card-tile-1"));
    expect(await screen.findByRole("link", { name: "9825012346" })).toBeInTheDocument();
  });

  it("Enter and Space on a focused tile open the modal", async () => {
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    const tile = await screen.findByTestId("card-tile-1");
    tile.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("link", { name: "9825012346" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close modal" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "9825012346" })).toBeNull());
    tile.focus();
    await userEvent.keyboard(" ");
    expect(await screen.findByRole("link", { name: "9825012346" })).toBeInTheDocument();
  });

  it("other keys do nothing", async () => {
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    const tile = await screen.findByTestId("card-tile-1");
    tile.focus();
    await userEvent.keyboard("a");
    expect(screen.queryByRole("link", { name: "9825012346" })).toBeNull();
  });

  it("revokes photo URLs on unmount", async () => {
    mockCardEndpoints();
    const { unmount } = renderWithProviders(<VisitingCards />);
    await screen.findByRole("img", { name: "Front of Shree Traders" });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:p1");
  });

  it("pages 24 at a time with Prev / Next", async () => {
    const cap = mockCardEndpoints({ total: 50 });
    renderWithProviders(<VisitingCards />);
    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
    expect(cap.list.PageSize).toBe(24);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(cap.list.PageNumber).toBe(2));
    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument(); // page 1 is cached: no refetch
  });

  it("one page hides the pager", async () => {
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    await screen.findByTestId("card-tile-1");
    expect(screen.queryByText(/Page 1 of/)).toBeNull();
  });

  it("search sends SearchTerm; no match says so", async () => {
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    await screen.findByTestId("card-tile-1");
    const cap = mockCardEndpoints({ rows: [] });
    await userEvent.type(screen.getByRole("textbox", { name: "Search cards" }), "zzz");
    await waitFor(() => expect(screen.getByText("No cards match “zzz”")).toBeInTheDocument());
    expect(cap.list.SearchTerm).toBe("zzz");
  });

  it("empty list shows the empty state", async () => {
    mockCardEndpoints({ rows: [] });
    renderWithProviders(<VisitingCards />);
    expect(await screen.findByText("No visiting cards yet")).toBeInTheDocument();
  });

  it("a failed fetch shows an error with Retry, not the empty state", async () => {
    mockCardEndpoints({ fails: true });
    renderWithProviders(<VisitingCards />);
    // useApiQuery retries once (1 s) before the error lands.
    expect(await screen.findByText("Couldn't load visiting cards", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("No visiting cards yet")).toBeNull();
    mockCardEndpoints();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("card-tile-1")).toBeInTheDocument();
  });
});

describe("VisitingCards — table view", () => {
  it("toggle switches to the table and remembers it", async () => {
    mockCardEndpoints();
    const { unmount } = renderWithProviders(<VisitingCards />);
    await screen.findByTestId("card-tile-1");
    await toTable();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByTestId("card-tile-1")).toBeNull();
    expect(localStorage.getItem("visitingCards.view")).toBe("table");
    unmount();
    renderWithProviders(<VisitingCards />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Table view" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Card view" }));
    expect(await screen.findByTestId("card-tile-1")).toBeInTheDocument();
  });

  it("broken storage still renders cards and still switches", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    await screen.findByTestId("card-tile-1");
    await toTable();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
  });

  it("lists business, contact, first mobile, first email, scanned by and received date", async () => {
    localStorage.setItem("visitingCards.view", "table");
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Shree Traders");
    expect(within(table).getByText("Ramesh Shah")).toBeInTheDocument();
    expect(within(table).getByText("9825012345")).toBeInTheDocument();
    expect(within(table).queryByText("9825012346")).toBeNull();
    expect(within(table).getByText("ramesh@shree.in")).toBeInTheDocument();
    expect(within(table).getByText("Asha Patel")).toBeInTheDocument();
    expect(within(table).getByText("21-10-2026")).toBeInTheDocument();
  });

  it("row click opens the detail modal", async () => {
    localStorage.setItem("visitingCards.view", "table");
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    await userEvent.click(await within(await screen.findByRole("table")).findByText("Shree Traders"));
    expect(await screen.findByRole("link", { name: "9825012346" })).toBeInTheDocument();
  });

  it("a card with no mobile or email shows dashes", async () => {
    localStorage.setItem("visitingCards.view", "table");
    mockCardEndpoints({ rows: [cardRow({ mobiles: [], emails: [], contactPerson: "", receivedAt: null })] });
    renderWithProviders(<VisitingCards />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Shree Traders");
    expect(within(table).getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("an unknown stored view falls back to cards", async () => {
    localStorage.setItem("visitingCards.view", "nonsense");
    mockCardEndpoints();
    renderWithProviders(<VisitingCards />);
    expect(await screen.findByTestId("card-tile-1")).toBeInTheDocument();
  });
});
