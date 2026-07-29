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

  it("plays its entrance animation", async () => {
    const { container } = renderWithProviders(<NotFound />);
    // Starts hidden, then the mount timer reveals it.
    expect(container.querySelector(".opacity-0")).toBeTruthy();
    await waitFor(() =>
      expect(container.querySelector(".opacity-0")).toBeNull(),
    );
    expect(container.querySelector(".opacity-100")).toBeTruthy();
  });
});
