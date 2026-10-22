import { describe, it, expect } from "vitest";

import { faceIndex, mainContact } from "./cardColor";

describe("faceIndex", () => {
  it("is stable for an id and always in range", () => {
    expect(faceIndex(42)).toBe(faceIndex(42));
    expect(faceIndex("42")).toBe(faceIndex(42));
    for (let id = -5; id < 200; id++) {
      const i = faceIndex(id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
    }
  });

  it("spreads ids across all six faces", () => {
    const seen = new Set(Array.from({ length: 60 }, (_, id) => faceIndex(id + 1)));
    expect(seen.size).toBe(6);
  });
});

describe("mainContact", () => {
  it("first mobile, with the other numbers counted", () => {
    expect(mainContact({ mobiles: ["1", "2"], landlines: ["3"], emails: ["a@b"] })).toEqual({ main: "1", more: 2 });
  });
  it("falls back to a landline, then an email", () => {
    expect(mainContact({ mobiles: [], landlines: ["3"], emails: [] })).toEqual({ main: "3", more: 0 });
    expect(mainContact({ emails: ["a@b", "c@d"] })).toEqual({ main: "a@b", more: 1 });
  });
  it("nothing to reach them by", () => {
    expect(mainContact({})).toEqual({ main: "", more: 0 });
  });
});
