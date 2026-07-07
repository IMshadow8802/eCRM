import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import Priorities from "./Priorities";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const renderPage = () => renderWithProviders(<Priorities />);

let lookupsByKind;
let lastFetchBody;
let lastSaveBody;

const seedLookups = (initial = {}) => {
  lookupsByKind = { priority: [], ...initial };
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

describe("Priorities page", () => {
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
      priority: [{ Id: 1, Kind: "priority", Value: "High", SortOrder: 1 }],
    });
  });

  it("lists priorities and fetches Kind=priority", async () => {
    renderPage();
    expect(await screen.findByText("High")).toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toMatchObject({ Kind: "priority" }));
  });

  it("creates a priority via saveLookup with the priority Kind", async () => {
    renderPage();
    await screen.findByText("High");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Value/), "Low");
    await user.click(screen.getByRole("button", { name: /create priority/i }));

    await waitFor(() => {
      expect(lastSaveBody).toMatchObject({ Id: 0, Kind: "priority", Value: "Low" });
    });
    expect(await screen.findByText("Low")).toBeInTheDocument();
  });

  it("deletes a priority after confirmation", async () => {
    renderPage();
    await screen.findByText("High");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-1"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete priority/i }));

    await waitFor(() => expect(screen.queryByText("High")).not.toBeInTheDocument());
  });

  it("shows an empty state when there are no priorities", async () => {
    seedLookups({});
    renderPage();
    expect(await screen.findByTestId("master-grid-empty")).toBeInTheDocument();
    expect(screen.getByText(/priorities yet/i)).toBeInTheDocument();
  });
});
