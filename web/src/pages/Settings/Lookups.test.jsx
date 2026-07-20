import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import Lookups from "./Lookups";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const renderPage = () => renderWithProviders(<Lookups />);

let lookupsByKind;
let lastFetchBody;
let lastSaveBody;

const seedLookups = (initial = {}) => {
  lookupsByKind = {
    lead_source: [],
    call_outcome: [],
    lost_reason: [],
    resolution: [],
    ...Object.fromEntries(
      Object.entries(initial).map(([kind, rows]) => [kind, rows.map((r) => ({ ...r }))])
    ),
  };
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

describe("Lookups page", () => {
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
      lead_source: [{ Id: 1, Kind: "lead_source", Value: "Website", SortOrder: 1 }],
      call_outcome: [{ Id: 2, Kind: "call_outcome", Value: "Interested", SortOrder: 1 }],
      lost_reason: [{ Id: 3, Kind: "lost_reason", Value: "Budget", SortOrder: 1 }],
      resolution: [{ Id: 4, Kind: "resolution", Value: "Fixed", SortOrder: 1 }],
    });
  });

  it("lists lookups for the default Kind (lead_source)", async () => {
    renderPage();
    expect(await screen.findByText("Website")).toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toMatchObject({ Kind: "lead_source" }));
  });

  it("switches Kind via tabs and fetches that Kind's lookups", async () => {
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("lookup-kind-tabs-call_outcome"));

    expect(await screen.findByText("Interested")).toBeInTheDocument();
    expect(screen.queryByText("Website")).not.toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toMatchObject({ Kind: "call_outcome" }));
  });

  it("has a Ticket Resolutions tab that fetches Kind='resolution'", async () => {
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("lookup-kind-tabs-resolution"));

    expect(await screen.findByText("Fixed")).toBeInTheDocument();
    expect(screen.queryByText("Website")).not.toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toMatchObject({ Kind: "resolution" }));
  });

  it("creates a resolution via saveLookup with Kind='resolution'", async () => {
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("lookup-kind-tabs-resolution"));
    await screen.findByText("Fixed");

    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Value/), "Duplicate");
    await user.click(screen.getByRole("button", { name: /create lookup/i }));

    await waitFor(() => {
      expect(lastSaveBody).toMatchObject({ Id: 0, Kind: "resolution", Value: "Duplicate" });
    });
    expect(await screen.findByText("Duplicate")).toBeInTheDocument();
  });

  it("creates a lookup in the active Kind via saveLookup", async () => {
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Value/), "Referral");
    await user.click(screen.getByRole("button", { name: /create lookup/i }));

    await waitFor(() => {
      expect(lastSaveBody).toMatchObject({ Id: 0, Kind: "lead_source", Value: "Referral" });
    });
    expect(await screen.findByText("Referral")).toBeInTheDocument();
  });

  it("deletes a lookup after confirmation", async () => {
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-1"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete lookup/i }));

    await waitFor(() => expect(screen.queryByText("Website")).not.toBeInTheDocument());
  });

  it("requires a value before saving", async () => {
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.click(screen.getByRole("button", { name: /create lookup/i }));

    expect(await screen.findByText("Value is required")).toBeInTheDocument();
    expect(lastSaveBody).toBeUndefined();
  });

  it("surfaces the API error when save fails", async () => {
    server.use(
      http.post("*/api/config/saveLookup", () =>
        HttpResponse.json({ success: false, message: "Duplicate value", responseCode: 400 }),
      ),
    );
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Value/), "Website");
    await user.click(screen.getByRole("button", { name: /create lookup/i }));

    expect(await screen.findByText("Duplicate value")).toBeInTheDocument();
  });

  it("falls back to a generic error when the save request errors", async () => {
    server.use(http.post("*/api/config/saveLookup", () => HttpResponse.error()));
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Value/), "Referral");
    await user.click(screen.getByRole("button", { name: /create lookup/i }));

    expect(await screen.findByText("Failed to save lookup")).toBeInTheDocument();
  });

  it("surfaces the API error when delete fails", async () => {
    server.use(
      http.post("*/api/config/deleteLookup", () =>
        HttpResponse.json({ success: false, message: "Lookup is in use", responseCode: 400 }),
      ),
    );
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-1"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete lookup/i }));

    expect(await screen.findByText("Lookup is in use")).toBeInTheDocument();
    expect(screen.getByText("Website")).toBeInTheDocument();
  });

  it("edits an existing lookup, pre-filling the form", async () => {
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-1"));

    const valueInput = await screen.findByLabelText(/Value/);
    expect(valueInput).toHaveValue("Website");

    await user.click(screen.getByRole("button", { name: /update lookup/i }));

    await waitFor(() => {
      expect(lastSaveBody).toMatchObject({ Id: 1, Kind: "lead_source", Value: "Website" });
    });
  });

  it("falls back to a generic error when the delete request errors", async () => {
    server.use(http.post("*/api/config/deleteLookup", () => HttpResponse.error()));
    renderPage();
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-1"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete lookup/i }));

    expect(await screen.findByText("Failed to delete lookup!")).toBeInTheDocument();
  });

  it("shows a Kind-specific empty state", async () => {
    seedLookups({});
    renderPage();
    expect(await screen.findByTestId("master-grid-empty")).toBeInTheDocument();
    expect(screen.getByText(/lead sources yet/i)).toBeInTheDocument();
  });
});
