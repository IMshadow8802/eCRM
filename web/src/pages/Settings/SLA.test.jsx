import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import SLA from "./SLA";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const renderPage = () => renderWithProviders(<SLA />);

let priorities;
let slaRules;
let lastSaveBody;

const seed = ({ priorityRows, ruleRows } = {}) => {
  priorities = priorityRows ?? [
    { Id: 1, Value: "High" },
    { Id: 2, Value: "Low" },
  ];
  slaRules =
    ruleRows ?? [
      { Id: 10, Priority: 1, PriorityName: "High", ResponseMins: 30, ResolutionMins: 120, IsActive: true },
    ];
  server.use(
    http.post("*/api/config/fetchLookups", async ({ request }) => {
      const body = await request.json();
      return HttpResponse.json({
        success: true,
        responseCode: 200,
        data: { lookups: body.Kind === "priority" ? priorities : [] },
      });
    }),
    http.post("*/api/tickets/fetchSLARules", async () =>
      HttpResponse.json({ success: true, responseCode: 200, data: { slaRules } })
    ),
    http.post("*/api/tickets/saveSLARule", async ({ request }) => {
      lastSaveBody = await request.json();
      return HttpResponse.json({ success: true, message: "Saved", responseCode: 200 });
    }),
  );
};

describe("SLA page", () => {
  beforeEach(() => {
    lastSaveBody = undefined;
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
    seed();
  });

  it("lists each priority with its current SLA minutes", async () => {
    renderPage();
    expect(await screen.findByText("High")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();

    // High has a rule → its mins are pre-filled.
    await waitFor(() =>
      expect(screen.getByLabelText("Response minutes for High")).toHaveValue(30)
    );
    expect(screen.getByLabelText("Resolution minutes for High")).toHaveValue(120);
    // Low has no rule → defaults to 0.
    expect(screen.getByLabelText("Resolution minutes for Low")).toHaveValue(0);
  });

  it("saves an existing rule with its rule Id and edited resolution", async () => {
    renderPage();
    await screen.findByText("High");

    const user = userEvent.setup();
    const input = screen.getByLabelText("Resolution minutes for High");
    await user.clear(input);
    await user.type(input, "240");
    await user.click(screen.getByTestId("sla-save-1"));

    await waitFor(() =>
      expect(lastSaveBody).toMatchObject({ Id: 10, Priority: 1, ResponseMins: 30, ResolutionMins: 240 })
    );
  });

  it("saves a priority without an existing rule as a new rule (Id 0)", async () => {
    renderPage();
    await screen.findByText("Low");

    const user = userEvent.setup();
    const input = screen.getByLabelText("Resolution minutes for Low");
    await user.clear(input);
    await user.type(input, "480");
    await user.click(screen.getByTestId("sla-save-2"));

    await waitFor(() =>
      expect(lastSaveBody).toMatchObject({ Id: 0, Priority: 2, ResolutionMins: 480 })
    );
  });

  it("prompts to add priorities when none exist", async () => {
    seed({ priorityRows: [], ruleRows: [] });
    renderPage();
    expect(await screen.findByTestId("sla-empty")).toBeInTheDocument();
  });
});
