import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

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

  // The connectivity probe, the event listeners, the offline ticker and the
  // Retry button are all timer- and promise-driven, so they need fake timers
  // to be exercised at all.
  describe("connectivity", () => {
    const probeOk = () => vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({})));
    const probeFails = () =>
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("blocked"))));

    const flush = async (ms = 0) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    const mountOffline = async () => {
      setOnline(true);
      probeFails();
      const rendered = renderWithProviders(<NetworkStatusBanner />, { router: false });
      await flush(250);
      return rendered;
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("stays hidden when the probe reaches the internet", async () => {
      setOnline(true);
      probeOk();
      const { container } = renderWithProviders(<NetworkStatusBanner />, { router: false });
      await flush(250);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://www.google.com/favicon.ico",
        expect.objectContaining({ method: "HEAD" }),
      );
      expect(container).toBeEmptyDOMElement();
    });

    // navigator.onLine only knows about the local link, so the probe is what
    // decides: a captive wifi reports online and reaches nothing.
    it("shows the banner when the probe fails even though navigator says online", async () => {
      await mountOffline();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("counts the outage in seconds, then in minutes and seconds", async () => {
      await mountOffline();
      expect(screen.queryByText(/offline for/)).toBeNull();

      await flush(1000);
      expect(screen.getByText(/offline for 1s/)).toBeInTheDocument();

      await flush(60000);
      expect(screen.getByText(/offline for 1m \d+s/)).toBeInTheDocument();
    });

    it("clears the banner when the browser fires online and the probe agrees", async () => {
      await mountOffline();
      probeOk();
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await flush();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("raises the banner when the browser fires offline", async () => {
      setOnline(true);
      probeOk();
      renderWithProviders(<NetworkStatusBanner />, { router: false });
      await flush(250);
      expect(screen.queryByRole("status")).toBeNull();

      await act(async () => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("recovers on its own once the periodic recheck gets through", async () => {
      await mountOffline();
      probeOk();
      await flush(5000);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("disables Retry while the probe is in flight, then clears on success", async () => {
      await mountOffline();
      let settle;
      vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { settle = resolve; })));

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      await flush();
      const testing = screen.getByRole("button", { name: /testing/i });
      expect(testing).toBeDisabled();

      await act(async () => {
        settle({});
      });
      await flush();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("keeps the banner up when Retry probes and still cannot get out", async () => {
      await mountOffline();
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      await flush();
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /retry/i })).toBeEnabled();
    });

    it("does not probe on Retry while the browser itself reports no link", async () => {
      await mountOffline();
      setOnline(false);
      global.fetch.mockClear();
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      await flush();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("highlights Retry on hover and drops the highlight on leave", async () => {
      await mountOffline();
      const retry = screen.getByRole("button", { name: /retry/i });
      const resting = retry.style.backgroundColor;

      fireEvent.mouseOver(retry);
      const hovered = retry.style.backgroundColor;
      expect(hovered).not.toBe(resting);

      fireEvent.mouseOut(retry);
      expect(retry.style.backgroundColor).toBe(resting);
    });

    it("does not highlight Retry while it is busy probing", async () => {
      await mountOffline();
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      await flush();

      const testing = screen.getByRole("button", { name: /testing/i });
      const resting = testing.style.backgroundColor;
      fireEvent.mouseOver(testing);
      expect(testing.style.backgroundColor).toBe(resting);
    });

    it("stops its timers when it unmounts", async () => {
      const { unmount } = await mountOffline();
      const removeSpy = vi.spyOn(window, "removeEventListener");
      unmount();
      expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));
      removeSpy.mockRestore();
    });
  });
});
