import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import SLABreach from "./SLABreach";

describe("SLABreach report", () => {
  it("fetches /api/reports/slaBreachSummary and renders open/breached per priority", async () => {
    server.use(
      http.post("*/api/reports/slaBreachSummary", () =>
        HttpResponse.json({
          success: true,
          data: {
            breach: [
              { Priority: 1, PriorityName: "High", TotalOpen: 20, Breached: 5 },
              { Priority: 2, PriorityName: "Low", TotalOpen: 0, Breached: 0 },
            ],
          },
        })
      )
    );

    renderWithProviders(<SLABreach />);

    const table = await screen.findByTestId("sla-breach-table");
    expect(within(table).getByText("High")).toBeInTheDocument();
    expect(within(table).getByText("20")).toBeInTheDocument();
    // 5 / 20 = 25%
    expect(within(table).getByText("25%")).toBeInTheDocument();
    // divide-by-zero guarded on the Low row
    expect(within(table).getByText("Low")).toBeInTheDocument();
    expect(within(table).getByText("—")).toBeInTheDocument();
  });

  it("shows an empty state when there is no breach data", async () => {
    server.use(
      http.post("*/api/reports/slaBreachSummary", () =>
        HttpResponse.json({ success: true, data: { breach: [] } })
      )
    );

    renderWithProviders(<SLABreach />);

    expect(await screen.findByTestId("sla-breach-empty")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    server.use(
      http.post("*/api/reports/slaBreachSummary", () =>
        HttpResponse.json({ success: false, message: "boom" }, { status: 500 })
      )
    );

    renderWithProviders(<SLABreach />);

    expect(await screen.findByTestId("sla-breach-error")).toBeInTheDocument();
  });
});
