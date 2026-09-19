import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";

import renderWithProviders from "../test/renderWithProviders";
import NetworkStatusBanner from "./NetworkStatusBanner";

const setOnline = (value) =>
  Object.defineProperty(navigator, "onLine", { value, configurable: true });

describe("NetworkStatusBanner", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setOnline(true);
  });

  it("renders nothing while online", () => {
    setOnline(true);
    const { container } = renderWithProviders(<NetworkStatusBanner />, { router: false });
    expect(container).toBeEmptyDOMElement();
  });

  // Regression, 2026-09-19: the banner was `position: fixed; top: 0;
  // z-index: 9999` and painted over the sticky TopNav, which starts at y=8.
  // At 360px its two halves could not wrap, the text ran to three lines, and
  // the bar covered the hamburger — the only way to open the menu on a phone.
  // Going offline locked a phone user out of navigating entirely.
  it("renders in flow, so it pushes the app down instead of covering the TopNav", () => {
    setOnline(false);
    renderWithProviders(<NetworkStatusBanner />, { router: false });
    const bar = screen.getByRole("status");
    expect(bar.style.position).toBe("");
    expect(bar.style.zIndex).toBe("");
    expect(bar.style.top).toBe("");
  });

  it("lets its two halves wrap rather than growing a line at a time", () => {
    setOnline(false);
    renderWithProviders(<NetworkStatusBanner />, { router: false });
    expect(screen.getByRole("status").style.flexWrap).toBe("wrap");
  });

  // The headline already says the connection is gone; the second sentence was
  // the line that pushed the bar past the TopNav on a phone.
  it("drops the filler sentence", () => {
    setOnline(false);
    renderWithProviders(<NetworkStatusBanner />, { router: false });
    expect(screen.getByText(/No Internet Connection/)).toBeInTheDocument();
    expect(screen.queryByText(/Some features may not work properly/)).toBeNull();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  // It was the one surface in the app rendered in system-ui on MUI's old
  // default red, visibly a different typeface from the TopNav 8px below it.
  it("takes its colour from the theme and its font from the app", () => {
    setOnline(false);
    renderWithProviders(<NetworkStatusBanner />, { router: false });
    const bar = screen.getByRole("status");
    expect(bar.style.fontFamily).toBe("");
    expect(bar.style.backgroundColor).not.toBe("");
    expect(bar.style.backgroundColor).not.toMatch(/244,\s*67,\s*54/); // #f44336
  });
});
