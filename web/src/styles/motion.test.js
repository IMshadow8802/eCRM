import { describe, it, expect } from "vitest";
import {
  ease,
  fadeIn,
  fadeScale,
  slideUp,
  slideDown,
  pagePresence,
  staggerChildren,
  tap,
  hover,
} from "./motion";

describe("motion presets", () => {
  it("ease arrays are 4-tuples", () => {
    for (const name of ["standard", "emphasized", "decelerate", "accelerate"]) {
      expect(ease[name]).toHaveLength(4);
    }
  });

  it("fadeIn has initial opacity 0 → 1", () => {
    expect(fadeIn.initial.opacity).toBe(0);
    expect(fadeIn.animate.opacity).toBe(1);
    expect(fadeIn.animate.transition.duration).toBeGreaterThan(0);
  });

  it("fadeScale uses scale 0.97 → 1", () => {
    expect(fadeScale.initial.scale).toBeCloseTo(0.97);
    expect(fadeScale.animate.scale).toBe(1);
  });

  it("slideUp + slideDown move on y axis in opposite directions", () => {
    expect(slideUp.initial.y).toBeGreaterThan(0);
    expect(slideDown.initial.y).toBeLessThan(0);
  });

  it("pagePresence exposes initial/animate/exit", () => {
    expect(pagePresence.initial).toBeDefined();
    expect(pagePresence.animate).toBeDefined();
    expect(pagePresence.exit).toBeDefined();
  });

  it("staggerChildren helper returns transition config", () => {
    const s = staggerChildren(50);
    expect(s.animate.transition.staggerChildren).toBeCloseTo(0.05);
  });

  it("tap scales slightly down; hover lifts slightly", () => {
    expect(tap.scale).toBeLessThan(1);
    expect(hover.y).toBeLessThan(0);
  });
});
