import { describe, it, expect } from "vitest";
import { recordGone, RECORD_GONE_MESSAGE } from "./recordGone";

const err = (status, code = status === 404 ? "NOT_FOUND" : "SP_ERROR") => ({ response: { status, data: { code } } });

describe("recordGone", () => {
  it("is true for the record's own 404 (code NOT_FOUND)", () => {
    expect(recordGone(err(404))).toBe(true);
  });
  // REGRESSION (final review m1): every 404 used to read as "this record left
  // you" — a 404 that names something else must not throw the user out.
  it("is false for a 404 without NOT_FOUND (another meaning, a proxy page, no body)", () => {
    expect(recordGone(err(404, "SP_ERROR"))).toBe(false);
    expect(recordGone({ response: { status: 404 } })).toBe(false);
    expect(recordGone({ response: { status: 404, data: "<html>Not Found</html>" } })).toBe(false);
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
