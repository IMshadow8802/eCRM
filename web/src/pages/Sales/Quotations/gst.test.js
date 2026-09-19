import { describe, it, expect } from "vitest";
import { GST_STATES, STATE_OPTIONS, stateByCode, isValidGstin, stateFromGstin, matchStateName, cleanGstin } from "./gst";

describe("gst", () => {
  it("lists the 28 states and 8 union territories, codes unique", () => {
    expect(GST_STATES).toHaveLength(36);
    expect(new Set(GST_STATES.map((s) => s.code)).size).toBe(36);
    expect(STATE_OPTIONS.find((o) => o.value === "24").label).toBe("Gujarat (24)");
  });

  it("resolves a code, padding a bare digit", () => {
    expect(stateByCode("24").name).toBe("Gujarat");
    expect(stateByCode(7).name).toBe("Delhi");
    expect(stateByCode("99")).toBeNull();
    expect(stateByCode(null)).toBeNull();
  });

  // Registrations issued before Daman & Diu merged into 26, and before Andhra
  // was re-coded to 37, are still in force.
  it("resolves legacy codes without offering them in the picker", () => {
    expect(stateByCode("25").name).toBe("Daman and Diu");
    expect(STATE_OPTIONS.some((o) => o.value === "25" || o.value === "28")).toBe(false);
  });

  it("validates the shape of a GSTIN, tolerating case and spaces", () => {
    expect(isValidGstin("24ABCDE1234F1Z5")).toBe(true);
    expect(isValidGstin(" 24abcde1234f1z5 ")).toBe(true);
    expect(cleanGstin("24 abcde 1234 f1z5")).toBe("24ABCDE1234F1Z5");
    expect(isValidGstin("24ABCDE1234F1Y5")).toBe(false); // 14th char is always Z
    expect(isValidGstin("24ABCDE1234F1Z")).toBe(false);
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin(null)).toBe(false);
  });

  it("reads the seller's state off the GSTIN", () => {
    expect(stateFromGstin("27ABCDE1234F1Z5")).toBe("27");
    expect(stateFromGstin("99ABCDE1234F1Z5")).toBeNull(); // well-formed, no such state
    expect(stateFromGstin("garbage")).toBeNull();
  });

  it("matches a typed state name exactly, and refuses to guess", () => {
    expect(matchStateName("gujarat")).toBe("24");
    expect(matchStateName("  Tamil Nadu ")).toBe("33");
    expect(matchStateName("Gujrat")).toBeNull();
    expect(matchStateName("MH")).toBeNull();
    expect(matchStateName("")).toBeNull();
    expect(matchStateName(undefined)).toBeNull();
  });
});
