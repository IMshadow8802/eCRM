import { describe, it, expect } from "vitest";
import { toTree, descendantsOf } from "./officeTree";

const ROWS = [
  { Id: 4, BranchName: "West HO", ParentId: null },
  { Id: 3, BranchName: "Noida", ParentId: 1 },
  { Id: 1, BranchName: "HO", ParentId: null },
  { Id: 2, BranchName: "Delhi", ParentId: 1 },
  { Id: 5, BranchName: "Saket", ParentId: 2 },
];

describe("toTree", () => {
  it("orders depth-first with children sorted by name", () => {
    expect(toTree(ROWS).map((r) => [r.BranchName, r.depth])).toEqual([
      ["HO", 0],
      ["Delhi", 1],
      ["Saket", 2],
      ["Noida", 1],
      ["West HO", 0],
    ]);
  });

  // e.g. the parent is outside the caller's list; dropping it hid the office.
  it("puts an office whose parent is not in the list at top level", () => {
    const rows = [
      { Id: 2, BranchName: "Delhi", ParentId: 99 },
      { Id: 5, BranchName: "Saket", ParentId: 2 },
      { Id: 1, BranchName: "HO", ParentId: null },
    ];
    expect(toTree(rows).map((r) => [r.BranchName, r.depth])).toEqual([
      ["Delhi", 0],
      ["Saket", 1],
      ["HO", 0],
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(toTree([])).toEqual([]);
  });
});

describe("descendantsOf", () => {
  it("collects the office and everything below it, at any depth", () => {
    expect([...descendantsOf(ROWS, 1)].sort()).toEqual([1, 2, 3, 5]);
  });

  it("is just the office itself for a leaf", () => {
    expect([...descendantsOf(ROWS, 4)]).toEqual([4]);
  });
});
