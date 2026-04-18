import { describe, it, expect, beforeEach, vi } from "vitest";

const stubSystemPrefersDark = (val) => {
  let listeners = new Set();
  const mq = {
    matches: val,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_, cb) => listeners.add(cb),
    removeEventListener: (_, cb) => listeners.delete(cb),
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
    dispatchEvent: vi.fn(),
    _fire: (next) => listeners.forEach((cb) => cb({ matches: next })),
  };
  window.matchMedia = vi.fn(() => mq);
  return mq;
};

describe("useThemeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    vi.resetModules();
  });

  it("defaults to light when system does not prefer dark", async () => {
    stubSystemPrefersDark(false);
    const { default: store } = await import("./useThemeStore");
    expect(store.getState().mode).toBe("light");
  });

  it("defaults to dark when system prefers dark", async () => {
    stubSystemPrefersDark(true);
    const { default: store } = await import("./useThemeStore");
    expect(store.getState().mode).toBe("dark");
  });

  it("toggleMode flips + sets userOverride", async () => {
    stubSystemPrefersDark(false);
    const { default: store } = await import("./useThemeStore");
    expect(store.getState().userOverride).toBe(false);
    store.getState().toggleMode();
    expect(store.getState().mode).toBe("dark");
    expect(store.getState().userOverride).toBe(true);
    store.getState().toggleMode();
    expect(store.getState().mode).toBe("light");
  });

  it("setMode applies html.dark class + userOverride", async () => {
    stubSystemPrefersDark(false);
    const { default: store } = await import("./useThemeStore");
    store.getState().setMode("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(store.getState().userOverride).toBe(true);
    store.getState().setMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("syncWithSystem updates mode when override not set", async () => {
    const mq = stubSystemPrefersDark(false);
    const { default: store } = await import("./useThemeStore");
    const unsub = store.getState().syncWithSystem();
    expect(store.getState().mode).toBe("light");
    mq._fire(true);
    expect(store.getState().mode).toBe("dark");
    unsub();
  });

  it("syncWithSystem is a no-op once user overrides", async () => {
    const mq = stubSystemPrefersDark(false);
    const { default: store } = await import("./useThemeStore");
    store.getState().setMode("light"); // user override
    store.getState().syncWithSystem();
    mq._fire(true);
    expect(store.getState().mode).toBe("light"); // unchanged
  });

  it("syncWithSystem without matchMedia returns noop unsub", async () => {
    stubSystemPrefersDark(false);
    const { default: store } = await import("./useThemeStore");
    const original = window.matchMedia;
    window.matchMedia = undefined;
    const unsub = store.getState().syncWithSystem();
    expect(typeof unsub).toBe("function");
    unsub();
    window.matchMedia = original;
  });
});
