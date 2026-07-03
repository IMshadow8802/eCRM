import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";

import { server } from "../../test/mocks/server";
import renderWithProviders from "../../test/renderWithProviders";
import CallsPerUser from "./CallsPerUser";

const withLocalization = (ui) => (
  <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
);

describe("CallsPerUser report", () => {
  it("fetches /api/reports/callsPerUser with FromDate/ToDate and renders rows", async () => {
    let capturedBody;
    server.use(
      http.post("*/api/reports/callsPerUser", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            calls: [{ UserId: 7, FullName: "Jane", CallCount: 12 }],
          },
        });
      })
    );

    renderWithProviders(withLocalization(<CallsPerUser />));

    const table = await screen.findByTestId("calls-per-user-table");
    expect(within(table).getByText("Jane")).toBeInTheDocument();
    expect(within(table).getByText("12")).toBeInTheDocument();
    expect(capturedBody).toHaveProperty("FromDate");
    expect(capturedBody).toHaveProperty("ToDate");
  });

  it("shows an empty state when there are no calls", async () => {
    server.use(
      http.post("*/api/reports/callsPerUser", () =>
        HttpResponse.json({ success: true, data: { calls: [] } })
      )
    );

    renderWithProviders(withLocalization(<CallsPerUser />));

    expect(await screen.findByTestId("calls-per-user-empty")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    server.use(
      http.post("*/api/reports/callsPerUser", () =>
        HttpResponse.json({ success: false, message: "boom" }, { status: 500 })
      )
    );

    renderWithProviders(withLocalization(<CallsPerUser />));

    expect(await screen.findByTestId("calls-per-user-error")).toBeInTheDocument();
  });
});
