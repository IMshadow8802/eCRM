import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import TicketCategories from "./TicketCategories";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const renderPage = () => renderWithProviders(<TicketCategories />);

let lookupsByKind;
let lastFetchBody;
let lastSaveBody;

const seedLookups = (initial = {}) => {
  lookupsByKind = { ticket_category: [], ...initial };
  server.use(
    http.post("*/api/config/fetchLookups", async ({ request }) => {
      const body = await request.json();
      lastFetchBody = body;
      return HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { lookups: lookupsByKind[body.Kind] || [] },
      });
    }),
    http.post("*/api/config/saveLookup", async ({ request }) => {
      const body = await request.json();
      lastSaveBody = body;
      if (!body.Value) {
        return HttpResponse.json({ success: false, message: "Value required", responseCode: 400 });
      }
      const rows = lookupsByKind[body.Kind] || (lookupsByKind[body.Kind] = []);
      if (body.Id) {
        const idx = rows.findIndex((r) => r.Id === body.Id);
        if (idx !== -1) rows[idx] = { ...rows[idx], ...body };
      } else {
        const allIds = Object.values(lookupsByKind).flat().map((r) => r.Id);
        const id = allIds.length ? Math.max(...allIds) + 1 : 1;
        rows.push({ ...body, Id: id });
      }
      return HttpResponse.json({ success: true, message: "Saved", responseCode: 200, data: { Id: body.Id || 1 } });
    }),
    http.post("*/api/config/deleteLookup", async ({ request }) => {
      const body = await request.json();
      Object.keys(lookupsByKind).forEach((kind) => {
        lookupsByKind[kind] = lookupsByKind[kind].filter((r) => r.Id !== body.Id);
      });
      return HttpResponse.json({ success: true, message: "Deleted", responseCode: 200 });
    }),
  );
};

describe("TicketCategories page", () => {
  beforeEach(() => {
    lastFetchBody = undefined;
    lastSaveBody = undefined;
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    seedLookups({
      ticket_category: [{ Id: 1, Kind: "ticket_category", Value: "Billing", SortOrder: 1 }],
    });
  });

  it("lists categories and fetches Kind=ticket_category", async () => {
    renderPage();
    expect(await screen.findByText("Billing")).toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toMatchObject({ Kind: "ticket_category" }));
  });

  it("creates a category via saveLookup with the ticket_category Kind", async () => {
    renderPage();
    await screen.findByText("Billing");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Value/), "Technical");
    await user.click(screen.getByRole("button", { name: /create category/i }));

    await waitFor(() => {
      expect(lastSaveBody).toMatchObject({ Id: 0, Kind: "ticket_category", Value: "Technical" });
    });
    expect(await screen.findByText("Technical")).toBeInTheDocument();
  });

  it("deletes a category after confirmation", async () => {
    renderPage();
    await screen.findByText("Billing");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-1"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete category/i }));

    await waitFor(() => expect(screen.queryByText("Billing")).not.toBeInTheDocument());
  });

  it("shows an empty state when there are no categories", async () => {
    seedLookups({});
    renderPage();
    expect(await screen.findByTestId("master-grid-empty")).toBeInTheDocument();
    expect(screen.getByText(/ticket categories yet/i)).toBeInTheDocument();
  });
});
