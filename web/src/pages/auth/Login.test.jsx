import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const post = vi.fn();
vi.mock("../../hooks/useApi", () => ({ default: () => ({ post }) }));

import Login from "./Login";
import renderWithProviders from "../../test/renderWithProviders";

beforeEach(() => {
  post.mockReset();
});

describe("Login", () => {
  it("posts the typed value as `identifier` (username / email / mobile)", async () => {
    post.mockResolvedValueOnce({
      data: {
        success: true,
        responseCode: 200,
        data: {
          token: "t",
          user: { Id: 1, BranchId: 1, CompId: 1 },
          company: {},
          permissions: { rawPermissions: [] },
        },
      },
    });

    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();

    const idField = screen.getByLabelText(/Username \/ Email \/ Mobile/i);
    await user.type(idField, "alice@example.com");
    await user.type(screen.getByLabelText(/^Password/i), "secret");
    await user.click(screen.getByRole("button", { name: /Sign in/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/api/auth/loginUser", {
        identifier: "alice@example.com",
        password: "secret",
      });
    });
  });

  it("shows an error when identifier or password is empty", async () => {
    renderWithProviders(<Login />, { router: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Sign in/i }));
    expect(post).not.toHaveBeenCalled();
  });
});
