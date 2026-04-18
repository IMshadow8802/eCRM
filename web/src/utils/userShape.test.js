import { describe, it, expect } from "vitest";

import {
  getUserId,
  getUserName,
  getUserJobTitle,
  toUserOption,
  toUserOptions,
  findUserById,
} from "./userShape";

describe("userShape", () => {
  it("getUserId reads canonical Id", () => {
    expect(getUserId({ Id: 7 })).toBe(7);
  });

  it("getUserId returns null for missing id + null input", () => {
    expect(getUserId(null)).toBeNull();
    expect(getUserId({})).toBeNull();
  });

  it("getUserName prefers FullName, falls back to Username", () => {
    expect(getUserName({ FullName: "Alice", Username: "a" })).toBe("Alice");
    expect(getUserName({ Username: "bob" })).toBe("bob");
    expect(getUserName({})).toBe("");
    expect(getUserName(null)).toBe("");
  });

  it("getUserJobTitle returns empty when missing", () => {
    expect(getUserJobTitle(null)).toBe("");
    expect(getUserJobTitle({ JobTitle: "Dev" })).toBe("Dev");
  });

  it("toUserOption shapes a user record", () => {
    expect(toUserOption({ Id: 1, FullName: "A" })).toEqual({
      value: "1",
      label: "A",
    });
  });

  it("toUserOption appends job title when requested", () => {
    expect(
      toUserOption(
        { Id: 1, FullName: "A", JobTitle: "Eng" },
        { withJobTitle: true },
      ),
    ).toEqual({ value: "1", label: "A - Eng" });
  });

  it("toUserOption returns null when id missing", () => {
    expect(toUserOption({ FullName: "no id" })).toBeNull();
  });

  it("toUserOptions filters out records without id", () => {
    const rows = [
      { Id: 1, FullName: "A" },
      { FullName: "no id" },
      { Id: 2, FullName: "B" },
    ];
    expect(toUserOptions(rows)).toEqual([
      { value: "1", label: "A" },
      { value: "2", label: "B" },
    ]);
  });

  it("toUserOptions returns [] for non-array input", () => {
    expect(toUserOptions(null)).toEqual([]);
    expect(toUserOptions(undefined)).toEqual([]);
  });

  it("findUserById handles string/number mismatch", () => {
    const users = [
      { Id: 1, FullName: "A" },
      { Id: 2, FullName: "B" },
    ];
    expect(findUserById(users, 1)).toBe(users[0]);
    expect(findUserById(users, "2")).toBe(users[1]);
    expect(findUserById(users, 99)).toBeNull();
    expect(findUserById(users, null)).toBeNull();
  });
});
