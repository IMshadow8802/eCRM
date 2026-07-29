import { describe, it, expect } from "vitest";

import {
  assigneesOf,
  isAssignee,
  isUnassigned,
  assigneeIdsOf,
  sameAssignees,
} from "./taskAssignees";

const two = [
  { UserId: 2, FullName: "Ayush" },
  { UserId: 11, FullName: "Vikash" },
];

describe("assigneesOf", () => {
  it("parses the AssigneesJson string the SP returns", () => {
    expect(assigneesOf({ AssigneesJson: JSON.stringify(two) })).toEqual(two);
  });

  it("accepts an already-parsed array", () => {
    expect(assigneesOf({ Assignees: two })).toEqual(two);
  });

  // A task cached before the migration has only the scalar pair. Rendering no
  // avatar at all would look like the assignee had been removed.
  it("falls back to the legacy scalar pair", () => {
    expect(
      assigneesOf({ AssignedToUserId: 2, AssigneeName: "Ayush" }),
    ).toEqual([{ UserId: 2, FullName: "Ayush", Avatar: null }]);
  });

  it("survives malformed JSON without blanking the card", () => {
    expect(
      assigneesOf({ AssigneesJson: "{not json", AssignedToUserId: 2 }),
    ).toEqual([{ UserId: 2, FullName: null, Avatar: null }]);
  });

  it("returns [] for an unassigned task, null and undefined", () => {
    expect(assigneesOf({ Id: 1 })).toEqual([]);
    expect(assigneesOf(null)).toEqual([]);
    expect(assigneesOf(undefined)).toEqual([]);
  });
});

describe("isAssignee", () => {
  it("finds a member of the set", () => {
    const task = { AssigneesJson: JSON.stringify(two) };
    expect(isAssignee(task, 11)).toBe(true);
    expect(isAssignee(task, "11")).toBe(true); // ids arrive as strings sometimes
    expect(isAssignee(task, 3)).toBe(false);
  });

  it("is false without a user id", () => {
    expect(isAssignee({ AssigneesJson: JSON.stringify(two) }, null)).toBe(false);
  });
});

describe("isUnassigned / assigneeIdsOf", () => {
  it("reports an empty set as claimable", () => {
    expect(isUnassigned({ Id: 1 })).toBe(true);
    expect(isUnassigned({ Assignees: two })).toBe(false);
  });

  it("extracts numeric ids", () => {
    expect(assigneeIdsOf({ Assignees: two })).toEqual([2, 11]);
  });
});

describe("sameAssignees", () => {
  it("ignores order and type", () => {
    expect(sameAssignees([2, 11], [11, 2])).toBe(true);
    expect(sameAssignees([2, 11], ["11", "2"])).toBe(true);
  });

  it("detects a real difference", () => {
    expect(sameAssignees([2], [2, 11])).toBe(false);
    expect(sameAssignees([2], [3])).toBe(false);
  });

  it("treats empty/omitted as equal", () => {
    expect(sameAssignees()).toBe(true);
    expect(sameAssignees([], [])).toBe(true);
  });
});
