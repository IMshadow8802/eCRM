import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import useAppTable, { mergeSxProps, fitHeight } from "./useAppTable";
import { tableDefaults } from "./tableDefaults";

describe("mergeSxProps", () => {
  it("returns the base untouched when there is no override", () => {
    const base = { hover: true, sx: { color: "red" } };
    expect(mergeSxProps(base, undefined)).toBe(base);
  });

  it("merges sx keys rather than replacing the whole object", () => {
    const merged = mergeSxProps(
      { hover: true, sx: { color: "red", fontWeight: 600 } },
      { sx: { color: "blue" } },
    );
    expect(merged.sx).toEqual({ color: "blue", fontWeight: 600 });
    expect(merged.hover).toBe(true);
  });

  /**
   * REGRESSION, and an invisible one.
   *
   * MRT lets a row prop be a function of the row, which is how four pages wire
   * up "click the row to open it" (Tickets, Leads, Customers, Follow-ups).
   * This helper used to bail out — `if (typeof override === "function") return
   * override` — so on exactly those four pages the shared config was thrown
   * away wholesale and the default row hover tint silently stopped rendering.
   * The one visual affordance telling you a row is clickable disappeared on
   * every page where rows are clickable.
   *
   * Nothing errored, nothing logged. A function override now merges into the
   * base the same way an object one does.
   */
  it("keeps the shared config when the override is a function of the row", () => {
    const base = { hover: true, sx: { "&:hover td": { backgroundColor: "action.hover" } } };
    const override = (row) => ({ sx: { cursor: "pointer" }, onClick: () => row.id });

    const merged = mergeSxProps(base, override);
    expect(typeof merged).toBe("function");

    const result = merged({ id: 7 });
    expect(result.hover).toBe(true);
    expect(result.sx["&:hover td"]).toEqual({ backgroundColor: "action.hover" });
    expect(result.sx.cursor).toBe("pointer");
    expect(result.onClick()).toBe(7);
  });

  it("still works when the function override brings no sx of its own", () => {
    const base = { sx: { a: 1 } };
    const merged = mergeSxProps(base, () => ({ onClick: () => "hi" }));
    const result = merged({});
    expect(result.sx).toEqual({ a: 1 });
    expect(result.onClick()).toBe("hi");
  });

  // The mirror case: a default that is itself a function, with a page passing a
  // plain object. Nothing ships this today, but the branch exists, and a merge
  // helper that silently drops one side is exactly the bug this file documents.
  it("layers an object override onto a function base", () => {
    const merged = mergeSxProps(
      (row) => ({ hover: true, sx: { height: row.h } }),
      { sx: { cursor: "pointer" } },
    );
    const result = merged({ h: 40 });
    expect(result.hover).toBe(true);
    expect(result.sx).toEqual({ height: 40, cursor: "pointer" });
  });

  it("survives a function base that returns nothing", () => {
    const merged = mergeSxProps(() => undefined, { sx: { a: 1 } });
    expect(merged({}).sx).toEqual({ a: 1 });
  });

  it("survives a function override that returns nothing", () => {
    const merged = mergeSxProps({ sx: { a: 1 } }, () => undefined);
    expect(merged({}).sx).toEqual({ a: 1 });
  });

  it("passes every argument through to the override", () => {
    const merged = mergeSxProps({ sx: {} }, (...args) => ({ seen: args }));
    expect(merged("a", "b").seen).toEqual(["a", "b"]);
  });

  // The real pairing the four pages rely on, asserted end to end against the
  // actual shipped defaults rather than a hand-built stand-in.
  it("preserves the real default hover tint under a real row-click override", () => {
    const merged = mergeSxProps(
      tableDefaults.muiTableBodyRowProps,
      () => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => {} }),
    );
    expect(merged({}).sx["&:hover td"]).toEqual({ backgroundColor: "action.hover" });
  });
});

/**
 * The hook itself. Every page suite mocks `useServerTable`, so without this
 * nothing in the repo ever executes the merge that makes the shared table
 * config apply — the defaults could stop reaching real tables and no test
 * would notice.
 */
describe("useAppTable", () => {
  const columns = [{ accessorKey: "name", header: "Name" }];
  const build = (options = {}) =>
    renderHook(() => useAppTable({ columns, data: [], ...options })).result.current.options;

  it("applies the shared defaults to a table that asks for nothing", () => {
    const o = build();
    expect(o.enableColumnActions).toBe(false);
    expect(o.enableStickyHeader).toBe(true);
    expect(o.muiTablePaperProps.sx.backgroundColor).toBe("background.paper");
  });

  it("lets a page override a default without losing its siblings", () => {
    const o = build({ muiTableContainerProps: { sx: { maxHeight: "500px" } } });
    expect(o.muiTableContainerProps.sx.maxHeight).toBe("500px");
    // …while the card styling it never mentioned survives.
    expect(o.muiTablePaperProps.sx.backgroundColor).toBe("background.paper");
  });

  it("merges initialState instead of replacing it", () => {
    const o = build({ initialState: { pagination: { pageSize: 10, pageIndex: 0 } } });
    expect(o.initialState.pagination.pageSize).toBe(10);
    expect(o.initialState.density).toBe("compact");
    expect(o.initialState.showGlobalFilter).toBe(true);
  });

  // The four clickable-row pages, end to end through the real hook.
  it("keeps the default row hover under a row-click override", () => {
    const o = build({
      muiTableBodyRowProps: () => ({ hover: true, sx: { cursor: "pointer" }, onClick: () => {} }),
    });
    const row = o.muiTableBodyRowProps({});
    expect(row.sx.cursor).toBe("pointer");
    expect(row.sx["&:hover td"]).toEqual({ backgroundColor: "action.hover" });
  });
});

describe("fitHeight", () => {
  it("ends the card a gap above the window bottom", () => {
    // 1080 window, body starts 400px down, 56px pagination under it, 16px gap.
    expect(fitHeight({ viewport: 1080, top: 400, below: 56 })).toBe(608);
    // Same layout on a 4K-tall window grows the table, not the page.
    expect(fitHeight({ viewport: 2160, top: 400, below: 56 })).toBe(1688);
  });

  it("never goes under the floor on a short screen with a tall chart", () => {
    expect(fitHeight({ viewport: 720, top: 650, below: 56 })).toBe(280);
    expect(fitHeight({ viewport: 720, top: 650, below: 56, min: 100 })).toBe(100);
  });
});

describe("useAppTable fit to window", () => {
  it("puts the measured height on the scrolling body", async () => {
    const { screen } = await import("@testing-library/react");
    const { default: renderWithProviders } = await import("../../test/renderWithProviders");
    const { MaterialReactTable } = await import("material-react-table");
    const rect = (top, bottom) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top });
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("MuiTableContainer-root")) return rect(300, 500);
      if (this.classList.contains("MuiPaper-root")) return rect(250, 556);
      return rect(0, 0);
    });
    window.innerHeight = 1000;
    function T() {
      const table = useAppTable({ columns: [{ accessorKey: "a", header: "A" }], data: [{ a: 1 }] });
      return <MaterialReactTable table={table} />;
    }
    renderWithProviders(<T />, { router: false });
    // 1000 - 300 - 56 - 16. It sits in a media rule (phones keep "none"),
    // which jsdom does not evaluate, so read the CSS emotion generated.
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css).toMatch(/max-height:\s*628px/);
    expect(screen.getByText("A")).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("useAppTable on a scaled-up screen", () => {
  // The page's bottom padding is rem; at a 24px root (4K) a fixed 16px gap
  // left the card 9px past the window and the page scrolled.
  it("keeps the bottom gap in step with the root font size", async () => {
    const { default: renderWithProviders } = await import("../../test/renderWithProviders");
    const { MaterialReactTable } = await import("material-react-table");
    const rect = (top, bottom) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top });
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("MuiTableContainer-root")) return rect(300, 500);
      if (this.classList.contains("MuiPaper-root")) return rect(250, 556);
      return rect(0, 0);
    });
    window.innerHeight = 1000;
    document.documentElement.style.fontSize = "24px";
    function T() {
      const table = useAppTable({ columns: [{ accessorKey: "a", header: "A" }], data: [{ a: 1 }] });
      return <MaterialReactTable table={table} />;
    }
    renderWithProviders(<T />, { router: false });
    // 1000 - 300 - 56 - 25.6
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css).toMatch(/max-height:\s*618px/);
    document.documentElement.style.fontSize = "";
    spy.mockRestore();
  });
});

describe("useAppTable refit when content above changes", () => {
  it("grows the table when something above it shrinks (the page itself never resizes)", async () => {
    const { act } = await import("@testing-library/react");
    const { MaterialReactTable } = await import("material-react-table");
    const { default: renderWithProviders } = await import("../../test/renderWithProviders");
    const observers = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb) { this.cb = cb; this.els = []; observers.push(this); }
      observe(el) { this.els.push(el); }
      disconnect() {}
    });
    let top = 600; // a chart is above the table
    const rect = (t, b) => ({ top: t, bottom: b, left: 0, right: 0, width: 0, height: b - t });
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("MuiTableContainer-root")) return rect(top, top + 100);
      if (this.classList.contains("MuiPaper-root")) return rect(top - 50, top + 100);
      return rect(0, 0);
    });
    window.innerHeight = 1000;
    function T() {
      const table = useAppTable({ columns: [{ accessorKey: "a", header: "A" }], data: [{ a: 1 }] });
      return <><div data-testid="chart" /><MaterialReactTable table={table} /></>;
    }
    renderWithProviders(<T />, { router: false });
    const css = () => [...document.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css()).toMatch(/max-height:\s*384px/); // 1000 - 600 - 0 - 16

    const ro = observers.find((o) => o.els.some((e) => e.dataset?.testid === "chart"));
    expect(ro).toBeTruthy();
    top = 300; // the chart is gone
    act(() => ro.cb());
    expect(css()).toMatch(/max-height:\s*684px/);
    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});
