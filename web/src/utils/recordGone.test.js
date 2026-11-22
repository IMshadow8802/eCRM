import { describe, it, expect } from "vitest";
import { recordGone, RECORD_GONE_MESSAGE } from "./recordGone";

const err = (status) => ({ response: { status } });

describe("recordGone", () => {
  it("is true for 404 only", () => {
    expect(recordGone(err(404))).toBe(true);
  });
  it("is false for 403 (visible, action refused), 400, 500, a network error and nothing", () => {
    expect(recordGone(err(403))).toBe(false);
    expect(recordGone(err(400))).toBe(false);
    expect(recordGone(err(500))).toBe(false);
    expect(recordGone(new Error("Network Error"))).toBe(false);
    expect(recordGone(undefined)).toBe(false);
  });
  it("has the agreed words", () => {
    expect(RECORD_GONE_MESSAGE).toBe("This record is no longer with you");
  });
});
