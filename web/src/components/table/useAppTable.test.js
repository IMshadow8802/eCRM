import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import useAppTable, { mergeSxProps } from "./useAppTable";
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
