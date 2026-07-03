import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import TicketsByCategory from "./TicketsByCategory";

describe("TicketsByCategory report", () => {
  it("fetches /api/reports/ticketsByCategory and renders count per category", async () => {
    server.use(
      http.post("*/api/reports/ticketsByCategory", () =>
        HttpResponse.json({
          success: true,
          data: {
            categories: [
              { CategoryId: 1, CategoryName: "Billing", TicketCount: 12 },
              { CategoryId: 2, CategoryName: "Technical", TicketCount: 7 },
            ],
          },
        })
      )
    );

    renderWithProviders(<TicketsByCategory />);

    const table = await screen.findByTestId("tickets-by-category-table");
    expect(within(table).getByText("Billing")).toBeInTheDocument();
    expect(within(table).getByText("12")).toBeInTheDocument();
    expect(within(table).getByText("Technical")).toBeInTheDocument();
    expect(within(table).getByText("7")).toBeInTheDocument();
  });

  it("shows an empty state when there is no category data", async () => {
    server.use(
      http.post("*/api/reports/ticketsByCategory", () =>
        HttpResponse.json({ success: true, data: { categories: [] } })
      )
    );

    renderWithProviders(<TicketsByCategory />);

    expect(await screen.findByTestId("tickets-by-category-empty")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    server.use(
      http.post("*/api/reports/ticketsByCategory", () =>
        HttpResponse.json({ success: false, message: "boom" }, { status: 500 })
      )
    );

    renderWithProviders(<TicketsByCategory />);

    expect(await screen.findByTestId("tickets-by-category-error")).toBeInTheDocument();
  });
});
