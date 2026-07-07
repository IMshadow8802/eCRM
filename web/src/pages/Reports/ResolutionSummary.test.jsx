import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import ResolutionSummary from "./ResolutionSummary";

describe("ResolutionSummary report", () => {
  it("fetches /api/reports/resolutionSummary and renders count per resolution", async () => {
    server.use(
      http.post("*/api/reports/resolutionSummary", () =>
        HttpResponse.json({
          success: true,
          data: {
            resolutions: [
              { ResolutionId: 1, ResolutionName: "Fixed", TicketCount: 30 },
              { ResolutionId: 2, ResolutionName: "Duplicate", TicketCount: 4 },
            ],
          },
        })
      )
    );

    renderWithProviders(<ResolutionSummary />);

    const table = await screen.findByTestId("resolution-summary-table");
    expect(within(table).getByText("Fixed")).toBeInTheDocument();
    expect(within(table).getByText("30")).toBeInTheDocument();
    expect(within(table).getByText("Duplicate")).toBeInTheDocument();
    expect(within(table).getByText("4")).toBeInTheDocument();
  });

  it("shows an empty state when there is no resolution data", async () => {
    server.use(
      http.post("*/api/reports/resolutionSummary", () =>
        HttpResponse.json({ success: true, data: { resolutions: [] } })
      )
    );

    renderWithProviders(<ResolutionSummary />);

    expect(await screen.findByTestId("resolution-summary-empty")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    server.use(
      http.post("*/api/reports/resolutionSummary", () =>
        HttpResponse.json({ success: false, message: "boom" }, { status: 500 })
      )
    );

    renderWithProviders(<ResolutionSummary />);

    expect(await screen.findByTestId("resolution-summary-error")).toBeInTheDocument();
  });
});
