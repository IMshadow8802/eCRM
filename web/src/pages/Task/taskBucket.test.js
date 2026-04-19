import { describe, it, expect } from "vitest";

import {
  bucketTasksByColumn,
  sortTasksWithinColumn,
  ORPHAN_BUCKET_KEY,
} from "./taskBucket";

describe("bucketTasksByColumn", () => {
  const columns = [
    { Id: 1, Title: "To Do", SortOrder: 1 },
    { Id: 2, Title: "In Progress", SortOrder: 2 },
    { Id: 3, Title: "Done", SortOrder: 3 },
  ];

  it("buckets tasks by ColumnId FK (and sorts newest-first when tie)", () => {
    const tasks = [
      { Id: 10, ColumnId: 1 },
      { Id: 11, ColumnId: 2 },
      { Id: 12, ColumnId: 3 },
      { Id: 13, ColumnId: 1 },
    ];
    const out = bucketTasksByColumn(columns, tasks);
    expect(out[1].map((t) => t.Id)).toEqual([13, 10]);
    expect(out[2].map((t) => t.Id)).toEqual([11]);
    expect(out[3].map((t) => t.Id)).toEqual([12]);
    expect(out[ORPHAN_BUCKET_KEY]).toBeUndefined();
  });

  it("routes null ColumnId into orphan bucket", () => {
    const out = bucketTasksByColumn(columns, [{ Id: 1, ColumnId: null }]);
    expect(out[ORPHAN_BUCKET_KEY]).toHaveLength(1);
  });

  it("routes unknown ColumnId into orphan bucket (never silently drops)", () => {
    const tasks = [
      { Id: 1, ColumnId: 1 },
      { Id: 2, ColumnId: 999 },
    ];
    const out = bucketTasksByColumn(columns, tasks);
    expect(out[1]).toHaveLength(1);
    expect(out[ORPHAN_BUCKET_KEY].map((t) => t.Id)).toEqual([2]);
  });

  it("returns empty bucket when no columns or no tasks", () => {
    expect(bucketTasksByColumn([], [])).toEqual({});
    expect(bucketTasksByColumn(columns, [])).toEqual({ 1: [], 2: [], 3: [] });
  });

  it("treats null/undefined columns + tasks as empty", () => {
    expect(bucketTasksByColumn(null, null)).toEqual({});
    expect(bucketTasksByColumn(undefined, undefined)).toEqual({});
  });

  it("skips columns without Id", () => {
    const out = bucketTasksByColumn(
      [{ Title: "anon" }, { Id: 5, Title: "Done" }],
      [{ Id: 10, ColumnId: 5 }],
    );
    expect(out[5]).toHaveLength(1);
  });
});

describe("sortTasksWithinColumn", () => {
  it("puts completed tasks last", () => {
    const out = sortTasksWithinColumn([
      { Id: 1, IsCompleted: 1, Priority: "high" },
      { Id: 2, IsCompleted: 0, Priority: "low" },
    ]);
    expect(out.map((t) => t.Id)).toEqual([2, 1]);
  });

  it("orders by priority DESC among incomplete", () => {
    const out = sortTasksWithinColumn([
      { Id: 1, IsCompleted: 0, Priority: "low" },
      { Id: 2, IsCompleted: 0, Priority: "critical" },
      { Id: 3, IsCompleted: 0, Priority: "medium" },
    ]);
    expect(out.map((t) => t.Id)).toEqual([2, 3, 1]);
  });

  it("breaks ties on due date ASC (nulls last)", () => {
    const out = sortTasksWithinColumn([
      { Id: 1, IsCompleted: 0, Priority: "high", DueDate: null },
      { Id: 2, IsCompleted: 0, Priority: "high", DueDate: "2026-01-01" },
      { Id: 3, IsCompleted: 0, Priority: "high", DueDate: "2025-12-01" },
    ]);
    expect(out.map((t) => t.Id)).toEqual([3, 2, 1]);
  });

  it("breaks ties on Id DESC (newest first)", () => {
    const out = sortTasksWithinColumn([
      { Id: 5, IsCompleted: 0, Priority: "medium" },
      { Id: 9, IsCompleted: 0, Priority: "medium" },
    ]);
    expect(out.map((t) => t.Id)).toEqual([9, 5]);
  });
});
