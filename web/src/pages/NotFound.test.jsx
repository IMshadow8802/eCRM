import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";

import renderWithProviders from "../test/renderWithProviders";
import NotFound from "./NotFound";
import useAuthStore from "../stores/useAuthStore";

const menu = (menuid, parentid, description, route) => ({
  menuid,
  parentid,
  description,
  route,
  permissions: { canView: true },
});

const setRights = (rights) =>
  act(() => useAuthStore.setState({ menuRights: rights }));

afterEach(() => {
  cleanup();
  setRights([]);
});

describe("NotFound", () => {
  it("renders the 404 message", () => {
    renderWithProviders(<NotFound />);
    expect(screen.getByText("Page Not Found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go back/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
  });

  // REGRESSION: the home link was hardcoded to /dashboard, so a user without
  // Dashboard rights got a 404 whose only escape was another page they can't
  // open — now bounced to NoAccess instead of anywhere useful.
  it("points home at the user's first granted page, not /dashboard", () => {
    setRights([menu(2, 0, "Tasks", "/tasks")]);
    renderWithProviders(<NotFound />);
    const home = screen.getByRole("link", { name: /go to my home page/i });
    expect(home).toHaveAttribute("href", expect.stringContaining("/tasks"));
    expect(home).not.toHaveAttribute("href", expect.stringContaining("/dashboard"));
  });

  it("falls back to / when the user has no menus", () => {
    setRights([]);
    renderWithProviders(<NotFound />);
    const home = screen.getByRole("link", { name: /go to my home page/i });
    expect(home.getAttribute("href")).toMatch(/\/$/);
  });

  it("restores the document title on unmount", () => {
    const { unmount } = renderWithProviders(<NotFound />);
    expect(document.title).toBe("404 - Page Not Found");
    unmount();
    expect(document.title).toBe("eCRM");
  });

  // This used to assert Tailwind's `.opacity-0`/`.opacity-100` classnames,
  // which existed only to drive a `<style jsx>` block. styled-jsx is not a
  // dependency here, so React rendered that block as a plain global <style>
  // and its keyframes leaked into every other page. The entrance is now one
  // transitioned inline value, so assert the thing the user actually sees.
  it("plays its entrance animation", async () => {
    renderWithProviders(<NotFound />);
    const page = screen.getByTestId("not-found");
    expect(page.style.opacity).toBe("0");
    await waitFor(() => expect(page.style.opacity).toBe("1"));
  });

  // Regression, 2026-09-19: the page was raw Tailwind against Tailwind's own
  // palette, so in dark mode it was a white slab with near-black text inside a
  // dark shell — the only page in the app that ignored the theme. It also used
  // `min-h-screen` inside `<main>`, which already sits below the TopNav, so a
  // ~376px page always showed a scrollbar with nothing below the fold.
  it("renders through the themed primitives, not hardcoded Tailwind colours", () => {
    const { container } = renderWithProviders(<NotFound />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/bg-white|text-gray-900|text-blue-600/);
    expect(container.querySelector("style")).toBeNull();
    expect(screen.getByTestId("not-found").style.minHeight).toBe("60vh");
  });
});
