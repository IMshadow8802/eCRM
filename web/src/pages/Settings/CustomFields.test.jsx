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
    http.post("*/api/config/fetchCustomFields", async ({ request }) => {
      lastFetchBody = await request.json();
      return HttpResponse.json({
        success: true,
        message: "ok",
        responseCode: 200,
        data: { customFields: fields },
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
    ]);
  });

  it("lists custom field defs for Entity='lead'", async () => {
    renderPage();
    expect(await screen.findByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Source Detail")).toBeInTheDocument();
    await waitFor(() => expect(lastFetchBody).toMatchObject({ Entity: "lead" }));
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

  it("shows an empty state when there are no fields", async () => {
    seedFields([]);
    renderPage();
    expect(await screen.findByTestId("master-grid-empty")).toBeInTheDocument();
  });
});
