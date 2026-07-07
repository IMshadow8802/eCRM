import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import DeleteLeadModal from "./DeleteLeadModal";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const json = (data) =>
  HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

const mockDelete = (capture) =>
  server.use(
    http.post("*/api/leads/deleteLeads", async ({ request }) => {
      capture?.(await request.json());
      return json({ Id: 42, ResponseCode: 200, ResponseMess: "Lead deleted" });
    }),
  );

describe("DeleteLeadModal", () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      UserId: 1,
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
  });

  it("posts deleteLeads with { Id } on confirm", async () => {
    let captured;
    mockDelete((body) => {
      captured = body;
    });
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    renderWithProviders(
      <DeleteLeadModal open leadId={42} leadName="Acme" onClose={onClose} onDeleted={onDeleted} />,
      { router: false },
    );
    const user = userEvent.setup();

    expect(screen.getByText(/Delete "Acme"\?/)).toBeInTheDocument();
    await user.click(screen.getByTestId("delete-submit"));

    await waitFor(() => expect(captured).toBeTruthy());
    expect(captured).toEqual({ Id: 42 });
    expect(onDeleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Cancel closes without calling deleteLeads", async () => {
    const deleteSpy = vi.fn();
    mockDelete(deleteSpy);
    const onClose = vi.fn();
    renderWithProviders(<DeleteLeadModal open leadId={42} onClose={onClose} />, {
      router: false,
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
