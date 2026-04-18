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

  it("uses page-based pagination with default page size 25", () => {
    expect(tableDefaults.paginationDisplayMode).toBe("pages");
    expect(tableDefaults.initialState.pagination.pageSize).toBe(25);
    expect(tableDefaults.muiPaginationProps.rowsPerPageOptions).toEqual([
      10, 25, 50, 100,
    ]);
  });
});
