import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import LeadsByStatus from "./LeadsByStatus";
import useAuthStore from "../../stores/useAuthStore";
import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

describe("LeadsByStatus", () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1, API_BASE_URL: "https://prdinfotech.in/CRM" }));

  it("renders one row per status in SortOrder", async () => {
    server.use(http.post("*/api/reports/leadsByStatus", async () => json({ statuses: [
      { StatusId: 11, StatusName: "New", StatusCode: "open", SortOrder: 1, LeadCount: 4 },
      { StatusId: 15, StatusName: "Lost", StatusCode: "lost", SortOrder: 5, LeadCount: 1 },
    ] })));
    renderWithProviders(<LeadsByStatus />);
    const table = await screen.findByTestId("leads-by-status-table");
    expect(table).toHaveTextContent("New");
    expect(table).toHaveTextContent("Lost");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("shows the empty state with no rows", async () => {
    server.use(http.post("*/api/reports/leadsByStatus", async () => json({ statuses: [] })));
    renderWithProviders(<LeadsByStatus />);
    expect(await screen.findByTestId("leads-by-status-empty")).toBeInTheDocument();
  });

  it("shows the error state on a failed request", async () => {
    server.use(http.post("*/api/reports/leadsByStatus", async () => HttpResponse.json({ success: false, message: "boom" }, { status: 500 })));
    renderWithProviders(<LeadsByStatus />);
    expect(await screen.findByTestId("leads-by-status-error")).toBeInTheDocument();
  });
});
