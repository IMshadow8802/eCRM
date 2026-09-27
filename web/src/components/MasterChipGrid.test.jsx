import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../theme";
import MasterChipGrid from "./MasterChipGrid";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

const ITEMS = [
  { Id: 1, Name: "Walk-in" },
  { Id: 2, Name: "Referral" },
  { Id: 3, Name: "Google Ads" },
];

const grid = (props = {}, mode = "light") =>
  wrap(<MasterChipGrid items={ITEMS} nameKey="Name" idKey="Id" {...props} />, mode);

describe("MasterChipGrid", () => {
  it("renders a tile per item, with its name and id", () => {
    grid();
    expect(screen.getByTestId("master-grid-items")).toBeInTheDocument();
    ITEMS.forEach((item) => {
      const tile = screen.getByTestId(`master-grid-tile-${item.Id}`);
      expect(within(tile).getByText(item.Name)).toBeInTheDocument();
      expect(within(tile).getByText(`#${item.Id}`)).toBeInTheDocument();
    });
  });

  it("leads each tile with the first letter of its name, upper-cased", () => {
    grid({ items: [{ Id: 9, Name: "walk-in" }] });
    expect(
      within(screen.getByTestId("master-grid-tile-9")).getByText("W"),
    ).toBeInTheDocument();
  });

  it("falls back to a dash for a nameless row and a ? for a blank one", () => {
    grid({ items: [{ Id: 4, Name: "" }, { Id: 5, Name: "   " }] });
    const nameless = within(screen.getByTestId("master-grid-tile-4"));
    expect(nameless.getAllByText("—").length).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId("master-grid-tile-5")).getByText("?"),
    ).toBeInTheDocument();
  });

  it("shows the empty state instead of the grid when there are no items", () => {
    grid({ items: [], emptyLabel: "No sources yet" });
    expect(screen.getByTestId("master-grid-empty")).toBeInTheDocument();
    expect(screen.getByText("No sources yet")).toBeInTheDocument();
    expect(screen.queryByTestId("master-grid-items")).toBeNull();
  });

  it("defaults the empty state's wording", () => {
    grid({ items: [] });
    expect(screen.getByText("No items yet")).toBeInTheDocument();
  });

  it("shows skeletons instead of tiles while loading", () => {
    grid({ isLoading: true });
    expect(screen.getByTestId("master-grid-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("master-grid-items")).toBeNull();
    expect(screen.queryByText("Walk-in")).toBeNull();
  });

  it("counts the rows, singular for one and plural for the rest", () => {
    const { unmount } = grid();
    expect(screen.getByTestId("master-grid-count")).toHaveTextContent("3 items");
    unmount();

    grid({ items: [ITEMS[0]] });
    expect(screen.getByTestId("master-grid-count")).toHaveTextContent("1 item");
  });

  // The page is paged, so the tiles on screen are not the whole set.
  it("prefers a server-side total over the number of tiles rendered", () => {
    grid({ totalCount: 42 });
    expect(screen.getByTestId("master-grid-count")).toHaveTextContent("42 items");
  });

  it("reports what is typed into the search box", () => {
    const onSearchChange = vi.fn();
    grid({ search: "ref", onSearchChange });
    const input = within(screen.getByTestId("master-grid-search")).getByRole("textbox");
    expect(input).toHaveValue("ref");

    fireEvent.change(input, { target: { value: "goo" } });
    expect(onSearchChange).toHaveBeenCalledWith("goo");
  });

  it("survives typing with no search handler attached", () => {
    grid();
    const input = within(screen.getByTestId("master-grid-search")).getByRole("textbox");
    expect(() => fireEvent.change(input, { target: { value: "x" } })).not.toThrow();
  });

  it("labels the create button and calls back when it is pressed", () => {
    const onCreate = vi.fn();
    grid({ onCreate, createLabel: "New Source" });
    const create = screen.getByTestId("master-grid-create");
    expect(create).toHaveTextContent("New Source");
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("defaults the create button's label", () => {
    grid();
    expect(screen.getByTestId("master-grid-create")).toHaveTextContent("New");
  });

  it("edits from the tile itself and from its edit action", () => {
    const onEdit = vi.fn();
    grid({ onEdit });

    const [tileSurface] = within(
      screen.getByTestId("master-grid-tile-2"),
    ).getAllByRole("button");
    fireEvent.click(tileSurface);
    expect(onEdit).toHaveBeenCalledWith(ITEMS[1]);

    fireEvent.click(screen.getByTestId("master-grid-edit-3"));
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onEdit).toHaveBeenLastCalledWith(ITEMS[2]);
  });

  it("deletes the row the action belongs to", () => {
    const onDelete = vi.fn();
    const onEdit = vi.fn();
    grid({ onDelete, onEdit });
    fireEvent.click(screen.getByTestId("master-grid-delete-1"));
    expect(onDelete).toHaveBeenCalledWith(ITEMS[0]);
    // The action sits on top of the tile's own edit target; it must not open
    // the editor on its way through.
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("survives an edit or delete with no handler attached", () => {
    grid();
    expect(() => {
      fireEvent.click(screen.getByTestId("master-grid-edit-1"));
      fireEvent.click(screen.getByTestId("master-grid-delete-1"));
    }).not.toThrow();
  });

  it("offers delete on every tile when no predicate is given", () => {
    grid();
    ITEMS.forEach((item) => {
      expect(screen.getByTestId(`master-grid-delete-${item.Id}`)).toBeInTheDocument();
    });
  });

  // Hidden, not disabled — an in-use master row has no delete to offer.
  it("removes the delete action from the tiles a predicate rejects", () => {
    grid({ canDelete: (item) => item.Id !== 2 });
    expect(screen.getByTestId("master-grid-delete-1")).toBeInTheDocument();
    expect(screen.queryByTestId("master-grid-delete-2")).toBeNull();
    expect(screen.getByTestId("master-grid-delete-3")).toBeInTheDocument();
    // Edit stays available on the row that cannot be deleted.
    expect(screen.getByTestId("master-grid-edit-2")).toBeInTheDocument();
  });

  it("renders with no items prop at all", () => {
    wrap(<MasterChipGrid nameKey="Name" idKey="Id" />);
    expect(screen.getByTestId("master-grid-empty")).toBeInTheDocument();
    expect(screen.getByTestId("master-grid-count")).toHaveTextContent("0 items");
  });

  it("renders in dark mode", () => {
    grid({}, "dark");
    expect(screen.getByText("Walk-in")).toBeInTheDocument();
  });
});
