import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import AccountModal from "./AccountModal";
import useAuthStore from "../stores/useAuthStore";
import { server } from "../test/mocks/server";
import renderWithProviders from "../test/renderWithProviders";

const render = () =>
  renderWithProviders(<AccountModal open onClose={() => {}} />, { router: false });

describe("AccountModal", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
        Id: 1,
        Username: "alice",
        FullName: "Alice",
        Avatar: "emoji:🚀",
        Email: "alice@old.com",
        Mobile: "1112223333",
      },
    });
  });

  it("saves the profile via /me/updateProfile and patches the store", async () => {
    let body;
    server.use(
      http.post("*/api/users/me/updateProfile", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: {} });
      }),
    );
    render();
    const user = userEvent.setup();
    const name = await screen.findByTestId("account-fullname");
    const inner = name.querySelector("input") || name;
    await user.clear(inner);
    await user.type(inner, "Alice New");
    await user.click(screen.getByTestId("account-save-profile"));

    await waitFor(() => {
      expect(body).toMatchObject({
        FullName: "Alice New",
        Email: "alice@old.com", // editable + sent through
        Mobile: "1112223333",
      });
    });
    expect(useAuthStore.getState().user.FullName).toBe("Alice New");
  });

  it("lets the user edit their email and sends the new value", async () => {
    let body;
    server.use(
      http.post("*/api/users/me/updateProfile", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: {} });
      }),
    );
    render();
    const user = userEvent.setup();
    const email = await screen.findByTestId("account-email");
    const inner = email.querySelector("input") || email;
    await user.clear(inner);
    await user.type(inner, "alice@new.com");
    await user.click(screen.getByTestId("account-save-profile"));
    await waitFor(() => expect(body.Email).toBe("alice@new.com"));
  });

  it("picks an emoji avatar and sends it", async () => {
    let body;
    server.use(
      http.post("*/api/users/me/updateProfile", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: {} });
      }),
    );
    render();
    const user = userEvent.setup();
    // switch avatar picker to Emoji, choose one
    await user.click(await screen.findByRole("tab", { name: /Emoji/i }));
    await user.click(screen.getByTestId("emoji-🐱"));
    await user.click(screen.getByTestId("account-save-profile"));
    await waitFor(() => expect(body.Avatar).toBe("emoji:🐱"));
  });

  it("blocks a password change when confirmation does not match", async () => {
    let called = false;
    server.use(
      http.post("*/api/users/me/changePassword", async () => {
        called = true;
        return HttpResponse.json({ success: true, responseCode: 200 });
      }),
    );
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: /Password/i }));
    const val = async (tid, v) => {
      const el = screen.getByTestId(tid);
      await user.type(el.querySelector("input") || el, v);
    };
    await val("account-current-pw", "oldpass");
    await val("account-new-pw", "newpass1");
    await val("account-confirm-pw", "different");
    await user.click(screen.getByTestId("account-save-password"));
    // never hit the API
    await new Promise((r) => setTimeout(r, 50));
    expect(called).toBe(false);
  });

  it("changes the password when inputs are valid", async () => {
    let body;
    server.use(
      http.post("*/api/users/me/changePassword", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, message: "Password changed", responseCode: 200 });
      }),
    );
    render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: /Password/i }));
    const val = async (tid, v) => {
      const el = screen.getByTestId(tid);
      await user.type(el.querySelector("input") || el, v);
    };
    await val("account-current-pw", "oldpass");
    await val("account-new-pw", "newpass1");
    await val("account-confirm-pw", "newpass1");
    await user.click(screen.getByTestId("account-save-password"));
    await waitFor(() => {
      expect(body).toMatchObject({ CurrentPassword: "oldpass", NewPassword: "newpass1" });
    });
  });
});
