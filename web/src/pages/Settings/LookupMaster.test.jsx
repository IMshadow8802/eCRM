import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import LookupMaster from "./LookupMaster";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

// Lookups.test.jsx exercises LookupMaster through the Lookups wrapper. This
// file drives the shared component directly, because the one thing that is not
// shared is the lead_status `Code` — the SP validates it for that Kind only, so
// the field has to appear for lead_status and stay out of every other payload.
const LEAD_STATUS = [{ value: "lead_status", label: "Lead Statuses" }];
const LEAD_SOURCE = [{ value: "lead_source", label: "Lead Sources" }];
const BOTH = [...LEAD_SOURCE, ...LEAD_STATUS];

let rowsByKind;
let lastSaveBody;

const seed = (initial = {}) => {
  rowsByKind = { lead_status: [], lead_source: [], ...initial };
  server.use(
    http.post("*/api/config/fetchLookups", async ({ request }) => {
      const body = await request.json();
      return HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { lookups: rowsByKind[body.Kind] || [] },
      });
    }),
    http.post("*/api/config/saveLookup", async ({ request }) => {
      lastSaveBody = await request.json();
      return HttpResponse.json({ success: true, message: "Saved", responseCode: 200, data: { Id: 1 } });
    }),
    http.post("*/api/config/deleteLookup", async ({ request }) => {
      const body = await request.json();
      Object.keys(rowsByKind).forEach((k) => {
        rowsByKind[k] = rowsByKind[k].filter((r) => r.Id !== body.Id);
      });
      return HttpResponse.json({ success: true, message: "Deleted", responseCode: 200 });
    })
  );
};

const renderMaster = (kinds, noun) =>
  renderWithProviders(
    <LookupMaster
      title={`${noun}s`}
      subtitle="Manage the list."
      documentTitle={`${noun}s`}
      noun={noun}
      kinds={kinds}
      placeholder="e.g. Warm"
    />
  );

describe("LookupMaster — lead_status Code", () => {
  beforeEach(() => {
    lastSaveBody = undefined;
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://shadowcodes.in/CRM",
    });
    seed({
      lead_status: [{ Id: 21, Kind: "lead_status", Value: "New", SortOrder: 1, Code: "open" }],
      lead_source: [{ Id: 1, Kind: "lead_source", Value: "Website", SortOrder: 1 }],
    });
  });

  it("shows a Code select for lead_status and sends it", async () => {
    renderMaster(LEAD_STATUS, "Status");
    await screen.findByText("New");

    const user = userEvent.setup();
    await user.click(screen.getByText("New Status"));
    await user.type(await screen.findByLabelText(/Value/), "Warm");
    await user.click(screen.getByLabelText(/Code/));
    await user.click(await screen.findByRole("option", { name: /Qualified/ }));
    await user.click(screen.getByRole("button", { name: "Create Status" }));

    await waitFor(() =>
      expect(lastSaveBody).toEqual({
        Id: 0,
        Kind: "lead_status",
        Value: "Warm",
        SortOrder: 0,
        Code: "qualified",
      })
    );
  });

  it("has no Code select for other kinds and omits it from the payload", async () => {
    renderMaster(LEAD_SOURCE, "Source");
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByText("New Source"));
    await user.type(await screen.findByLabelText(/Value/), "Referral");
    expect(screen.queryByLabelText(/Code/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create Source" }));

    await waitFor(() =>
      expect(lastSaveBody).toEqual({
        Id: 0,
        Kind: "lead_source",
        Value: "Referral",
        SortOrder: 0,
      })
    );
  });

  // A status edited without its Code re-sent would be re-coded "open" and the
  // lead lifecycle would silently lose its Lost/Junk buckets.
  it("seeds the editing row's Code and sends it back unchanged", async () => {
    seed({
      lead_status: [{ Id: 22, Kind: "lead_status", Value: "Dropped", SortOrder: 2, Code: "lost" }],
    });
    renderMaster(LEAD_STATUS, "Status");
    await screen.findByText("Dropped");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-22"));
    expect(await screen.findByLabelText(/Code/)).toHaveValue("Lost — needs a reason");

    await user.click(screen.getByRole("button", { name: "Update Status" }));
    await waitFor(() =>
      expect(lastSaveBody).toMatchObject({ Id: 22, Value: "Dropped", SortOrder: 2, Code: "lost" })
    );
  });

  it("defaults a codeless legacy row to open", async () => {
    seed({ lead_status: [{ Id: 23, Kind: "lead_status", Value: "Old", SortOrder: 0 }] });
    renderMaster(LEAD_STATUS, "Status");
    await screen.findByText("Old");

    await userEvent.setup().click(screen.getByTestId("master-grid-edit-23"));
    expect(await screen.findByLabelText(/Code/)).toHaveValue("Open — still being worked");
  });
});

describe("LookupMaster — shared CRUD", () => {
  beforeEach(() => {
    lastSaveBody = undefined;
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://shadowcodes.in/CRM",
    });
    seed({
      lead_status: [{ Id: 21, Kind: "lead_status", Value: "New", SortOrder: 1, Code: "open" }],
      lead_source: [
        { Id: 1, Kind: "lead_source", Value: "Website", SortOrder: 1 },
        { Id: 2, Kind: "lead_source", Value: "Referral", SortOrder: 2 },
      ],
    });
  });

  it("requires a value before saving", async () => {
    renderMaster(LEAD_STATUS, "Status");
    await screen.findByText("New");

    const user = userEvent.setup();
    await user.click(screen.getByText("New Status"));
    await user.click(screen.getByRole("button", { name: "Create Status" }));

    expect(await screen.findByText("Value is required")).toBeInTheDocument();
    expect(lastSaveBody).toBeUndefined();
  });

  it("filters the grid by the search box", async () => {
    renderMaster(LEAD_SOURCE, "Source");
    await screen.findByText("Website");

    await userEvent.setup().type(screen.getByPlaceholderText("Search…"), "refer");
    await waitFor(() => expect(screen.queryByText("Website")).not.toBeInTheDocument());
    expect(screen.getByText("Referral")).toBeInTheDocument();
  });

  it("switches Kind via the tab strip", async () => {
    renderMaster(BOTH, "Lookup");
    await screen.findByText("Website");

    await userEvent.setup().click(screen.getByTestId("lookup-kind-tabs-lead_status"));
    expect(await screen.findByText("New")).toBeInTheDocument();
    expect(screen.queryByText("Website")).not.toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    renderMaster(LEAD_SOURCE, "Source");
    await screen.findByText("Website");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-1"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete source/i }));

    await waitFor(() => expect(screen.queryByText("Website")).not.toBeInTheDocument());
  });

  it("surfaces the API's own refusal, and a generic message when the request errors", async () => {
    server.use(
      http.post("*/api/config/saveLookup", () =>
        HttpResponse.json({ success: false, message: "Code already used", responseCode: 400 })
      )
    );
    renderMaster(LEAD_STATUS, "Status");
    await screen.findByText("New");

    const user = userEvent.setup();
    await user.click(screen.getByText("New Status"));
    await user.type(await screen.findByLabelText(/Value/), "Warm");
    await user.click(screen.getByRole("button", { name: "Create Status" }));
    expect(await screen.findByText("Code already used")).toBeInTheDocument();

    server.use(http.post("*/api/config/saveLookup", () => HttpResponse.error()));
    await user.click(screen.getByRole("button", { name: "Create Status" }));
    expect(await screen.findByText("Failed to save status")).toBeInTheDocument();
  });

  it("surfaces a failed delete", async () => {
    server.use(
      http.post("*/api/config/deleteLookup", () =>
        HttpResponse.json({ success: false, message: "Status is in use", responseCode: 400 })
      )
    );
    renderMaster(LEAD_STATUS, "Status");
    await screen.findByText("New");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-21"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete status/i }));

    expect(await screen.findByText("Status is in use")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });
});
