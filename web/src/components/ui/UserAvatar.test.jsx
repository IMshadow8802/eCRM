import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import UserAvatar from "./UserAvatar";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

describe("UserAvatar", () => {
  it("resolves the preset from the directory by userId", async () => {
    server.use(
      http.post("*/api/users/directory", async () =>
        HttpResponse.json({
          success: true,
          responseCode: 200,
          data: { users: [{ Id: 7, FullName: "Zed", Avatar: "emoji:🐱" }] },
        }),
      ),
    );
    renderWithProviders(<UserAvatar userId={7} name="fallback" data-testid="ua" />, {
      router: false,
    });
    await waitFor(() => expect(screen.getByText("🐱")).toBeInTheDocument());
  });

  it("falls back to the passed name's initials when unknown", async () => {
    server.use(
      http.post("*/api/users/directory", async () =>
        HttpResponse.json({ success: true, responseCode: 200, data: { users: [] } }),
      ),
    );
    renderWithProviders(<UserAvatar userId={99} name="Foo Bar" data-testid="ua" />, {
      router: false,
    });
    expect(await screen.findByText("FB")).toBeInTheDocument();
  });
});
