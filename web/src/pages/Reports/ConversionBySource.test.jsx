import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import ConversionBySource from "./ConversionBySource";

describe("ConversionBySource report", () => {
  it("fetches /api/reports/conversionBySource and renders total/won per source", async () => {
    server.use(
      http.post("*/api/reports/conversionBySource", () =>
        HttpResponse.json({
          success: true,
          data: {
            conversion: [{ SourceId: 1, SourceName: "Website", TotalLeads: 50, WonCount: 8 }],
          },
        })
      )
    );

    renderWithProviders(<ConversionBySource />);

    const table = await screen.findByTestId("conversion-by-source-table");
    expect(within(table).getByText("Website")).toBeInTheDocument();
    expect(within(table).getByText("50")).toBeInTheDocument();
    expect(within(table).getByText("8")).toBeInTheDocument();
    expect(within(table).getByText("16%")).toBeInTheDocument();
  });

  it("dashes the win rate for a source with no leads rather than dividing by zero", async () => {
    // A configured source nobody has used yet comes back with TotalLeads 0;
    // the unguarded division rendered "NaN%".
    server.use(
      http.post("*/api/reports/conversionBySource", () =>
        HttpResponse.json({
          success: true,
          data: {
            conversion: [{ SourceId: 9, SourceName: "Billboard", TotalLeads: 0, WonCount: 0 }],
          },
        })
      )
    );

    renderWithProviders(<ConversionBySource />);

    const table = await screen.findByTestId("conversion-by-source-table");
    expect(within(table).getByText("—")).toBeInTheDocument();
    expect(within(table).queryByText("NaN%")).not.toBeInTheDocument();
  });

  it("shows an empty state when there is no conversion data", async () => {
    server.use(
      http.post("*/api/reports/conversionBySource", () =>
        HttpResponse.json({ success: true, data: { conversion: [] } })
      )
    );

    renderWithProviders(<ConversionBySource />);

    expect(await screen.findByTestId("conversion-by-source-empty")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    server.use(
      http.post("*/api/reports/conversionBySource", () =>
        HttpResponse.json({ success: false, message: "boom" }, { status: 500 })
      )
    );

    renderWithProviders(<ConversionBySource />);

    expect(await screen.findByTestId("conversion-by-source-error")).toBeInTheDocument();
  });
});
