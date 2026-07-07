import { describe, it, expect, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import PipelineFunnel from "./PipelineFunnel";

describe("PipelineFunnel report", () => {
  // The report resolves the default lead pipeline before funneling it.
  beforeEach(() => {
    server.use(
      http.post("*/api/config/fetchPipelines", () =>
        HttpResponse.json({
          success: true,
          data: {
            pipelines: [{ Id: 9, Name: "Sales", IsDefault: true }],
            stages: [],
          },
        })
      )
    );
  });

  it("fetches /api/reports/pipelineFunnel and renders stage rows", async () => {
    server.use(
      http.post("*/api/reports/pipelineFunnel", () =>
        HttpResponse.json({
          success: true,
          data: {
            funnel: [
              { StageId: 1, StageName: "New", LeadCount: 10 },
              { StageId: 2, StageName: "Qualified", LeadCount: 4 },
            ],
          },
        })
      )
    );

    renderWithProviders(<PipelineFunnel />);

    const table = await screen.findByTestId("pipeline-funnel-table");
    expect(within(table).getByText("New")).toBeInTheDocument();
    expect(within(table).getByText("Qualified")).toBeInTheDocument();
    expect(within(table).getByText("10")).toBeInTheDocument();
    expect(within(table).getByText("4")).toBeInTheDocument();
  });

  it("shows an empty state when there are no stages", async () => {
    server.use(
      http.post("*/api/reports/pipelineFunnel", () =>
        HttpResponse.json({ success: true, data: { funnel: [] } })
      )
    );

    renderWithProviders(<PipelineFunnel />);

    expect(await screen.findByTestId("pipeline-funnel-empty")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    server.use(
      http.post("*/api/reports/pipelineFunnel", () =>
        HttpResponse.json({ success: false, message: "boom" }, { status: 500 })
      )
    );

    renderWithProviders(<PipelineFunnel />);

    expect(await screen.findByTestId("pipeline-funnel-error")).toBeInTheDocument();
  });
});
