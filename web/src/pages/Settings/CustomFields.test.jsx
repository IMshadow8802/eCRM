import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import CustomFields from "./CustomFields";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const renderPage = () => renderWithProviders(<CustomFields />);

let fields;
let lastFetchBody;
let lastSaveBody;

const seedFields = (initial = []) => {
  fields = initial.map((f) => ({ ...f }));
  server.use(
    // The page fetches per-Entity — the handler filters like the SP does.
    http.post("*/api/config/fetchCustomFields", async ({ request }) => {
      lastFetchBody = await request.json();
      return HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { customFields: fields.filter((f) => f.Entity === lastFetchBody.Entity) },
      });
    }),
    http.post("*/api/config/saveCustomField", async ({ request }) => {
      const body = await request.json();
      lastSaveBody = body;
      if (!body.Label) {
        return HttpResponse.json({
          success: false,
          message: "Label required",
          responseCode: 400,
        });
      }
      if (body.Id) {
        const idx = fields.findIndex((f) => f.Id === body.Id);
        if (idx !== -1) fields[idx] = { ...fields[idx], ...body };
      } else {
        const id = fields.length ? Math.max(...fields.map((f) => f.Id)) + 1 : 1;
        fields.push({ ...body, Id: id });
      }
      return HttpResponse.json({
        success: true,
        message: "Saved",
        responseCode: 200,
        data: { Id: body.Id || fields[fields.length - 1].Id },
      });
    }),
    http.post("*/api/config/deleteCustomField", async ({ request }) => {
      const body = await request.json();
      fields = fields.filter((f) => f.Id !== body.Id);
      return HttpResponse.json({ success: true, message: "Deleted", responseCode: 200 });
    }),
  );
};

describe("CustomFields page", () => {
  beforeEach(() => {
    lastFetchBody = undefined;
    lastSaveBody = undefined;
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    seedFields([
      { Id: 1, Entity: "lead", FieldKey: "budget", Label: "Budget", Type: "number", Options: null, IsRequired: true, SortOrder: 1 },
      { Id: 2, Entity: "lead", FieldKey: "source_detail", Label: "Source Detail", Type: "dropdown", Options: JSON.stringify(["Web", "Referral"]), IsRequired: false, SortOrder: 2 },
      { Id: 3, Entity: "ticket", FieldKey: "device", Label: "Device", Type: "text", Options: null, IsRequired: false, SortOrder: 1 },
    ]);
  });

  it("lists custom field defs for Entity='lead' by default", async () => {
    renderPage();
    expect(await screen.findByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Source Detail")).toBeInTheDocument();
    expect(screen.queryByText("Device")).not.toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toMatchObject({ Entity: "lead" }));
  });

  it("switches to the Tickets tab and fetches with Entity='ticket'", async () => {
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("customfield-entity-tabs-ticket"));

    expect(await screen.findByText("Device")).toBeInTheDocument();
    expect(screen.queryByText("Budget")).not.toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toMatchObject({ Entity: "ticket" }));
  });

  it("creates a field under the active entity (Entity='ticket')", async () => {
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("customfield-entity-tabs-ticket"));
    await screen.findByText("Device");

    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Label/), "Serial Number");
    await user.click(screen.getByRole("button", { name: /create field/i }));

    await waitFor(() => {
      expect(lastSaveBody).toMatchObject({ Id: 0, Entity: "ticket", Label: "Serial Number" });
    });
    expect(await screen.findByText("Serial Number")).toBeInTheDocument();
  });

  it("creates a new field and calls saveCustomField", async () => {
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));

    await user.type(await screen.findByLabelText(/Label/), "Company Size");
    await user.click(screen.getByRole("button", { name: /create field/i }));

    await waitFor(() => {
      expect(lastSaveBody).toMatchObject({
        Id: 0,
        Entity: "lead",
        Label: "Company Size",
        Type: "text",
        IsRequired: false,
      });
    });
    expect(await screen.findByText("Company Size")).toBeInTheDocument();
  });

  it("requires at least one option before saving a dropdown field", async () => {
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Label/), "Region");

    // Switch Type to dropdown via the combobox
    const typeCombo = screen.getAllByRole("combobox")[0];
    await user.click(typeCombo);
    await user.click(await screen.findByText("Dropdown"));

    await user.click(screen.getByRole("button", { name: /create field/i }));

    expect(await screen.findByText("Add at least one option")).toBeInTheDocument();
  });

  it("filters the list via the search box", async () => {
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    const searchInput = within(screen.getByTestId("master-grid-search")).getByRole("textbox");
    await user.type(searchInput, "budg");

    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.queryByText("Source Detail")).not.toBeInTheDocument();
  });

  it("edits a field whose stored Options JSON is corrupt without crashing (empty Options)", async () => {
    seedFields([
      { Id: 9, Entity: "lead", FieldKey: "bad", Label: "Bad Options", Type: "dropdown", Options: "not-json{", IsRequired: false, SortOrder: 1 },
    ]);
    renderPage();
    await screen.findByText("Bad Options");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-9"));

    const optionsInput = await screen.findByLabelText(/Options/);
    expect(optionsInput).toHaveValue("");
  });

  it("edits an existing field, pre-filling the form", async () => {
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-1"));

    const labelInput = await screen.findByLabelText(/Label/);
    expect(labelInput).toHaveValue("Budget");

    await user.click(screen.getByRole("button", { name: /update field/i }));

    await waitFor(() => {
      expect(lastSaveBody).toMatchObject({ Id: 1, Label: "Budget", FieldKey: "budget" });
    });
  });

  it("round-trips dropdown Options as a comma-separated string on edit", async () => {
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-edit-2"));

    const optionsInput = await screen.findByLabelText(/Options/);
    expect(optionsInput).toHaveValue("Web, Referral");

    await user.type(optionsInput, ", Walk-in");
    await user.click(screen.getByRole("button", { name: /update field/i }));

    await waitFor(() => {
      expect(lastSaveBody).toMatchObject({
        Id: 2,
        Type: "dropdown",
        Options: JSON.stringify(["Web", "Referral", "Walk-in"]),
      });
    });
  });

  it("deletes a field after confirmation", async () => {
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-1"));

    const dialog = await screen.findByTestId("confirmation-dialog");
    expect(within(dialog).getByText(/Budget/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /delete field/i }));

    await waitFor(() => expect(screen.queryByText("Budget")).not.toBeInTheDocument());
  });

  it("surfaces the API error when save fails", async () => {
    server.use(
      http.post("*/api/config/saveCustomField", () =>
        HttpResponse.json({ success: false, message: "Duplicate key", responseCode: 400 }),
      ),
    );
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Label/), "Region");
    await user.click(screen.getByRole("button", { name: /create field/i }));

    expect(await screen.findByText("Duplicate key")).toBeInTheDocument();
  });

  it("surfaces the API error when delete fails", async () => {
    server.use(
      http.post("*/api/config/deleteCustomField", () =>
        HttpResponse.json({ success: false, message: "Field is in use", responseCode: 400 }),
      ),
    );
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-1"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete field/i }));

    expect(await screen.findByText("Field is in use")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
  });

  it("falls back to a generic error when the save request errors", async () => {
    server.use(http.post("*/api/config/saveCustomField", () => HttpResponse.error()));
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-create"));
    await user.type(await screen.findByLabelText(/Label/), "Region");
    await user.click(screen.getByRole("button", { name: /create field/i }));

    expect(await screen.findByText("Failed to save field")).toBeInTheDocument();
  });

  it("falls back to a generic error when the delete request errors", async () => {
    server.use(http.post("*/api/config/deleteCustomField", () => HttpResponse.error()));
    renderPage();
    await screen.findByText("Budget");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("master-grid-delete-1"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /delete field/i }));

    expect(await screen.findByText("Failed to delete field!")).toBeInTheDocument();
  });

  it("shows an empty state when there are no fields", async () => {
    seedFields([]);
    renderPage();
    expect(await screen.findByTestId("master-grid-empty")).toBeInTheDocument();
  });
});
