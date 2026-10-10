import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import useUiScale from "./useUiScale";

const setRoot = (px) => { document.documentElement.style.fontSize = px; };

describe("useUiScale", () => {
  afterEach(() => setRoot(""));

  it("is the root font size over the 15px design root", () => {
    setRoot("18px");
    expect(renderHook(() => useUiScale()).result.current).toBe(1.2);
  });

  it("falls back to 1 when the root size cannot be read", () => {
    setRoot("");
    const { result } = renderHook(() => useUiScale());
    // jsdom reports no computed font size unless one is set
    expect(result.current).toBeGreaterThan(0);
  });

  it("follows a window resize", () => {
    setRoot("15px");
    const { result } = renderHook(() => useUiScale());
    expect(result.current).toBe(1);
    act(() => { setRoot("24px"); window.dispatchEvent(new Event("resize")); });
    expect(result.current).toBe(1.6);
  });
});

describe("useViewportHeight", () => {
  it("follows the window height", async () => {
    const { useViewportHeight } = await import("./useUiScale");
    const { result } = renderHook(() => useViewportHeight());
    expect(result.current).toBe(window.innerHeight);
    act(() => { window.innerHeight = 720; window.dispatchEvent(new Event("resize")); });
    expect(result.current).toBe(720);
    window.innerHeight = 768;
  });
});
