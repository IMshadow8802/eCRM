import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import TransferLeadModal from "./TransferLeadModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const USERS = [
  { Id: 1, Username: "alice", FullName: "Alice" },
  { Id: 2, Username: "bob", FullName: "Bob" },
];

const json = (data) =>
  HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const mockUsers = () =>
  server.use(http.post("*/api/users/fetchUsers", async () => json({ users: USERS })));

const mockTransfer = (capture) =>
  server.use(
    http.post("*/api/leads/transferLead", async ({ request }) => {
      capture?.(await request.json());
      return json({ Id: 7, ResponseCode: 200, ResponseMess: "Lead transferred" });
    }),
  );

describe("TransferLeadModal", () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    mockUsers();
  });

  it("posts transferLead with { LeadId, OwnerId } for the picked owner", async () => {
    let captured;
    mockTransfer((body) => {
      captured = body;
    });
    const onClose = vi.fn();
    const onTransferred = vi.fn();
    renderWithProviders(
      <TransferLeadModal open leadId={7} onClose={onClose} onTransferred={onTransferred} />,
      { router: false },
    );
    const user = userEvent.setup();

    await user.click(screen.getByTestId("transfer-owner-input"));
    await user.click(await screen.findByRole("option", { name: "Bob" }));
    await user.click(screen.getByTestId("transfer-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toEqual({ LeadId: 7, OwnerId: 2 });
    expect(onTransferred).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("disables Transfer and skips the call until an owner is picked", async () => {
    const transferSpy = vi.fn();
    mockTransfer(transferSpy);
    renderWithProviders(<TransferLeadModal open leadId={7} onClose={() => {}} />, {
      router: false,
    });
    const user = userEvent.setup();

    expect(screen.getByTestId("transfer-submit")).toBeDisabled();
    await user.click(screen.getByTestId("transfer-submit"));
    expect(transferSpy).not.toHaveBeenCalled();
  });
});
