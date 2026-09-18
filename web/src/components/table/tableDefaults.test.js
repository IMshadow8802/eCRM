import { describe, it, expect } from "vitest";
import { tableDefaults } from "./tableDefaults";

describe("tableDefaults", () => {
  it("hides the per-column header action menu (three dots)", () => {
    expect(tableDefaults.enableColumnActions).toBe(false);
  });

  it("keeps sticky header enabled", () => {
    expect(tableDefaults.enableStickyHeader).toBe(true);
  });

  it("disables density + fullscreen toggles", () => {
    expect(tableDefaults.enableDensityToggle).toBe(false);
    expect(tableDefaults.enableFullScreenToggle).toBe(false);
  });

  it("defaults to compact density with search visible", () => {
    expect(tableDefaults.initialState.density).toBe("compact");
    expect(tableDefaults.initialState.showGlobalFilter).toBe(true);
  });

  /**
   * The table is a card, not a hole in the page.
   *
   * The Paper used to be painted `background.default` — the same colour as the
   * page behind it — with a 1px border and elevation 0. That reads as a region
   * cut out of the page rather than an object sitting on it, which is what
   * "flat and embedded" means when someone reports it. Depth here comes from
   * the surface step first (page is one shade darker than card) and the shadow
   * second; that ordering is why the background assertion matters more than the
   * shadow one.
   */
  it("sits on the card surface, a step above the page behind it", () => {
    expect(tableDefaults.muiTablePaperProps.sx.backgroundColor).toBe("background.paper");
    expect(tableDefaults.muiTablePaperProps.sx.backgroundColor).not.toBe("background.default");
  });

  it("casts a shadow rather than relying on a border alone", () => {
    const { boxShadow } = tableDefaults.muiTablePaperProps.sx;
    expect(typeof boxShadow).toBe("function");
    // Reads the token, so retuning the scale retunes the table with it.
    expect(boxShadow({ tokens: { shadow: { md: "TOKEN" } } })).toBe("TOKEN");
  });

  // A sticky header or a toolbar left on the page colour puts a stripe of
  // "outside" inside the card, which undoes the whole effect.
  it.each([
    ["muiTableHeadCellProps", "head cells"],
    ["muiTopToolbarProps", "the top toolbar"],
    ["muiBottomToolbarProps", "the bottom toolbar"],
  ])("paints %s on the same surface as the card", (key) => {
    expect(tableDefaults[key].sx.backgroundColor).toBe("background.paper");
  });

  /**
   * MRT ships its own `box-shadow: 0 1px 2px -1px rgba(97,97,97,0.5)` on the
   * bottom toolbar, and both toolbars are square boxes sitting inside the
   * Paper's 24px corners. That grey square shadow drew straight across the
   * rounded arc, so the card's corners read as sharp rectangles — the shadow
   * we did not ask for was louder than the one we did.
   *
   * Two things settle it: the toolbars lose their own shadow, and their outer
   * corners match the Paper's radius so no square child sits in the arc.
   */
  const theme = { radii: { xl: 24 }, tokens: { shadow: { md: "TOKEN" } } };

  it.each(["muiTopToolbarProps", "muiBottomToolbarProps"])(
    "strips MRT's own shadow from %s",
    (key) => {
      expect(tableDefaults[key].sx.boxShadow).toBe("none");
    },
  );

  it("rounds the top toolbar's top corners to match the card", () => {
    expect(tableDefaults.muiTopToolbarProps.sx.borderRadius(theme)).toBe("24px 24px 0 0");
  });

  it("rounds the bottom toolbar's bottom corners to match the card", () => {
    expect(tableDefaults.muiBottomToolbarProps.sx.borderRadius(theme)).toBe("0 0 24px 24px");
  });

  // All three read the same token, so the card cannot end up with corners that
  // disagree with each other.
  it("takes every corner radius from one token", () => {
    expect(tableDefaults.muiTablePaperProps.sx.borderRadius(theme)).toBe("24px");
  });

  /**
   * The card needs air above it.
   *
   * The filter bar sat flush against the table on every screen, and each page
   * had its own idea of the gap: none on Tickets and Leads, `mt: 1` on
   * Customers and Follow-ups, `mt: 1.5` on Products, `mt: 2` on the three
   * Master pages. Six different answers to one question. It belongs to the
   * card, not to whatever happens to sit above it.
   */
  it("keeps a gap above itself, so it never sits flush against the filters", () => {
    expect(tableDefaults.muiTablePaperProps.sx.mt).toBe(2);
  });

  it("uses page-based pagination with default page size 25", () => {
    expect(tableDefaults.paginationDisplayMode).toBe("pages");
    expect(tableDefaults.initialState.pagination.pageSize).toBe(25);
    expect(tableDefaults.muiPaginationProps.rowsPerPageOptions).toEqual([
      10, 25, 50, 100,
    ]);
  });
});
