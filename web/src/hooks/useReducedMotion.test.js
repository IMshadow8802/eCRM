import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useReducedMotion from "./useReducedMotion";

const stubMatchMedia = (matches, handlers = {}) => {
  const listeners = new Set();
  window.matchMedia = vi.fn(() => ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_, cb) => listeners.add(cb),
    removeEventListener: (_, cb) => listeners.delete(cb),
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
    dispatchEvent: vi.fn(),
    _fire: (val) => listeners.forEach((cb) => cb({ matches: val })),
    ...handlers,
  }));
};

afterEach(() => {
  // setup.js installs a default stub; restore it
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
});

describe("useReducedMotion", () => {
  it("returns false when OS prefers motion", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when OS prefers reduced motion", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the media query changes", () => {
    let storedHandler;
    const mq = {
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: (_, cb) => {
        storedHandler = cb;
      },
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    window.matchMedia = vi.fn(() => mq);

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      storedHandler?.({ matches: true });
    });
    expect(result.current).toBe(true);
  });

  it("falls back to legacy addListener if addEventListener unavailable", () => {
    let storedHandler;
    const mq = {
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      addListener: (cb) => {
        storedHandler = cb;
      },
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    window.matchMedia = vi.fn(() => mq);

    const { result } = renderHook(() => useReducedMotion());
    act(() => {
      storedHandler?.({ matches: true });
    });
    expect(result.current).toBe(true);
  });
});
